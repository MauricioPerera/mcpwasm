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
import { newQuickJSAsyncWASMModuleFromVariant, newVariant } from "quickjs-emscripten-core";
import baseAsyncifyVariant from "@jitl/quickjs-wasmfile-release-asyncify";
import { AsyncToolHost } from "./host-async.mjs";
import { handleMcpMessageAsync } from "./mcp-core-async.mjs";

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

  hostA.dispose();
  hostB.dispose();
  try { quickjs.dispose(); } catch { /* best-effort */ }

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

  console.log("\n" + (failures === 0 ? "TODOS LOS CHECKS VERDE" : failures + " CHECK(S) ROJO(S)"));
} catch (e) {
  console.error("ERROR en mf-gateway:", e && e.stack ? e.stack : e);
  failures++;
} finally {
  await mf.dispose();
}

if (failures !== 0) process.exit(1);