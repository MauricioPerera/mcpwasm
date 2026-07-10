// mcpwasm-web.mjs — el TERCER runtime: navegador.
//
// Mismo contrato que el runtime local (bin/mcpwasm-local.mjs) y el gateway
// (worker-gateway.mjs): descubre skills en el llms.txt de un origin, verifica
// CADA byte contra su sha256 declarado (CRLF->LF normalizado, crypto.subtle),
// carga cada tool verificada en su propio sandbox QuickJS-wasm y expone
// listTools/callTool/recipes — sin servidor, sin Node: todo corre en la
// pestana del usuario. Scopes (ext v0.5 SS2.5) y origin-memory por scope
// incluidos (minimemory wasm, opcional).
//
// Requisitos del entorno: fetch, crypto.subtle, WebAssembly. El publicador
// debe servir CORS (GitHub Pages ya manda Access-Control-Allow-Origin: *).
//
// Uso:
//   import { connectStaticSkills } from "./mcpwasm-web.js";
//   const skills = await connectStaticSkills("https://mauricioperera.github.io", {
//     quickjsWasmUrl: "./emscripten-module.wasm",        // requerido
//     minimemoryWasmUrl: "./minimemory_bg.wasm",         // opcional (memoria BM25)
//     minimemoryInit: (bytes) => { ... return WasmOkfIndex; }, // opcional
//     onLog: (line) => console.log(line),
//   });
//   skills.tools                       // [{ name, description, inputSchema }]
//   await skills.callTool(name, args)  // structured result (o lanza)
//   skills.recipes                     // { publicName: skillMdText } verificadas

import { AsyncToolHost } from "../host-async.mjs";
import { parseLlmsTxt } from "../llmstxt-parse.mjs";

const MAX_TOOL_BYTES = 256 * 1024;
const MAX_SKILLMD_BYTES = 256 * 1024;
const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;

async function sha256Normalized(text) {
  const bytes = new TextEncoder().encode(text.replace(/\r\n/g, "\n"));
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function resolvePath(origin, path) {
  return new URL(path, origin + "/").toString();
}

async function fetchText(url, maxBytes, label) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  const text = await res.text();
  if (new TextEncoder().encode(text).length > maxBytes) {
    throw new Error(`${label}: excede el limite de ${maxBytes} bytes`);
  }
  return text;
}

// makeMemorySearch: closure por scope sobre un snapshot YA verificado.
// MISMO contrato que el runtime local/gateway: acepta [q, k] o [{q, k}],
// devuelve { hits: [{ text, score, title, concept_id }] } (snippet -> text).
function makeMemorySearch(engineFactory, snapshotText) {
  let idx = null;
  return async (argsJson) => {
    let q = null;
    let k = 5;
    try {
      const parsed = JSON.parse(argsJson || "[]");
      const first = Array.isArray(parsed) ? parsed[0] : parsed;
      const second = Array.isArray(parsed) ? parsed[1] : undefined;
      if (typeof first === "string") q = first;
      else if (first && typeof first === "object" && typeof first.q === "string") {
        q = first.q;
        if (typeof first.k === "number" && Number.isFinite(first.k)) k = Math.floor(first.k);
      }
      if (typeof second === "number" && Number.isFinite(second)) k = Math.floor(second);
    } catch {
      return JSON.stringify({ error: "memorySearch: args JSON invalido" });
    }
    if (typeof q !== "string" || !q.trim()) return JSON.stringify({ error: "memorySearch: query (q) string obligatorio" });
    k = Math.min(Math.max(k, 1), 10);
    try {
      if (!idx) idx = engineFactory(snapshotText);
      const hits = idx.search(q, k).map((h) => ({
        text: typeof h.snippet === "string" ? h.snippet : "",
        score: h.score,
        title: typeof h.title === "string" ? h.title : (typeof h.concept_id === "string" ? h.concept_id : ""),
        concept_id: typeof h.concept_id === "string" ? h.concept_id : "",
      }));
      return JSON.stringify({ hits });
    } catch (e) {
      return JSON.stringify({ error: "memorySearch: " + String((e && e.message) || e) });
    }
  };
}

export async function connectStaticSkills(origin, options = {}) {
  const log = typeof options.onLog === "function" ? options.onLog : () => {};
  const originUrl = new URL(origin);
  const allowedOrigin = originUrl.origin;

  // 1) QuickJS wasm precompilado (una sola compilacion para todos los sandboxes).
  // quickjsWasm acepta: URL string (streaming), bytes (BufferSource) o un
  // WebAssembly.Module ya compilado — esto ultimo permite testear en Node.
  const qw = options.quickjsWasm ?? options.quickjsWasmUrl;
  if (!qw) throw new Error("connectStaticSkills: falta quickjsWasm (URL, bytes o Module)");
  log("compilando QuickJS-wasm...");
  let quickjsModule;
  if (qw instanceof WebAssembly.Module) quickjsModule = qw;
  else if (typeof qw === "string") quickjsModule = await WebAssembly.compileStreaming(fetch(qw));
  else quickjsModule = await WebAssembly.compile(qw);

  // 2) Descubrimiento
  log(`descubriendo skills de ${allowedOrigin} ...`);
  const llmsText = await fetchText(allowedOrigin + "/llms.txt", 1024 * 1024, "llms.txt");
  const parsed = parseLlmsTxt(llmsText);
  for (const ne of parsed.nonExecutable) {
    log(`skill de prosa (no ejecutable): ${ne.name} — ${ne.reason}`);
  }

  // 3) Memorias por scope (ext v0.5): fetch + verificacion sha256 de cada snapshot
  const memories = parsed.memories || [];
  const engines = {}; // scopeKey -> makeMemorySearch closure
  let engineFactory = null;
  const mmw = options.minimemoryWasm ?? options.minimemoryWasmUrl;
  if (memories.length && mmw && typeof options.minimemoryInit === "function") {
    const wasmBytes = typeof mmw === "string" ? await (await fetch(mmw)).arrayBuffer() : mmw;
    const WasmOkfIndex = options.minimemoryInit(wasmBytes);
    engineFactory = (snapshotText) => {
      const idx = new WasmOkfIndex();
      idx.import_snapshot(snapshotText);
      return { search: (q, k) => JSON.parse(idx.search(q, k)) };
    };
  }
  for (const mem of memories) {
    const scopeKey = mem.scope || "";
    const label = mem.scope ? `origin-memory[${mem.scope}]` : "origin-memory";
    if (mem.unsupported) {
      log(`${label}: formato '${mem.format}' no soportado — se ignora`);
      continue;
    }
    if (!engineFactory) {
      log(`${label}: motor BM25 no configurado — memoria ausente (fail-closed)`);
      continue;
    }
    try {
      const snapText = await fetchText(resolvePath(allowedOrigin, mem.snapshot), MAX_SNAPSHOT_BYTES, label);
      const actual = await sha256Normalized(snapText);
      if (actual !== mem.snapshot_sha256) {
        log(`${label}: snapshot sha256 mismatch — capability NO inyectada`);
        continue;
      }
      engines[scopeKey] = makeMemorySearch(engineFactory, snapText);
      log(`${label}: snapshot verificado -> host.memorySearch inyectada`);
    } catch (e) {
      log(`${label}: ${e.message} — memoria ausente`);
    }
  }

  // 4) Skills: fetch + verificacion + un sandbox por skill; rename por scope
  const routes = new Map(); // publicToolName -> { host, internal }
  const order = [];
  const tools = [];
  const recipes = {};
  const rejected = [];
  const loadedPublic = new Set();

  for (const s of parsed.skills) {
    const publicName = s.scope ? `${s.scope}__${s.name}` : s.name;
    if (loadedPublic.has(publicName)) {
      rejected.push({ name: s.name, reason: `nombre publico '${publicName}' ya cargado (colision; ext v0.5 SS2.5)` });
      log(`skill rechazada: ${s.name} — colision de nombre publico '${publicName}'`);
      continue;
    }
    let code;
    try {
      code = await fetchText(resolvePath(allowedOrigin, s.toolPath), MAX_TOOL_BYTES, `tool.js de ${s.name}`);
    } catch (e) {
      rejected.push({ name: s.name, reason: e.message });
      log(`skill rechazada: ${s.name} — ${e.message}`);
      continue;
    }
    const actual = await sha256Normalized(code);
    if (actual !== s.sha256) {
      rejected.push({ name: s.name, reason: "tool_sha256 mismatch" });
      log(`skill rechazada: ${s.name} — tool_sha256 mismatch (declarado ${s.sha256.slice(0, 12)}..., real ${actual.slice(0, 12)}...)`);
      continue;
    }

    const extra = engines[s.scope || ""] ? { memorySearch: engines[s.scope || ""] } : null;
    const host = new AsyncToolHost({
      quickjsModule,
      allowedOrigin,
      extraCapabilities: extra,
    });
    try {
      await host.init();
      host.loadToolSource(code);
    } catch (e) {
      rejected.push({ name: s.name, reason: `no cargo: ${e.message}` });
      log(`skill rechazada: ${s.name} — no cargo: ${e.message}`);
      continue;
    }
    loadedPublic.add(publicName);
    for (const t of host.listTools()) {
      const pub = s.scope ? `${s.scope}__${t.name}` : t.name;
      if (routes.has(pub)) {
        log(`tool omitida: '${pub}' ya registrada (colision de nombre publico)`);
        continue;
      }
      routes.set(pub, { host, internal: t.name });
      order.push(pub);
      tools.push({ ...t, name: pub, verified_sha256: s.sha256 });
    }
    log(`skill verificada y cargada: ${publicName} (sha ${s.sha256.slice(0, 12)}...)`);

    // 5) Receta (SKILL.md): la otra mitad, verificada contra el sha256 del core RFC
    if (s.skillPath && s.skillSha256) {
      try {
        const md = await fetchText(resolvePath(allowedOrigin, s.skillPath), MAX_SKILLMD_BYTES, `SKILL.md de ${s.name}`);
        if ((await sha256Normalized(md)) === s.skillSha256) {
          recipes[publicName] = md;
        } else {
          log(`receta omitida: ${publicName} — SKILL.md sha256 mismatch (la tool carga igual)`);
        }
      } catch (e) {
        log(`receta omitida: ${publicName} — ${e.message}`);
      }
    }
  }

  if (tools.length === 0) {
    throw new Error(`sin skills ejecutables verificadas en ${allowedOrigin} (${rejected.length} rechazadas)`);
  }
  log(`listo: ${order.length} tool(s) verificadas (${order.join(", ")})`);

  return {
    origin: allowedOrigin,
    tools,
    recipes,
    rejected,
    async callTool(name, args = {}) {
      const r = routes.get(name);
      if (!r) throw new Error(`tool no encontrada: ${name}`);
      return r.host.callTool(r.internal, args);
    },
    dispose() {
      const seen = new Set();
      for (const { host } of routes.values()) {
        if (seen.has(host)) continue;
        seen.add(host);
        try { host.dispose?.(); } catch { /* best-effort */ }
      }
      routes.clear();
    },
  };
}
