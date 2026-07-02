// worker-memspike.mjs
// Entry Workers del spike TAREA20: minimemory (BM25) + QuickJS sandbox en el
// MISMO Worker. Demuestra que la base embebida minimemory v3.2.0 (WasmOkfIndex,
// BM25-only sin embeddings) convivir con QuickJS-asyncify y servir de capability
// de busqueda para una skill sandboxeada.
//
//   search_docs {q} -> handler async que hace `await host.memorySearch(args.q)` y
//                      devuelve {hits:[{text (<=200 chars), score, section}]}.
//   echo {msg}       -> skill trivial QuickJS pura (coexistencia de los 2 wasm).
//
// Capability host.memorySearch se inyecta via la extension COMPATIBLE
// extraCapabilities de AsyncToolHost (vía A): puente raw-JSON asyncified, mismo
// patron que host.fetchOrigin. El host llama al wasm de minimemory (sync) mientras
// asyncify suspende la pila del wasm QuickJS => dos wasm independientes coexistentes.
//
// Integridad: el snapshot (mem-docs.snapshot, bundleado junto al bundle) se
// verifica sha256 contra EXPECTED_SNAPSHOT_SHA_DEFAULT (constante horneada en
// build) antes de importarlo. env.EXPECTED_SNAPSHOT_SHA override (test negativo).
// Mismo principio de integridad que tool_sha256. Si el sha no coincide, NO se
// importa y memorySearch devuelve {error:"..."} (error controlado, no crash).

import "./shim.mjs"; // primero: location/self para el loader del wasm QuickJS
import { newQuickJSAsyncWASMModuleFromVariant, newVariant } from "quickjs-emscripten-core";
import baseAsyncifyVariant from "@jitl/quickjs-wasmfile-release-asyncify";
import { AsyncToolHost } from "./host-async.mjs";
import { handleMcpMessageAsync } from "./mcp-core-async.mjs";
import initMem, { WasmOkfIndex } from "@rckflr/minimemory";

// Imports estaticos de los .wasm (workerd los compila via CompiledWasm) y del
// snapshot (texto, via regla Text de Miniflare). TAREA24: el wrapper JS de
// minimemory se consume desde el paquete npm (bundleado por esbuild); el .wasm
// queda como import verbatim (external *.wasm) y se copia junto al bundle.
import QUICKJS_WASM from "./quickjs-asyncify.wasm";
import MEM_WASM from "./minimemory_bg.wasm";
import SNAPSHOT_TEXT from "./mem-docs.snapshot";

// Variante asyncify QuickJS con modulo pre-compilado (mismo truco que worker.mjs).
const quickjsVariant = newVariant(baseAsyncifyVariant, { wasmModule: QUICKJS_WASM });

// Construccion perezosa y cacheada del modulo QuickJS (sin top-level await).
let _quickjsPromise = null;
function getQuickjs() {
  if (!_quickjsPromise) {
    _quickjsPromise = newQuickJSAsyncWASMModuleFromVariant(quickjsVariant);
  }
  return _quickjsPromise;
}

// --- Motor minimemory: init wasm + verify sha + import snapshot (cacheado) ---
// Se cachea por expected-sha: el test negativo cambia env.EXPECTED_SNAPSHOT_SHA
// => clave distinta => re-init que falla la verificacion y cachea el error.
const _engineCache = new Map();

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const arr = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < arr.length; i++) hex += arr[i].toString(16).padStart(2, "0");
  return hex;
}

async function initEngine(env) {
  const expected = (env && env.EXPECTED_SNAPSHOT_SHA) || EXPECTED_SNAPSHOT_SHA_DEFAULT;
  if (_engineCache.has(expected)) return _engineCache.get(expected);
  const p = (async () => {
    // 1) init minimemory wasm (modulo pre-compilado por workerd). Forma objeto
    //    {module_or_path} para evitar el warning "deprecated parameters" del
    //    wrapper (pasar el Module directo lo dispara; funciona igual).
    await initMem({ module_or_path: MEM_WASM });
    // 2) verificacion de integridad del snapshot (antes de importarlo).
    const got = await sha256Hex(SNAPSHOT_TEXT);
    if (got !== expected) {
      return {
        error:
          "snapshot integrity check failed: sha256 mismatch (expected " +
          String(expected).slice(0, 12) + "... got " + got.slice(0, 12) + "...)",
      };
    }
    // 3) construir OkfIndex e importar el snapshot verificado.
    const idx = new WasmOkfIndex();
    const count = idx.import_snapshot(SNAPSHOT_TEXT);
    return { idx, count };
  })();
  _engineCache.set(expected, p);
  return p;
}

// --- Capability host.memorySearch(argsJson) => resultJson --------------------
// Puente raw-JSON: recibe '{"q":"..."}', devuelve '{"hits":[{text,score,section}]}'.
// Si el motor no cargo (sha invalido), devuelve '{"error":"..."}' (error controlado).
// TAREA26 (BUG 1, Opcion A): el puente reenvia TODOS los args posicionales como
// un array JSON. search_docs llama `host.memorySearch({q})` => '[{q}]'; aqui
// desempaquetamos el array. Compat: arg suelto objeto {q} o string "q".
function makeMemorySearch(env) {
  return async function memorySearch(argsJson) {
    let engine;
    try {
      engine = await initEngine(env);
    } catch (e) {
      return JSON.stringify({ error: "memorySearch init fallo: " + (e && e.message ? e.message : String(e)) });
    }
    if (engine.error) return JSON.stringify({ error: engine.error });
    let q = "";
    try {
      const parsed = JSON.parse(argsJson);
      let first = parsed;
      if (Array.isArray(parsed)) first = parsed[0];
      if (typeof first === "string") {
        q = first;
      } else if (first && typeof first === "object") {
        q = typeof first.q === "string" ? first.q : "";
      }
    } catch {
      return JSON.stringify({ error: "memorySearch: args JSON invalido" });
    }
    let hits;
    try {
      hits = JSON.parse(engine.idx.search(q, 5, null));
    } catch (e) {
      return JSON.stringify({ error: "memorySearch: search fallo: " + (e && e.message ? e.message : String(e)) });
    }
    const out = hits.map(function (h) {
      return {
        text: typeof h.snippet === "string" ? h.snippet.slice(0, 200) : "",
        score: h.score,
        section: h.title || h.concept_id,
      };
    });
    return JSON.stringify({ hits: out });
  };
}

// Skills inline: search_docs (usa host.memorySearch) + echo (QuickJS puro).
const SKILL_SOURCES = [
  `registerTool({
    name: "search_docs",
    description: "Busca BM25 sobre el snapshot del README y devuelve chunks relevantes (text, score, section).",
    inputSchema: { type: "object", properties: { q: { type: "string", description: "Consulta BM25" } }, required: ["q"] },
    handler: async function (args) {
      const r = await host.memorySearch(args);
      if (r && r.error) throw new Error(r.error);
      return r;
    }
  });`,
  `registerTool({
    name: "echo",
    description: "Skill trivial QuickJS pura (coexistencia de los 2 wasm): devuelve el mensaje tal cual.",
    inputSchema: { type: "object", properties: { msg: { type: "string" } }, required: ["msg"] },
    handler: async function (args) {
      return { echo: args.msg };
    }
  });`,
];

// allowedOrigin es requerido por AsyncToolHost pero ninguna skill del spike usa
// fetchOrigin; valor inocuo.
const DUMMY_ORIGIN = "https://memspike.local";

async function buildHost(env) {
  const quickjs = await getQuickjs();
  const host = new AsyncToolHost({
    quickjs,
    allowedOrigin: DUMMY_ORIGIN,
    extraCapabilities: { memorySearch: makeMemorySearch(env) },
  });
  await host.init();
  for (const src of SKILL_SOURCES) host.loadToolSource(src);
  return host;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET") {
      return new Response(
        "toolhost-mcp-memspike server\n" +
        "Spike TAREA20: minimemory (BM25) + QuickJS sandbox en el mismo Worker\n" +
        "Capability: host.memorySearch (puente raw-JSON asyncified, via extraCapabilities)\n" +
        "Probar: POST " + url.origin + "/mcp con tools/list | tools/call search_docs | tools/call echo\n",
        { headers: { "content-type": "text/plain; charset=utf-8" } }
      );
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    let msg;
    try {
      msg = await request.json();
    } catch {
      return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
    }

    const host = await buildHost(env);
    try {
      const response = await handleMcpMessageAsync(host, msg);
      if (response === null) return new Response(null, { status: 202 });
      return json(response);
    } catch (e) {
      return json({ jsonrpc: "2.0", id: msg.id ?? null, error: { code: -32603, message: String(e.message || e) } }, 500);
    } finally {
      host.dispose();
    }
  },
};