// worker-gateway.mjs
// TAREA7: gateway llms.txt -> MCP.
//
// Dado un origin permitido (?origin=<url-encoded>):
//   1) descarga su /llms.txt (timeout 5s),
//   2) parsea las skills ejecutables (comentario JSON con tool+sha256),
//   3) descarga cada tool.js (timeout 5s) y VERIFICA sha256 con crypto.subtle;
//      mismatch -> skill excluida y registrada como rechazada (console.warn),
//   4) carga las skills verificadas en un AsyncToolHost con fetchOrigin scoped
//      a ESE origin (hardening: memoria 64MB, pila 1MB, interrupt 2s),
//   5) expone MCP Streamable HTTP (initialize / tools/list / tools/call) via
//      mcp-core-async.mjs.
//
// Un solo contexto QuickJS por request: todas las skills del mismo origin
// comparten dominio de confianza (mismo allowedOrigin). Host construido por
// request y disposed al final (igual que el PoC). Trade-off documentado en
// TAREA7-REPORT.md.
//
// WORKER-TO-WORKER (error 1042): un Worker que hace fetch a otro Worker de la
// MISMA cuenta Cloudflare via workers.dev falla con "error code: 1042". El demo
// site esta en la misma cuenta que el gateway. Solucion: el origin del demo se
// enruta por su SERVICE BINDING (env.DEMO), que bypassa workers.dev. Otros
// origins (externos) usan fetch global. El mismo fetchImpl se inyecta en
// AsyncToolHost para que fetchOrigin (server_time) tambien use el binding.

import "./shim.mjs"; // primero: location/self para el loader del wasm
import { newQuickJSAsyncWASMModuleFromVariant, newVariant } from "quickjs-emscripten-core";
import baseAsyncifyVariant from "@jitl/quickjs-wasmfile-release-asyncify";
import { AsyncToolHost } from "./host-async.mjs";
import { handleMcpMessageAsync } from "./mcp-core-async.mjs";
import { parseLlmsTxt } from "./llmstxt-parse.mjs";

// Import estatico del .wasm ASYNCIFY (CompiledWasm en el build).
import QUICKJS_WASM from "./quickjs-asyncify.wasm";

const variant = newVariant(baseAsyncifyVariant, { wasmModule: QUICKJS_WASM });

// Construccion perezosa y cacheada del modulo asyncify (sin top-level await).
let _quickjsPromise = null;
function getQuickjs() {
  if (!_quickjsPromise) {
    _quickjsPromise = newQuickJSAsyncWASMModuleFromVariant(variant);
  }
  return _quickjsPromise;
}

// --- Cache (opcional, bypass si la Cache API falla en el runtime) -------------
// tool.js: inmutable, key = `gw:tool:${url}#${sha}`. Solo se cachea tras verify OK.
// llms.txt: TTL 60s, key = `gw:llms:${origin}`. Se almacena con timestamp.
const LLMS_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 5000;

async function cacheGet(key) {
  try {
    const c = caches.default;
    const r = await c.match(new Request("https://cache.local/" + key));
    if (!r) return null;
    return await r.text();
  } catch {
    return null;
  }
}

async function cachePut(key, body, ttlMs) {
  try {
    const c = caches.default;
    const headers = { "content-type": "text/plain; charset=utf-8" };
    if (ttlMs) headers["cache-control"] = `max-age=${Math.round(ttlMs / 1000)}`;
    await c.put(
      new Request("https://cache.local/" + key),
      new Response(body, { headers })
    );
  } catch {
    // bypass: la Cache API no disponible; no bloquea el gateway.
  }
}

// Fabrica el fetch inyectado. Origins de la misma cuenta Cloudflare con un
// service binding configurado se enrutan por el binding (bypass error 1042);
// el resto, fetch global. Extensible: añadir mas bindings para mas origins
// same-account en wrangler-gateway.toml y mapearlos aqui.
function makeFetchImpl(env) {
  const bindings = {};
  if (env && env.DEMO) {
    bindings["https://llmstxt-demo-site.rckflr.workers.dev"] = env.DEMO;
  }
  return async function fetchImpl(url, opts) {
    let origin = null;
    try {
      origin = new URL(url).origin;
    } catch {
      origin = null;
    }
    const binding = bindings[origin];
    if (binding) {
      // Service binding: el host del URL se ignora, pathname+query pasan al
      // worker destino. No pasamos AbortSignal (algunas impl de binding no lo
      // soportan y el worker destino es trivial, resuelve en ms).
      return binding.fetch(url);
    }
    return fetch(url, opts);
  };
}

async function fetchText(url, timeoutMs, fetchImpl) {
  // Cache-bust: ?_gw=<ts> bypassa el edge cache de Cloudflare para los origins
  // externos por workers.dev (sin Cache-Control, Cloudflare cachea .txt/.js por
  // heuristica y podria servir un 404 stale). El demo site ignora el query
  // (matchea por pathname). El sha256 se computa sobre el body, no sobre la
  // URL, asi que el bust no afecta la verificacion. Las Cache API keys usan la
  // URL LIMPIA (sin el bust), asi que la dedup interna se mantiene.
  const sep = url.includes("?") ? "&" : "?";
  const resp = await fetchImpl(url + sep + "_gw=" + Date.now(), {
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: resp.status, text: await resp.text() };
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Descubre y verifica las skills ejecutables de un origin.
// Devuelve { sources: [{name, source}], rejected: [{name, reason}] }.
async function discoverSkills(origin, fetchImpl) {
  const rejected = [];
  const sources = [];

  // 1) llms.txt (con cache TTL 60s)
  const llmsKey = "gw:llms:" + origin;
  let llmsText = null;
  const cached = await cacheGet(llmsKey);
  if (cached) {
    try {
      const obj = JSON.parse(cached);
      if (obj && typeof obj.text === "string" && Date.now() - obj.ts < LLMS_TTL_MS) {
        llmsText = obj.text;
      }
    } catch {
      llmsText = null;
    }
  }
  let llmsStatus = 200;
  if (llmsText === null) {
    let r;
    try {
      r = await fetchText(origin + "/llms.txt", FETCH_TIMEOUT_MS, fetchImpl);
    } catch (e) {
      throw new Error("fetch llms.txt fallo: " + String(e && e.message || e));
    }
    llmsStatus = r.status;
    if (r.status !== 200) {
      throw new Error("llms.txt: HTTP " + r.status);
    }
    llmsText = r.text;
    await cachePut(llmsKey, JSON.stringify({ text: llmsText, ts: Date.now() }), LLMS_TTL_MS);
  }

  // 2) parse
  const skills = parseLlmsTxt(llmsText);
  if (skills.length === 0) {
    throw new Error("llms.txt: sin skills ejecutables (estado=" + llmsStatus + ")");
  }

  // 3) descargar + verificar cada tool.js
  for (const s of skills) {
    const toolUrl = new URL(s.toolPath, origin).href;
    const toolKey = "gw:tool:" + toolUrl + "#" + s.sha256;

    let src = await cacheGet(toolKey);
    if (src === null) {
      let r;
      try {
        r = await fetchText(toolUrl, FETCH_TIMEOUT_MS, fetchImpl);
      } catch (e) {
        rejected.push({ name: s.name, reason: "fetch tool.js fallo: " + (e && e.message) });
        continue;
      }
      if (r.status !== 200) {
        rejected.push({ name: s.name, reason: "tool.js: HTTP " + r.status });
        continue;
      }
      src = r.text;
    }

    // Verificar sha256 (siempre, incluso en cache hit, por seguridad/barato)
    let hash;
    try {
      hash = await sha256Hex(src);
    } catch (e) {
      rejected.push({ name: s.name, reason: "sha256 fallo: " + (e && e.message) });
      continue;
    }
    if (hash !== s.sha256) {
      rejected.push({
        name: s.name,
        reason: "sha256 mismatch (esperado " + s.sha256.slice(0, 12) + "…, obtenido " + hash.slice(0, 12) + "…)",
      });
      // NO cachear contenido corrupto.
      continue;
    }

    // Cache inmutable (key incluye el sha => contenido addressable).
    await cachePut(toolKey, src, 0);
    sources.push({ name: s.name, source: src });
  }

  return { sources, rejected };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}

function allowedOrigins(env) {
  const raw = (env && env.ALLOWED_ORIGINS) || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET") {
      return new Response(
        "llmstxt-gateway\n" +
          "Gateway llms.txt -> MCP (Streamable HTTP, JSON-RPC 2.0 por POST).\n" +
          "Uso: POST " + url.origin + "/mcp?origin=<url-encoded-origin>\n" +
          "El origin debe estar en la allowlist (ALLOWED_ORIGINS).\n" +
          "Metodos MCP: initialize | tools/list | tools/call\n",
        { headers: { "content-type": "text/plain; charset=utf-8" } }
      );
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // --- Validacion de origin (allowlist) ---
    const originParam = url.searchParams.get("origin");
    if (!originParam) {
      return json(
        { jsonrpc: "2.0", id: null, error: { code: -32602, message: "falta parametro origin" } },
        403
      );
    }
    let origin;
    try {
      origin = new URL(originParam).origin;
    } catch {
      return json(
        { jsonrpc: "2.0", id: null, error: { code: -32602, message: "origin invalido: " + originParam } },
        403
      );
    }
    const allowed = allowedOrigins(env);
    if (!allowed.includes(origin)) {
      return json(
        { jsonrpc: "2.0", id: null, error: { code: -32602, message: "origin no permitido: " + origin } },
        403
      );
    }

    // --- Body JSON-RPC ---
    let msg;
    try {
      msg = await request.json();
    } catch {
      return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
    }

    // fetch inyectado (binding para same-account, fetch global para el resto).
    const fetchImpl = makeFetchImpl(env);

    // --- Descubrimiento + verificacion ---
    let sources;
    try {
      const discovered = await discoverSkills(origin, fetchImpl);
      sources = discovered.sources;
      for (const r of discovered.rejected) {
        console.warn("[gateway] skill rechazada: " + r.name + " -> " + r.reason);
      }
    } catch (e) {
      return json(
        { jsonrpc: "2.0", id: msg && msg.id !== undefined ? msg.id : null, error: { code: -32603, message: "descubrimiento fallo: " + String(e && e.message || e) } },
        502
      );
    }
    if (sources.length === 0) {
      return json(
        { jsonrpc: "2.0", id: msg && msg.id !== undefined ? msg.id : null, error: { code: -32603, message: "ninguna skill verificada para el origin" } },
        502
      );
    }

    // --- Host por request, scoped al origin, hardening aplicado ---
    let host;
    try {
      const quickjs = await getQuickjs();
      host = new AsyncToolHost({ quickjs, allowedOrigin: origin, fetchImpl });
      await host.init();
      for (const s of sources) host.loadToolSource(s.source);
    } catch (e) {
      if (host) host.dispose();
      return json(
        { jsonrpc: "2.0", id: msg && msg.id !== undefined ? msg.id : null, error: { code: -32603, message: "host fallo: " + String(e && e.message || e) } },
        500
      );
    }

    try {
      const response = await handleMcpMessageAsync(host, msg);
      if (response === null) return new Response(null, { status: 202 });
      return json(response);
    } catch (e) {
      return json(
        { jsonrpc: "2.0", id: msg && msg.id !== undefined ? msg.id : null, error: { code: -32603, message: String(e && e.message || e) } },
        500
      );
    } finally {
      host.dispose();
    }
  },
};