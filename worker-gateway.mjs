// worker-gateway.mjs
// TAREA7: gateway llms.txt -> MCP.  TAREA9: contexto por skill + cache de descubrimiento en isolate.
//
// Dado un origin permitido (?origin=<url-encoded>):
//   1) descubre sus skills ejecutables (llms.txt + tool.js verificado por sha256),
//   2) carga CADA skill en su PROPIO contexto QuickJS (aislamiento tool<->tool: una
//      skill no puede ver ni pisar __tools/globals de otra). tools/list agrega los
//      schemas de todos los contextos; tools/call enruta al contexto de la skill.
//      El hardening por contexto se mantiene (mismos valores: 64MB / 1MB / 2s).
//   3) expone MCP Streamable HTTP (initialize / tools/list / tools/call) via
//      mcp-core-async.mjs.
//
// Cache de descubrimiento (TAREA9): Map a nivel de modulo (isolate) origin ->
//   { skills: [{name, description, inputSchema, code, sha256}], rejected, expiresAt }
// con TTL 60s y max 16 origins (evict FIFO). Salta fetch de llms.txt + tool.js +
// verificacion sha256 en requests calientes del mismo isolate: la verificacion se
// hace al poblar la entrada y el codigo cacheado es inmutable por hash. Los
// contextos QuickJS NO se cachean (se crean por request); lo cacheado es texto.
// El cache de caches.default existente se mantiene como SEGUNDA capa (tool.js
// inmutable por sha; llms.txt TTL 60s).
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

// TAREA22: motor minimemory (WasmOkfIndex, BM25) para la capability de memoria.
// TAREA24: el wrapper JS se consume desde el paquete npm @rckflr/minimemory (esbuild
// lo bundlea desde node_modules); el .wasm sigue como import estatico verbatim
// (CompiledWasm en el build, mismo truco que QuickJS).
import initMem, { WasmOkfIndex } from "@rckflr/minimemory";
import MEM_WASM from "./minimemory_bg.wasm";

// Import estatico del .wasm ASYNCIFY (CompiledWasm en el build).
import QUICKJS_WASM from "./quickjs-asyncify.wasm";

const variant = newVariant(baseAsyncifyVariant, { wasmModule: QUICKJS_WASM });

// Construccion perezosa y cacheada del modulo asyncify (sin top-level await).
// El modulo se cachea a nivel isolate; solo newContext() es por skill por request.
let _quickjsPromise = null;
function getQuickjs() {
  if (!_quickjsPromise) {
    _quickjsPromise = newQuickJSAsyncWASMModuleFromVariant(variant);
  }
  return _quickjsPromise;
}

// --- Motor minimemory (TAREA22): init wasm cacheado a nivel isolate ----------
// initMem instancia el wasm de minimemory (modulo pre-compilado por workerd).
// El wasm-instance se cachea en el modulo minimemory (singleton `wasm`); lo
// cacheamos a nivel isolate con una unica promesa. Las instancias WasmOkfIndex
// se crean POR REQUEST desde el snapshot verificado (sin estado compartido entre
// requests): new WasmOkfIndex() + idx.import_snapshot(text). Si initMem falla,
// reseteamos la promesa para reintentar en el siguiente request.
let _memPromise = null;
function getMem() {
  if (!_memPromise) {
    _memPromise = initMem({ module_or_path: MEM_WASM }).catch((e) => {
      _memPromise = null; // no envenenar: el siguiente request reintenta
      throw e;
    });
  }
  return _memPromise;
}

// --- Capability host.memorySearch (TAREA22) -----------------------------------
// Puente raw-JSON asyncified (via extraCapabilities de AsyncToolHost, mismo
// patron que host.fetchOrigin). Recibe argsJson = JSON.stringify(primerArg) y
// devuelve resultJson. La skill search_spec del docs-site llama
// `host.memorySearch(args.q, k)`; el puente reenvia SOLO el primer arg posicional
// => argsJson = JSON.stringify(args.q) = '"<query>"' (string JSON). El estilo
// memspike `host.memorySearch({q,k})` llega como objeto. Se aceptan ambos:
//  - string  -> query, k default 5
//  - {q,k}   -> query y k del objeto
// k se acota a [1,10] (tope). La skill ya acota k 1..10 client-side; el tope aca
// es defensa en profundidad (el puente descarta k posicional, por lo que el k
// efectivo en la llamada posicional es el default 5, que cumple <=10).
// Devuelve {hits:[{text, score, title, concept_id}]} o {error:"..."}.
// El indice WasmOkfIndex se construye perezosamente POR CLOSURE (la closure se
// crea por request en PerSkillHost) => una instancia por request, sin estado
// compartido. Si la capability NO se inyecta (snapshot sin verificar), la skill
// ve `host.memorySearch` undefined -> throw dentro del sandbox -> isError:true.
function makeMemorySearch(snapshotText) {
  let idx = null; // instancia POR REQUEST (closure per request)
  return async function memorySearch(argsJson) {
    let q = null;
    let k = 5;
    try {
      const a = JSON.parse(argsJson);
      if (typeof a === "string") {
        q = a;
      } else if (a && typeof a === "object") {
        if (typeof a.q === "string") q = a.q;
        if (typeof a.k === "number" && Number.isFinite(a.k)) k = Math.floor(a.k);
      }
    } catch {
      return JSON.stringify({ error: "memorySearch: args JSON invalido" });
    }
    if (typeof q !== "string" || q.trim().length === 0) {
      return JSON.stringify({ error: "memorySearch: query (q) string obligatorio" });
    }
    if (k < 1) k = 1;
    else if (k > 10) k = 10;
    try {
      await getMem();
      if (!idx) {
        idx = new WasmOkfIndex();
        idx.import_snapshot(snapshotText);
      }
      const hits = JSON.parse(idx.search(q, k, null));
      const out = hits.map(function (h) {
        return {
          text: typeof h.snippet === "string" ? h.snippet : "",
          score: h.score,
          title: typeof h.title === "string" ? h.title : (typeof h.concept_id === "string" ? h.concept_id : ""),
          concept_id: typeof h.concept_id === "string" ? h.concept_id : "",
        };
      });
      return JSON.stringify({ hits: out });
    } catch (e) {
      return JSON.stringify({ error: "memorySearch: " + ((e && e.message) ? e.message : String(e)) });
    }
  };
}

// --- Mutex de ejecucion por modulo wasm (TAREA19) ---------------------------
// El modulo QuickJS ASYNCIFY solo soporta UNA suspension async a la vez; el
// modulo se cachea a nivel isolate (getQuickjs). Requests concurrentes del
// mismo isolate que ejecuten wasm (crear contextos, loadToolSource, callTool,
// dispose) intercalarian suspensiones asyncify y corromperian el modulo.
// withModuleLock serializa TODA ejecucion que pueda tocar/suspender el wasm
// encadenando fn sobre una unica promise de modulo (cola FIFO).
//  - El lock se suelta SIEMPRE: la cola se reinicia tanto en resolve como en
//    reject (result.then(noop, noop)) => el fallo de un request no envenena el
//    mutex ni bloquea a los demas. Incluso si la tool lanza o el interrupt corta.
//  - Las esperas en cola ocurren ANTES de que fn corra => NO cuentan contra
//    el timeout de fetchOrigin de OTRO request: ese timeout (fetchTimeoutMs)
//    se arma DENTRO de la ejecucion propia (bajo el lock, en callTool), no
//    mientras se espera en cola.
let _moduleLock = Promise.resolve();
function withModuleLock(fn) {
  const result = _moduleLock.then(fn, fn); // corre fn pase lo que pase del previo
  _moduleLock = result.then(() => undefined, () => undefined); // cola siempre fulfilled
  return result;
}

// --- Cache de descubrimiento en el isolate (TAREA9, capa 1) -------------------
// Map a nivel de modulo origin -> { skills, rejected, snapshotText, expiresAt }.
// TTL 60s. Max 16 origins; al llenarse, evict el mas viejo (FIFO por orden de
// insercion del Map). Los contextos QuickJS NO se cachean: lo cacheado es texto
// (code ya verificado + metadata +, TAREA22, el TEXTO del snapshot de memoria
// verificado por sha256). La verificacion sha256 (tool.js y snapshot) se hace al
// poblar la entrada; lo cacheado es inmutable por hash => no se re-verifica en
// hit. snapshotText es null si el origin no declara memoria o la verificacion
// fallo (la capability no se inyecta en ese caso).
const ISOLATE_TTL_MS = 60_000;
const ISOLATE_MAX_ENTRIES = 16;
const isolateCache = new Map();

// --- Single-flight del descubrimiento (TAREA19) ------------------------------
// Map a nivel isolate origin -> Promise del descubrimiento en vuelo. Los miss
// concurrentes del mismo origin esperan la MISMA promesa en vez de refetear
// llms.txt + tool.js cada uno (estampida bajo fan-out frio). La entrada se
// borra al settle (resolve o reject) via finally => un fallo no envenena el
// cache (el siguiente miss reintentara) y nunca queda pegada.
const discoverInflight = new Map();

function isolateCacheGet(origin) {
  const e = isolateCache.get(origin);
  if (!e) return null;
  if (Date.now() >= e.expiresAt) {
    isolateCache.delete(origin);
    return null;
  }
  return e;
}

function isolateCachePut(origin, skills, rejected, snapshotText) {
  if (isolateCache.size >= ISOLATE_MAX_ENTRIES) {
    // Evict el mas viejo (primera clave en orden de insercion del Map).
    const oldest = isolateCache.keys().next().value;
    if (oldest !== undefined) isolateCache.delete(oldest);
  }
  isolateCache.set(origin, {
    skills,
    rejected,
    snapshotText: snapshotText || null,
    expiresAt: Date.now() + ISOLATE_TTL_MS,
  });
}

// --- Cache (capa 2, opcional, bypass si la Cache API falla en el runtime) ------
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
  if (env && env.BOOKSTORE) {
    bindings["https://llmstxt-bookstore.rckflr.workers.dev"] = env.BOOKSTORE;
  }
  if (env && env.DOCS) {
    // TAREA22: docs-site mismo motivo (misma cuenta -> error 1042 sin binding).
    bindings["https://llmstxt-docs.rckflr.workers.dev"] = env.DOCS;
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
      // worker destino. Reenviamos el init (method, body, headers) para que
      // POST/PUT lleguen al worker destino; sin init el binding degrada a GET.
      // Quitamos AbortSignal: algunas impl de binding no lo soportan y el
      // worker destino es trivial, resuelve en ms.
      const init = { ...opts };
      if (init && init.signal) delete init.signal;
      return binding.fetch(url, init);
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
// Devuelve { skills: [...], rejected, discovery, snapshotText }.
//  - skills: cada entrada lleva el `code` (tool.js) verificado por sha256 e
//    inmutable por hash; `inputSchema` queda undefined aqui y se extrae del
//    contexto QuickJS en runtime (mismo comportamiento observable que antes).
//  - snapshotText (TAREA22): TEXTO del snapshot de memoria verificado por
//    sha256, o null si el origin no declara memoria, el format es unsupported,
//    o la verificacion fallo. Se cachea en el isolate junto a las skills; el
//    indice WasmOkfIndex se construye por request desde este texto.
//  - discovery: "hit" (capa 1 isolate, cache fria leida del cache) | "miss"
//    (este request hizo el fetch real, poblado ahora). Single-flight: los miss
//    concurrentes del mismo origin que esperan la promesa en vuelo reportan
//    "hit" (leyeron del cache tras el fetch unico del iniciador; ellos no
//    tocan la red) => un solo fetch de llms.txt + tool.js por estampida.
async function discoverSkills(origin, fetchImpl) {
  // --- Capa 1: cache de descubrimiento en el isolate ---
  const cached = isolateCacheGet(origin);
  if (cached) {
    return {
      skills: cached.skills,
      rejected: cached.rejected,
      snapshotText: cached.snapshotText,
      discovery: "hit",
    };
  }

  // --- Single-flight (TAREA19): miss concurrentes del mismo origin ---
  // Si hay un descubrimiento en vuelo para este origin, esperarlo en vez de
  // refetear. Si resuelve OK, el iniciador ya poblo el cache => leerlo y
  // reportar "hit" (el fetch lo hizo el iniciador; este request no toco la
  // red). Si el en-vuelo fallo, cae al camino iniciador a reintentar: el
  // finally del iniciador ya borro la entrada => un fallo no envenena el cache.
  const existing = discoverInflight.get(origin);
  if (existing) {
    try {
      await existing;
    } catch {
      /* reintento abajo */
    }
    const nowCached = isolateCacheGet(origin);
    if (nowCached) {
      return {
        skills: nowCached.skills,
        rejected: nowCached.rejected,
        snapshotText: nowCached.snapshotText,
        discovery: "hit",
      };
    }
  }

  // --- Iniciador: crear la promesa en vuelo ANTES de cualquier await ---
  // En single-thread el check+set es atomico respecto a otros requests (no hay
  // await entre medias) => solo un iniciador por origin por estampida. La
  // entrada se borra al settle (resolve o reject) via finally => nunca pegada.
  const p = discoverSkillsInner(origin, fetchImpl).finally(() => {
    discoverInflight.delete(origin);
  });
  discoverInflight.set(origin, p);
  return p; // discovery "miss": este request hizo el fetch real
}

// Cuerpo del descubrimiento (fetch llms.txt + tool.js + verify sha256). Puebla
// el cache de isolate (capa 1). Devuelve { skills, rejected, discovery: "miss", snapshotText }.
async function discoverSkillsInner(origin, fetchImpl) {
  const rejected = [];
  const skills = [];

  // --- Capa 2: fetch llms.txt (con cache caches.default TTL 60s) ---
  const llmsKey = "gw:llms:" + origin;
  let llmsText = null;
  const cachedLlms = await cacheGet(llmsKey);
  if (cachedLlms) {
    try {
      const obj = JSON.parse(cachedLlms);
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

  // --- parse ---
  const parsed = parseLlmsTxt(llmsText);
  const parsedSkills = parsed.skills;
  const memory = parsed.memory;
  if (parsedSkills.length === 0) {
    throw new Error("llms.txt: sin skills ejecutables (estado=" + llmsStatus + ")");
  }

  // --- fetch + verificar cada tool.js (con cache caches.default inmutable) ---
  for (const s of parsedSkills) {
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

    // Verificar sha256 (siempre, incluso en cache hit de capa 2, por seguridad/barato).
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
    skills.push({
      name: s.name,
      description: s.description,
      inputSchema: undefined, // se extrae del contexto QuickJS en runtime
      code: src,
      sha256: s.sha256,
    });
  }

  // --- TAREA22: snapshot de memoria (fetch + verify sha256) -----------------
  // Si el origin declara memoria soportada (format minimemory-okf-v1), se
  // descarga el snapshot por el mismo fetchImpl/bindings y timeout que el resto
  // y se verifica sha256 contra snapshot_sha256. Solo si coincide se cachea el
  // TEXTO del snapshot (la capability se inyecta por request desde este texto).
  //  - mismatch / fetch fallido / HTTP no-200 / format unsupported => snapshotText
  //    null: las skills se listan igual (ya verificadas) pero la capability
  //    memorySearch NO se inyecta => las skills que la usen fallan controlado
  //    (host.memorySearch undefined -> throw dentro del sandbox -> isError:true).
  //  - No se cachea snapshot corrupto (mismo principio que tool.js).
  let snapshotText = null;
  if (
    memory &&
    !memory.unsupported &&
    typeof memory.snapshot === "string" &&
    typeof memory.snapshot_sha256 === "string"
  ) {
    const snapUrl = new URL(memory.snapshot, origin).href;
    let snapResp = null;
    try {
      snapResp = await fetchText(snapUrl, FETCH_TIMEOUT_MS, fetchImpl);
    } catch (e) {
      console.warn("[gateway] snapshot fetch fallo: " + String((e && e.message) || e) + " -> memory NO inyectada");
      snapResp = null;
    }
    if (snapResp && snapResp.status === 200) {
      let snapHash;
      try {
        snapHash = await sha256Hex(snapResp.text);
      } catch (e) {
        snapHash = null;
        console.warn("[gateway] snapshot sha256 fallo: " + String((e && e.message) || e) + " -> memory NO inyectada");
      }
      if (snapHash && snapHash === memory.snapshot_sha256) {
        snapshotText = snapResp.text;
      } else if (snapHash) {
        console.warn(
          "[gateway] snapshot sha256 mismatch (declarado " +
            memory.snapshot_sha256.slice(0, 12) + "…, obtenido " + snapHash.slice(0, 12) +
            "…) -> memory NO inyectada (skills se listan, memorySearch falla controlado)"
        );
        // NO cachear snapshot corrupto.
      }
    } else if (snapResp) {
      console.warn("[gateway] snapshot HTTP " + snapResp.status + " -> memory NO inyectada");
    }
  } else if (memory && memory.unsupported) {
    console.warn("[gateway] skills-memory format unsupported: '" + memory.format + "' -> memory NO inyectada");
  }

  // Poblar capa 1 (isolate) aunque algunas skills se hayan rechazado: las
  // rechazadas no se re-intentan en cada request caliente; el TTL refresca.
  isolateCachePut(origin, skills, rejected, snapshotText);
  return { skills, rejected, discovery: "miss", snapshotText };
}

// --- PerSkillHost: un AsyncToolHost por skill (aislamiento tool<->tool) --------
// Cada skill se carga en su PROPIO contexto QuickJS (newContext propio => runtime
// propio => __tools/globals propios). tools/list agrega los schemas de todos los
// contextos; tools/call enruta al contexto de la skill. El hardening por contexto
// se hereda de AsyncToolHost (mismos valores). Las llamadas son secuenciales por
// request (sin concurrencia entre contextos) => respeta la limitacion asyncify
// (una suspension async a la vez por modulo). Dispose de TODOS los contextos al
// final del request (try/finally en el handler).
class PerSkillHost {
  constructor({ quickjs, allowedOrigin, fetchImpl, skills, snapshotText }) {
    this._quickjs = quickjs;
    this._allowedOrigin = allowedOrigin;
    this._fetchImpl = fetchImpl;
    this._skills = skills; // [{name, code, ...}]
    this._snapshotText = snapshotText || null; // TAREA22: snapshot verificado o null
    this._byName = new Map(); // name -> AsyncToolHost
    this._order = []; // names en orden de carga
  }

  async init() {
    // TAREA22: si hay snapshot verificado, se inyecta la capability
    // host.memorySearch en TODAS las skills del origin via extraCapabilities
    // (mismo puente raw-JSON asyncified que host.fetchOrigin). Se pasa la MISMA
    // closure a cada skill => una sola instancia WasmOkfIndex por request (sin
    // estado compartido entre requests: la closure se crea por request aqui).
    // Sin snapshot verificado -> extraCapabilities null -> comportamiento
    // byte-identico al previo (demo-site y bookstore intactos).
    const extraCaps = this._snapshotText
      ? { memorySearch: makeMemorySearch(this._snapshotText) }
      : null;
    for (const s of this._skills) {
      const h = new AsyncToolHost({
        quickjs: this._quickjs,
        allowedOrigin: this._allowedOrigin,
        fetchImpl: this._fetchImpl,
        extraCapabilities: extraCaps,
      });
      await h.init();
      h.loadToolSource(s.code);
      this._byName.set(s.name, h);
      this._order.push(s.name);
    }
  }

  // MCP: tools/list agrega los schemas de todos los contextos.
  listTools() {
    const all = [];
    for (const name of this._order) {
      const tools = this._byName.get(name).listTools();
      for (const t of tools) all.push(t);
    }
    return all;
  }

  // MCP: tools/call enruta al contexto de la skill.
  async callTool(name, args) {
    const h = this._byName.get(name);
    if (!h) throw new Error("tool no encontrada: " + name);
    return await h.callTool(name, args);
  }

  dispose() {
    for (const h of this._byName.values()) {
      try {
        h.dispose();
      } catch {
        // best-effort: no bloquear el dispose del resto.
      }
    }
  }
}

function json(obj, status = 200, discovery) {
  const headers = { "content-type": "application/json", "access-control-allow-origin": "*" };
  // X-Gw-Discovery: "miss" | "hit" (tras descubrimiento) | "none" (antes de
  // descubrimiento, p.ej. errores de validacion). Solo-test/observabilidad; no
  // filtra nada sensible (es el estado del cache del isolate para este origin).
  if (discovery) headers["x-gw-discovery"] = discovery;
  return new Response(JSON.stringify(obj), { status, headers });
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
      const authOn = !!(env && env.AUTH_TOKEN && env.AUTH_TOKEN.length > 0);
      return new Response(
        "llmstxt-gateway\n" +
          "Gateway llms.txt -> MCP (Streamable HTTP, JSON-RPC 2.0 por POST).\n" +
          "Uso: POST " + url.origin + "/mcp?origin=<url-encoded-origin>\n" +
          "El origin debe estar en la allowlist (ALLOWED_ORIGINS).\n" +
          (authOn
            ? "Auth ACTIVADO: POST /mcp exige header Authorization: Bearer <AUTH_TOKEN>.\n"
            : "Auth DESACTIVADO (modo dev): sin token. Definir env.AUTH_TOKEN para activarlo.\n") +
          "Metodos MCP: initialize | tools/list | tools/call\n",
        { headers: { "content-type": "text/plain; charset=utf-8" } }
      );
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // --- Auth Bearer opcional-por-config (TAREA15) ---
    // Si env.AUTH_TOKEN esta definido y no vacio -> POST /mcp exige
    // Authorization: "Bearer <AUTH_TOKEN>" (comparacion exacta). Si falta o no
    // coincide -> 401 JSON {"error":"unauthorized"} SIN tocar el resto del flujo.
    // Si env.AUTH_TOKEN no esta definido -> comportamiento actual (abierto, dev).
    if (env && env.AUTH_TOKEN && env.AUTH_TOKEN.length > 0) {
      const expected = "Bearer " + env.AUTH_TOKEN;
      const got = request.headers.get("authorization") || "";
      if (got !== expected) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
        });
      }
    }

    // --- Validacion de origin (allowlist) ---
    const originParam = url.searchParams.get("origin");
    if (!originParam) {
      return json(
        { jsonrpc: "2.0", id: null, error: { code: -32602, message: "falta parametro origin" } },
        403,
        "none"
      );
    }
    let origin;
    try {
      origin = new URL(originParam).origin;
    } catch {
      return json(
        { jsonrpc: "2.0", id: null, error: { code: -32602, message: "origin invalido: " + originParam } },
        403,
        "none"
      );
    }
    const allowed = allowedOrigins(env);
    if (!allowed.includes(origin)) {
      return json(
        { jsonrpc: "2.0", id: null, error: { code: -32602, message: "origin no permitido: " + origin } },
        403,
        "none"
      );
    }

    // --- Body JSON-RPC ---
    let msg;
    try {
      msg = await request.json();
    } catch {
      return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400, "none");
    }

    // fetch inyectado (binding para same-account, fetch global para el resto).
    const fetchImpl = makeFetchImpl(env);

    // --- Descubrimiento + verificacion (cache isolate -> caches.default -> red) ---
    let skills;
    let snapshotText = null;
    let discovery = "none";
    try {
      const discovered = await discoverSkills(origin, fetchImpl);
      skills = discovered.skills;
      snapshotText = discovered.snapshotText || null;
      discovery = discovered.discovery;
      for (const r of discovered.rejected) {
        console.warn("[gateway] skill rechazada: " + r.name + " -> " + r.reason);
      }
    } catch (e) {
      return json(
        { jsonrpc: "2.0", id: msg && msg.id !== undefined ? msg.id : null, error: { code: -32603, message: "descubrimiento fallo: " + String(e && e.message || e) } },
        502,
        "miss"
      );
    }
    if (skills.length === 0) {
      return json(
        { jsonrpc: "2.0", id: msg && msg.id !== undefined ? msg.id : null, error: { code: -32603, message: "ninguna skill verificada para el origin" } },
        502,
        discovery
      );
    }

    // --- Host por request + ejecucion MCP, serializada por modulo (TAREA19) ---
    // Un contexto QuickJS por skill (hardening por contexto). TODA la ejecucion
    // que toca/suspende el wasm (init: newContext+loadToolSource; handleMcp:
    // listTools/callTool; dispose) va bajo withModuleLock para no intercalar
    // suspensiones asyncify entre requests concurrentes del mismo isolate. La
    // cola espera antes de correr fn => no cuenta contra el fetchTimeoutMs de
    // otros requests (se arma dentro de la ejecucion propia, bajo el lock).
    let response;
    try {
      response = await withModuleLock(async () => {
        const quickjs = await getQuickjs();
        const host = new PerSkillHost({ quickjs, allowedOrigin: origin, fetchImpl, skills, snapshotText });
        try {
          await host.init();
          return await handleMcpMessageAsync(host, msg);
        } finally {
          // Dispose de TODOS los contextos (uno por skill), bajo el lock.
          try {
            host.dispose();
          } catch {
            // best-effort: no bloquear el release del lock.
          }
        }
      });
    } catch (e) {
      return json(
        { jsonrpc: "2.0", id: msg && msg.id !== undefined ? msg.id : null, error: { code: -32603, message: "host fallo: " + String(e && e.message || e) } },
        500,
        discovery
      );
    }
    if (response === null) {
      return new Response(null, { status: 202, headers: { "x-gw-discovery": discovery } });
    }
    return json(response, 200, discovery);
  },
};