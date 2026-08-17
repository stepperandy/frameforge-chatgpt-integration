import { createServer } from "node:http";

const PORT = Number(process.env.PORT || 8788);
const BASE44_MCP_GATEWAY_URL = process.env.BASE44_MCP_GATEWAY_URL || "https://sociable-prime-motion-lab.base44.app/functions/mcpGateway";
const ROUTES = new Map([
  ["/generateImage", "generate_image"],
  ["/generateVideo", "generate_video"],
]);

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/healthz") {
    return json(res, 200, { service: "frameforge-api-proxy", status: "ok", gateway: "base44" });
  }

  const action = ROUTES.get(url.pathname);
  if (req.method !== "POST" || !action) {
    return json(res, 404, { error: "Not found" });
  }

  const authorization = req.headers.authorization || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return json(res, 401, { error: "Bearer token required" });
  }

  try {
    const payload = await readJson(req);
    const upstream = await fetch(BASE44_MCP_GATEWAY_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization,
      },
      body: JSON.stringify({ action, ...payload }),
      signal: AbortSignal.timeout(120000),
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    return res.end(text);
  } catch (error) {
    return json(res, 502, { error: "Base44 gateway unavailable", detail: error?.message || "unknown error" });
  }
});

server.listen(PORT, () => {
  console.log(`FrameForge API proxy listening on http://localhost:${PORT}`);
});
