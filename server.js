import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";

const PORT = Number(process.env.PORT || 8787);
const MCP_PATH = "/mcp";
const FRAMEFORGE_API_BASE = (process.env.FRAMEFORGE_API_BASE || "").replace(/\/$/, "");
const FRAMEFORGE_WEB_URL = (process.env.FRAMEFORGE_WEB_URL || "https://frameforger.com").replace(/\/$/, "");
const MCP_PUBLIC_ORIGIN = (process.env.MCP_PUBLIC_ORIGIN || "http://localhost:8787").replace(/\/$/, "");
const OAUTH_ISSUER = (process.env.OAUTH_ISSUER || "").replace(/\/$/, "");
const OAUTH_JWKS_URL = process.env.OAUTH_JWKS_URL || "";
const OAUTH_AUDIENCE = process.env.OAUTH_AUDIENCE || MCP_PUBLIC_ORIGIN;
const AUTH_MODE = (process.env.AUTH_MODE || "oauth").toLowerCase();
const FRAMEFORGE_BACKEND_AUTH_MODE = (process.env.FRAMEFORGE_BACKEND_AUTH_MODE || "forward").toLowerCase();
const FRAMEFORGE_SERVICE_TOKEN = process.env.FRAMEFORGE_SERVICE_TOKEN || "";
const SCOPES = ["frameforge.generate", "frameforge.projects.read"];
const WIDGET_URI = "ui://frameforge/result-v1.html";
const widgetHtml = readFileSync(new URL("./public/frameforge-widget.html", import.meta.url), "utf8");
const jwks = OAUTH_JWKS_URL ? createRemoteJWKSet(new URL(OAUTH_JWKS_URL)) : null;

function json(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body));
}

function requireBackend() {
  if (!FRAMEFORGE_API_BASE) throw new Error("FRAMEFORGE_API_BASE is not configured");
}

function authChallenge(error = "invalid_token", description = "Connect your FrameForge account to continue") {
  const metadata = `${MCP_PUBLIC_ORIGIN}/.well-known/oauth-protected-resource`;
  return `Bearer resource_metadata="${metadata}", error="${error}", error_description="${description.replace(/"/g, "'")}"`;
}

function authError(description = "Authentication required") {
  return {
    content: [{ type: "text", text: description }],
    structuredContent: {
      type: "auth_required",
      status: "failed",
      message: description,
      openUrl: FRAMEFORGE_WEB_URL,
    },
    _meta: { "mcp/www_authenticate": [authChallenge("invalid_token", description)] },
    isError: true,
  };
}

async function verifyAccessToken(authHeader) {
  if (AUTH_MODE === "none") return { token: null, claims: { sub: "local-dev" } };
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  // Production mode verifies JWT signature + issuer + audience when JWKS is configured.
  // This keeps token verification at the MCP resource server, as required by OAuth 2.1.
  if (jwks && OAUTH_ISSUER) {
    const verified = await jwtVerify(token, jwks, {
      issuer: OAUTH_ISSUER,
      audience: OAUTH_AUDIENCE,
    });
    const scopeValue = verified.payload.scope || verified.payload.scp || "";
    const scopes = Array.isArray(scopeValue) ? scopeValue : String(scopeValue).split(/\s+/).filter(Boolean);
    if (!SCOPES.some((scope) => scopes.includes(scope))) {
      throw Object.assign(new Error("The access token does not include a FrameForge scope"), { status: 401 });
    }
    return { token, claims: verified.payload };
  }

  // For development/provider bring-up only. Public launch should configure issuer + JWKS.
  if (process.env.ALLOW_UNVERIFIED_BEARER === "true") return { token, claims: {} };
  throw Object.assign(new Error("OAuth verifier is not configured"), { status: 503 });
}

async function callFrameForge(path, payload, identity) {
  requireBackend();
  const headers = { "content-type": "application/json" };
  if (FRAMEFORGE_BACKEND_AUTH_MODE === "forward") {
    if (!identity?.token) throw Object.assign(new Error("FrameForge account connection is required"), { status: 401 });
    headers.authorization = `Bearer ${identity.token}`;
  } else if (FRAMEFORGE_BACKEND_AUTH_MODE === "service") {
    if (!FRAMEFORGE_SERVICE_TOKEN) throw new Error("FRAMEFORGE_SERVICE_TOKEN is not configured");
    headers.authorization = `Bearer ${FRAMEFORGE_SERVICE_TOKEN}`;
    if (identity?.claims?.sub) headers["x-frameforge-user-sub"] = String(identity.claims.sub);
    if (identity?.claims?.email) headers["x-frameforge-user-email"] = String(identity.claims.email);
  }

  const response = await fetch(`${FRAMEFORGE_API_BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data?.error || `FrameForge backend returned ${response.status}`);
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}

function safeResult(type, title, payload) {
  const mediaUrl = payload?.image?.image_url || payload?.video?.video_url || payload?.scene_url || null;
  const id = payload?.image?.id || payload?.video?.id || payload?.composition?.id || null;
  return {
    type,
    title,
    status: "ready",
    mediaUrl,
    itemId: id,
    openUrl: id ? `${FRAMEFORGE_WEB_URL}/?item=${encodeURIComponent(id)}` : FRAMEFORGE_WEB_URL,
  };
}

function errorResult(error) {
  if (error?.status === 401 || error?.status === 403) return authError(error.message);
  const insufficient = error?.status === 402 || error?.data?.insufficient_credits;
  return {
    content: [{
      type: "text",
      text: insufficient
        ? "FrameForge needs more credits for this generation. Open FrameForge to add credits and continue."
        : `FrameForge could not complete the request: ${error.message}`,
    }],
    structuredContent: {
      type: "error",
      status: "failed",
      message: insufficient ? "Insufficient FrameForge credits" : "Generation failed",
      insufficientCredits: Boolean(insufficient),
      openUrl: FRAMEFORGE_WEB_URL,
    },
    isError: true,
  };
}

const oauthSecurity = [{ type: "oauth2", scopes: ["frameforge.generate"] }];
const readSecurity = [{ type: "oauth2", scopes: ["frameforge.projects.read"] }];
const noAuthSecurity = [{ type: "noauth" }];

function createFrameForgeServer(identity) {
  const server = new McpServer({ name: "frameforge", version: "0.2.0" });

  registerAppResource(server, "frameforge-result", WIDGET_URI, {}, async () => ({
    contents: [{
      uri: WIDGET_URI,
      mimeType: RESOURCE_MIME_TYPE,
      text: widgetHtml,
      _meta: {
        "ui/domain": MCP_PUBLIC_ORIGIN,
        "ui/prefersBorder": true,
        "ui/csp": {
          connectDomains: [FRAMEFORGE_API_BASE, FRAMEFORGE_WEB_URL].filter(Boolean),
          resourceDomains: [FRAMEFORGE_WEB_URL].filter(Boolean),
        },
        "openai/widgetDescription": "Shows a FrameForge image, video, or scene result and lets the user continue in the full FrameForge studio on FrameForger.com.",
      },
    }],
  }));

  registerAppTool(server, "generate_image", {
    title: "Generate FrameForge image",
    description: "Use this when the user wants to create a cinematic image, storyboard frame, concept frame, or visual in FrameForge.",
    inputSchema: {
      title: z.string().min(1).max(120),
      prompt: z.string().min(1).max(2000),
      style: z.string().max(120).optional(),
      reference_image: z.string().url().optional(),
    },
    securitySchemes: AUTH_MODE === "none" ? noAuthSecurity : oauthSecurity,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
    _meta: { "ui/resourceUri": WIDGET_URI, "openai/outputTemplate": WIDGET_URI },
  }, async ({ title, prompt, style, reference_image }) => {
    if (AUTH_MODE !== "none" && !identity) return authError();
    try {
      const data = await callFrameForge("/generateImage", { title, prompt, style, reference_image }, identity);
      return { content: [{ type: "text", text: `FrameForge generated “${title}”.` }], structuredContent: safeResult("image", title, data) };
    } catch (error) { return errorResult(error); }
  });

  registerAppTool(server, "generate_video", {
    title: "Generate FrameForge video",
    description: "Use this when the user wants to generate a cinematic video clip in FrameForge from a prompt or reference image.",
    inputSchema: {
      title: z.string().min(1).max(120),
      prompt: z.string().min(1).max(2000),
      aspect_ratio: z.enum(["16:9", "9:16"]).default("16:9"),
      duration: z.enum(["4", "6", "8"]).transform(Number).default("6"),
      audio_enabled: z.boolean().default(false),
      reference_image: z.string().url().optional(),
    },
    securitySchemes: AUTH_MODE === "none" ? noAuthSecurity : oauthSecurity,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
    _meta: { "ui/resourceUri": WIDGET_URI, "openai/outputTemplate": WIDGET_URI },
  }, async ({ title, prompt, aspect_ratio, duration, audio_enabled, reference_image }) => {
    if (AUTH_MODE !== "none" && !identity) return authError();
    try {
      const data = await callFrameForge("/generateVideo", { title, prompt, aspect_ratio, duration, audio_enabled, reference_image }, identity);
      return { content: [{ type: "text", text: `FrameForge generated the video “${title}”.` }], structuredContent: safeResult("video", title, data) };
    } catch (error) { return errorResult(error); }
  });

  registerAppTool(server, "generate_scene", {
    title: "Generate FrameForge scene",
    description: "Use this when the user wants to render or regenerate one scene in an existing FrameForge composition.",
    inputSchema: {
      composition_id: z.string().min(1),
      scene_index: z.number().int().min(0),
      prompt: z.string().max(2000).optional(),
      duration: z.enum(["4", "6", "8"]).transform(Number).default("8"),
      reference_image: z.string().url().optional(),
    },
    securitySchemes: AUTH_MODE === "none" ? noAuthSecurity : oauthSecurity,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
    _meta: { "ui/resourceUri": WIDGET_URI, "openai/outputTemplate": WIDGET_URI },
  }, async ({ composition_id, scene_index, prompt, duration, reference_image }) => {
    if (AUTH_MODE !== "none" && !identity) return authError();
    try {
      const data = await callFrameForge("/generateScene", { composition_id, scene_index, prompt, duration, reference_image }, identity);
      return { content: [{ type: "text", text: `FrameForge rendered scene ${scene_index + 1}.` }], structuredContent: safeResult("scene", `Scene ${scene_index + 1}`, data) };
    } catch (error) { return errorResult(error); }
  });

  registerAppTool(server, "open_frameforge", {
    title: "Open FrameForge",
    description: "Use this when the user wants to continue editing, manage credits, or use the full FrameForge Studio at FrameForger.com.",
    inputSchema: { item_id: z.string().optional() },
    securitySchemes: AUTH_MODE === "none" ? noAuthSecurity : readSecurity,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    _meta: { "ui/resourceUri": WIDGET_URI, "openai/outputTemplate": WIDGET_URI },
  }, async ({ item_id }) => {
    if (AUTH_MODE !== "none" && !identity) return authError();
    const openUrl = item_id ? `${FRAMEFORGE_WEB_URL}/?item=${encodeURIComponent(item_id)}` : FRAMEFORGE_WEB_URL;
    return {
      content: [{ type: "text", text: "Open FrameForge to continue in the full studio." }],
      structuredContent: { type: "link", title: "Open FrameForge", status: "ready", openUrl },
    };
  });

  return server;
}

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "GET" && url.pathname === "/healthz") {
    return json(res, 200, { service: "frameforge-chatgpt-integration", status: "ok", version: "0.2.0" });
  }

  if (req.method === "GET" && ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"].includes(url.pathname)) {
    if (!OAUTH_ISSUER) return json(res, 503, { error: "OAUTH_ISSUER is not configured" });
    return json(res, 200, {
      resource: MCP_PUBLIC_ORIGIN,
      authorization_servers: [OAUTH_ISSUER],
      scopes_supported: SCOPES,
      resource_documentation: `${FRAMEFORGE_WEB_URL}/support`,
    });
  }

  if (req.method === "GET" && url.pathname === "/") {
    return json(res, 200, {
      service: "FrameForge ChatGPT integration",
      status: "ok",
      mcp: `${MCP_PUBLIC_ORIGIN}${MCP_PATH}`,
      website: FRAMEFORGE_WEB_URL,
    });
  }

  if (req.method === "OPTIONS" && url.pathname === MCP_PATH) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "https://chatgpt.com",
      "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, mcp-session-id, authorization",
      "Access-Control-Expose-Headers": "Mcp-Session-Id, WWW-Authenticate",
      "Vary": "Origin",
    });
    return res.end();
  }

  const methods = new Set(["POST", "GET", "DELETE"]);
  if (url.pathname === MCP_PATH && req.method && methods.has(req.method)) {
    res.setHeader("Access-Control-Allow-Origin", "https://chatgpt.com");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id, WWW-Authenticate");
    res.setHeader("Vary", "Origin");

    let identity = null;
    try {
      identity = await verifyAccessToken(req.headers.authorization);
    } catch (error) {
      if (error?.status !== 503) {
        res.setHeader("WWW-Authenticate", authChallenge("invalid_token", error.message));
      }
      // Tool-level auth errors will trigger linking; for malformed tokens, fail early.
      if (req.headers.authorization) return json(res, error?.status || 401, { error: error.message });
    }

    const server = createFrameForgeServer(identity);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { transport.close(); server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("MCP request failed", error);
      if (!res.headersSent) json(res, 500, { error: "Internal server error" });
    }
    return;
  }

  json(res, 404, { error: "Not found" });
});

httpServer.listen(PORT, () => {
  console.log(`FrameForge MCP server listening on http://localhost:${PORT}${MCP_PATH}`);
});

