// worker-spike.mjs
// Entry Workers del spike TAREA5. Minimo: construye AsyncToolHost con allowedOrigin
// apuntando a nuestro Worker ya desplegado (estable), registra DOS tools inline de
// prueba y expone MCP via mcp-core-async.mjs.
//
//   fetch_home  -> handler async que hace `await host.fetchOrigin("/")` y devuelve
//                  { status, firstLine } con datos REALES del origin permitido.
//   fetch_evil  -> handler async que intenta `await host.fetchOrigin("https://example.com/")`
//                  y debe fallar con "origin no permitido" DENTRO del sandbox.
//
// Mismo truco que worker.mjs para Workers: import estatico del .wasm asyncify como
// modulo, variante con wasmModule pre-compilado (instantiateWasm), construccion
// perezosa del modulo (sin top-level await).

import "./shim.mjs"; // primero: location/self para el loader del wasm (sin modificarlo)
import { newQuickJSAsyncWASMModuleFromVariant, newVariant } from "quickjs-emscripten-core";
import baseAsyncifyVariant from "@jitl/quickjs-wasmfile-release-asyncify";
import { AsyncToolHost } from "./host-async.mjs";
import { handleMcpMessageAsync } from "./mcp-core-async.mjs";

// Import estatico del .wasm ASYNCIFY. Workers lo compila en build (CompiledWasm),
// no en runtime: instanciar un WebAssembly.Module ya compilado si esta permitido.
import QUICKJS_WASM from "./quickjs-asyncify.wasm";

// Variante asyncify que usa el modulo pre-compilado (mismo truco que worker.mjs).
const variant = newVariant(baseAsyncifyVariant, { wasmModule: QUICKJS_WASM });

// Construccion perezosa y cacheada del modulo asyncify (sin top-level await).
let _quickjsPromise = null;
function getQuickjs() {
  if (!_quickjsPromise) {
    _quickjsPromise = newQuickJSAsyncWASMModuleFromVariant(variant);
  }
  return _quickjsPromise;
}

// Origin unico permitido: nuestro Worker ya desplegado, estable.
const ALLOWED_ORIGIN = "https://toolhost-mcp.rckflr.workers.dev";

// Tools inline de prueba (en prod vendrian de R2/KV). Handlers async con await.
const SPIKE_TOOL_SOURCES = [
  `registerTool({
    name: "fetch_home",
    description: "Hace fetch al origin permitido y devuelve status + primera linea",
    inputSchema: { type: "object" },
    handler: async function (args) {
      const r = await host.fetchOrigin("/");
      return { status: r.status, firstLine: r.body.split("\\n")[0] };
    }
  });`,
  `registerTool({
    name: "fetch_evil",
    description: "Intenta fetch a un origin NO permitido; debe fallar dentro del sandbox",
    inputSchema: { type: "object" },
    handler: async function (args) {
      const r = await host.fetchOrigin("https://example.com/");
      return r;
    }
  });`,
];

async function buildHost() {
  const quickjs = await getQuickjs();
  const host = new AsyncToolHost({ quickjs, allowedOrigin: ALLOWED_ORIGIN });
  await host.init();
  for (const src of SPIKE_TOOL_SOURCES) host.loadToolSource(src);
  return host;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET") {
      return new Response(
        "toolhost-mcp-spike-async server\\n" +
        "Spike TAREA5: handler async + capability host.fetchOrigin (origin restringido)\\n" +
        "Transporte: MCP Streamable HTTP (JSON-RPC 2.0 por POST)\\n" +
        "Probar: POST " + url.origin + "/mcp con tools/list | tools/call fetch_home | tools/call fetch_evil\\n",
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

    const host = await buildHost();
    try {
      const response = await handleMcpMessageAsync(host, msg);
      if (response === null) {
        return new Response(null, { status: 202 });
      }
      return json(response);
    } catch (e) {
      return json({ jsonrpc: "2.0", id: msg.id ?? null, error: { code: -32603, message: String(e.message || e) } }, 500);
    } finally {
      host.dispose();
    }
  },
};