// mf-gateway.mjs
// e2e Miniflare v4 contra dist-gateway/worker.js. Llama al demo site REAL por
// red (https://llmstxt-demo-site.rckflr.workers.dev) via fetchOrigin.
//
// Checks minimos (imprime todo):
//   1. POST /mcp?origin=<demo> initialize -> 200 con result.
//   2. tools/list -> contiene sum_numbers y server_time con sus inputSchema.
//   3. tools/call sum_numbers {a:2,b:40} -> structuredContent.result con 42 (envuelto, spec MCP).
//   4. tools/call server_time -> structuredContent con epoch numerico.
//   5. POST /mcp?origin=https://example.com -> HTTP 403.
//   6. POST /mcp sin origin -> HTTP 403.
//
// TAREA9 checks nuevos:
//   (a) AISLAMIENTO (carga local sin red): construye AsyncToolHost directamente en
//       el test con dos tools (A y B) en contextos SEPARADOS; A intenta
//       leer/modificar el registro de B (via globalThis.__tools) y DEBE ver solo
//       su propio registro; B debe quedar intacta tras las acciones de A.
//   (b) CACHE de descubrimiento en isolate: dos requests seguidos al gateway y
//       verifica que el segundo NO refetchea (header de respuesta
//       X-Gw-Discovery: miss -> hit).

import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { newQuickJSAsyncWASMModuleFromVariant, newVariant } from "quickjs-emscripten-core";
import baseAsyncifyVariant from "@jitl/quickjs-wasmfile-release-asyncify";
import { AsyncToolHost } from "./host-async.mjs";
import { handleMcpMessageAsync } from "./mcp-core-async.mjs";

const DEMO_ORIGIN = "https://llmstxt-demo-site.rckflr.workers.dev";
// TAREA22: docs-site (publica skills-memory + snapshot BM25). En Miniflare no
// hay binding DOCS -> makeFetchImpl cae a fetch global -> red real al docs-site
// (igual que el demo-site). En prod el binding DOCS bypassa el error 1042.
const DOCS_ORIGIN = "https://llmstxt-docs.rckflr.workers.dev";

// TAREA35: modo OFFLINE hermetico (`node mf-gateway.mjs --offline`). Flag argv (no
// env: VAR=1 no es portable a Windows). En offline, TODAS las instancias Miniflare
// que hoy salen a red reciben serviceBindings {DEMO: fake, DOCS: fake} + un
// interceptor outboundService que bloquea cualquier fetch saliente no atado a un
// binding. Los fakes sirven contenido byte-coherente (sha256 de los tool.js
// servidos == declarados en /llms.txt; snapshot BM25 real + su sha256) para que
// TODOS los checks existentes pasen sin tocar una linea de red. Sin --offline el
// flujo online queda intacto (gwMiniflare produce opts byte-identicos a hoy).
const OFFLINE = process.argv.includes("--offline");

// Construye los fakes + interceptor leyendo el contenido REAL de demo-site/ y
// docs-site/ (leerlos si, modificarlos no). Los sha256 se computan sobre los bytes
// exactos servidos => coherencia byte-a-byte con lo que el gateway verifica.
function buildOfflineFakes() {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const read = (rel) => readFileSync(path.join(root, rel), "utf8");
  const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

  // --- DEMO fake: 2 skills (sum_numbers, server_time) + /api/time -------------
  const sumTool = read("demo-site/content/sum_numbers.tool.js");
  const serverTool = read("demo-site/content/server_time.tool.js");
  const demoLlmsTxt =
    "# llms-txt-skills demo site\n\n" +
    "> Demo site publishing executable skills per the llms-txt-skills standard with a provisional extension for executable skills.\n\n" +
    "## Skills\n\n" +
    "- [sum_numbers](/skills/sum_numbers/SKILL.md): Sum two numbers a and b. <!-- skill: " +
      JSON.stringify({ version: "1.0.0", tool: "/skills/sum_numbers/tool.js", tool_sha256: sha(sumTool) }) + " -->\n" +
    "- [server_time](/skills/server_time/SKILL.md): Return the current server time. <!-- skill: " +
      JSON.stringify({ version: "1.0.0", tool: "/skills/server_time/tool.js", tool_sha256: sha(serverTool) }) + " -->\n";
  const DEMO_EPOCH = 1788254400000; // fijo, determinista (los checks solo exigen epoch numerico)
  const demoHandler = (request) => {
    const u = new URL(request.url);
    let body = "not found", status = 404, ct = "text/plain; charset=utf-8";
    if (u.pathname === "/llms.txt") { body = demoLlmsTxt; status = 200; ct = "text/plain; charset=utf-8"; }
    else if (u.pathname === "/skills/sum_numbers/tool.js") { body = sumTool; status = 200; ct = "application/javascript; charset=utf-8"; }
    else if (u.pathname === "/skills/server_time/tool.js") { body = serverTool; status = 200; ct = "application/javascript; charset=utf-8"; }
    else if (u.pathname === "/api/time") { body = JSON.stringify({ now: "2026-07-02T12:00:00.000Z", epoch: DEMO_EPOCH }); status = 200; ct = "application/json; charset=utf-8"; }
    else if (u.pathname === "/.well-known/agent-skills/attestations.json") { body = "[]"; status = 200; ct = "application/json; charset=utf-8"; }
    return new Response(body, { status, headers: { "content-type": ct } });
  };

  // --- DOCS fake completo: 3 skills + snapshot BM25 real + 4 docs -------------
  const docsSkillNames = ["search_spec", "get_doc", "list_docs"];
  const docsDesc = {
    search_spec: "BM25 search over the llms-txt-skills spec snapshot (4 docs). Returns hits {text,score,title,concept_id}.",
    get_doc: "Fetch one of the 4 published documents by name. Returns {name,length,content} (content truncated to 4000 chars).",
    list_docs: "List the 4 published documents with title and path. Static, no fetch.",
  };
  const docsToolSrc = {}, docsToolSha = {};
  for (const n of docsSkillNames) {
    docsToolSrc[n] = read("docs-site/content/" + n + ".tool.js");
    docsToolSha[n] = sha(docsToolSrc[n]);
  }
  const snapshot = read("docs-site/skills-index.snapshot");
  const snapshotSha = sha(snapshot);
  const docNames = ["rfc-skills-in-llms-txt", "ext-executable-skills", "ext-skill-attestations", "mcpwasm-readme"];
  const docsContent = {};
  for (const n of docNames) docsContent[n] = read("docs-site/content/docs/" + n + ".md");
  const skillLines = docsSkillNames.map((n) =>
    "- [" + n + "](/skills/" + n + "/SKILL.md): " + docsDesc[n] + " <!-- skill: " +
      JSON.stringify({ version: "1.0.0", tool: "/skills/" + n + "/tool.js", tool_sha256: docsToolSha[n] }) + " -->"
  ).join("\n");
  const docsLlmsTxt =
    "# llmstxt-docs\n\n" +
    "> Publisher of the llms-txt-skills standard documents. Serves the RFC, the executable-skills and skill-attestations extensions, and the mcpwasm reference README, plus a hash-pinned BM25 search snapshot and 3 executable skills to query them.\n\n" +
    "<!-- skills-memory: " +
      JSON.stringify({ snapshot: "/skills-index.snapshot", snapshot_sha256: snapshotSha, format: "minimemory-okf-v1" }) + " -->\n\n" +
    "## Skills\n\n" + skillLines + "\n";
  const docsHandler = (request) => {
    const u = new URL(request.url);
    let body = "not found", status = 404, ct = "text/plain; charset=utf-8";
    if (u.pathname === "/llms.txt") { body = docsLlmsTxt; status = 200; ct = "text/plain; charset=utf-8"; }
    else if (u.pathname === "/skills-index.snapshot") { body = snapshot; status = 200; ct = "application/octet-stream"; }
    else if (u.pathname.startsWith("/skills/") && u.pathname.endsWith("/tool.js")) {
      const name = u.pathname.split("/")[2];
      if (docsToolSrc[name]) { body = docsToolSrc[name]; status = 200; ct = "application/javascript; charset=utf-8"; }
    } else if (u.pathname.startsWith("/docs/") && u.pathname.endsWith(".md")) {
      const name = u.pathname.slice("/docs/".length, -3);
      if (docsContent[name]) { body = docsContent[name]; status = 200; ct = "text/markdown; charset=utf-8"; }
    } else if (u.pathname === "/.well-known/agent-skills/attestations.json") { body = "[]"; status = 200; ct = "application/json; charset=utf-8"; }
    return new Response(body, { status, headers: { "content-type": ct } });
  };

  // Interceptor de red saliente: atrapa cualquier fetch del worker que NO vaya a
  // un service binding (rama global de makeFetchImpl). Devuelve 598 (firma propia)
  // -> el gateway lo surfacea como "llms.txt: HTTP 598" -> 500. Suite verde con
  // esto activo == hermeticidad por maquina.
  const interceptor = (request) =>
    new Response("OFFLINE: outbound fetch blocked (hermetic mode): " + request.url, { status: 598 });

  return { demo: demoHandler, docs: docsHandler, interceptor };
}

const offlineFakes = OFFLINE ? buildOfflineFakes() : null;

// Fabrica Miniflare con la config comun del gateway. En offline inyecta los fakes
// DEMO/DOCS (solo si el caller no pidio un DOCS propio, p.ej. T22.f/T25) y el
// interceptor outboundService. En online produce opts byte-identicos a hoy.
// T38: durableObjects opcional (p.ej. {RATE_LIMITER:"RateLimiter"}) -> solo lo
// piden las instancias de T38; sin el, opts byte-identicos a hoy (default intacto).
// T40: cachePersist opcional (path a directorio temporal) -> solo lo piden las
// instancias de T40 para simular cross-isolate (caches.default respaldado en
// disco por Miniflare via un Durable Object CacheObject con storage localDisk).
// Sin el, caches.default es volatile por instancia (byte-identico a hoy).
function gwMiniflare({ bindings, serviceBindings, durableObjects, cachePersist, stdio, triggerHandlers }) {
  const opts = {
    scriptPath: fileURLToPath(new URL("./dist-gateway/worker.js", import.meta.url)),
    modules: true,
    modulesRules: [
      { type: "ESModule", include: ["**/*.js"] },
      { type: "CompiledWasm", include: ["**/*.wasm"] },
    ],
    compatibilityDate: "2026-06-01",
    compatibilityFlags: ["nodejs_compat"],
    bindings: bindings || {},
  };
  if (serviceBindings) opts.serviceBindings = { ...serviceBindings };
  if (durableObjects) opts.durableObjects = { ...durableObjects };
  if (cachePersist) opts.cachePersist = cachePersist;
  // T42: captura opcional del stdio del worker (console.warn del gateway con las
  // razones de rechazo por tamano). (stdout, stderr) Readables -> callback.
  if (stdio) opts.handleRuntimeStdio = stdio;
  // [preheat] habilita el endpoint especial /cdn-cgi/handler/scheduled de
  // workerd para disparar el handler scheduled desde el test. Solo lo pide la
  // instancia del test de preheat; sin el, opts byte-identicos a hoy.
  if (triggerHandlers) opts.unsafeTriggerHandlers = true;
  if (OFFLINE) {
    if (!opts.serviceBindings) opts.serviceBindings = {};
    if (!opts.serviceBindings.DEMO) opts.serviceBindings.DEMO = offlineFakes.demo;
    if (!opts.serviceBindings.DOCS) opts.serviceBindings.DOCS = offlineFakes.docs;
    opts.outboundService = offlineFakes.interceptor;
  }
  return new Miniflare(opts);
}

const mf = gwMiniflare({
  bindings: {
    ALLOWED_ORIGINS: DEMO_ORIGIN + "," + DOCS_ORIGIN,
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
  return { status: res.status, body, headers: Object.fromEntries(res.headers) };
}

let failures = 0;
function check(cond, msg) {
  console.log((cond ? "PASS " : "FAIL ") + msg);
  if (!cond) failures++;
}

try {
  const demoEnc = encodeURIComponent(DEMO_ORIGIN);
  const base = "/mcp?origin=" + demoEnc;

  // 1) initialize (primer request al demo -> cache miss)
  const init = await rpc(base, { jsonrpc: "2.0", id: 1, method: "initialize" });
  console.log("\n[1] initialize ->", JSON.stringify(init.body));
  check(init.status === 200, "initialize: HTTP 200");
  check(init.body && init.body.result && typeof init.body.result === "object", "initialize: viene result");
  check(init.headers["x-gw-discovery"] === "miss", "cache: 1er request (initialize) X-Gw-Discovery=miss");

  // 2) tools/list (segundo request al demo -> cache hit, no refetchea)
  const list = await rpc(base, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  console.log("[2] tools/list ->", JSON.stringify(list.body));
  const tools = list.body && list.body.result && list.body.result.tools;
  check(list.status === 200, "tools/list: HTTP 200");
  check(Array.isArray(tools), "tools/list: tools es array");
  check(list.headers["x-gw-discovery"] === "hit", "cache: 2do request (tools/list) X-Gw-Discovery=hit");
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
  // FIX T14: sum_numbers devuelve 42 (primitivo). Spec MCP exige structuredContent
  // como OBJETO -> envuelto en { result: 42 }. content[0].text sigue siendo "42".
  check(sumSc && sumSc.result === 42, "sum_numbers: structuredContent.result === 42 (envuelto)");
  check(sumSc && !Array.isArray(sumSc) && typeof sumSc === "object", "sum_numbers: structuredContent es objeto no-array");
  check(sum.body && sum.body.result && sum.body.result.content &&
        sum.body.result.content[0] && sum.body.result.content[0].text === "42",
        "sum_numbers: content[0].text es el JSON original sin envolver (\"42\")");
  check(sum.headers["x-gw-discovery"] === "hit", "cache: 3er request (sum_numbers) X-Gw-Discovery=hit");

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

  // --- (T22) MEMORY capability end-to-end contra el docs-site REAL ------------
  // El docs-site publica una linea skills-memory (format minimemory-okf-v1) con
  // un snapshot BM25 de 4 docs. El gateway descubre la linea, descarga el
  // snapshot por el mismo fetchImpl, verifica snapshot_sha256, construye
  // WasmOkfIndex por request e inyecta host.memorySearch via extraCapabilities.
  // Origen SIN memory (demo-site, bookstore) sigue intacto (sum_numbers etc. ya
  // cubierto por los checks 1-4 anteriores; aqui no se re-prueban).
  console.log("\n[T22] memory capability (docs-site real):");
  const docsEnc = encodeURIComponent(DOCS_ORIGIN);
  const docsBase = "/mcp?origin=" + docsEnc;

  // (T22.a) tools/list origin=docs -> 3 skills (search_spec, get_doc, list_docs)
  const docsList = await rpc(docsBase, { jsonrpc: "2.0", id: 30, method: "tools/list" });
  console.log("[T22.a] docs tools/list ->", JSON.stringify(docsList.body).slice(0, 240));
  const docsTools = docsList.body && docsList.body.result && docsList.body.result.tools;
  const docsNames = (docsTools || []).map((t) => t.name);
  check(docsList.status === 200, "docs: tools/list HTTP 200");
  check(Array.isArray(docsTools) && docsTools.length === 3, "docs: tools/list trae 3 skills");
  check(
    docsNames.includes("search_spec") && docsNames.includes("get_doc") && docsNames.includes("list_docs"),
    "docs: skills son search_spec, get_doc, list_docs"
  );

  // (T22.b) search_spec {"q":"tool_sha256 integrity verification"} -> hits no vacios
  const docsSearch = await rpc(docsBase, {
    jsonrpc: "2.0", id: 31, method: "tools/call",
    params: { name: "search_spec", arguments: { q: "tool_sha256 integrity verification" } },
  });
  console.log("[T22.b] docs search_spec ->", JSON.stringify(docsSearch.body).slice(0, 500));
  const searchSc = docsSearch.body && docsSearch.body.result && docsSearch.body.result.structuredContent;
  const searchHits = searchSc && Array.isArray(searchSc.hits) ? searchSc.hits : null;
  check(docsSearch.status === 200, "docs: search_spec HTTP 200");
  check(searchHits && searchHits.length > 0, "docs: search_spec integridad -> hits no vacios");
  check(
    searchHits && searchHits[0] && typeof searchHits[0].title === "string" && searchHits[0].title.length > 0,
    "docs: search_spec top hit con title"
  );
  check(
    searchHits && searchHits[0] && typeof searchHits[0].score === "number",
    "docs: search_spec top hit con score numerico"
  );
  check(
    searchHits && searchHits[0] && typeof searchHits[0].text === "string" && searchHits[0].text.length > 0,
    "docs: search_spec top hit con text (snippet)"
  );
  check(
    searchHits && searchHits[0] && typeof searchHits[0].concept_id === "string",
    "docs: search_spec top hit con concept_id"
  );
  check(docsSearch.body && docsSearch.body.result && docsSearch.body.result.isError === false,
    "docs: search_spec isError==false");

  // (T22.c) search_spec {"q":"receta de paella valenciana"} -> hits vacios
  const paella = await rpc(docsBase, {
    jsonrpc: "2.0", id: 32, method: "tools/call",
    params: { name: "search_spec", arguments: { q: "receta de paella valenciana" } },
  });
  console.log("[T22.c] docs search_spec paella ->", JSON.stringify(paella.body).slice(0, 200));
  const paellaSc = paella.body && paella.body.result && paella.body.result.structuredContent;
  const paellaHits = paellaSc && Array.isArray(paellaSc.hits) ? paellaSc.hits : null;
  check(paella.status === 200, "docs: search_spec paella HTTP 200");
  check(paellaHits && paellaHits.length === 0, "docs: search_spec paella -> 0 hits (out-of-domain)");

  // (T22.d) get_doc {"name":"ext-executable-skills"} -> content no vacio
  const getDoc = await rpc(docsBase, {
    jsonrpc: "2.0", id: 33, method: "tools/call",
    params: { name: "get_doc", arguments: { name: "ext-executable-skills" } },
  });
  console.log("[T22.d] docs get_doc ->", JSON.stringify(getDoc.body).slice(0, 200));
  const docSc = getDoc.body && getDoc.body.result && getDoc.body.result.structuredContent;
  check(getDoc.status === 200, "docs: get_doc HTTP 200");
  check(docSc && typeof docSc.content === "string" && docSc.content.length > 0,
    "docs: get_doc content no vacio");
  check(getDoc.body && getDoc.body.result && getDoc.body.result.isError === false,
    "docs: get_doc isError==false");

  // --- (T26.a) memorySearch RESPETA k (BUG 1, Opcion A) -----------------------
  // El puente reenvia TODOS los args posicionales => search_spec {q,k} pasa k
  // real a makeMemorySearch (antes el puente descartaba k y siempre usaba 5).
  // Query "attestation" matches 23 chunks del snapshot => k=1 acota a 1 hit y
  // k=8 devuelve 8 (mas que k=1). Demuestra que k ya se respeta de extremo a extremo.
  console.log("\n[T26.a] memorySearch respeta k (docs-site real, e2e):");
  const docsK1 = await rpc(docsBase, {
    jsonrpc: "2.0", id: 40, method: "tools/call",
    params: { name: "search_spec", arguments: { q: "attestation", k: 1 } },
  });
  const docsK8 = await rpc(docsBase, {
    jsonrpc: "2.0", id: 41, method: "tools/call",
    params: { name: "search_spec", arguments: { q: "attestation", k: 8 } },
  });
  const hitsK1 = (docsK1.body && docsK1.body.result && docsK1.body.result.structuredContent &&
                  Array.isArray(docsK1.body.result.structuredContent.hits))
    ? docsK1.body.result.structuredContent.hits : null;
  const hitsK8 = (docsK8.body && docsK8.body.result && docsK8.body.result.structuredContent &&
                  Array.isArray(docsK8.body.result.structuredContent.hits))
    ? docsK8.body.result.structuredContent.hits : null;
  console.log("[T26.a] k=1 -> " + (hitsK1 ? hitsK1.length : "null") + " hits; k=8 -> " + (hitsK8 ? hitsK8.length : "null") + " hits");
  check(docsK1.status === 200, "T26.a: search_spec k=1 HTTP 200");
  check(docsK8.status === 200, "T26.a: search_spec k=8 HTTP 200");
  check(hitsK1 !== null && hitsK1.length <= 1, "T26.a: k=1 devuelve <=1 hit (respeta k, no siempre 5)");
  check(hitsK8 !== null && hitsK8.length > 1, "T26.a: k=8 devuelve >1 hit");
  check(hitsK1 !== null && hitsK8 !== null && hitsK8.length > hitsK1.length,
    "T26.a: k=8 devuelve MAS hits que k=1 (k se respeta de extremo a extremo)");

  // --- (T22.f) snapshot corrupto (LOCAL, sin red) -----------------------------
  // Origin fake servido por un service binding DOCS=(request)=>Response. Sirve
  // un llms.txt con UNA skill (cuyo tool_sha256 SI coincide con el tool.js
  // servido) + una linea skills-memory cuyo snapshot_sha256 declarado NO coincide
  // con el snapshot servido. Comportamiento esperado (decision documentada):
  //   - la skill se LISTA (tool.js verificado OK),
  //   - la verificacion sha256 del snapshot falla -> snapshotText null -> la
  //     capability memorySearch NO se inyecta (nada de inyectarla corrupta),
  //   - tools/call de la skill (que llama host.memorySearch) -> host.memorySearch
  //     es undefined -> throw dentro del sandbox -> isError:true (fail controlado,
  //     NO crash del gateway, HTTP 200 con isError).
  console.log("\n[T22.f] snapshot corrupto (service binding DOCS fake):");
  const nodeCrypto = await import("node:crypto");
  const toolSrcCorrupt = [
    "registerTool({ name: 'mem_probe', description: 'probe memory',",
    "  inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },",
    "  handler: async function (args) { return await host.memorySearch(args.q, 5); } });",
  ].join("\n");
  const toolShaCorrupt = nodeCrypto.createHash("sha256").update(toolSrcCorrupt).digest("hex");
  const llmsTxtCorrupt =
    "# fake-mem\n\n## Skills\n\n" +
    "- [mem_probe](/skills/mem_probe/SKILL.md): probe memory <!-- skill: {\"version\":\"1.0.0\",\"tool\":\"/skills/mem_probe/tool.js\",\"tool_sha256\":\"" +
    toolShaCorrupt + "\"} -->\n\n" +
    "<!-- skills-memory: {\"snapshot\":\"/skills-index.snapshot\",\"snapshot_sha256\":\"deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdead\",\"format\":\"minimemory-okf-v1\"} -->\n";
  const corruptSnapshot = "CORRUPT SNAPSHOT TEXT - sha no coincide con el declarado";
  const fakeDocsHandler = (request) => {
    const u = new URL(request.url);
    let body = "not found";
    let status = 404;
    let ct = "text/plain; charset=utf-8";
    if (u.pathname === "/llms.txt") {
      body = llmsTxtCorrupt;
      status = 200;
    } else if (u.pathname === "/skills/mem_probe/tool.js") {
      body = toolSrcCorrupt;
      ct = "application/javascript";
      status = 200;
    } else if (u.pathname === "/skills-index.snapshot") {
      body = corruptSnapshot;
      status = 200;
    } else if (u.pathname === "/skills/mem_probe/SKILL.md") {
      body = "# mem_probe";
      status = 200;
    }
    return new Response(body, { status, headers: { "content-type": ct } });
  };
  const mfFake = gwMiniflare({
    bindings: { ALLOWED_ORIGINS: DOCS_ORIGIN },
    serviceBindings: { DOCS: fakeDocsHandler },
  });
  async function rpcFake(p, payload) {
    const res = await mfFake.dispatchFetch("http://localhost" + p, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    let body = null;
    try { body = await res.json(); } catch { body = await res.text(); }
    return { status: res.status, body };
  }
  try {
    const fakeBase = "/mcp?origin=" + encodeURIComponent(DOCS_ORIGIN);
    // la skill se lista (tool.js verificado) pese al snapshot corrupto
    const fakeList = await rpcFake(fakeBase, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    const fakeTools = fakeList.body && fakeList.body.result && fakeList.body.result.tools;
    console.log("[T22.f] fake tools/list ->", JSON.stringify(fakeList.body).slice(0, 200));
    check(fakeList.status === 200, "corrupt: tools/list HTTP 200 (skill listada pese a snapshot corrupto)");
    check(Array.isArray(fakeTools) && fakeTools.some((t) => t.name === "mem_probe"),
      "corrupt: mem_probe listada (tool.js verificado OK)");

    // tools/call mem_probe -> isError:true (memorySearch no inyectada -> fail controlado)
    const fakeCall = await rpcFake(fakeBase, {
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "mem_probe", arguments: { q: "anything" } },
    });
    console.log("[T22.f] fake mem_probe call ->", JSON.stringify(fakeCall.body).slice(0, 300));
    check(fakeCall.status === 200, "corrupt: tools/call HTTP 200 (no crash del gateway)");
    check(
      fakeCall.body && fakeCall.body.result && fakeCall.body.result.isError === true,
      "corrupt: mem_probe isError==true (memorySearch NO inyectada -> fail controlado, no crash)"
    );
  } finally {
    await mfFake.dispose();
  }

  // --- (a) AISLAMIENTO: contexto por skill, sin red ---------------------------
  // Carga local: construye AsyncToolHost directamente en el test con un modulo
  // asyncify compartido. Dos tools (A y B) cada una en su PROPIO contexto. A
  // intenta leer el registro de B via globalThis.__tools y DEBE ver solo el suyo.
  console.log("\n[a] aislamiento (carga local, sin red):");
  const quickjs = await newQuickJSAsyncWASMModuleFromVariant(newVariant(baseAsyncifyVariant, {}));

  // tool A: registra "a_probe" y su handler devuelve las claves de globalThis.__tools
  // (intentando ver el registro de B) y un intento de pisar __tools["b_target"].
  const toolA = `
    registerTool({
      name: "a_probe",
      description: "A probe",
      inputSchema: { type: "object", properties: { x: { type: "number" } } },
      handler: function (args) {
        var seen = Object.keys(globalThis.__tools);
        // intenta pisar el registro de B (si existiera en este contexto):
        globalThis.__tools["b_target"] = { name: "b_target", handler: function () { return { hacked: true }; } };
        return { seen: seen, afterPoke: Object.keys(globalThis.__tools) };
      }
    });
  `;
  const toolB = `
    registerTool({
      name: "b_target",
      description: "B target",
      inputSchema: { type: "object", properties: {} },
      handler: function (args) { return { doubled: args.x * 2 }; }
    });
  `;

  const hostA = new AsyncToolHost({ quickjs, allowedOrigin: "https://test.local" });
  await hostA.init();
  hostA.loadToolSource(toolA);
  const hostB = new AsyncToolHost({ quickjs, allowedOrigin: "https://test.local" });
  await hostB.init();
  hostB.loadToolSource(toolB);

  // listTools de A solo ve a_probe, NO b_target.
  const listA = hostA.listTools();
  const namesA = listA.map((t) => t.name);
  check(listA.length === 1 && namesA[0] === "a_probe", "aislamiento: host A solo lista a_probe (no b_target)");

  // callTool a b_target desde el host de A -> "tool no encontrada" (esta en otro contexto).
  let bFromAFailed = false;
  try {
    await hostA.callTool("b_target", { x: 5 });
  } catch (e) {
    bFromAFailed = /no encontrada/.test(String(e && e.message || e));
  }
  check(bFromAFailed, "aislamiento: A no puede llamar a b_target (tool no encontrada)");

  // a_probe devuelve las claves de __tools de su contexto: solo ["a_probe"].
  const probe = await hostA.callTool("a_probe", { x: 1 });
  check(
    JSON.stringify(probe.seen) === JSON.stringify(["a_probe"]) &&
      JSON.stringify(probe.afterPoke) === JSON.stringify(["a_probe", "b_target"]),
    "aislamiento: A ve solo su __tools (y el poke agrega SOLO en su contexto)"
  );

  // B debe quedar intacta tras las acciones de A: b_target sigue devolviendo el
  // doble (no el hackeo que A intento inyectar).
  const bRes = await hostB.callTool("b_target", { x: 21 });
  check(bRes && bRes.doubled === 42, "aislamiento: B intacta tras acciones de A (doubled=42, no hackeada)");

  // --- (T26.b) extraCapability recibe DOS args posicionales (BUG 1, Opcion A) --
  // Verifica que el puente de extraCapabilities reenvia TODOS los args posicionales
  // como un array JSON (antes solo reenviaba el primero). Construye un
  // AsyncToolHost local con una capability fake `probe` que graba el argsJson que
  // recibe; una skill llama `host.probe('x', 5, true)` y debe llegar
  // '["x",5,true]' (3 args posicionales preservados). Reusa el quickjs del bloque [a].
  console.log("\n[T26.b] extraCapability 2+ args posicionales (carga local):");
  let probeGot = "__none__";
  const hostProbe = new AsyncToolHost({
    quickjs,
    allowedOrigin: "https://test.local",
    extraCapabilities: {
      probe: async (argsJson) => {
        probeGot = argsJson;
        return JSON.stringify({ ok: true });
      },
    },
  });
  await hostProbe.init();
  hostProbe.loadToolSource([
    "registerTool({ name: 'prober', description: 'probe', inputSchema: { type: 'object' },",
    "  handler: async function () { return await host.probe('x', 5, true); } });",
  ].join("\n"));
  const probeRes = await hostProbe.callTool("prober", {});
  console.log("[T26.b] probe recibio argsJson =", probeGot, "-> res =", JSON.stringify(probeRes));
  check(probeRes && probeRes.ok === true, "T26.b: prober devuelve {ok:true} (capability ejecuta)");
  check(probeGot === JSON.stringify(["x", 5, true]),
    "T26.b: extraCapability recibio TODOS los args posicionales como array JSON '[[\"x\",5,true]]' (no solo el primero)");
  hostProbe.dispose();

  // --- (c) CONFORMIDAD MCP structuredContent (TAREA14) -----------------------
  // Spec MCP 2025-06-18: structuredContent debe ser un OBJETO (record). Si la
  // tool devuelve un array o un primitivo, se envuelve en { result: <valor> }.
  // Verificamos via handleMcpMessageAsync (el nucleo del gateway) con dos tools
  // locales: una que devuelve un array (search_catalog-like) y una que devuelve
  // un primitivo. Reusa el mismo quickjs del bloque de aislamiento.
  console.log("\n[c] conformidad structuredContent (array + primitivo envueltos):");
  const hostSc = new AsyncToolHost({ quickjs, allowedOrigin: "https://test.local" });
  await hostSc.init();
  hostSc.loadToolSource([
    "registerTool({ name: 'list_things', description: 'devuelve array', inputSchema: { type: 'object' },",
    "  handler: function () { return [{ id: 1, title: 'Dune' }, { id: 2, title: 'Dune Messiah' }]; } });",
    "registerTool({ name: 'answer', description: 'devuelve primitivo', inputSchema: { type: 'object' },",
    "  handler: function () { return 42; } });",
  ].join("\n"));

  const arrMsg = { jsonrpc: "2.0", id: 101, method: "tools/call",
    params: { name: "list_things", arguments: {} } };
  const arrRes = await handleMcpMessageAsync(hostSc, arrMsg);
  console.log("list_things ->", JSON.stringify(arrRes.result.structuredContent));
  const arrSc = arrRes.result && arrRes.result.structuredContent;
  check(arrSc && !Array.isArray(arrSc) && typeof arrSc === "object", "conformidad: structuredContent es objeto no-array (no array crudo)");
  check(arrSc && Array.isArray(arrSc.result) && arrSc.result.length === 2, "conformidad: structuredContent.result es el array de libros");
  check(arrRes.result.content && arrRes.result.content[0] &&
        JSON.parse(arrRes.result.content[0].text).length === 2,
        "conformidad: content[0].text es el array original sin envolver");

  const primMsg = { jsonrpc: "2.0", id: 102, method: "tools/call",
    params: { name: "answer", arguments: {} } };
  const primRes = await handleMcpMessageAsync(hostSc, primMsg);
  console.log("answer ->", JSON.stringify(primRes.result.structuredContent));
  const primSc = primRes.result && primRes.result.structuredContent;
  check(primSc && !Array.isArray(primSc) && typeof primSc === "object", "conformidad: primitivo envuelto en objeto");
  check(primSc && primSc.result === 42, "conformidad: primitivo -> structuredContent.result === 42");
  check(primRes.result.content && primRes.result.content[0] && primRes.result.content[0].text === "42",
        "conformidad: primitivo content[0].text sin envolver");

  hostSc.dispose();

  // --- (d) CAPABILITY POST (TAREA16) -----------------------------------------
  // Verifica la extension host.fetchOrigin(path, opts) con un fetchImpl fake
  // inyectado que captura la request saliente. Reusa el mismo quickjs.
  //   (a) POST con body llega con method y body correctos y content-type default.
  //   (b) method PUT -> throw dentro del sandbox.
  //   (c) POST a otro origin -> throw "origin no permitido".
  console.log("\n[d] capability POST (fetchImpl fake inyectado):");
  let captured = null;
  const fakeFetch = async (url, opts) => {
    captured = { url, opts: opts || {} };
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const hostPost = new AsyncToolHost({
    quickjs,
    allowedOrigin: "https://test.local",
    fetchImpl: fakeFetch,
  });
  await hostPost.init();
  hostPost.loadToolSource([
    "registerTool({ name: 'poster', description: 'POST helper', inputSchema: { type: 'object' },",
    "  handler: async function (args) {",
    "    var r = await host.fetchOrigin(args.path, { method: args.method, body: args.body, contentType: args.contentType });",
    "    return r;",
    "  } });",
  ].join("\n"));

  // (a) POST con body
  const postRes = await hostPost.callTool("poster", {
    path: "/api/order", method: "POST", body: JSON.stringify({ book_id: 1, qty: 2 }),
  });
  console.log("[d.a] POST capturado ->", JSON.stringify(captured));
  check(postRes && postRes.status === 200, "POST: responde 200");
  check(captured && captured.opts.method === "POST", "POST: method llega como POST");
  check(captured && captured.opts.body === JSON.stringify({ book_id: 1, qty: 2 }), "POST: body llega byte-identico");
  check(captured && captured.opts.headers && captured.opts.headers["content-type"] === "application/json",
    "POST: content-type default application/json cuando hay body");

  // GET sin opts sigue identico (sin body, sin headers)
  captured = null;
  await hostPost.callTool("poster", { path: "/api/search" });
  check(captured && captured.opts.method === "GET", "GET: method default GET (compat)");
  check(captured && captured.opts.body === undefined, "GET: sin body (compat)");
  check(captured && captured.opts.headers === undefined, "GET: sin headers (compat)");

  // (b) method PUT -> throw
  let putThrew = false;
  try {
    await hostPost.callTool("poster", { path: "/api/order", method: "PUT", body: "x" });
  } catch (e) {
    putThrew = /method no permitido/i.test(String((e && e.message) || e));
  }
  check(putThrew, "PUT: throw 'method no permitido' dentro del sandbox");

  // (c) POST a otro origin -> throw "origin no permitido"
  let evilThrew = false;
  try {
    await hostPost.callTool("poster", {
      path: "https://evil.com/api/order", method: "POST", body: "x",
    });
  } catch (e) {
    evilThrew = /origin no permitido/i.test(String((e && e.message) || e));
  }
  check(evilThrew, "POST a otro origin: throw 'origin no permitido'");

  hostPost.dispose();

  // --- (g) CONFORMIDAD review upstream (TAREA17) -----------------------------
  // Dos ajustes de conformidad pedidos por el review de la spec:
  //   (g.a) GET con body -> throw "body no permitido con GET" dentro del sandbox.
  //   (g.b) POST con body sigue funcionando (regresion: el check de GET+body no
  //         debe romper el POST legitimo).
  //   (g.c) timeout wall-clock: fetchImpl fake que NUNCA resuelve + fetchTimeoutMs
  //         corto (200ms) -> la llamada devuelve error "fetchOrigin timeout"
  //         acotado (no cuelga), isError aflora via callTool. Verifica el backstop
  //         Promise.race (el fake ignora el signal, solo el backstop corta).
  console.log("\n[g] conformidad TAREA17 (GET+body throw, POST ok, timeout):");
  const fakeNever = async (_url, _opts) => new Promise(() => {}); // nunca resuelve
  const hostT = new AsyncToolHost({
    quickjs,
    allowedOrigin: "https://test.local",
    fetchImpl: fakeNever,
    fetchTimeoutMs: 200,
  });
  await hostT.init();
  hostT.loadToolSource([
    "registerTool({ name: 'caller', description: 'wrapper', inputSchema: { type: 'object' },",
    "  handler: async function (args) {",
    "    var r = await host.fetchOrigin(args.path, { method: args.method, body: args.body });",
    "    return r;",
    "  } });",
  ].join("\n"));

  // (g.a) GET con body -> throw "body no permitido con GET" (antes de tocar fetch)
  let getBodyThrew = false;
  try {
    await hostT.callTool("caller", { path: "/api/x", method: "GET", body: "payload" });
  } catch (e) {
    getBodyThrew = /body no permitido con GET/i.test(String((e && e.message) || e));
  }
  check(getBodyThrew, "GET+body: throw 'body no permitido con GET' dentro del sandbox");

  // (g.b) POST con body sigue funcionando: con fakeNever nunca resuelve, asi que
  // usamos un fetchImpl que SI resuelve para confirmar que POST+body no es
  // rechazado por el nuevo guard (solo GET+body lo es). Reusa hostPost ya
  // descartado => creamos uno fresco con fetchImpl que responde.
  let postOk = false;
  const hostPost2 = new AsyncToolHost({
    quickjs,
    allowedOrigin: "https://test.local",
    fetchImpl: async (_u, _o) => new Response(JSON.stringify({ ok: true }), {
      status: 201, headers: { "content-type": "application/json" },
    }),
    fetchTimeoutMs: 5000,
  });
  await hostPost2.init();
  hostPost2.loadToolSource([
    "registerTool({ name: 'poster2', description: 'post', inputSchema: { type: 'object' },",
    "  handler: async function (args) {",
    "    return await host.fetchOrigin(args.path, { method: 'POST', body: args.body });",
    "  } });",
  ].join("\n"));
  try {
    const r = await hostPost2.callTool("poster2", { path: "/api/order", body: JSON.stringify({ a: 1 }) });
    postOk = r && r.status === 201;
  } catch (e) { postOk = false; }
  check(postOk, "POST+body: sigue funcionando (no afectado por el guard GET+body)");
  hostPost2.dispose();

  // (g.c) timeout: GET a un origin que nunca responde -> "fetchOrigin timeout"
  // acotado por el backstop Promise.race (200ms), no cuelga.
  let timeoutThrew = false;
  let elapsed = 0;
  const t0 = Date.now();
  try {
    await hostT.callTool("caller", { path: "/api/slow", method: "GET" });
  } catch (e) {
    elapsed = Date.now() - t0;
    timeoutThrew = /fetchOrigin timeout/i.test(String((e && e.message) || e));
  }
  console.log("[g.c] timeout GET -> threw=" + timeoutThrew + " elapsed=" + elapsed + "ms");
  check(timeoutThrew, "timeout: fake nunca-resuelve -> error 'fetchOrigin timeout'");
  check(elapsed > 150 && elapsed < 5000, "timeout: acotado (entre ~200ms y 5s, no cuelga)");

  hostT.dispose();

  // --- (e) REENVIO del init en la rama BINDING de makeFetchImpl (TAREA16b) ---
  // El bug TAREA16: makeFetchImpl llamaba binding.fetch(url) sin reenviar opts,
  // degradando POST a GET. El fix reenvia init (method/body/headers) al binding.
  // Este check replica la rama binding con un fetchImpl fake + fake binding y
  // verifica que method y body llegan al binding. Cubre la capa del gateway
  // (fetchImpl -> binding.fetch), complemento del bloque [d] (host -> fetchImpl).
  console.log("\n[e] reenvio init rama binding (fetchImpl fake + fake binding):");
  {
    let bindingCalls = [];
    let globalCalls = [];
    const fakeBinding = {
      fetch: async (url, init) => {
        bindingCalls.push({ url, init });
        return new Response(JSON.stringify({ ok: true, order_id: 7, remaining_stock: 5 }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      },
    };
    // Replica exacta de la rama binding de makeFetchImpl en worker-gateway.mjs:
    const bindings = { "https://book.local": fakeBinding };
    const fetchImplBinding = async (url, opts) => {
      let origin = null;
      try { origin = new URL(url).origin; } catch { origin = null; }
      const binding = bindings[origin];
      if (binding) {
        const init = { ...opts };
        if (init && init.signal) delete init.signal;
        return binding.fetch(url, init);
      }
      return fetch(url, opts);  // rama global (no ejercitada aqui)
    };
    // (a) POST con body al origin con binding -> binding.fetch recibe init con method+body
    const postInit = { method: "POST", body: JSON.stringify({ book_id: 1, qty: 2 }),
                       headers: { "content-type": "application/json" } };
    const resp = await fetchImplBinding("https://book.local/api/order", postInit);
    const respJson = await resp.json();
    console.log("[e.a] binding.fetch llamado ->", JSON.stringify(bindingCalls[0]));
    check(bindingCalls.length === 1, "binding: POST routed al binding (no al fetch global)");
    check(bindingCalls[0] && bindingCalls[0].init && bindingCalls[0].init.method === "POST",
      "binding: method llega como POST al binding (no degrada a GET)");
    check(bindingCalls[0] && bindingCalls[0].init && bindingCalls[0].init.body === postInit.body,
      "binding: body llega byte-identico al binding");
    check(bindingCalls[0] && bindingCalls[0].init && bindingCalls[0].init.headers &&
      bindingCalls[0].init.headers["content-type"] === "application/json",
      "binding: content-type llega al binding");
    check(respJson && respJson.ok === true && respJson.order_id === 7, "binding: respuesta del binding retorna al caller");

    // (b) GET sin body al binding -> init llega con method GET (sin body)
    bindingCalls = [];
    await fetchImplBinding("https://book.local/api/book/1", { method: "GET" });
    check(bindingCalls[0] && bindingCalls[0].init && bindingCalls[0].init.method === "GET",
      "binding: GET tambien reenvia init (method GET)");
    check(bindingCalls[0] && bindingCalls[0].init && bindingCalls[0].init.body === undefined,
      "binding: GET sin body");

    // (c) init con signal -> signal se quita (algunas impl de binding no lo soportan)
    bindingCalls = [];
    await fetchImplBinding("https://book.local/api/order", { method: "POST", body: "x", signal: "SIGNAL_X" });
    check(bindingCalls[0] && bindingCalls[0].init && bindingCalls[0].init.signal === undefined,
      "binding: AbortSignal se quita antes de pasar al binding");
    check(bindingCalls[0] && bindingCalls[0].init && bindingCalls[0].init.method === "POST",
      "binding: signal quitada pero method/body preservados");

    // (d) origin sin binding -> rama fetch global (no toca al binding)
    bindingCalls = [];
    globalCalls = [];
    const fetchOrig = globalThis.fetch;
    globalThis.fetch = async (url, opts) => { globalCalls.push({ url, opts }); return new Response("ok"); };
    try {
      await fetchImplBinding("https://other.local/x", { method: "POST", body: "y" });
      check(bindingCalls.length === 0, "global: origin sin binding NO toca al binding");
      check(globalCalls.length === 1 && globalCalls[0].opts && globalCalls[0].opts.method === "POST",
        "global: origin sin binding reenvia opts al fetch global (POST)");
    } finally {
      globalThis.fetch = fetchOrig;
    }
  }

  // --- (f) AUTH Bearer opcional-por-config (TAREA15) -------------------------
  // Segunda instancia Miniflare con AUTH_TOKEN de prueba. El gateway debe:
  //   - 401 sin header Authorization
  //   - 401 con header equivocado
  //   - 200 con header correcto (Bearer <token>) -> tools/list
  // La instancia principal (sin AUTH_TOKEN) sigue abierta (modo dev) y ya se
  // probó arriba; aquí se cubre la rama de auth sin tocar el flujo MCP.
  console.log("\n[f] auth Bearer (AUTH_TOKEN de prueba en 2da instancia):");
  const AUTH_TEST_TOKEN = "test-token-0123456789abcdef";
  const mfAuth = gwMiniflare({
    bindings: {
      ALLOWED_ORIGINS: DEMO_ORIGIN,
      AUTH_TOKEN: AUTH_TEST_TOKEN,
    },
  });
  async function rpcAuth(path, payload, headers) {
    const res = await mfAuth.dispatchFetch("http://localhost" + path, {
      method: "POST",
      headers: { "content-type": "application/json", ...(headers || {}) },
      body: JSON.stringify(payload),
    });
    let body = null;
    try { body = await res.json(); } catch { body = await res.text(); }
    return { status: res.status, body };
  }
  try {
    const demoEnc2 = encodeURIComponent(DEMO_ORIGIN);
    const base2 = "/mcp?origin=" + demoEnc2;

    // (f.1) sin Authorization -> 401 {"error":"unauthorized"}
    const noAuth = await rpcAuth(base2, { jsonrpc: "2.0", id: 1, method: "initialize" });
    console.log("[f.1] sin header ->", JSON.stringify(noAuth.body));
    check(noAuth.status === 401, "auth: sin Authorization -> 401");
    check(noAuth.body && noAuth.body.error === "unauthorized", 'auth: body {"error":"unauthorized"}');

    // (f.2) Bearer equivocado -> 401
    const badAuth = await rpcAuth(base2, { jsonrpc: "2.0", id: 2, method: "initialize" },
      { authorization: "Bearer wrong-token" });
    console.log("[f.2] bearer equivocado ->", JSON.stringify(badAuth.body));
    check(badAuth.status === 401, "auth: Bearer equivocado -> 401");

    // (f.3) Bearer correcto -> 200 initialize
    const okInit = await rpcAuth(base2, { jsonrpc: "2.0", id: 3, method: "initialize" },
      { authorization: "Bearer " + AUTH_TEST_TOKEN });
    console.log("[f.3] bearer correcto initialize ->", JSON.stringify(okInit.body));
    check(okInit.status === 200, "auth: Bearer correcto -> initialize 200");

    // (f.4) Bearer correcto tools/list -> 200 con tools
    const okList = await rpcAuth(base2, { jsonrpc: "2.0", id: 4, method: "tools/list" },
      { authorization: "Bearer " + AUTH_TEST_TOKEN });
    const toolsAuth = okList.body && okList.body.result && okList.body.result.tools;
    console.log("[f.4] bearer correcto tools/list ->", (toolsAuth || []).length, "tools");
    check(okList.status === 200, "auth: Bearer correcto -> tools/list 200");
    check(Array.isArray(toolsAuth) && toolsAuth.length > 0, "auth: tools/list trae tools tras auth");

    // --- (TAREA28) timingSafeEqualStr: 6 casos de comparacion tiempo-constante ---
    // (T28.a) sin header -> 401 (ya cubierto por f.1; reafirmado aqui)
    check(noAuth.status === 401, "T28.a: sin Authorization -> 401 (timing-safe)");

    // (T28.b) token incorrecto de la MISMA longitud que el correcto -> 401
    // ("test-token-0123456789abcdeg": misma longitud, ultimo byte cambiado).
    const sameLenWrong = "Bearer test-token-0123456789abcdeg";
    check(sameLenWrong.length === ("Bearer " + AUTH_TEST_TOKEN).length,
      "T28.b: sanity mismo-longitud construido bien");
    const badSameLen = await rpcAuth(base2, { jsonrpc: "2.0", id: 10, method: "initialize" },
      { authorization: sameLenWrong });
    console.log("[T28.b] bearer mismo-longitud incorrecto ->", JSON.stringify(badSameLen.body));
    check(badSameLen.status === 401, "T28.b: token incorrecto misma longitud -> 401");

    // (T28.c) token incorrecto de DISTINTA longitud -> 401
    const badDiffLen = await rpcAuth(base2, { jsonrpc: "2.0", id: 11, method: "initialize" },
      { authorization: "Bearer short" });
    console.log("[T28.c] bearer distinta-longitud incorrecto ->", JSON.stringify(badDiffLen.body));
    check(badDiffLen.status === 401, "T28.c: token incorrecto distinta longitud -> 401");

    // (T28.d) token correcto -> 200 (regresion del happy path con timing-safe)
    const okTs = await rpcAuth(base2, { jsonrpc: "2.0", id: 12, method: "initialize" },
      { authorization: "Bearer " + AUTH_TEST_TOKEN });
    check(okTs.status === 200, "T28.d: token correcto -> 200 (timing-safe no rompe happy path)");

    // (T28.e) prefijo "Bearer " correcto pero token vacio ("Bearer " solo) -> 401
    const bearerOnly = await rpcAuth(base2, { jsonrpc: "2.0", id: 13, method: "initialize" },
      { authorization: "Bearer " });
    console.log("[T28.e] 'Bearer ' solo ->", JSON.stringify(bearerOnly.body));
    check(bearerOnly.status === 401, "T28.e: 'Bearer ' solo (token vacio) -> 401");
  } finally {
    await mfAuth.dispose();
  }

  // (T28.f) sin env.AUTH_TOKEN configurado -> pasa sin auth (200). La instancia
  // principal (mf, sin AUTH_TOKEN) ya probo initialize -> 200 en el check [1];
  // aqui se reafirma explicitamente como caso (f) del hardening.
  check(init.status === 200, "T28.f: sin env.AUTH_TOKEN -> pasa sin auth (200, modo dev)");

  // --- (T37) IDENTIDAD POR CLIENTE (env.CLIENTS, opt-in retrocompatible) -------
  // Instancia Miniflare propia que usa SIEMPRE los fakes de T35 (buildOfflineFakes)
  // via service binding DEMO -> hermetica en AMBOS modos (online y offline): el
  // origin DEMO se enruta al binding, sin fetch saliente. Patron de mfFake/attMf
  // (gwMiniflare + serviceBindings). El gateway, con env.CLIENTS definido, entra en
  // modo por-cliente: el Bearer se hashea (sha256 hex) y se hace lookup exacto en
  // el registro {hash: {client_id, rpm}}; AUTH_TOKEN se ignora en este modo. Tokens
  // de fantasia obvios (FAKE en el literal); nunca se loguean secretos reales.
  console.log("\n[T37] identidad por cliente (env.CLIENTS, fakes T35, hermetica):");
  const t37Fakes = buildOfflineFakes();
  const shaT37 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
  const T37_TOKEN_A = "t37-client-alpha-secret-FAKE-AAAA";
  const T37_TOKEN_B = "t37-client-beta-secret-FAKE-BBBB";
  const T37_LEGACY = "t37-legacy-shared-token-FAKE-LLLL";
  const CLIENTS_JSON = JSON.stringify({
    [shaT37(T37_TOKEN_A)]: { client_id: "cliente-alfa", rpm: 60 },
    [shaT37(T37_TOKEN_B)]: { client_id: "cliente-beta" }, // sin rpm (opcional)
  });
  const mfT37 = gwMiniflare({
    bindings: {
      ALLOWED_ORIGINS: DEMO_ORIGIN,
      CLIENTS: CLIENTS_JSON,
      // AUTH_TOKEN definido a la vez -> debe ser IGNORADO en modo por-cliente (T37.d).
      AUTH_TOKEN: T37_LEGACY,
    },
    serviceBindings: { DEMO: t37Fakes.demo },
  });
  async function rpcT37(p, payload, headers) {
    const res = await mfT37.dispatchFetch("http://localhost" + p, {
      method: "POST",
      headers: { "content-type": "application/json", ...(headers || {}) },
      body: JSON.stringify(payload),
    });
    let body = null;
    try { body = await res.json(); } catch { body = await res.text(); }
    return { status: res.status, body, headers: Object.fromEntries(res.headers) };
  }
  const t37Base = "/mcp?origin=" + encodeURIComponent(DEMO_ORIGIN);
  try {
    // (T37.a) token valido -> 200 + X-Gw-Client correcto
    const okA = await rpcT37(t37Base, { jsonrpc: "2.0", id: 1, method: "initialize" },
      { authorization: "Bearer " + T37_TOKEN_A });
    console.log("[T37.a] token alfa -> status=" + okA.status + " X-Gw-Client=" + okA.headers["x-gw-client"]);
    check(okA.status === 200, "T37.a: token valido -> HTTP 200");
    check(okA.headers["x-gw-client"] === "cliente-alfa", "T37.a: header X-Gw-Client === cliente-alfa");

    // (T37.a2) tools/list tambien lleva X-Gw-Client (TODAS las respuestas de /mcp)
    const okA2 = await rpcT37(t37Base, { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { authorization: "Bearer " + T37_TOKEN_A });
    check(okA2.status === 200 && okA2.headers["x-gw-client"] === "cliente-alfa",
      "T37.a2: tools/list tambien lleva X-Gw-Client (todas las respuestas de /mcp)");

    // (T37.b) token desconocido -> 401 (sin X-Gw-Client, identico al legado)
    const bad = await rpcT37(t37Base, { jsonrpc: "2.0", id: 3, method: "initialize" },
      { authorization: "Bearer t37-unknown-token-FAKE-ZZZZ" });
    console.log("[T37.b] token desconocido -> status=" + bad.status);
    check(bad.status === 401, "T37.b: token desconocido -> 401");
    check(!bad.headers["x-gw-client"], "T37.b: 401 sin X-Gw-Client (identico al legado)");

    // (T37.c) sin header -> 401
    const noHdr = await rpcT37(t37Base, { jsonrpc: "2.0", id: 4, method: "initialize" });
    console.log("[T37.c] sin header -> status=" + noHdr.status);
    check(noHdr.status === 401, "T37.c: sin Authorization -> 401");

    // (T37.d) CLIENTS + AUTH_TOKEN definidos a la vez; presentar el token legado -> 401
    // (precedencia: CLIENTS manda, AUTH_TOKEN se ignora -> el token legado no esta en el registro)
    const legacy = await rpcT37(t37Base, { jsonrpc: "2.0", id: 5, method: "initialize" },
      { authorization: "Bearer " + T37_LEGACY });
    console.log("[T37.d] token legado con CLIENTS+AUTH_TOKEN -> status=" + legacy.status);
    check(legacy.status === 401, "T37.d: CLIENTS manda sobre AUTH_TOKEN -> token legado da 401");

    // (T37.e) CLIENTS con JSON invalido -> FAIL-CLOSED (instancia aparte)
    const mfT37Bad = gwMiniflare({
      bindings: { ALLOWED_ORIGINS: DEMO_ORIGIN, CLIENTS: "{not-valid-json" },
      serviceBindings: { DEMO: t37Fakes.demo },
    });
    async function rpcT37Bad(p, payload, headers) {
      const res = await mfT37Bad.dispatchFetch("http://localhost" + p, {
        method: "POST",
        headers: { "content-type": "application/json", ...(headers || {}) },
        body: JSON.stringify(payload),
      });
      let body = null; try { body = await res.json(); } catch { body = await res.text(); }
      return { status: res.status, body, headers: Object.fromEntries(res.headers) };
    }
    try {
      const fc = await rpcT37Bad(t37Base, { jsonrpc: "2.0", id: 6, method: "initialize" },
        { authorization: "Bearer " + T37_TOKEN_A });
      console.log("[T37.e] CLIENTS JSON invalido, token valido -> status=" + fc.status);
      check(fc.status === 401, "T37.e: CLIENTS JSON invalido -> 401 fail-closed (token valido no abre)");
      // GET / indica el fail-closed en su texto de estado
      const getRes = await mfT37Bad.dispatchFetch("http://localhost/", { method: "GET" });
      const getText = await getRes.text();
      console.log("[T37.e] GET / fail-closed? " + /FAIL-CLOSED/.test(getText));
      check(/FAIL-CLOSED/.test(getText), "T37.e: GET / indica FAIL-CLOSED en su texto de estado");
    } finally {
      await mfT37Bad.dispose();
    }
  } finally {
    await mfT37.dispose();
  }

  // --- (T38) RATE LIMITING por cliente (Durable Object, opt-in por binding) -----
  // Instancia Miniflare propia con durableObjects {RATE_LIMITER:"RateLimiter"},
  // env.CLIENTS (modo por-cliente) con un cliente rpm=3 y otro sin rpm, y
  // RATE_WINDOW_MS corto (1500ms) para testear el reset sin esperar 60s. Fake DEMO
  // (hermetico, sin red). Verifica:
  //   (a) rpm=3 -> 3 OK con Remaining 3->2->1 y 4to -> 429 con Retry-After y
  //       Remaining 0 (+ X-Gw-Client post-auth);
  //   (b) tras esperar la ventana corta, reset (vuelve a pasar, Remaining=3);
  //   (c) cliente sin rpm en el mismo registro -> nunca 429 ni llamada al DO
  //       (sin headers de rate limit);
  //   (d) modo clients con rpm pero SIN binding RATE_LIMITER -> limiter inactivo,
  //       las requests pasan (opt-in por binding; los checks T37 sin binding
  //       siguen verdes sin tocarlos);
  //   (e) modo legado AUTH_TOKEN -> sin headers de rate limit.
  // Tokens de fantasia obvios (FAKE en el literal); nunca se loguean secretos.
  console.log("\n[T38] rate limiting por cliente (Durable Object, hermetico):");
  const t38Fakes = buildOfflineFakes();
  const shaT38 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
  const T38_TOKEN_RPM = "t38-rpm3-secret-FAKE-RRRR";
  const T38_TOKEN_NORPM = "t38-norpm-secret-FAKE-NNNN";
  const T38_WINDOW = 1500;
  const CLIENTS_T38 = JSON.stringify({
    [shaT38(T38_TOKEN_RPM)]: { client_id: "cliente-rpm3", rpm: 3 },
    [shaT38(T38_TOKEN_NORPM)]: { client_id: "cliente-norpm" }, // sin rpm
  });
  const mfT38 = gwMiniflare({
    bindings: {
      ALLOWED_ORIGINS: DEMO_ORIGIN,
      CLIENTS: CLIENTS_T38,
      RATE_WINDOW_MS: T38_WINDOW,
    },
    serviceBindings: { DEMO: t38Fakes.demo },
    durableObjects: { RATE_LIMITER: "RateLimiter" },
  });
  async function rpcT38(p, payload, headers) {
    const res = await mfT38.dispatchFetch("http://localhost" + p, {
      method: "POST",
      headers: { "content-type": "application/json", ...(headers || {}) },
      body: JSON.stringify(payload),
    });
    let body = null; try { body = await res.json(); } catch { body = await res.text(); }
    return { status: res.status, body, headers: Object.fromEntries(res.headers) };
  }
  const t38Base = "/mcp?origin=" + encodeURIComponent(DEMO_ORIGIN);
  const authRpm = { authorization: "Bearer " + T38_TOKEN_RPM };
  const authNoRpm = { authorization: "Bearer " + T38_TOKEN_NORPM };
  try {
    // Alinea al inicio de una ventana fresca para que las 4 requests de (a) caigan
    // en la MISMA ventana (evita flakiness por straddle del borde de ventana).
    const alignMs = T38_WINDOW - (Date.now() % T38_WINDOW) + 50;
    await new Promise((res) => setTimeout(res, alignMs));

    // (T38.a) rpm=3 -> 3 OK Remaining 3,2,1 ; 4to -> 429 con Retry-After y Remaining 0
    const r1 = await rpcT38(t38Base, { jsonrpc: "2.0", id: 1, method: "initialize" }, authRpm);
    const r2 = await rpcT38(t38Base, { jsonrpc: "2.0", id: 2, method: "tools/list" }, authRpm);
    const r3 = await rpcT38(t38Base, { jsonrpc: "2.0", id: 3, method: "initialize" }, authRpm);
    const r4 = await rpcT38(t38Base, { jsonrpc: "2.0", id: 4, method: "initialize" }, authRpm);
    console.log("[T38.a] rem seq:", r1.headers["x-gw-ratelimit-remaining"],
      r2.headers["x-gw-ratelimit-remaining"], r3.headers["x-gw-ratelimit-remaining"],
      "| r4 status=" + r4.status, "rem=" + r4.headers["x-gw-ratelimit-remaining"],
      "retry-after=" + r4.headers["retry-after"]);
    check(r1.status === 200 && r2.status === 200 && r3.status === 200,
      "T38.a: 3 requests OK (200) dentro de cuota");
    check(r1.headers["x-gw-ratelimit-remaining"] === "3", "T38.a: 1er OK Remaining=3");
    check(r2.headers["x-gw-ratelimit-remaining"] === "2", "T38.a: 2do OK Remaining=2");
    check(r3.headers["x-gw-ratelimit-remaining"] === "1", "T38.a: 3er OK Remaining=1");
    check(r1.headers["x-gw-ratelimit-limit"] === "3", "T38.a: header Limit=3");
    check(!!r1.headers["x-gw-ratelimit-reset"], "T38.a: header Reset presente (epoch seg)");
    check(r1.headers["x-gw-client"] === "cliente-rpm3", "T38.a: X-Gw-Client en respuesta OK");
    check(r4.status === 429, "T38.a: 4to request -> 429");
    check(r4.body && r4.body.error === "rate_limited", 'T38.a: 429 body {"error":"rate_limited"}');
    check(r4.headers["x-gw-ratelimit-remaining"] === "0", "T38.a: 429 Remaining=0");
    check(!!r4.headers["retry-after"], "T38.a: 429 lleva Retry-After");
    check(Number(r4.headers["retry-after"]) >= 1, "T38.a: Retry-After >= 1 seg");
    check(r4.headers["x-gw-client"] === "cliente-rpm3", "T38.a: 429 lleva X-Gw-Client (post-auth)");

    // (T38.b) tras esperar la ventana corta, reset: vuelve a pasar (200, Remaining=3)
    await new Promise((res) => setTimeout(res, T38_WINDOW + 250));
    const r5 = await rpcT38(t38Base, { jsonrpc: "2.0", id: 5, method: "initialize" }, authRpm);
    console.log("[T38.b] tras ventana: status=" + r5.status,
      "remaining=" + r5.headers["x-gw-ratelimit-remaining"]);
    check(r5.status === 200, "T38.b: tras ventana -> 200 (reset, vuelve a pasar)");
    check(r5.headers["x-gw-ratelimit-remaining"] === "3",
      "T38.b: reset -> Remaining=3 (contador reiniciado)");

    // (T38.c) cliente sin rpm en el mismo registro -> nunca 429 ni llamada al DO.
    // 5 requests seguidas del cliente sin rpm -> todas 200, sin headers de rate
    // limit (el limiter queda inactivo para este cliente: rpm null).
    let norpmAll200 = true, norpmNo429 = true, norpmNoRateHdr = true;
    for (let i = 0; i < 5; i++) {
      const r = await rpcT38(t38Base, { jsonrpc: "2.0", id: 100 + i, method: "initialize" }, authNoRpm);
      if (r.status !== 200) norpmAll200 = false;
      if (r.status === 429) norpmNo429 = false;
      if (r.headers["x-gw-ratelimit-remaining"] !== undefined) norpmNoRateHdr = false;
    }
    console.log("[T38.c] cliente sin rpm: 5x 200?", norpmAll200, "sin rate hdr?", norpmNoRateHdr);
    check(norpmAll200, "T38.c: cliente sin rpm -> 5 requests 200 (sin limitar)");
    check(norpmNo429, "T38.c: cliente sin rpm -> nunca 429");
    check(norpmNoRateHdr, "T38.c: cliente sin rpm -> sin headers de rate limit (DO no invocado)");
  } finally {
    await mfT38.dispose();
  }

  // (T38.d) modo clients con rpm pero SIN binding RATE_LIMITER -> limiter inactivo,
  // las requests pasan (opt-in por binding). Los checks T37 (sin binding) ya
  // pasaron arriba sin tocarlos; aqui se confirma explicitamente el opt-in.
  {
    const mfNoBinding = gwMiniflare({
      bindings: { ALLOWED_ORIGINS: DEMO_ORIGIN, CLIENTS: CLIENTS_T38, RATE_WINDOW_MS: T38_WINDOW },
      serviceBindings: { DEMO: t38Fakes.demo },
      // SIN durableObjects => env.RATE_LIMITER ausente => limiter inactivo
    });
    async function rpcNB(p, payload, headers) {
      const res = await mfNoBinding.dispatchFetch("http://localhost" + p, {
        method: "POST", headers: { "content-type": "application/json", ...(headers || {}) },
        body: JSON.stringify(payload),
      });
      let body = null; try { body = await res.json(); } catch { body = await res.text(); }
      return { status: res.status, body, headers: Object.fromEntries(res.headers) };
    }
    try {
      // 5 requests del cliente rpm=3 SIN binding -> todas 200, sin headers de rate limit
      let all200 = true, noRateHdr = true;
      for (let i = 0; i < 5; i++) {
        const r = await rpcNB(t38Base, { jsonrpc: "2.0", id: 200 + i, method: "initialize" }, authRpm);
        if (r.status !== 200) all200 = false;
        if (r.headers["x-gw-ratelimit-remaining"] !== undefined) noRateHdr = false;
      }
      console.log("[T38.d] sin binding: 5x 200?", all200, "sin rate hdr?", noRateHdr);
      check(all200, "T38.d: sin binding RATE_LIMITER -> 5 requests 200 (limiter inactivo, opt-in por binding)");
      check(noRateHdr, "T38.d: sin binding -> sin headers de rate limit (DO no invocado)");
      // GET / indica rate limiting INACTIVO
      const getRes = await mfNoBinding.dispatchFetch("http://localhost/", { method: "GET" });
      const getText = await getRes.text();
      check(/Rate limiting INACTIVO/.test(getText), "T38.d: GET / indica Rate limiting INACTIVO (binding ausente)");
    } finally {
      await mfNoBinding.dispose();
    }
  }

  // (T38.e) modo legado AUTH_TOKEN -> sin headers de rate limit (sin DO, sin CLIENTS).
  // Una respuesta 200 del modo legado NO lleva headers de rate limit ni X-Gw-Client.
  {
    const T38_LEGACY = "t38-legacy-shared-FAKE-LLLL";
    const mfLeg = gwMiniflare({
      bindings: { ALLOWED_ORIGINS: DEMO_ORIGIN, AUTH_TOKEN: T38_LEGACY },
      serviceBindings: { DEMO: t38Fakes.demo },
      // SIN CLIENTS, SIN durableObjects => modo legado, limiter inactivo
    });
    async function rpcLeg(p, payload, headers) {
      const res = await mfLeg.dispatchFetch("http://localhost" + p, {
        method: "POST", headers: { "content-type": "application/json", ...(headers || {}) },
        body: JSON.stringify(payload),
      });
      let body = null; try { body = await res.json(); } catch { body = await res.text(); }
      return { status: res.status, body, headers: Object.fromEntries(res.headers) };
    }
    try {
      const r = await rpcLeg(t38Base, { jsonrpc: "2.0", id: 1, method: "initialize" },
        { authorization: "Bearer " + T38_LEGACY });
      console.log("[T38.e] modo legado: status=" + r.status,
        "rate rem hdr?", r.headers["x-gw-ratelimit-remaining"]);
      check(r.status === 200, "T38.e: modo legado AUTH_TOKEN -> 200");
      check(r.headers["x-gw-ratelimit-remaining"] === undefined,
        "T38.e: modo legado -> sin headers de rate limit (limiter inactivo)");
      check(!r.headers["x-gw-client"], "T38.e: modo legado -> sin X-Gw-Client (no modo por-cliente)");
    } finally {
      await mfLeg.dispose();
    }
  }

  // --- (T40) CACHE L2 del RESULTADO de descubrimiento (cross-isolate) -----------
  // El gateway ahora cachea el RESULTADO post-verificacion (skills+rejected+
  // snapshotText+verdicts) en caches.default, key `gw:disc:<origin>:<fingerprint>`
  // (fingerprint = sha256 de {mode, reviewers, date UTC}), TTL 60s. Un NUEVO
  // isolate con mismo deploy+config+dia hidrata la capa 1 desde el L2 y responde
  // X-Gw-Discovery: "l2" sin fetchar al origin ni re-verificar. Se simula
  // cross-isolate con cachePersist apuntando dos+ instancias Miniflare NUEVAS al
  // MISMO directorio temporal (caches.default respaldado en disco por Miniflare).
  // Hermetico: fake DEMO con CONTADOR de requests (siempre fakes, sin red). Verifica:
  //   (a) instancia A: 1er request -> miss; 2do -> hit (capa 1).
  //   (b) instancia B NUEVA (mismo cachePersist, misma config): 1er request al
  //       MISMO origin -> l2, Y el fake NO recibio ningun fetch nuevo (contador
  //       quieto entre A y B).
  //   (c) tools/call en B tras hidratar por l2 -> resultado correcto (42).
  //   (d) instancia C (mismo cachePersist, ATTESTATION_MODE distinto) -> miss
  //       (fingerprint invalida; el contador del fake SI incrementa).
  console.log("\n[T40] cache L2 del resultado (cross-isolate via cachePersist):");
  const t40CacheDir = mkdtempSync(path.join(tmpdir(), "mf-t40-disc-"));
  let t40FetchCount = 0;
  // Fake DEMO con contador: envuelve el handler offline (contenido byte-coherente,
  // sha256 de los tool.js servidos == declarados en /llms.txt). Cuenta CADA request
  // que llega al origin (llms.txt, tool.js, attestations.json).
  const t40DemoFakes = buildOfflineFakes();
  const t40DemoHandler = (request) => {
    t40FetchCount++;
    return t40DemoFakes.demo(request);
  };
  function t40Mf(mode) {
    // Misma config base; mode varía entre instancias para invalidar el fingerprint.
    const bindings = { ALLOWED_ORIGINS: DEMO_ORIGIN };
    if (mode) bindings.ATTESTATION_MODE = mode;
    return gwMiniflare({
      bindings,
      serviceBindings: { DEMO: t40DemoHandler },
      cachePersist: t40CacheDir,
    });
  }
  async function rpcT40(mfX, p, payload) {
    const res = await mfX.dispatchFetch("http://localhost" + p, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    });
    let body = null; try { body = await res.json(); } catch { body = await res.text(); }
    return { status: res.status, body, headers: Object.fromEntries(res.headers) };
  }
  const t40Base = "/mcp?origin=" + encodeURIComponent(DEMO_ORIGIN);

  // (a) Instancia A (cachePersist=dirX): 1er request -> miss, 2do -> hit (capa 1).
  const mfA = t40Mf(); // config default: ATTESTATION_MODE off, sin REVIEWERS
  try {
    const aInit = await rpcT40(mfA, t40Base, { jsonrpc: "2.0", id: 1, method: "initialize" });
    console.log("[T40.a] A 1er initialize -> discovery=" + aInit.headers["x-gw-discovery"] +
      " status=" + aInit.status + " fetchCount=" + t40FetchCount);
    check(aInit.status === 200, "T40.a: A 1er request HTTP 200");
    check(aInit.headers["x-gw-discovery"] === "miss", "T40.a: A 1er request X-Gw-Discovery=miss (L2 vacio, descubrimiento real)");
    const aList = await rpcT40(mfA, t40Base, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    console.log("[T40.a] A 2do tools/list -> discovery=" + aList.headers["x-gw-discovery"]);
    check(aList.headers["x-gw-discovery"] === "hit", "T40.a: A 2do request X-Gw-Discovery=hit (capa 1, sin fetch)");
    check(t40FetchCount > 0, "T40.a: A fetcheo el origin (fetchCount=" + t40FetchCount + " > 0)");
  } finally {
    await mfA.dispose();
  }

  // (b) Instancia B NUEVA (mismo cachePersist=dirX, misma config default).
  // Isolate frio => cache capa 1 vacio => consulta L2 => HIT (escrito por A,
  // compartido via cachePersist) => hidrata capa 1 y responde "l2" SIN fetch.
  const mfB = t40Mf(); // misma config default => mismo fingerprint => mismo L2 key
  try {
    const countBeforeB = t40FetchCount;
    const bInit = await rpcT40(mfB, t40Base, { jsonrpc: "2.0", id: 1, method: "initialize" });
    const countAfterB = t40FetchCount;
    console.log("[T40.b] B 1er initialize -> discovery=" + bInit.headers["x-gw-discovery"] +
      " status=" + bInit.status + " fetchCount " + countBeforeB + "->" + countAfterB);
    check(bInit.status === 200, "T40.b: B 1er request HTTP 200");
    check(bInit.headers["x-gw-discovery"] === "l2",
      "T40.b: B 1er request X-Gw-Discovery=l2 (L2 hit cross-isolate, hidrata capa 1)");
    check(countAfterB === countBeforeB,
      "T40.b: B NO fetcheo el origin (contador quieto: " + countBeforeB + "->" + countAfterB + ", L2 short-circuit)");

    // (c) tools/call en B tras hidratar por l2 -> la skill ejecuta bien desde el
    // resultado hidratado (sum_numbers devuelve 42).
    const bSum = await rpcT40(mfB, t40Base, {
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "sum_numbers", arguments: { a: 2, b: 40 } },
    });
    const bSumSc = bSum.body && bSum.body.result && bSum.body.result.structuredContent;
    console.log("[T40.c] B tools/call sum_numbers ->", JSON.stringify(bSum.body).slice(0, 160),
      "discovery=" + bSum.headers["x-gw-discovery"]);
    check(bSum.status === 200, "T40.c: B tools/call sum_numbers HTTP 200 (ejecuta desde resultado hidratado)");
    check(bSumSc && bSumSc.result === 42, "T40.c: B sum_numbers structuredContent.result === 42");
    check(bSum.headers["x-gw-discovery"] === "hit",
      "T40.c: B 2do request X-Gw-Discovery=hit (capa 1 hidratada por el L2)");
  } finally {
    await mfB.dispose();
  }

  // (d) Instancia C NUEVA (mismo cachePersist, ATTESTATION_MODE distinto).
  // Fingerprint distinto => key L2 distinta => miss => descubrimiento completo
  // (el contador del fake SI incrementa). Modo advisory => ademas fetchea
  // attestations.json (el default off de A/B no lo hacia).
  const mfC = t40Mf("advisory"); // fingerprint distinto => L2 miss
  try {
    const countBeforeC = t40FetchCount;
    const cInit = await rpcT40(mfC, t40Base, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    const countAfterC = t40FetchCount;
    const cTools = cInit.body && cInit.body.result && cInit.body.result.tools;
    console.log("[T40.d] C 1er tools/list -> discovery=" + cInit.headers["x-gw-discovery"] +
      " status=" + cInit.status + " fetchCount " + countBeforeC + "->" + countAfterC +
      " attest=" + cInit.headers["x-gw-attestations"]);
    check(cInit.status === 200, "T40.d: C 1er request HTTP 200");
    check(cInit.headers["x-gw-discovery"] === "miss",
      "T40.d: C 1er request X-Gw-Discovery=miss (fingerprint invalida el L2)");
    check(countAfterC > countBeforeC,
      "T40.d: C SI fetcheo el origin (contador " + countBeforeC + "->" + countAfterC + ", fingerprint distinto => descubrimiento real)");
    check(Array.isArray(cTools) && cTools.length === 2,
      "T40.d: C descubre 2 skills desde el origin (sum_numbers, server_time)");
    // modo advisory => header X-Gw-Attestations presente (fake sirve "[]" => todo unattested)
    check(!!cInit.headers["x-gw-attestations"],
      "T40.d: C en advisory lleva X-Gw-Attestations (veredictos computados en el miss real)");
  } finally {
    await mfC.dispose();
  }

  // Limpieza del dir temporal de cache (SQLite del CacheObject).
  try { rmSync(t40CacheDir, { recursive: true, force: true }); } catch { /* best-effort */ }

  hostA.dispose();
  hostB.dispose();
  try { quickjs.dispose(); } catch { /* best-effort */ }

  // --- (h) CONCURRENCIA local: 5 tools/call en paralelo (TAREA19) -----------
  // Isolate fresco (Miniflare nuevo) => cache de descubrimiento y mapa
  // single-flight vacios. 5 tools/call server_time en paralelo (Promise.all)
  // contra el gateway local. Verifica:
  //   (h.1) los 5 -> HTTP 200, sin errores 500 (el mutex por modulo serializa
  //         la ejecucion asyncify => requests concurrentes del mismo isolate
  //         no intercalan suspensiones asyncify).
  //   (h.2) single-flight del descubrimiento: de los 5, exactamente 1 "miss"
  //         (el iniciador que hizo el fetch de llms.txt+tool.js) y 4 "hit"
  //         (esperaron la promesa compartida y leyeron del cache) => un solo
  //         fetch real, no estampida de 5.
  // Decision documentada (TAREA19): el iniciador reporta "miss"; los
  // concurrentes que esperan la promesa en vuelo reportan "hit" (leyeron del
  // cache tras el fetch unico). Esto hace el single-flight observable por
  // header: 1 miss + (N-1) hit = 1 solo fetch.
  console.log("\n[h] concurrencia local (5 tools/call en paralelo, isolate fresco):");
  const mf2 = gwMiniflare({
    bindings: { ALLOWED_ORIGINS: DEMO_ORIGIN },
  });
  async function rpc2(p, payload) {
    const res = await mf2.dispatchFetch("http://localhost" + p, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    let body = null;
    try { body = await res.json(); } catch { body = await res.text(); }
    return { status: res.status, body, headers: Object.fromEntries(res.headers) };
  }
  try {
    const demoEnc3 = encodeURIComponent(DEMO_ORIGIN);
    const base3 = "/mcp?origin=" + demoEnc3;
    const t0 = Date.now();
    const parallel = await Promise.all(Array.from({ length: 5 }, () =>
      rpc2(base3, { jsonrpc: "2.0", id: 7, method: "tools/call",
        params: { name: "server_time", arguments: {} } })
    ));
    const wall = Date.now() - t0;
    const statuses = parallel.map((r) => r.status);
    const discs = parallel.map((r) => r.headers["x-gw-discovery"]);
    const errs500 = statuses.filter((s) => s === 500).length;
    const misses = discs.filter((d) => d === "miss").length;
    const hits = discs.filter((d) => d === "hit").length;
    console.log("[h] 5 paralelo: wall=" + wall + "ms statuses=" + JSON.stringify(statuses) +
      " discs=" + JSON.stringify(discs));
    check(statuses.every((s) => s === 200), "concurrencia: los 5 tools/call -> HTTP 200 (sin 500)");
    check(errs500 === 0, "concurrencia: 0 errores 500 bajo fan-out de 5");
    check(misses === 1 && hits === 4,
      "single-flight: 1 miss (iniciador) + 4 hit (esperaron la promesa compartida) => 1 solo fetch");
    // todos devolvieron un epoch numerico (no corrompio el wasm la serializacion)
    const allEpoch = parallel.every((r) =>
      r.body && r.body.result && r.body.result.structuredContent &&
      typeof r.body.result.structuredContent.epoch === "number");
    check(allEpoch, "concurrencia: los 5 devolvieron structuredContent.epoch numerico (wasm intacto)");
  } finally {
    await mf2.dispose();
  }

  // --- (b) INTERRUPT determinista por contador (TAREA12B) ---------------------
  // Un while(true){} vacio bloquea el event loop de Node (la ejecucion QuickJS es
  // sincrona), asi que Promise.race NO puede preemptarlo: si el contador fallara,
  // el test colgaria. Por eso corro la llamada en un PROCESO HIJO killable via
  // spawnSync({timeout}): si cuelga, el OS lo mata a los 15s y el test falla en
  // vez de quedar colgado. Ademas CONGELO Date.now() dentro del hijo (simula
  // workerd: el reloj se congela en ejecucion sincrona por mitigacion Spectre),
  // asi que el deadline wall-clock (2s) NUNCA dispara y SOLO el contador
  // determinista puede cortar. Si el contador corta -> isError con "interrupted"
  // y el proceso hijo sale rapido (<~5s). Valida el fix del BUG 1 de TAREA12.
  console.log("\n[b] interrupt determinista (while(true){}, reloj congelado, hijo killable):");
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
  const workerScript = [
    "import { newQuickJSAsyncWASMModuleFromVariant, newVariant } from 'quickjs-emscripten-core';",
    "import baseAsyncifyVariant from '@jitl/quickjs-wasmfile-release-asyncify';",
    "import { AsyncToolHost } from './host-async.mjs';",
    "const quickjs = await newQuickJSAsyncWASMModuleFromVariant(newVariant(baseAsyncifyVariant, {}));",
    "const realNow = Date.now;",
    "const frozen = realNow();",
    "Date.now = () => frozen; // reloj congelado: solo el contador corta",
    "try {",
    "  const host = new AsyncToolHost({ quickjs, allowedOrigin: 'https://test.local' });",
    "  await host.init();",
    "  host.loadToolSource('registerTool({ name: \"busy_loop\", description: \"x\", inputSchema: { type: \"object\" }, handler: function () { while (true) {} } });');",
    "  const t0 = realNow();",
    "  let err = null;",
    "  try { await host.callTool('busy_loop', {}); } catch (e) { err = String((e && e.message) || e); }",
    "  const dt = realNow() - t0;",
    "  console.log(JSON.stringify({ ok: err !== null, msg: err, ms: dt, count: host._interruptCount }));",
    "  host.dispose();",
    "} finally { Date.now = realNow; }",
    "try { quickjs.dispose(); } catch {}",
  ].join("\n");
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", workerScript], {
    cwd: repoRoot,
    timeout: 15000,
    encoding: "utf8",
  });
  if (child.signal === "SIGTERM" || child.status === null) {
    console.log("busy_loop: el HIJO fue matado por timeout (contador NO corto) -> HANG");
    check(false, "interrupt: busy_loop corto por el contador (no hang)");
  } else {
    const line = (child.stdout || "").split(/\r?\n/).find((l) => l.trim().startsWith("{"));
    console.log("busy_loop ->", (line || "(sin salida)").trim());
    let parsed = null;
    try { parsed = JSON.parse(line); } catch {}
    check(!!parsed && parsed.ok === true, "interrupt: busy_loop termino con error (no colgo)");
    check(!!parsed && /interrupt/i.test(parsed.msg || ""), 'interrupt: mensaje contiene "interrupted"');
    check(!!parsed && typeof parsed.ms === "number" && parsed.ms < 10000, "interrupt: corto en <10s");
    check(!!parsed && typeof parsed.count === "number" && parsed.count > 0, "interrupt: el contador se invoco (>0)");
  }

  // --- (T25) ATTESTATIONS (ext-skill-attestations v0.2) ---------------------
  // Veredictos Ed25519 contra un registro de revisores, con fetchImpl fake local
  // (service binding DOCS) que sirve llms.txt + tool.js + attestations.json.
  // Casos: attested, invalid (corrupt de registrado DOMINA sobre otra valida),
  // expired, unattested, attester desconocido (ignorado), 404 del archivo (todo
  // unattested sin error), enforcing excluye no-attested.
  console.log("\n[T25] attestations (service binding DOCS fake, node:crypto):");
  const attCrypto = await import("node:crypto");
  const attKey = attCrypto.generateKeyPairSync("ed25519");
  // publica raw 32 bytes -> base64 (lo que va al registro y el gateway importa).
  {
    const jwk = attKey.publicKey.export({ format: "jwk" });
    let x = jwk.x.replace(/-/g, "+").replace(/_/g, "/");
    while (x.length % 4) x += "=";
    var ATT_PUB_B64 = Buffer.from(x, "base64").toString("base64");
  }
  const REVIEWERS = JSON.stringify({
    "human:mauricio": { public_key: ATT_PUB_B64, registered_at: "2026-07-02" },
  });
  const ATTC_CANON = new URL(DOCS_ORIGIN).origin; // == DOCS_ORIGIN (sin slash)
  function signAtt(skill, toolSha, signedOn, validUntil) {
    const payload = Buffer.from(
      [ATTC_CANON, skill, toolSha, signedOn, validUntil].join("\n"), "utf8"
    );
    return attCrypto.sign(null, payload, attKey.privateKey).toString("base64");
  }
  function corruptB64(b64) {
    const buf = Buffer.from(b64, "base64");
    buf[buf.length - 1] = buf[buf.length - 1] ^ 0xff;
    return buf.toString("base64");
  }
  const attSkillNames = ["attested_skill", "invalid_skill", "expired_skill", "unattested_skill"];
  const toolSrcs = {};
  const toolShas = {};
  for (const n of attSkillNames) {
    const src = `registerTool({ name: "${n}", description: "tool ${n}", inputSchema: { type: "object" }, handler: function () { return { name: "${n}" }; } });`;
    toolSrcs[n] = src;
    toolShas[n] = attCrypto.createHash("sha256").update(src, "utf8").digest("hex");
  }
  const skillMeta = (n) =>
    JSON.stringify({ version: "1.0.0", tool: `/skills/${n}/tool.js`, tool_sha256: toolShas[n] });
  const attLlmsTxt =
    "# fake-att\n\n> fake docs for attestation tests\n\n## Skills\n\n" +
    attSkillNames
      .map((n) => `- [${n}](/skills/${n}/SKILL.md): tool ${n} <!-- skill: ${skillMeta(n)} -->`)
      .join("\n") + "\n";
  const sigAtt = signAtt("attested_skill", toolShas["attested_skill"], "2026-07-02", "2027-07-02");
  const sigInv = signAtt("invalid_skill", toolShas["invalid_skill"], "2026-07-02", "2027-07-02");
  const sigExp = signAtt("expired_skill", toolShas["expired_skill"], "2025-01-01", "2025-01-02");
  const attestationsArr = [
    // attested_skill: firma valida de registrado -> attested
    { origin: ATTC_CANON, skill: "attested_skill", tool_sha256: toolShas["attested_skill"],
      attester: "human:mauricio", signed_on: "2026-07-02", valid_until: "2027-07-02", signature: sigAtt },
    // attested_skill: attester DESCONOCIDO con sig corrupta -> ignorado (no invalid)
    { origin: ATTC_CANON, skill: "attested_skill", tool_sha256: toolShas["attested_skill"],
      attester: "human:unknown", signed_on: "2026-07-02", valid_until: "2027-07-02",
      signature: corruptB64(sigAtt) },
    // invalid_skill: firma valida
    { origin: ATTC_CANON, skill: "invalid_skill", tool_sha256: toolShas["invalid_skill"],
      attester: "human:mauricio", signed_on: "2026-07-02", valid_until: "2027-07-02", signature: sigInv },
    // invalid_skill: firma CORRUPTA de registrado -> INVALID domina
    { origin: ATTC_CANON, skill: "invalid_skill", tool_sha256: toolShas["invalid_skill"],
      attester: "human:mauricio", signed_on: "2026-07-02", valid_until: "2027-07-02",
      signature: corruptB64(sigInv) },
    // expired_skill: firma valida, valid_until pasado -> expired
    { origin: ATTC_CANON, skill: "expired_skill", tool_sha256: toolShas["expired_skill"],
      attester: "human:mauricio", signed_on: "2025-01-01", valid_until: "2025-01-02", signature: sigExp },
  ];
  function makeFakeDocs(opts) {
    const noAtt = !!(opts && opts.noAttestations);
    return (request) => {
      const u = new URL(request.url);
      let body = "not found", status = 404, ct = "text/plain; charset=utf-8";
      if (u.pathname === "/llms.txt") {
        body = attLlmsTxt; status = 200; ct = "text/plain; charset=utf-8";
      } else if (u.pathname.startsWith("/skills/") && u.pathname.endsWith("/tool.js")) {
        const name = u.pathname.split("/")[2];
        if (toolSrcs[name]) { body = toolSrcs[name]; status = 200; ct = "application/javascript; charset=utf-8"; }
      } else if (u.pathname === "/.well-known/agent-skills/attestations.json" && !noAtt) {
        body = JSON.stringify(attestationsArr); status = 200; ct = "application/json; charset=utf-8";
      }
      return new Response(body, { status, headers: { "content-type": ct } });
    };
  }
  function attMf(mode, noAtt) {
    return gwMiniflare({
      bindings: { ALLOWED_ORIGINS: DOCS_ORIGIN, REVIEWERS, ATTESTATION_MODE: mode },
      serviceBindings: { DOCS: makeFakeDocs({ noAttestations: noAtt }) },
    });
  }
  async function rpcAtt(mfX, p, payload) {
    const res = await mfX.dispatchFetch("http://localhost" + p, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    });
    let body = null; try { body = await res.json(); } catch { body = await res.text(); }
    return { status: res.status, body, headers: Object.fromEntries(res.headers) };
  }
  const attBase = "/mcp?origin=" + encodeURIComponent(DOCS_ORIGIN);

  // --- advisory ---
  const mfAttAdv = attMf("advisory", false);
  try {
    const list = await rpcAtt(mfAttAdv, attBase, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    const tools = list.body && list.body.result && list.body.result.tools;
    console.log("[T25.adv] tools/list ->", (tools || []).map((t) => t.name + "=" + (t.description||"").split("[attestation:")[1] || "?").join(" "));
    check(list.status === 200, "att.adv: tools/list HTTP 200");
    check(Array.isArray(tools) && tools.length === 4, "att.adv: 4 skills cargadas (advisory no excluye)");
    const descOf = (n) => (tools.find((t) => t.name === n) || {}).description || "";
    check(/ \[attestation: attested\]$/.test(descOf("attested_skill")), "att.adv: attested_skill -> [attestation: attested]");
    check(/ \[attestation: invalid\]$/.test(descOf("invalid_skill")), "att.adv: invalid_skill -> [attestation: invalid] (corrupt domina)");
    check(/ \[attestation: expired\]$/.test(descOf("expired_skill")), "att.adv: expired_skill -> [attestation: expired]");
    check(/ \[attestation: unattested\]$/.test(descOf("unattested_skill")), "att.adv: unattested_skill -> [attestation: unattested]");
    const ah = list.headers["x-gw-attestations"];
    console.log("[T25.adv] X-Gw-Attestations ->", ah);
    check(!!ah, "att.adv: header X-Gw-Attestations presente");
    check(ah && ah.includes("1attested") && ah.includes("1expired") && ah.includes("1invalid") && ah.includes("1unattested"),
      "att.adv: header con conteos 1attested,1expired,1invalid,1unattested");
    // attester desconocido ignorado: attested_skill sigue attested pese a sig corrupta de human:unknown
    check(/ \[attestation: attested\]$/.test(descOf("attested_skill")),
      "att.adv: attester desconocido (sig corrupta) ignorado -> attested_skill sigue attested (no invalid)");
    // tools/call attested_skill funciona (advisory no rompe ejecucion)
    const call = await rpcAtt(mfAttAdv, attBase, {
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "attested_skill", arguments: {} },
    });
    const callSc = call.body && call.body.result && call.body.result.structuredContent;
    console.log("[T25.adv] tools/call attested_skill ->", JSON.stringify(call.body).slice(0, 200));
    check(call.status === 200 && callSc && callSc.name === "attested_skill",
      "att.adv: tools/call attested_skill ejecuta y devuelve {name:attested_skill}");
  } finally {
    await mfAttAdv.dispose();
  }

  // --- enforcing: excluye no-attested como hash mismatch ---
  const mfAttEnf = attMf("enforcing", false);
  try {
    const list = await rpcAtt(mfAttEnf, attBase, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    const tools = list.body && list.body.result && list.body.result.tools;
    const names = (tools || []).map((t) => t.name);
    console.log("[T25.enf] tools/list ->", JSON.stringify(names), "header=", list.headers["x-gw-attestations"]);
    check(list.status === 200, "att.enf: tools/list HTTP 200");
    check(Array.isArray(tools) && tools.length === 1 && names[0] === "attested_skill",
      "att.enf: SOLO attested_skill cargada (invalid/expired/unattested excluidas)");
    check(tools[0] && / \[attestation: attested\]$/.test(tools[0].description),
      "att.enf: la unica tool cargada etiquetada [attestation: attested]");
    // el header muestra el cuadro completo (4 skills) aunque solo 1 cargue
    check(list.headers["x-gw-attestations"] && list.headers["x-gw-attestations"].includes("1attested") && list.headers["x-gw-attestations"].includes("1unattested"),
      "att.enf: header X-Gw-Attestations con conteos completos (1attested,...,1unattested)");
    // tools/call unattested_skill -> excluida -> no encontrada
    const call = await rpcAtt(mfAttEnf, attBase, {
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "unattested_skill", arguments: {} },
    });
    console.log("[T25.enf] tools/call unattested_skill ->", JSON.stringify(call.body).slice(0, 200));
    check(call.status === 200, "att.enf: tools/call unattested_skill HTTP 200 (no crash)");
    check(call.body && (call.body.error || (call.body.result && call.body.result.isError)),
      "att.enf: unattested_skill excluida -> call responde error (no encontrada)");
  } finally {
    await mfAttEnf.dispose();
  }

  // --- 404 del archivo: todo unattested, sin error ---
  const mfAtt404 = attMf("advisory", true);
  try {
    const list = await rpcAtt(mfAtt404, attBase, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    const tools = list.body && list.body.result && list.body.result.tools;
    console.log("[T25.404] tools/list ->", (tools || []).length, "tools, header=", list.headers["x-gw-attestations"]);
    check(list.status === 200, "att.404: tools/list HTTP 200 (404 del archivo NO es error)");
    check(Array.isArray(tools) && tools.length === 4, "att.404: 4 skills cargadas (404 -> todo unattested, cargan igual)");
    check((tools || []).every((t) => / \[attestation: unattested\]$/.test(t.description || "")),
      "att.404: todas las tools [attestation: unattested]");
    check(list.headers["x-gw-attestations"] === "0attested,0expired,0invalid,4unattested",
      "att.404: header X-Gw-Attestations = 0attested,0expired,0invalid,4unattested");
  } finally {
    await mfAtt404.dispose();
  }

  // --- (T35) HERMETICIDAD offline: el interceptor NO es decorativo -------------
  // Misma gateway worker, ALLOWED_ORIGINS=DEMO (pasa el check 403), interceptor
  // activo, PERO sin binding DEMO -> makeFetchImpl cae al fetch global -> el
  // interceptor lo bloquea (status 598, firma propia) -> discovery falla -> 500
  // con error que cita "HTTP 598". Demuestra que el interceptor atrapa la ruta de
  // red real del gateway (no es decorativo). Solo corre en --offline.
  if (OFFLINE) {
    console.log("\n[T35] hermeticidad offline (interceptor bloquea fetch saliente):");
    const mfHerm = new Miniflare({
      scriptPath: fileURLToPath(new URL("./dist-gateway/worker.js", import.meta.url)),
      modules: true,
      modulesRules: [
        { type: "ESModule", include: ["**/*.js"] },
        { type: "CompiledWasm", include: ["**/*.wasm"] },
      ],
      compatibilityDate: "2026-06-01",
      compatibilityFlags: ["nodejs_compat"],
      bindings: { ALLOWED_ORIGINS: DEMO_ORIGIN },
      outboundService: offlineFakes.interceptor,
      // SIN serviceBindings: el fetch al demo cae al fetch global -> interceptor.
    });
    async function rpcHerm(p, payload) {
      const res = await mfHerm.dispatchFetch("http://localhost" + p, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      });
      let body = null; try { body = await res.json(); } catch { body = await res.text(); }
      return { status: res.status, body };
    }
    try {
      const herm = await rpcHerm("/mcp?origin=" + encodeURIComponent(DEMO_ORIGIN),
        { jsonrpc: "2.0", id: 1, method: "initialize" });
      console.log("[T35] initialize sin binding + interceptor ->", JSON.stringify(herm.body).slice(0, 200));
      check(herm.status === 502,
        "T35: sin binding + interceptor -> HTTP 502 (discovery fallo: el fetch saliente fue bloqueado, no servido por red real)");
      check(herm.body && herm.body.error && /598/.test(herm.body.error.message),
        "T35: el error cita HTTP 598 (firma del interceptor: hermeticidad por maquina, no decorativo)");
    } finally {
      await mfHerm.dispose();
    }
  }

  // --- (T42) CAPS DE TAMANO EN FETCHES DE DESCUBRIMIENTO ----------------------
  // Todos los fetches de discovery (llms.txt, tool.js, attestations.json, snapshot)
  // tienen un cap de tamano configurable por env (defaults que no afectan a los 3
  // origins reales). Enforcement en dos niveles: (a) Content-Length precheck
  // (rechaza sin leer si el header declara mas del cap) y (b) streaming defensivo
  // (acumula hasta cap; si excede, cancela y rechaza — nunca confia solo en CL,
  // que puede faltar o mentir). Semantica de rechazo por tipo (sin tumbar nada mas):
  //   - llms.txt excedido  -> discovery falla (mismo error controlado que fetch fallido).
  //   - tool.js excedido   -> ESA skill a rejected con razon de tamano (patron hash
  //                          mismatch); las demas cargan.
  //   - attestations exc.  -> null (ausente) -> unattested -> excluidas en enforcing
  //                          (fail-safe; advisory las lista como unattested).
  //   - snapshot excedido  -> memorySearch no se inyecta (patron sha mismatch).
  // Hermetico: caps CHICOS via env (p.ej. MAX_TOOL_BYTES=1000) para no generar MB.
  // El origin reutiliza DOCS_ORIGIN (en la allowlist) con un service binding DOCS
  // propio por caso. Las razones de rechazo se capturan via handleRuntimeStdio.
  console.log("\n[T42] caps de tamano en fetches de descubrimiento:");
  const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

  // tool.js valido de EXACTAMENTE n bytes (head + comentario de relleno). Registra
  // una tool que devuelve {ok:n} (para probar ejecucion). El sha se computa sobre
  // los bytes exactos servidos => coherente con lo que el gateway verifica.
  function makeToolJs(name, n) {
    const head = "registerTool({ name: " + JSON.stringify(name) + ", description: \"t\", inputSchema: { type: \"object\" }, handler: function () { return { ok: " + n + " }; } });";
    if (head.length + 4 > n) throw new Error("makeToolJs: n demasiado chico para " + name);
    const fill = n - head.length - 4; // "/*" + fill + "*/" == 4+fill
    return head + "/*" + "x".repeat(fill) + "*/";
  }
  // tool.js que LLAMA a host.memorySearch (para observar la no-inyeccion cuando el
  // snapshot excede el cap). Si memorySearch es undefined -> throw -> isError:true.
  function makeMemProbeJs(n) {
    const head = "registerTool({ name: \"mem_probe\", description: \"m\", inputSchema: { type: \"object\", properties: { q: { type: \"string\" } }, required: [\"q\"] }, handler: async function (a) { return await host.memorySearch(a.q, 5); } });";
    if (head.length + 4 > n) throw new Error("makeMemProbeJs: n demasiado chico");
    const fill = n - head.length - 4;
    return head + "/*" + "x".repeat(fill) + "*/";
  }

  // Fabrica un fake DOCS para T42. skills: [{name, bytes, src?}]; memory:
  // {snapshotBytes} | null; attestations: string | null. tool.js por skill se sirve
  // como string (workerd no setea Content-Length => streaming) salvo streamSkill
  // (nombre): se sirve como ReadableStream (chunked, sin CL); clHugeSkill (nombre):
  // body chico + header content-length enorme (para probar el precheck).
  function makeT42Fake({ skills, memory, attestations, streamSkill, clHugeSkill }) {
    const toolSrc = {}, toolSha = {};
    for (const s of skills) {
      const src = s.src || makeToolJs(s.name, s.bytes);
      toolSrc[s.name] = src;
      toolSha[s.name] = sha(src);
    }
    let snapBytes = 0, snapSha = "";
    if (memory) {
      snapBytes = memory.snapshotBytes;
      const snap = "x".repeat(snapBytes);
      snapSha = sha(snap);
    }
    let llms = "# t42\n\n> t42 origin\n\n";
    if (memory) {
      llms += '<!-- skills-memory: ' +
        JSON.stringify({ snapshot: "/skills-index.snapshot", snapshot_sha256: snapSha, format: "minimemory-okf-v1" }) +
        ' -->\n\n';
    }
    llms += "## Skills\n\n";
    for (const s of skills) {
      llms += "- [" + s.name + "](/skills/" + s.name + "/SKILL.md): " + s.name + " <!-- skill: " +
        JSON.stringify({ version: "1.0.0", tool: "/skills/" + s.name + "/tool.js", tool_sha256: toolSha[s.name] }) + " -->\n";
    }
    return (request) => {
      const u = new URL(request.url);
      let body = "not found", status = 404, ct = "text/plain; charset=utf-8";
      if (u.pathname === "/llms.txt") { body = llms; status = 200; ct = "text/plain; charset=utf-8"; }
      else if (u.pathname.startsWith("/skills/") && u.pathname.endsWith("/tool.js")) {
        const name = u.pathname.split("/")[2];
        if (toolSrc[name]) {
          status = 200; ct = "application/javascript; charset=utf-8";
          if (streamSkill && name === streamSkill) {
            // ReadableStream (chunked, sin Content-Length): el precheck no dispara.
            const src = toolSrc[name];
            body = new ReadableStream({
              start(c) { c.enqueue(new TextEncoder().encode(src)); c.close(); }
            });
          } else if (clHugeSkill && name === clHugeSkill) {
            // body chico + content-length enorme: el precheck rechaza sin leer.
            return new Response(toolSrc[name], { status, headers: { "content-type": ct, "content-length": "999999999" } });
          } else {
            body = toolSrc[name];
          }
        }
      } else if (memory && u.pathname === "/skills-index.snapshot") {
        body = "x".repeat(snapBytes); status = 200; ct = "application/octet-stream";
      } else if (attestations != null && u.pathname === "/.well-known/agent-skills/attestations.json") {
        body = attestations; status = 200; ct = "application/json; charset=utf-8";
      }
      return new Response(body, { status, headers: { "content-type": ct } });
    };
  }

  // rpc contra una mf T42 con captura de stderr (razones de rechazo por tamano).
  async function rpcT42(mfX, p, payload) {
    const res = await mfX.dispatchFetch("http://localhost" + p, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    });
    let body = null; try { body = await res.json(); } catch { body = await res.text(); }
    return { status: res.status, body, headers: Object.fromEntries(res.headers) };
  }
  // construye mf T42 con caps via env (bindings) + fake DOCS + captura de stdio.
  function t42mf(caps, fake, extraBindings) {
    let captured = "";
    const mfX = gwMiniflare({
      bindings: { ALLOWED_ORIGINS: DOCS_ORIGIN, ...caps, ...(extraBindings || {}) },
      serviceBindings: { DOCS: fake },
      stdio: (stdout, stderr) => { stderr.on("data", (d) => { captured += d.toString(); }); stdout.on("data", (d) => { captured += d.toString(); }); },
    });
    return { mf: mfX, getStd: () => captured, drain: (pred, ms) => new Promise((res) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (pred() || Date.now() - t0 > (ms || 1500)) { clearInterval(iv); res(); }
      }, 50);
    }) };
  }
  const t42Base = "/mcp?origin=" + encodeURIComponent(DOCS_ORIGIN);

  // (a) tool.js cap+1 -> skill rejected con razon de tamano; la otra carga y ejecuta.
  {
    const { mf: mfA, getStd, drain } = t42mf(
      { MAX_TOOL_BYTES: 1000 },
      makeT42Fake({ skills: [{ name: "small", bytes: 200 }, { name: "big", bytes: 1001 }] })
    );
    try {
      const list = await rpcT42(mfA, t42Base, { jsonrpc: "2.0", id: 1, method: "tools/list" });
      await drain(() => /big.*tool\.js excede el limite de tamano/.test(getStd()));
      const tools = list.body && list.body.result && list.body.result.tools;
      const names = (tools || []).map((t) => t.name);
      console.log("[T42.a] tools/list ->", JSON.stringify(names), "discovery=" + list.headers["x-gw-discovery"]);
      check(list.status === 200, "T42.a: tools/list HTTP 200 (origin descubre pese a 1 skill rechazada)");
      check(Array.isArray(tools) && names.includes("small") && !names.includes("big"),
        "T42.a: small cargada, big rechazada por tamano (cap 1000, big=1001)");
      const call = await rpcT42(mfA, t42Base, {
        jsonrpc: "2.0", id: 2, method: "tools/call",
        params: { name: "small", arguments: {} },
      });
      const sc = call.body && call.body.result && call.body.result.structuredContent;
      console.log("[T42.a] tools/call small ->", JSON.stringify(call.body).slice(0, 160));
      check(call.status === 200 && sc && sc.ok === 200, "T42.a: small ejecuta y devuelve {ok:200}");
      check(/big.*tool\.js excede el limite de tamano/.test(getStd()),
        "T42.a: el stderr del worker cita 'big -> tool.js excede el limite de tamano'");
    } finally { await mfA.dispose(); }
  }
  // (a.control) mismo origin con cap grande -> ambas cargan (prueba que es el cap, no
  // un sha invalido ni JS roto, lo que rechaza a big).
  {
    const { mf: mfA2 } = t42mf(
      { MAX_TOOL_BYTES: 2000 },
      makeT42Fake({ skills: [{ name: "small", bytes: 200 }, { name: "big", bytes: 1001 }] })
    );
    try {
      const list = await rpcT42(mfA2, t42Base, { jsonrpc: "2.0", id: 1, method: "tools/list" });
      const names = ((list.body && list.body.result && list.body.result.tools) || []).map((t) => t.name);
      console.log("[T42.a.control] cap 2000 -> tools/list =", JSON.stringify(names));
      check(Array.isArray(names) && names.includes("small") && names.includes("big"),
        "T42.a.control: con cap 2000 big (1001) carga -> el rechazo previo era por el cap, no por sha/JS");
    } finally { await mfA2.dispose(); }
  }

  // (b) boundary: tool.js de EXACTAMENTE cap bytes -> pasa.
  {
    const { mf: mfB } = t42mf(
      { MAX_TOOL_BYTES: 1000 },
      makeT42Fake({ skills: [{ name: "exact", bytes: 1000 }] })
    );
    try {
      const list = await rpcT42(mfB, t42Base, { jsonrpc: "2.0", id: 1, method: "tools/list" });
      const names = ((list.body && list.body.result && list.body.result.tools) || []).map((t) => t.name);
      const call = await rpcT42(mfB, t42Base, {
        jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "exact", arguments: {} },
      });
      const sc = call.body && call.body.result && call.body.result.structuredContent;
      console.log("[T42.b] boundary cap=1000 bytes=1000 -> tools/list =", JSON.stringify(names), "call.ok=", sc && sc.ok);
      check(list.status === 200 && Array.isArray(names) && names.includes("exact"),
        "T42.b: tool.js de exactamente cap (1000) bytes carga (boundary: >cap rechaza, ==cap pasa)");
      check(call.status === 200 && sc && sc.ok === 1000, "T42.b: la tool de cap bytes ejecuta");
    } finally { await mfB.dispose(); }
  }

  // (c) llms.txt excedido -> discovery falla (mismo shape controlado que fetch fallido).
  {
    // llms.txt enorme (>512). El gateway lo fetchea, excede el cap -> throw ->
    // "fetch llms.txt fallo: ..." -> 502 (mismo shape que un fetch fallido de llms.txt).
    const bigLlms = "# t42\n\n" + "x".repeat(2000) + "\n";
    const { mf: mfC } = t42mf(
      { MAX_LLMS_BYTES: 512 },
      (request) => {
        const u = new URL(request.url);
        if (u.pathname === "/llms.txt") return new Response(bigLlms, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
        return new Response("nf", { status: 404 });
      }
    );
    try {
      const r = await rpcT42(mfC, t42Base, { jsonrpc: "2.0", id: 1, method: "initialize" });
      console.log("[T42.c] llms.txt excedido -> HTTP " + r.status, JSON.stringify(r.body).slice(0, 160));
      check(r.status === 502, "T42.c: llms.txt excedido -> HTTP 502 (discovery falla, mismo shape que fetch fallido)");
      check(r.body && r.body.error && r.body.error.code === -32603,
        "T42.c: error JSON-RPC -32603 (mismo code que un fetch fallido de llms.txt)");
      check(r.body && r.body.error && /llms\.txt/.test(r.body.error.message),
        "T42.c: el mensaje cita llms.txt (mismo error controlado que fetch fallido, no crash)");
    } finally { await mfC.dispose(); }
  }

  // (d) snapshot excedido -> memorySearch NO se inyecta; skills OK (patron sha mismatch).
  {
    // mem_probe llama host.memorySearch; snapshot de cap+1 bytes (>512) -> fetch
    // excede -> snapshotText null -> capability ausente -> call isError:true.
    const probeSrc = makeMemProbeJs(260);
    const { mf: mfD } = t42mf(
      { MAX_SNAPSHOT_BYTES: 512 },
      makeT42Fake({
        skills: [{ name: "mem_probe", bytes: 260, src: probeSrc }],
        memory: { snapshotBytes: 513 },
      })
    );
    try {
      const list = await rpcT42(mfD, t42Base, { jsonrpc: "2.0", id: 1, method: "tools/list" });
      const names = ((list.body && list.body.result && list.body.result.tools) || []).map((t) => t.name);
      const call = await rpcT42(mfD, t42Base, {
        jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "mem_probe", arguments: { q: "x" } },
      });
      const isError = call.body && call.body.result && call.body.result.isError;
      console.log("[T42.d] snapshot exc. -> list=", JSON.stringify(names), "call.isError=", isError);
      check(list.status === 200 && Array.isArray(names) && names.includes("mem_probe"),
        "T42.d: la skill se lista (tool.js verificado) pese al snapshot excedido");
      check(call.status === 200 && isError === true,
        "T42.d: memorySearch NO inyectada (snapshot excedido -> snapshotText null -> fail controlado, no crash)");
    } finally { await mfD.dispose(); }
  }

  // (e) attestations excedido en enforcing -> skills excluidas como unattested (fail-safe).
  // Contracontrol: con attestations BAJO el cap y firma valida -> attested -> cargan.
  // Reusa la maquinaria Ed25519 del bloque T25 (attKey/signAtt/REVIEWERS/ATTC_CANON).
  {
    const skillNames = ["t42e_a", "t42e_b"];
    const toolSrcs = {}, toolShas = {};
    for (const n of skillNames) { toolSrcs[n] = makeToolJs(n, 200); toolShas[n] = sha(toolSrcs[n]); }
    function signedAtt(skill, toolSha, signedOn, validUntil, pad) {
      const payload = Buffer.from([ATTC_CANON, skill, toolSha, signedOn, validUntil].join("\n"), "utf8");
      const sig = attCrypto.sign(null, payload, attKey.privateKey).toString("base64");
      const obj = {
        origin: ATTC_CANON, skill, tool_sha256: toolSha,
        attester: "human:mauricio", signed_on: signedOn, valid_until: validUntil, signature: sig,
      };
      if (pad) obj.pad = "x".repeat(pad);
      return obj;
    }
    const attOkArr = skillNames.map((n) => signedAtt(n, toolShas[n], "2026-07-02", "2027-07-02", 0));
    const attBigArr = skillNames.map((n) => signedAtt(n, toolShas[n], "2026-07-02", "2027-07-02", 4000));
    const attOkBody = JSON.stringify(attOkArr);   // ~ bajo cap (cap 1000)
    const attBigBody = JSON.stringify(attBigArr);  // > cap (cap 1000)
    function fakeE(big) {
      return makeT42Fake({
        skills: skillNames.map((n) => ({ name: n, bytes: 200, src: toolSrcs[n] })),
        attestations: big ? attBigBody : attOkBody,
      });
    }
    // enforcing, attestations BAJO cap y validas -> attested -> skills cargan
    const { mf: mfEok } = t42mf(
      { MAX_ATTESTATIONS_BYTES: 1000 },
      fakeE(false),
      { ATTESTATION_MODE: "enforcing", REVIEWERS }
    );
    try {
      const list = await rpcT42(mfEok, t42Base, { jsonrpc: "2.0", id: 1, method: "tools/list" });
      const names = ((list.body && list.body.result && list.body.result.tools) || []).map((t) => t.name);
      console.log("[T42.e.ok] enforcing + attestations validas bajo cap -> list=", JSON.stringify(names),
        "hdr=", list.headers["x-gw-attestations"]);
      check(list.status === 200 && Array.isArray(names) && names.length === 2,
        "T42.e.ok: enforcing con attestations validas (bajo cap) -> 2 skills attested cargan");
      check(list.headers["x-gw-attestations"] && list.headers["x-gw-attestations"].includes("2attested"),
        "T42.e.ok: header X-Gw-Attestations = 2 attested (las firmas verifican bajo el cap)");
    } finally { await mfEok.dispose(); }
    // enforcing, attestations EXCEDEN cap -> null -> unattested -> excluidas -> 502
    const { mf: mfEbig, getStd, drain } = t42mf(
      { MAX_ATTESTATIONS_BYTES: 1000 },
      fakeE(true),
      { ATTESTATION_MODE: "enforcing", REVIEWERS }
    );
    try {
      const list = await rpcT42(mfEbig, t42Base, { jsonrpc: "2.0", id: 1, method: "tools/list" });
      await drain(() => /attestations fetch fallo:.*excede el limite de tamano/.test(getStd()));
      console.log("[T42.e.big] enforcing + attestations excedidas -> HTTP " + list.status,
        JSON.stringify(list.body).slice(0, 140));
      check(list.status === 502,
        "T42.e.big: attestations exceden cap -> null -> unattested -> enforcing excluye TODAS -> 502 (fail-safe)");
      check(/attestations fetch fallo:.*excede el limite de tamano/.test(getStd()),
        "T42.e.big: el stderr cita 'attestations fetch fallo: ... excede el limite de tamano' (tratado como ausente, no crash)");
    } finally { await mfEbig.dispose(); }
  }

  // (f) Content-Length no confiable: dos niveles de enforcement sin fiarse del header.
  //   (f.clhuge) header content-length ENORME sobre un body chico -> el precheck
  //     rechaza SIN leer el body (nivel a). En workerd el header sobrevive al receptor
  //     y el gateway cancela antes de leer.
  //   (f.chunked) tool.js servido como ReadableStream (sin Content-Length, chunked) de
  //     cap+1 bytes -> el streaming corta (nivel b). Es el vector realista de un
  //     "Content-Length mentiroso": un server que evita el framing por CL (chunked) y
  //     entrega mas bytes del cap. NOTA: workerd enmarca el body por Content-Length
  //     (trunca al declarado), por lo que un "CL chico + body gordo" literal NO es
  //     construible; el equivalente fiel es chunked (CL ausente) + body gordo.
  {
    // (f.clhuge) body chico + content-length enorme -> precheck rechaza sin leer.
    // Dos skills: small carga (CL normal); victim con CL enorme -> precheck la rechaza.
    const { mf: mfF1, getStd, drain } = t42mf(
      { MAX_TOOL_BYTES: 1000 },
      makeT42Fake({ skills: [{ name: "small", bytes: 200 }, { name: "victim", bytes: 200 }], clHugeSkill: "victim" })
    );
    try {
      const list = await rpcT42(mfF1, t42Base, { jsonrpc: "2.0", id: 1, method: "tools/list" });
      await drain(() => /victim.*tool\.js excede el limite de tamano/.test(getStd()));
      const names = ((list.body && list.body.result && list.body.result.tools) || []).map((t) => t.name);
      console.log("[T42.f.clhuge] CL=999999999 (victim) cap=1000 -> list=", JSON.stringify(names));
      check(list.status === 200 && Array.isArray(names) && names.includes("small") && !names.includes("victim"),
        "T42.f.clhuge: Content-Length enorme (>cap) -> precheck rechaza sin leer el body -> victim rechazada, small carga");
      check(/victim.*tool\.js excede el limite de tamano/.test(getStd()),
        "T42.f.clhuge: razon de tamano en stderr (precheck por Content-Length, no se leyo el body)");
    } finally { await mfF1.dispose(); }
  }
  {
    // (f.chunked) ReadableStream (sin CL) de cap+1 bytes -> streaming corta.
    // Dos skills: small carga; big servido como stream de 1001 bytes -> streaming corta.
    const { mf: mfF2, getStd, drain } = t42mf(
      { MAX_TOOL_BYTES: 1000 },
      makeT42Fake({ skills: [{ name: "small", bytes: 200 }, { name: "big", bytes: 1001 }], streamSkill: "big" })
    );
    try {
      const list = await rpcT42(mfF2, t42Base, { jsonrpc: "2.0", id: 1, method: "tools/list" });
      await drain(() => /big.*tool\.js excede el limite de tamano/.test(getStd()));
      const names = ((list.body && list.body.result && list.body.result.tools) || []).map((t) => t.name);
      console.log("[T42.f.chunked] ReadableStream 1001 bytes (big, sin CL) cap=1000 -> list=", JSON.stringify(names));
      check(list.status === 200 && Array.isArray(names) && names.includes("small") && !names.includes("big"),
        "T42.f.chunked: tool.js chunked (sin CL) de cap+1 bytes -> streaming corta -> big rechazada, small carga");
      check(/big.*tool\.js excede el limite de tamano/.test(getStd()),
        "T42.f.chunked: razon de tamano en stderr (streaming defensivo, no confia en CL ausente)");
    } finally { await mfF2.dispose(); }
  }

  // (g) checks existentes intactos: la suite verde hasta aqui (incluidos T22/T25/T35/
  // T37/T38/T40) ya corrio antes de T42. Se afirma de forma implicita: si T42 rompia
  // el comportamiento default, los checks previos habrian fallado. Ademas un smoke
  // directo al demo offline con caps por DEFAULT (sin env) confirma no-regresion.
  {
    const { mf: mfG } = t42mf({}, offlineFakes ? offlineFakes.docs : makeT42Fake({ skills: [{ name: "s", bytes: 200 }] }));
    try {
      const list = await rpcT42(mfG, t42Base, { jsonrpc: "2.0", id: 1, method: "tools/list" });
      console.log("[T42.g] smoke default-caps docs -> HTTP " + list.status + " (no-regresion: caps default no rompen discovery)");
      check(list.status === 200, "T42.g: con caps por DEFAULT (sin env) el discovery del docs real/fake sigue HTTP 200 (no-regresion)");
    } finally { await mfG.dispose(); }
  }

  // ---------------------------------------------------------------------------
  // [preheat] El handler scheduled precalienta el descubrimiento: tras disparar
  // el evento (endpoint especial de workerd /cdn-cgi/handler/scheduled, opt-in
  // unsafeTriggerHandlers), el PRIMER request MCP del isolate ya reporta
  // X-Gw-Discovery=hit — la capa 1 la poblo el cron, no un request. Sin el
  // preheat ese primer request seria siempre "miss" (asi lo asevera el check 1
  // de esta suite). Isolate fresco (instancia Miniflare propia).
  console.log("\n[preheat] scheduled() -> primer request MCP con discovery=hit:");
  const mfPre = gwMiniflare({
    bindings: { ALLOWED_ORIGINS: DEMO_ORIGIN },
    triggerHandlers: true,
  });
  try {
    const sched = await mfPre.dispatchFetch("http://localhost/cdn-cgi/handler/scheduled");
    console.log("[preheat] trigger scheduled -> HTTP " + sched.status + " " + (await sched.text()).slice(0, 60));
    check(sched.status === 200, "preheat: el trigger scheduled respondio 200");

    async function rpcPre(payload) {
      const res = await mfPre.dispatchFetch(
        "http://localhost/mcp?origin=" + encodeURIComponent(DEMO_ORIGIN),
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }
      );
      let body = null;
      try { body = await res.json(); } catch { body = null; }
      return { status: res.status, body, headers: Object.fromEntries(res.headers) };
    }

    const preFirst = await rpcPre({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    console.log("[preheat] 1er tools/list -> discovery=" + preFirst.headers["x-gw-discovery"]);
    check(preFirst.status === 200, "preheat: 1er tools/list HTTP 200");
    check(
      preFirst.headers["x-gw-discovery"] === "hit",
      "preheat: 1er request MCP del isolate -> X-Gw-Discovery=hit (descubrimiento precalentado por el cron)"
    );
    const preNames = ((preFirst.body && preFirst.body.result && preFirst.body.result.tools) || []).map((t) => t.name);
    check(preNames.includes("sum_numbers"), "preheat: tools/list precalentado contiene sum_numbers");

    const preCall = await rpcPre({
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "sum_numbers", arguments: { a: 20, b: 22 } },
    });
    const preSc = preCall.body && preCall.body.result && preCall.body.result.structuredContent;
    check(preCall.status === 200 && preSc && preSc.result === 42,
      "preheat: tools/call sum_numbers sobre el cache precalentado -> 42");
  } finally {
    await mfPre.dispose();
  }

  console.log("\n" + (failures === 0 ? "TODOS LOS CHECKS VERDE" : failures + " CHECK(S) ROJO(S)"));
} catch (e) {
  console.error("ERROR en mf-gateway:", e && e.stack ? e.stack : e);
  failures++;
} finally {
  await mf.dispose();
}

if (failures !== 0) process.exit(1);