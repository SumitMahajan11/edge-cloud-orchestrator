# Security Hardening Review

## Step 1: WebSocket Authentication Enforcement

**1. Is `jwt.verify()` called with `env.JWT_SECRET`? (not a hardcoded string)**
**Yes.** In `apps/api/src/services/websocket-manager.ts`, the code correctly pulls the secret from the validated environment configuration.
*Code Evidence (Lines 75-76):*
```typescript
      const jwtSecret = env.JWT_SECRET;
      const decoded = jwt.verify(token, jwtSecret) as any;
```

**2. If the token is expired, does the socket close with a specific error code?**
**Yes.** The system specifically intercepts `jwt.TokenExpiredError` and closes the socket with a distinct `4002` error code, separate from the generic `4001 Unauthorized` code.
*Code Evidence (Lines 162-164):*
```typescript
      if (err instanceof jwt.TokenExpiredError) {
        this.logger.warn({ err }, '[WebSocket] Token expired');
        socket.close(4002, 'Token Expired');
```

**3. Is the tenantId extracted from the JWT payload and stored per-connection?**
**Yes.** The `tenantId` (along with `id` and `role`) is extracted from the decoded token and stored inside the `WebSocketClient` object, which is tied to the connection.
*Code Evidence (Lines 77, 86-94):*
```typescript
      const { id: userId, tenantId, role } = decoded;
      // ...
      const client: WebSocketClient = {
        socket,
        tenantId,
        userId,
        role,
        subscriptions: new Set(),
        connectedAt: new Date(),
        isAuthenticated: true,
      };
```

**4. Does the `broadcastToTenant` method filter by tenantId before sending?**
**Yes.** `broadcastToTenant` delegates to `broadcast`, which namespaces the Redis pub/sub channel. However, for defense-in-depth, the `handleRedisMessage` method explicitly ensures that users cannot receive events intended for another tenant.
*Code Evidence (Lines 336-340):*
```typescript
        // Defense-in-depth: Ensure non-SUPER_ADMIN users cannot receive events of other tenants
        if (client.role !== 'SUPER_ADMIN') {
          if (tenantId && tenantId !== 'system' && client.tenantId !== tenantId) {
            continue;
          }
        }
```

**5. Is there a `socket.on('close', ...)` handler that cleans up the client from memory?**
**Yes.** The handler instantly removes the connection from the active `this.clients` map to prevent memory leaks and stores it temporarily in a `disconnectedClients` cache (for 60 seconds) to allow seamless reconnection.
*Code Evidence (Lines 142-155):*
```typescript
      socket.on('close', () => {
        this.clients.delete(connectionId);
        this.disconnectedClients.set(connectionId, {
          // ... 
        });
        setTimeout(() => {
          this.disconnectedClients.delete(connectionId);
        }, 60000);
        this.logger.info({ connectionId }, '[WebSocket] Client disconnected');
      });
```

## Step 2: Fix Found Issues
All of the WebSocket checks evaluated in Step 1 passed correctly. Authentication and tenant isolation logic were implemented properly and no logic fixes were required in the websocket manager for this step.

## Step 3: Review API Gateway mTLS validation
**Findings for API Gateway mTLS validation:**
The API gateway is implemented using Nginx (`apps/api-gateway/nginx.conf`), and the file `apps/api-gateway/src/index.ts` specified in the prompt does not actually exist in the codebase. 

Upon reviewing the `nginx.conf` file, **requests to internal microservices do NOT forward the client certificate.**
The Nginx configuration defines TLS for `api.edgecloud.io` over port 443, but it lacks the required directives to enforce mutual TLS (mTLS) or forward the client certificate. Specifically, the following expected directives are missing:
* `ssl_verify_client on;` (to enforce mTLS validation at the gateway)
* `proxy_set_header X-Client-Cert $ssl_client_escaped_cert;` (to forward the certificate to downstream microservices, which expect it in the `x-client-cert` header).

*Note: This is a vulnerability if the internal microservices assume the gateway is verifying and forwarding client certificates.*

## Step 4: Verify SSRF protection
**Findings for Webhook SSRF validation:**
**Yes, SSRF protection is successfully enforced.** In `apps/api/src/routes/webhooks.ts`, when creating or updating a webhook, the destination URL is validated using the `validateWebhookUrl(url)` function imported from `@edgecloud/shared-kernel`. 

If the URL resolves to an unsafe destination, the API outright rejects the request with a `400 Bad Request` and `INVALID_WEBHOOK_URL` error code.
*Code Evidence (Lines 98-108):*
```typescript
      // SSRF Protection
      const { safe, reason } = await validateWebhookUrl(url);
      if (!safe) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_WEBHOOK_URL',
            message: `Webhook URL rejected: ${reason}`,
            requestId: request.id,
          }
        });
      }
```
A review of the `ssrf-protection.spec.ts` inside `@edgecloud/shared-kernel` confirms that `validateWebhookUrl` accurately blocks URLs that resolve to internal IPs (like `10.x.x.x` or `192.168.x.x`), localhost (`127.0.0.1`), metadata endpoints (`169.254.169.254`), and non-HTTP protocols (`file://`, `ftp://`).
