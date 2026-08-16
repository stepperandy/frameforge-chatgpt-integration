# FrameForge ChatGPT Integration

Separate MCP + widget integration service for the **FrameForge** product. The public SaaS remains **https://frameforger.com**.

## Architecture

ChatGPT -> `https://chatgpt.frameforger.com/mcp` -> this integration service -> FrameForge backend -> FrameForger.com

The service is intentionally separate from the main FrameForge web app. It does not contain FrameForge generation logic; it exposes ChatGPT-safe MCP tools and forwards authenticated requests to the existing backend.

## MCP tools

- `generate_image` -> FrameForge `generateImage`
- `generate_video` -> FrameForge `generateVideo`
- `generate_scene` -> FrameForge `generateScene`
- `open_frameforge` -> opens the full FrameForge experience at FrameForger.com

All generation tools are marked as mutating, non-destructive, open-world operations. `open_frameforge` is read-only and idempotent.

## Authentication

Public launch is configured for OAuth 2.1 resource-server behavior.

The service exposes:

- `GET /.well-known/oauth-protected-resource`
- per-tool OAuth `securitySchemes`
- `mcp/www_authenticate` challenges for unauthenticated tool calls
- JWT signature, issuer, audience, expiry, and scope verification when `OAUTH_ISSUER` and `OAUTH_JWKS_URL` are configured

Use an established OAuth identity provider that supports the MCP authorization requirements and PKCE. Do not launch publicly with `ALLOW_UNVERIFIED_BEARER=true`.

The preferred backend mode is `FRAMEFORGE_BACKEND_AUTH_MODE=forward`, which forwards the linked user's bearer token to the FrameForge backend. This only works when the FrameForge backend recognizes tokens from the same issuer. If a separate identity provider is used, add a trusted server-side account-mapping gateway before enabling production generation.

## Environment

Copy `.env.example` into your hosting provider's secret/environment settings.

Required for production:

- `MCP_PUBLIC_ORIGIN=https://chatgpt.frameforger.com`
- `FRAMEFORGE_API_BASE=<authenticated FrameForge gateway/base URL>`
- `OAUTH_ISSUER=<authorization server issuer>`
- `OAUTH_JWKS_URL=<authorization server JWKS URL>`
- `OAUTH_AUDIENCE=https://chatgpt.frameforger.com`

## Local development

```bash
npm install
npm start
```

Health endpoint:

```bash
curl http://localhost:8787/healthz
```

MCP endpoint:

```text
http://localhost:8787/mcp
```

For local ChatGPT testing, expose the server over a public HTTPS tunnel and add the tunneled `/mcp` URL in ChatGPT Developer Mode.

## Deployment

A `Dockerfile` and `render.yaml` are included. A suitable production deployment should:

1. run Node 20+ behind HTTPS;
2. map `chatgpt.frameforger.com` to the service;
3. keep OAuth and backend credentials in the hosting provider's secret store;
4. preserve streaming requests to `/mcp`;
5. route `/healthz` to health checks;
6. log request IDs, latency, backend status codes, and sanitized errors without logging bearer tokens.

## Submission package

`submission.json` contains the proposed listing name, short description, MCP URL, starter prompts, five positive review tests, and three negative review tests.

Before submitting publicly, verify that these URLs exist and accurately describe FrameForge data handling:

- website: `https://frameforger.com`
- privacy policy
- terms
- support/contact page

Also complete OpenAI developer/business identity verification in the same organization that submits the plugin/app.

## Validation status

Completed in this build:

- Node syntax check (`npm run check`)
- static MCP contract review
- OAuth protected-resource metadata route added
- tool-level OAuth security schemes added
- JWT verification path added
- Docker/Render deployment files added
- submission manifest added

Not completed in this environment:

- dependency installation (network install timed out)
- live MCP Inspector run
- end-to-end OAuth login
- live FrameForge generation call
- ChatGPT Developer Mode connection

Those require a reachable OAuth provider, production/test FrameForge backend URL, and deployed HTTPS endpoint.

