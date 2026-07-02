// mf-gateway.mjs
// e2e Miniflare v4 contra dist-gateway/worker.js. Llama al demo site REAL por
// red (https://llmstxt-demo-site.rckflr.workers.dev) via fetchOrigin.
//
// Checks minimos (imprime todo):
//   1. POST /mcp?origin=<demo> initialize -> 200 con result.
//   2. tools/list -> contiene sum_numbers y server_time con sus inputSchema.
//   3. tools/call sum_numbers {a:2,b:40} -> structuredContent con 42.
//   4. tools/call server_time -> structuredContent con epoch numerico.
//   5. POST /mcp?origin=https://example.com -> HTTP 403.
//   6. POST /mcp sin origin -> HTTP 403.

import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";

const DEMO_ORIGIN = "https://llmstxt-demo-site.rckflr.workers.dev";

const mf = new Miniflare({
  scriptPath: fileURLToPath(new URL("./dist-gateway/worker.js", import.meta.url)),
  modules: true,
  modulesRules: [
    { type: "ESModule", include: ["**/*.js"] },
    { type: "CompiledWasm", include: ["**/*.wasm"] },
  ],
  compatibilityDate: "2026-06-01",
  compatibilityFlags: ["nodejs_compat"],
  bindings: {
    ALLOWED_ORIGINS: DEMO_ORIGIN,
  },
});

async function rpc(path, payload) {
  const res = await mf.dispatchFetch("http://localhost" + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }
  return { status: res.status, body };
}

let failures = 0;
function check(cond, msg) {
  console.log((cond ? "PASS " : "FAIL ") + msg);
  if (!cond) failures++;
}

try {
  const demoEnc = encodeURIComponent(DEMO_ORIGIN);
  const base = "/mcp?origin=" + demoEnc;

  // 1) initialize
  const init = await rpc(base, { jsonrpc: "2.0", id: 1, method: "initialize" });
  console.log("\n[1] initialize ->", JSON.stringify(init.body));
  check(init.status === 200, "initialize: HTTP 200");
  check(init.body && init.body.result && typeof init.body.result === "object", "initialize: viene result");

  // 2) tools/list
  const list = await rpc(base, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  console.log("[2] tools/list ->", JSON.stringify(list.body));
  const tools = list.body && list.body.result && list.body.result.tools;
  check(list.status === 200, "tools/list: HTTP 200");
  check(Array.isArray(tools), "tools/list: tools es array");
  const names = (tools || []).map((t) => t.name);
  check(names.includes("sum_numbers"), 'tools/list: contiene "sum_numbers"');
  check(names.includes("server_time"), 'tools/list: contiene "server_time"');
  const sumTool = (tools || []).find((t) => t.name === "sum_numbers");
  const timeTool = (tools || []).find((t) => t.name === "server_time");
  check(sumTool && sumTool.inputSchema && sumTool.inputSchema.properties && sumTool.inputSchema.properties.a, "sum_numbers: inputSchema con property a");
  check(timeTool && timeTool.inputSchema, "server_time: inputSchema presente");

  // 3) tools/call sum_numbers {a:2,b:40} -> 42
  const sum = await rpc(base, {
    jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: "sum_numbers", arguments: { a: 2, b: 40 } },
  });
  console.log("[3] sum_numbers ->", JSON.stringify(sum.body));
  const sumSc = sum.body && sum.body.result && sum.body.result.structuredContent;
  check(sum.status === 200, "sum_numbers: HTTP 200");
  check(sumSc && sumSc === 42, "sum_numbers: structuredContent === 42");

  // 4) tools/call server_time -> epoch numerico (via fetchOrigin al demo site)
  const time = await rpc(base, {
    jsonrpc: "2.0", id: 4, method: "tools/call",
    params: { name: "server_time", arguments: {} },
  });
  console.log("[4] server_time ->", JSON.stringify(time.body));
  const timeSc = time.body && time.body.result && time.body.result.structuredContent;
  check(time.status === 200, "server_time: HTTP 200");
  check(timeSc && typeof timeSc.epoch === "number", "server_time: structuredContent.epoch numerico");
  check(time.body && time.body.result && time.body.result.isError === false, "server_time: isError==false");

  // 5) origin no permitido -> 403
  const evil = await rpc("/mcp?origin=" + encodeURIComponent("https://example.com"), {
    jsonrpc: "2.0", id: 5, method: "initialize",
  });
  console.log("[5] evil origin ->", JSON.stringify(evil.body));
  check(evil.status === 403, "origin no permitido: HTTP 403");

  // 6) sin origin -> 403
  const noOrigin = await rpc("/mcp", { jsonrpc: "2.0", id: 6, method: "initialize" });
  console.log("[6] sin origin ->", JSON.stringify(noOrigin.body));
  check(noOrigin.status === 403, "sin origin: HTTP 403");

  console.log("\n" + (failures === 0 ? "TODOS LOS CHECKS VERDE" : failures + " CHECK(S) ROJO(S)"));
} catch (e) {
  console.error("ERROR en mf-gateway:", e && e.stack ? e.stack : e);
  failures++;
} finally {
  await mf.dispose();
}

if (failures !== 0) process.exit(1);