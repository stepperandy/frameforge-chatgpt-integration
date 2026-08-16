# FrameForge ChatGPT App deployment

## Production target

- App name: FrameForge
- Product website: https://frameforger.com
- MCP origin: https://chatgpt.frameforger.com
- MCP endpoint: https://chatgpt.frameforger.com/mcp
- Health endpoint: https://chatgpt.frameforger.com/healthz
- OAuth protected-resource metadata:
  - https://chatgpt.frameforger.com/.well-known/oauth-protected-resource
  - https://chatgpt.frameforger.com/.well-known/oauth-protected-resource/mcp

## 1. Create the DNS record

Create `chatgpt.frameforger.com` as a CNAME/ALIAS to the hostname supplied by the hosting provider. Do not point it at FrameForger.com itself unless that server is intentionally reverse-proxying the integration service.

## 2. Configure environment variables

Copy `.env.example` into the hosting provider's secret/environment settings. For production, all URLs must use HTTPS and `ALLOW_UNVERIFIED_BEARER` must remain `false`.

The remaining values that require owner/provider access are:

- `FRAMEFORGE_API_BASE`: reachable backend gateway for FrameForge generation functions.
- `OAUTH_ISSUER`: OAuth 2.1/OpenID Connect issuer that owns FrameForge account login.
- `OAUTH_JWKS_URL`: issuer JWKS endpoint for JWT signature verification.
- `OAUTH_AUDIENCE`: should identify this MCP resource, normally `https://chatgpt.frameforger.com`.

## 3. Account-linking contract

Preferred mode is `FRAMEFORGE_BACKEND_AUTH_MODE=forward`. The bearer token accepted by this MCP service must also be accepted by the FrameForge backend gateway and map to the same FrameForge user. That preserves credits, ownership, and audit history.

If the identity provider's token is not directly understood by FrameForge, add a trusted backend token-exchange/gateway. Do not forward arbitrary identity claims from the browser and do not trust `email` alone as authorization.

## 4. Backend gateway routes expected by this service

The integration currently calls JSON POST endpoints relative to `FRAMEFORGE_API_BASE`:

- `/generateImage`
- `/generateVideo`
- `/generateScene`

Each request receives `Authorization: Bearer <linked-user-token>` in forward mode. The gateway should invoke the existing Base44 FrameForge functions as that authenticated user so credit checks and data ownership remain enforced.

## 5. Validate before launch

Run:

```bash
npm run check
NODE_ENV=production npm run validate:config
npm start
npm run smoke
```

Then verify the public URLs with curl and test the MCP endpoint in MCP Inspector and ChatGPT Developer Mode.

## 6. ChatGPT Developer Mode

In ChatGPT, enable Developer Mode under Settings > Apps & Connectors > Advanced settings. Create a new app using:

`https://chatgpt.frameforger.com/mcp`

Complete FrameForge OAuth linking and test every starter prompt in `submission.json`.

## 7. Submission gates

Before submitting publicly, confirm:

- Publisher identity/organization verification is complete.
- The production `/mcp` endpoint is stable and HTTPS-only.
- OAuth login, reconnect, logout/revocation, and expired-token paths work.
- Privacy policy, terms, and support pages are public on FrameForger.com.
- App icon/screenshots are final.
- Five positive and three negative review tests have been run against production.
- Tool names/descriptions/annotations match actual behavior.
- No secrets, internal error payloads, or private URLs are returned to ChatGPT.

