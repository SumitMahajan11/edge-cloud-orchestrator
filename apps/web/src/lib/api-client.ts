import { context, propagation } from "@opentelemetry/api";
import { getActiveTenantId } from "../contexts/TenantContext";

/**
 * Enhanced fetch wrapper that layers the following on top of the plain
 * fetch:
 *   1. X-Tenant-ID header from the active tenant context
 *   2. traceparent/tracestate headers injected from the OTel active context
 *   3. 429 rate-limit respect with Retry-After (up to 2 retries)
 *   4. Automatic 401 token refresh
 *
 * Use this for all REST communication to maintain OTel trace propagation
 * and consistent tenant isolation.
 */

import {
  client,
  postV2AuthLogin,
  postV2AuthRegister,
  postV2AuthLogout,
  getV2AuthMe,
} from "@edgecloud/api-client";
import { authStorage } from "./auth-storage";
export { authStorage };
import { transformUserFromApi } from "./typeTransformers";

function getBaseUrl(): string {
  if (typeof window !== "undefined") {
    if (
      window.location.port === "3000" ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1"
    ) {
      return "http://localhost:3090";
    }
  }
  return process.env.NEXT_PUBLIC_API_URL || "http://localhost:3090";
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function buildHeaders(init?: HeadersInit): Promise<Headers> {
  const h = new Headers(init);
  if (!h.has("Content-Type")) h.set("Content-Type", "application/json");

  const token = authStorage.getToken();
  console.log("[api-client] buildHeaders token from storage:", token ? `exists (${token.substring(0, 10)}...)` : "null/undefined");
  if (token) h.set("Authorization", `Bearer ${token}`);

  const tenantId = getActiveTenantId();
  if (tenantId) h.set("X-Tenant-ID", tenantId);

  // Inject OTel traceparent from active context
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  for (const k of Object.keys(carrier)) {
    if (carrier[k]) h.set(k, carrier[k]);
  }

  return h;
}

let refreshPromise: Promise<boolean> | null = null;

async function refreshAuth(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const rt = authStorage.getRefreshToken();
    if (!rt) return false;
    try {
      const res = await fetch(`${getBaseUrl()}/v2/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: rt }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (data?.token) {
        authStorage.setToken(data.token);
        if (data.refreshToken) authStorage.setRefreshToken(data.refreshToken);
        return true;
      }
    } catch {
      /* fall through */
    } finally {
      refreshPromise = null;
    }
    return false;
  })();

  return refreshPromise;
}

async function customFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  let attempt = 0;
  let refreshed = false;

  const url = input instanceof Request ? input.url : String(input);
  console.log("[api-client] customFetch starting for:", url);

  while (true) {
    // When the @hey-api/openapi-ts client calls customFetch, it passes
    // a fully-constructed Request object as `input` and undefined as `init`.
    // The Request object contains serialized body, content-type, etc.
    // We must extract those headers and merge them with our auth headers,
    // otherwise fetch(requestObj, { headers }) completely replaces them.
    let baseHeaders: HeadersInit | undefined = init?.headers;
    if (!baseHeaders && input instanceof Request) {
      baseHeaders = input.headers;
    }
    const headers = await buildHeaders(baseHeaders);
    const headersObj: Record<string, string> = {};
    headers.forEach((value, key) => {
      headersObj[key] = value;
    });

    console.log("[api-client] customFetch headers for", url, ":", JSON.stringify(headersObj));

    let req: Request;
    if (input instanceof Request) {
      req = new Request(input, { headers: headersObj });
    } else {
      req = new Request(input, { ...init, headers: headersObj });
    }

    const res = await fetch(req);

    if (res.status === 429 && attempt < 2) {
      const retryAfter = Number(res.headers.get("Retry-After") ?? "1");
      const delay = Math.min(
        30_000,
        (isNaN(retryAfter) ? 1 : retryAfter) * 1000,
      );
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
      continue;
    }

    if (res.status === 401 && !refreshed) {
      refreshed = true;
      const ok = await refreshAuth();
      if (ok) continue;
      authStorage.clear();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("auth-unauthorized"));
      }
    }

    if (!res.ok) {
      // Clone response to read text without consuming it for the caller (though openapi-ts throws on its own usually)
      // openapi-ts will handle throwing, so we can just return res unless we want to intercept
      return res;
    }

    return res;
  }
}

// Configure the global generated client
client.setConfig({
  baseUrl: getBaseUrl(),
  fetch: customFetch,
});

// Keep a minimal api fetch fallback for non-SDK routes if absolutely needed
export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit & { maxRateLimitRetries?: number } = {},
): Promise<T> {
  const url = path.startsWith("http") ? path : `${getBaseUrl()}${path}`;
  const res = await customFetch(url, options);

  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {}

  if (!res.ok) {
    const msg =
      (body as any)?.error ||
      (body as any)?.message ||
      res.statusText ||
      "Request failed";
    throw new ApiError(String(msg), res.status, body);
  }
  return body as T;
}

export const api = {
  get: <T = unknown>(path: string, init?: RequestInit) =>
    apiFetch<T>(path, { ...init, method: "GET" }),
  post: <T = unknown>(path: string, body?: unknown, init?: RequestInit) =>
    apiFetch<T>(path, {
      ...init,
      method: "POST",
      body: body ? JSON.stringify(body) : null,
    }),
  patch: <T = unknown>(path: string, body?: unknown, init?: RequestInit) =>
    apiFetch<T>(path, {
      ...init,
      method: "PATCH",
      body: body ? JSON.stringify(body) : null,
    }),
  put: <T = unknown>(path: string, body?: unknown, init?: RequestInit) =>
    apiFetch<T>(path, {
      ...init,
      method: "PUT",
      body: body ? JSON.stringify(body) : null,
    }),
  delete: <T = unknown>(path: string, init?: RequestInit) =>
    apiFetch<T>(path, { ...init, method: "DELETE" }),
};

export const authApi = {
  login: async (email: string, password: string) => {
    const { data, error } = await postV2AuthLogin({
      body: { email, password },
    });
    if (error) throw new ApiError("Login failed", 401, error);
    const body = data as any;

    // Persist tokens so every subsequent API call carries Authorization header
    if (body.token) authStorage.setToken(body.token);
    if (body.refreshToken) authStorage.setRefreshToken(body.refreshToken);

    const user = transformUserFromApi(body.user);
    authStorage.setUser(user as any);

    return { token: body.token, refreshToken: body.refreshToken, user };
  },
  register: async (email: string, password: string, name: string) => {
    const { data, error } = await postV2AuthRegister({
      body: { email, password, name },
    });
    if (error) throw new ApiError("Registration failed", 400, error);
    return transformUserFromApi((data as any).user ?? data);
  },
  logout: async () => {
    authStorage.clear();
    await postV2AuthLogout();
  },
  getMe: async () => {
    const { data, error } = await getV2AuthMe();
    if (error) throw new ApiError("Fetch failed", 400, error);
    return transformUserFromApi(data);
  },
};

export const apiClient = api;
