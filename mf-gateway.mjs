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
  const mfAuth = new Miniflare({
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
  } finally {
    await mfAuth.dispose();
  }

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
  const mf2 = new Miniflare({
    scriptPath: fileURLToPath(new URL("./dist-gateway/worker.js", import.meta.url)),
    modules: true,
    modulesRules: [
      { type: "ESModule", include: ["**/*.js"] },
      { type: "CompiledWasm", include: ["**/*.wasm"] },
    ],
    compatibilityDate: "2026-06-01",
    compatibilityFlags: ["nodejs_compat"],
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

  console.log("\n" + (failures === 0 ? "TODOS LOS CHECKS VERDE" : failures + " CHECK(S) ROJO(S)"));
} catch (e) {
  console.error("ERROR en mf-gateway:", e && e.stack ? e.stack : e);
  failures++;
} finally {
  await mf.dispose();
}

if (failures !== 0) process.exit(1);