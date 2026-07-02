// worker.mjs
// MCP server sobre Cloudflare Workers. Transporte Streamable HTTP (POST JSON-RPC).
// Embebe el ToolHost: tools cargadas como archivos, corriendo aisladas en QuickJS-wasm.

import "./shim.mjs"; // debe ir primero: prepara location/self para el loader del wasm
import { newQuickJSWASMModuleFromVariant, newVariant } from "quickjs-emscripten-core";
import baseVariant from "@jitl/quickjs-wasmfile-release-sync";
import { ToolHost } from "./host.mjs";
import { handleMcpMessage } from "./mcp-core.mjs";
import { makeInternalLogic } from "./internal-logic.mjs";
import { TOOL_SOURCES } from "./tools-inline.mjs";

// Importamos el .wasm como modulo ESTATICO. Workers lo compila en el build,
// no en runtime. Esto evita el bloqueo "Wasm code generation disallowed by embedder":
// instanciar un WebAssembly.Module ya compilado si esta permitido; compilar desde bytes no.
import QUICKJS_WASM from "./quickjs.wasm";

// Variante que usa el modulo pre-compilado en vez de instanciar desde bytes embebidos.
const variant = newVariant(baseVariant, { wasmModule: QUICKJS_WASM });

// El wasm de QuickJS se compila una sola vez y se cachea. NO en top-level await
// (Workers lo rechaza: "top-level await unsettled"), sino perezosamente en el
// primer request, reusando el mismo modulo para los siguientes.
let _quickjsPromise = null;
function getQuickjs() {
  if (!_quickjsPromise) {
    _quickjsPromise = newQuickJSWASMModuleFromVariant(variant);
  }
  return _quickjsPromise;
}

async function buildHost(env) {
  const quickjs = await getQuickjs();
  // El secreto llega del binding de entorno. Fallback solo para el demo.
  const secret = (env && env.STRIPE_SECRET) || "sk_live_DEMO_SECRETO_SOLO_HOST";
  const { callInternal } = makeInternalLogic(secret);
  const host = new ToolHost({ callInternal, quickjs });
  await host.init();
  for (const src of TOOL_SOURCES) host.loadToolSource(src);
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
        "toolhost-mcp server\n" +
        "Transporte: MCP Streamable HTTP (JSON-RPC 2.0 por POST)\n" +
        "Probar: POST " + url.origin + "/mcp con initialize | tools/list | tools/call\n",
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
      const response = handleMcpMessage(host, msg);
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
