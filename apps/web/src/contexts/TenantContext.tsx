import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { authStorage } from "../lib/auth-storage";

/**
 * TenantContext decodes the current JWT to surface the active tenantId.
 * Super-admin users can switch the active tenant via setActiveTenantId();
 * this value is mirrored into localStorage and picked up by api-client headers.
 */

const ACTIVE_TENANT_KEY = "active_tenant_id";

export interface TenantInfo {
  tenantId: string | null;
  tenantName?: string | null;
  isSuperAdmin: boolean;
  availableTenants: Array<{ id: string; name: string }>;
  setActiveTenantId: (tenantId: string) => void;
}

const TenantContext = createContext<TenantInfo | undefined>(undefined);

/**
 * Minimal, dependency-free JWT payload decoder. Returns {} on failure.
 */
function decodeJwt(token: string | null): Record<string, any> {
  if (!token) return {};
  try {
    const parts = token.split(".");
    if (parts.length < 2) return {};
    const payload = parts[1];
    if (!payload) return {};
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = atob(padded);
    return JSON.parse(json);
  } catch {
    return {};
  }
}

export function TenantProvider({ children }: { children: ReactNode }) {
  const [tokenTick, setTokenTick] = useState(0);
  const [overrideTenantId, setOverrideTenantId] = useState<string | null>(() =>
    typeof window !== "undefined"
      ? localStorage.getItem(ACTIVE_TENANT_KEY)
      : null,
  );

  // Refresh tenant info whenever auth_token changes in another tab
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "auth_token") setTokenTick((t) => t + 1);
      if (e.key === ACTIVE_TENANT_KEY) {
        setOverrideTenantId(e.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Re-read token on every render-tick trigger
  const claims = useMemo(() => {
    void tokenTick;
    return decodeJwt(authStorage.getToken());
  }, [tokenTick]);

  const jwtTenantId: string | null =
    claims.tenantId ?? claims.tenant_id ?? null;
  const role: string = (claims.role ?? "").toString().toLowerCase();
  const isSuperAdmin =
    role === "admin" || role === "super_admin" || role === "superadmin";
  const availableTenants: Array<{ id: string; name: string }> = Array.isArray(
    claims.tenants,
  )
    ? claims.tenants
    : [];

  const setActiveTenantId = useCallback((tenantId: string) => {
    localStorage.setItem(ACTIVE_TENANT_KEY, tenantId);
    setOverrideTenantId(tenantId);
  }, []);

  const value: TenantInfo = {
    tenantId: overrideTenantId || jwtTenantId,
    tenantName: claims.tenantName ?? claims.tenant_name ?? null,
    isSuperAdmin,
    availableTenants,
    setActiveTenantId,
  };

  return (
    <TenantContext.Provider value={value}>{children}</TenantContext.Provider>
  );
}

export function useTenant(): TenantInfo {
  const ctx = useContext(TenantContext);
  if (!ctx) {
    throw new Error("useTenant must be used within a TenantProvider");
  }
  return ctx;
}

/**
 * Read the current active tenant id outside React (for api-client headers).
 */
export function getActiveTenantId(): string | null {
  if (typeof window === "undefined") return null;
  const override = localStorage.getItem(ACTIVE_TENANT_KEY);
  if (override) return override;
  const claims = decodeJwt(authStorage.getToken());
  return claims.tenantId ?? claims.tenant_id ?? null;
}
