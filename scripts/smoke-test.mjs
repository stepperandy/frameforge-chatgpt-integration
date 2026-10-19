const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8787";
const health = await fetch(`${base}/healthz`);
if (!health.ok) throw new Error(`healthz failed: ${health.status}`);
const body = await health.json();
if (body.status !== "ok") throw new Error("healthz did not return ok");
if (body.gateway !== "ok") throw new Error("Base44 gateway health probe failed");
console.log("healthz and Base44 gateway ok", body.version);

const root = await fetch(`${base}/`);
if (!root.ok) throw new Error(`root failed: ${root.status}`);
console.log("root ok");

