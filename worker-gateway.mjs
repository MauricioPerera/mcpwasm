// worker-gateway.mjs — Gateway llms.txt -> MCP (Streamable HTTP, JSON-RPC 2.0 por POST).
// Descubre skills de un origin (?origin=<url-encoded>), carga CADA una en su propio
// contexto QuickJS (aislamiento tool<->tool, hardening 64MB/1MB/2s) y expone MCP.
// Cache de descubrimiento isolate (capa 1, TTL 60s) + caches.default (capa 2):
// (a) insumos crudos (llms.txt TTL 60s, tool.js inmutable por hash) y (b) desde
// T40, el RESULTADO post-verificacion (skills+rejected+snapshotText+verdicts) key
// `gw:disc:<origin>:<fingerprint>` (TTL 60s, cross-isolate). Los contextos NO se
// cachean (por request); lo cacheado es texto inmutable por hash.

import "./shim.mjs"; // primero: location/self para el loader del wasm
import { newQuickJSAsyncWASMModuleFromVariant, newVariant } from "quickjs-emscripten-core";
import baseAsyncifyVariant from "@jitl/quickjs-wasmfile-release-asyncify";
import { AsyncToolHost } from "./host-async.mjs";
import { handleMcpMessageAsync } from "./mcp-core-async.mjs";
import { parseLlmsTxt } from "./llmstxt-parse.mjs";

// minimemory (WasmOkfIndex, BM25) para la capability de memoria. .wasm import estatico verbatim (CompiledWasm, mismo truco que QuickJS).
import initMem, { WasmOkfIndex } from "@rckflr/minimemory";
import MEM_WASM from "./minimemory_bg.wasm";

import QUICKJS_WASM from "./quickjs-asyncify.wasm"; // .wasm ASYNCIFY (CompiledWasm en el build)

// package.json (esbuild/wrangler lo resuelven con su json loader): unica fuente
// de la version para el serverInfo del gateway (sin duplicar el numero aca).
import PKG from "./package.json";
const GATEWAY_SERVER_INFO = { name: "llmstxt-gateway", version: PKG.version };

// Pool de instancias del modulo asyncify (reemplaza el mutex withModuleLock de
// T19). Un modulo QuickJS ASYNCIFY solo soporta UNA suspension async a la vez;
// con un modulo unico por isolate, TODA ejecucion wasm se serializaba. El pool
// mantiene hasta N instancias independientes del MISMO WebAssembly.Module
// pre-compilado (compilar una vez, instanciar N veces): cada request adquiere
// una instancia en exclusiva, asi las suspensiones concurrentes caen en
// instancias DISTINTAS => hasta N requests verdaderamente paralelos por
// isolate; el (N+1)-esimo espera por POLLING en su propio contexto. N via
// env.WASM_POOL_SIZE (default 4, clamp [1,8]); con N=1 el comportamiento
// equivale al mutex previo. Memoria: cada instancia crece bajo demanda
// (el limite QuickJS es 64MB por contexto, no reserva previa); el clamp evita
// que N alto + tools hostiles concurrentes se acerquen al limite del Worker.
//
// Por que polling y no un handoff de promesa (cola FIFO de waiters): workerd
// CANCELA continuaciones de una promesa resuelta desde otro request context
// ("promise was resolved from a different request context ... continuations
// canceled", field-tested aqui: el request en cola recibia el slot y moria).
// setTimeout si es local al contexto del request que espera, asi que cada
// waiter reintenta en SU contexto. Costo: hasta ~POLL_MS extra de latencia
// bajo contencion (>N concurrentes en el mismo isolate), cero en el resto.
const DEFAULT_WASM_POOL_SIZE = 4;
function parsePoolSize(env) {
  const raw = env && env.WASM_POOL_SIZE;
  let n = null;
  if (typeof raw === "number" && Number.isFinite(raw)) n = Math.floor(raw);
  else if (typeof raw === "string" && raw.trim() !== "") {
    const p = Number(raw);
    if (Number.isFinite(p)) n = Math.floor(p);
  }
  if (n === null) return DEFAULT_WASM_POOL_SIZE;
  return Math.min(8, Math.max(1, n));
}

const POOL_POLL_MS = 5; // intervalo de reintento bajo contencion
const POOL_MAX_WAIT_MS = 30000; // corte observable si el pool nunca se libera

class ModulePool {
  constructor(size) {
    this._size = size;
    this._slots = []; // {busy, modP} — modP: Promise del modulo instanciado
  }

  // Devuelve un slot en exclusiva. Si la creacion del modulo falla, el error
  // surge al hacer `await slot.modP` en el caller (que debe llamar discard(slot)
  // en ese caso, no release). Bajo contencion reintenta por polling en el
  // contexto del PROPIO request (ver nota de cabecera: nada cross-request);
  // tras POOL_MAX_WAIT_MS lanza (500 observable, no cuelgue infinito).
  async acquire() {
    const t0 = Date.now();
    for (;;) {
      for (const s of this._slots) {
        if (!s.busy) {
          s.busy = true;
          return s;
        }
      }
      if (this._slots.length < this._size) {
        // Variante fresca por instancia: el WebAssembly.Module compilado se
        // comparte (barato), la instanciacion (memoria propia) es por slot.
        const variant = newVariant(baseAsyncifyVariant, { wasmModule: QUICKJS_WASM });
        const slot = { busy: true, modP: newQuickJSAsyncWASMModuleFromVariant(variant) };
        this._slots.push(slot);
        return slot;
      }
      if (Date.now() - t0 > POOL_MAX_WAIT_MS) {
        throw new Error("wasm pool exhausted (espera > " + POOL_MAX_WAIT_MS + "ms)");
      }
      await new Promise((r) => setTimeout(r, POOL_POLL_MS));
    }
  }

  release(slot) {
    slot.busy = false; // el proximo poll de cualquier waiter lo toma
  }

  // Creacion del modulo fallida: sacar el slot muerto para que el proximo
  // acquire (o el proximo poll de un waiter) reintente instanciar.
  discard(slot) {
    const i = this._slots.indexOf(slot);
    if (i !== -1) this._slots.splice(i, 1);
  }
}

// Pool a nivel isolate; el tamano se fija con el env del primer request (el env
// es constante por deploy, asi que no hay ambiguedad real).
let _modulePool = null;
function getPool(env) {
  if (!_modulePool) {
    _modulePool = new ModulePool(parsePoolSize(env));
  }
  return _modulePool;
}

// initMem cacheado a nivel isolate. Instancias WasmOkfIndex POR REQUEST desde el
// snapshot verificado (sin estado compartido). Fallo resetea la promesa: no envenenar.
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

// Puente raw-JSON asyncified (extraCapabilities de AsyncToolHost). Acepta ["<q>",k]
// | [{q,k}] | ["<q>"] (k default 5) | compat 1-arg. k acotado a [1,10]. Indice
// WasmOkfIndex POR CLOSURE (una instancia por request, sin estado compartido). Sin
// snapshot verificado -> host.memorySearch undefined -> throw -> isError:true.
function makeMemorySearch(snapshotText) {
  let idx = null; // instancia POR REQUEST (closure per request)
  return async function memorySearch(argsJson) {
    let q = null;
    let k = 5;
    try {
      const parsed = JSON.parse(argsJson);
      // Normaliza a (first, second) segun el contrato (array nuevo | suelto viejo).
      let first = parsed;
      let second = undefined;
      if (Array.isArray(parsed)) {
        first = parsed[0];
        second = parsed[1];
      }
      if (typeof first === "string") {
        q = first;
        if (typeof second === "number" && Number.isFinite(second)) k = Math.floor(second);
      } else if (first && typeof first === "object") {
        if (typeof first.q === "string") q = first.q;
        if (typeof first.k === "number" && Number.isFinite(first.k)) k = Math.floor(first.k);
        // k posicional adicional [obj, k] (inusual pero barato de soportar).
        if (typeof second === "number" && Number.isFinite(second)) k = Math.floor(second);
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

// Map origin -> {skills, rejected, snapshotText, verdicts, expiresAt}. TTL 60s,
// max 16, evict FIFO. Lo cacheado es texto inmutable por hash (code verificado +
// metadata + snapshotText verificado): la verificacion sha256 se hace al poblar,
// no se re-verifica en hit. snapshotText null si no hay memoria o verify fallo.
const ISOLATE_TTL_MS = 60_000;
const ISOLATE_MAX_ENTRIES = 16;
const isolateCache = new Map();

// Map origin -> Promise en vuelo. Miss concurrentes del mismo origin esperan la
// MISMA promesa (evita estampida bajo fan-out frio). Se borra al settle (finally):
// fallo no envenena el cache, nunca queda pegada.
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

function isolateCachePut(origin, skills, rejected, snapshotText, verdicts, docs) {
  if (isolateCache.size >= ISOLATE_MAX_ENTRIES) {
    const oldest = isolateCache.keys().next().value; // evict FIFO (primera clave)
    if (oldest !== undefined) isolateCache.delete(oldest);
  }
  isolateCache.set(origin, {
    skills,
    rejected,
    snapshotText: snapshotText || null,
    verdicts: verdicts || null, // {verdicts, counts} o null (modo off)
    docs: docs || [], // recetas (SKILL.md verificado) -> resources
    expiresAt: Date.now() + ISOLATE_TTL_MS,
  });
}

// tool.js inmutable key=`gw:tool:${url}#${sha}` (solo tras verify OK); llms.txt
// TTL 60s key=`gw:llms:${origin}` (con timestamp).
const LLMS_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 5000;

// T42: caps de tamano para TODOS los fetches de descubrimiento (env con defaults
// sensatos que NO afectan a los origins actuales — estan muy por debajo). Parse
// defensivo: valor no-numero / <=0 / ausente -> default del campo.
const DEFAULT_SIZE_CAPS = {
  llms: 262144, // 256 KB
  tool: 1048576, // 1 MB
  attestations: 262144, // 256 KB
  snapshot: 4194304, // 4 MB
  index: 262144, // 256 KB
  skillmd: 262144, // 256 KB — la receta (SKILL.md) servida como MCP resource
};
function parseSizeCap(raw, def) {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  if (typeof raw === "string") {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return def;
}
function parseSizeCaps(env) {
  const e = env || {};
  return {
    llms: parseSizeCap(e.MAX_LLMS_BYTES, DEFAULT_SIZE_CAPS.llms),
    tool: parseSizeCap(e.MAX_TOOL_BYTES, DEFAULT_SIZE_CAPS.tool),
    attestations: parseSizeCap(e.MAX_ATTESTATIONS_BYTES, DEFAULT_SIZE_CAPS.attestations),
    snapshot: parseSizeCap(e.MAX_SNAPSHOT_BYTES, DEFAULT_SIZE_CAPS.snapshot),
    index: parseSizeCap(e.MAX_INDEX_BYTES, DEFAULT_SIZE_CAPS.index),
    skillmd: parseSizeCap(e.MAX_SKILLMD_BYTES, DEFAULT_SIZE_CAPS.skillmd),
  };
}

// T42: error de limite de tamano. Distinto de un fetch fallido para que cada caller
// decida la semantica de rechazo (llms -> discovery falla; tool -> skill rejected;
// attestations/snapshot -> tratar como ausente). maxBytes queda para el mensaje.
class SizeLimitError extends Error {
  constructor(maxBytes) {
    super("body excede el limite de tamano (" + maxBytes + " bytes)");
    this.name = "SizeLimitError";
    this.maxBytes = maxBytes;
  }
}

// T40: cache L2 del RESULTADO de descubrimiento (no solo insumos), cross-isolate
// via caches.default. Key `gw:disc:${origin}:${fingerprint}` donde fingerprint =
// sha256 hex de JSON.stringify({mode, reviewers, date UTC}). Mismo TTL que la
// capa 1 (60s): el L2 hidrata el isolate y responde "l2" sin tocar el origin ni
// re-verificar (sin sha256 de tool.js, sin Ed25519). Cambio de ATTESTATION_MODE,
// REVIEWERS o dia UTC => fingerprint distinto => key distinta (cero veredictos
// stale; critico en enforcing).
const DISC_L2_TTL_MS = 60_000;

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

// Fabrica el fetch inyectado: origins de la misma cuenta CF van por service binding
// (bypass error 1042); el resto, fetch global. Extensible añadiendo bindings en wrangler.
function makeFetchImpl(env) {
  const bindings = {};
  if (env && env.DEMO) {
    bindings["https://llmstxt-demo-site.rckflr.workers.dev"] = env.DEMO;
  }
  if (env && env.BOOKSTORE) {
    bindings["https://llmstxt-bookstore.rckflr.workers.dev"] = env.BOOKSTORE;
  }
  if (env && env.DOCS) {
    // docs-site: mismo motivo (misma cuenta -> error 1042 sin binding).
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
      // Service binding: host del URL ignorado, pathname+query van al worker destino.
      // Reenviamos init (method/body/headers) para POST/PUT; sin init degrada a GET.
      // Quitamos AbortSignal: algunas impl de binding no lo soportan.
      const init = { ...opts };
      if (init && init.signal) delete init.signal;
      return binding.fetch(url, init);
    }
    return fetch(url, opts);
  };
}

// T42: fetch de texto con cap de tamano en DOS niveles:
//  (a) Content-Length precheck: si el header declara mas del cap, se cancela el body
//      y se rechaza SIN leerlo (proteccion de memoria; el header puede mentir por
//      exceso). workerd enmarca el body por Content-Length => un header grande sobre
//      un body chico sobrevive al receptor y el precheck corta antes de leer.
//  (b) Streaming defensivo: NUNCA confiar solo en Content-Length (puede faltar —
//      chunked — o mentir). Se lee el body por reader acumulando hasta cap; si excede,
//      se cancela el stream y se rechaza. Nunca se materializan mas de cap+chunk en
//      memoria. TextDecoder con stream:true reconstruye el texto igual que resp.text()
//      (manjeta bordes multi-byte UTF-8 entre chunks).
// Lanza SizeLimitError si excede; el caller decide la semantica de rechazo por tipo.
async function fetchText(url, timeoutMs, maxBytes, fetchImpl) {
  // Cache-bust ?_gw=<ts>: bypass del edge cache de CF para origins externos por workers.dev
  // (sin Cache-Control CF cachearia .txt/.js y serviria 404 stale). sha256 es sobre el body
  // => el bust no afecta la verificacion. Cache API keys usan la URL LIMPIA (sin bust).
  const sep = url.includes("?") ? "&" : "?";
  const resp = await fetchImpl(url + sep + "_gw=" + Date.now(), {
    signal: AbortSignal.timeout(timeoutMs),
  });
  // (a) Content-Length precheck: rechazo inmediato sin leer el body.
  const cl = resp.headers.get("content-length");
  if (cl !== null) {
    const cln = Number(cl);
    if (Number.isFinite(cln) && cln > maxBytes) {
      if (resp.body) {
        try { await resp.body.cancel(); } catch { /* best-effort */ }
      }
      throw new SizeLimitError(maxBytes);
    }
  }
  // (b) Streaming defensivo: acumula hasta cap; si excede, cancela y rechaza.
  const body = resp.body;
  if (!body) {
    return { status: resp.status, text: "" };
  }
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let received = 0;
  const parts = [];
  let exceeded = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > maxBytes) {
        exceeded = true;
        break;
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    try { await reader.cancel(); } catch { /* best-effort: libera el stream */ }
  }
  if (exceeded) {
    throw new SizeLimitError(maxBytes);
  }
  parts.push(decoder.decode()); // flush (borde multi-byte final)
  return { status: resp.status, text: parts.join("") };
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Tercer anillo de confianza: atestaciones Ed25519 firmadas por revisores registrados,
// publicadas en /.well-known/agent-skills/attestations.json. Veredicto por skill
// (attested/expired/invalid/unattested, INVALID DOMINA) en modo advisory (tag en
// description + header X-Gw-Attestations) o enforcing (excluye no-attested como hash
// mismatch). Modo off: no fetchea. Verificacion Ed25519 con WebCrypto (importKey "raw"
// 32 bytes + verify), publica y firma en base64 (spec v0.2).
function attestationMode(env) {
  const m = (env && env.ATTESTATION_MODE) || "off";
  return m === "enforcing" || m === "advisory" ? m : "off";
}

function parseReviewers(env) {
  const raw = (env && env.REVIEWERS) || "";
  if (!raw) return {};
  try {
    const o = JSON.parse(raw);
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

// Origin canonico: lowercase, sin trailing slash, sin puerto default (new URL(...).origin).
function canonicalOrigin(s) {
  try {
  return new URL(s).origin;
  } catch {
    return null;
  }
}

function todayUtcStr() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// T40: fingerprint de config del descubrimiento = sha256 hex de
// JSON.stringify({mode: ATTESTATION_MODE||"off", reviewers: REVIEWERS||"",
// date: <UTC YYYY-MM-DD>}). Key del L2 (orden de claves estable: mode, reviewers,
// date). Un cambio de modo, de revisores o de dia UTC => fingerprint distinto =>
// key distinta (cero veredictos stale dentro del TTL). rawMode/rawReviewers son
// los strings crudos de env (no el modo normalizado ni el objeto parseado): asi
// un config "basura" mapea a su propia key en vez de colisionar con "off".
async function discFingerprint(attestCtx) {
  const fpInput = JSON.stringify({
    mode: (attestCtx && attestCtx.rawMode) || "off",
    reviewers: (attestCtx && attestCtx.rawReviewers) || "",
    date: todayUtcStr(),
  });
  return sha256Hex(fpInput);
}

function b64ToBytes(s) {
  // base64 standard -> Uint8Array (atob disponible en workerd).
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Verifica firma Ed25519 de data contra pubB64 (raw 32 bytes, base64). true/false; cualquier error -> false.
async function verifyEd25519(pubB64, sigB64, data) {
  try {
    const pubRaw = b64ToBytes(pubB64);
    const sig = b64ToBytes(sigB64);
    const key = await crypto.subtle.importKey("raw", pubRaw, { name: "Ed25519" }, false, [
      "verify",
    ]);
    return await crypto.subtle.verify("Ed25519", key, sig, data);
  } catch {
    return false;
  }
}

// Descarga attestations.json del origin. 404/no-200 -> null (sin atestaciones, NO es
// error de descubrimiento: skills se listan, todo unattested). JSON no-array -> null.
// T42: body que excede el cap -> null (mismo efecto que ausente: skills quedan
// unattested/excluidas en enforcing, fail-safe). Se cachea el TEXTO en el isolate;
// los veredictos se recomputan al poblar.
async function fetchAttestations(origin, fetchImpl, maxBytes) {
  const url = origin + "/.well-known/agent-skills/attestations.json";
  let r;
  try {
    r = await fetchText(url, FETCH_TIMEOUT_MS, maxBytes, fetchImpl);
  } catch (e) {
    console.warn(
      "[gateway] attestations fetch fallo: " + String((e && e.message) || e) + " -> sin atestaciones"
    );
    return null;
  }
  if (r.status === 404) return null; // esperado: el origin no atesta nada
  if (r.status !== 200) {
    console.warn("[gateway] attestations HTTP " + r.status + " -> sin atestaciones");
    return null;
  }
  try {
    const arr = JSON.parse(r.text);
    return Array.isArray(arr) ? arr : null;
  } catch {
    console.warn("[gateway] attestations JSON invalido -> sin atestaciones");
    return null;
  }
}

// Descarga /.well-known/agent-skills/index.json del origin: la capa de metadata
// CANONICA que define el core RFC (§8 Open Question 5) -- llms.txt es el puntero
// de descubrimiento ("## Skills", zero fetch extra), index.json es la fuente de
// verdad de metadata/verificacion. Este gateway hasta ahora solo leia llms.txt
// directo, ignorando index.json por completo; se usa aqui SOLO para cruzar
// tool_sha256 contra lo declarado en llms.txt (ver discoverSkillsInner), no
// reemplaza el llms.txt como fuente primaria de descubrimiento.
// 404/no-200/JSON invalido -> null: el origin puede no publicar index.json (no
// es parte obligatoria de este spec para el publisher), asi que ausencia NO es
// error de descubrimiento -- el gateway simplemente no cruza nada y confia solo
// en llms.txt, como hacia antes de este cambio.
async function fetchAgentSkillsIndex(origin, fetchImpl, maxBytes) {
  const url = origin + "/.well-known/agent-skills/index.json";
  let r;
  try {
    r = await fetchText(url, FETCH_TIMEOUT_MS, maxBytes, fetchImpl);
  } catch (e) {
    console.warn(
      "[gateway] agent-skills index.json fetch fallo: " + String((e && e.message) || e) + " -> sin cruce de metadata"
    );
    return null;
  }
  if (r.status === 404) return null; // esperado: el origin no publica index.json
  if (r.status !== 200) {
    console.warn("[gateway] agent-skills index.json HTTP " + r.status + " -> sin cruce de metadata");
    return null;
  }
  try {
    const obj = JSON.parse(r.text);
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    console.warn("[gateway] agent-skills index.json invalido -> sin cruce de metadata");
    return null;
  }
}

// Veredicto por skill (spec §4, INVALID DOMINA). matching: mismo origin canonico +
// skill + tool_sha256. attester no registrado -> ignorado; registrado + firma falla
// -> INVALID (domina). firma valida en ventana -> attested; hoy>valid_until -> expired.
// Precedencia: invalid > attested > expired > unattested.
// signed_on/valid_until deben ser fechas ISO estrictas (YYYY-MM-DD): la ventana se
// compara como string y solo ese formato ordena lexicograficamente igual que
// cronologicamente. Entrada con fecha malformada -> ignorada (ni una firma valida
// sobre fechas basura debe producir un veredicto con comparaciones sin sentido).
const ATTEST_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function verdictForSkill(skill, origin, attestations, reviewers, today) {
  if (!attestations || attestations.length === 0) return "unattested";
  const canon = canonicalOrigin(origin);
  if (!canon) return "unattested";
  let hasInvalid = false;
  let hasValidInWindow = false;
  let hasExpired = false;
  for (const a of attestations) {
    if (!a || typeof a !== "object") continue;
    if (a.skill !== skill.name) continue;
    if (typeof a.tool_sha256 !== "string" || a.tool_sha256 !== skill.sha256) continue;
    const aCanon = canonicalOrigin(a.origin);
    if (!aCanon || aCanon !== canon) continue; // otra origin: no replayable
    if (typeof a.attester !== "string" || typeof a.signature !== "string") continue;
    if (typeof a.signed_on !== "string" || !ATTEST_DATE_RE.test(a.signed_on) ||
        typeof a.valid_until !== "string" || !ATTEST_DATE_RE.test(a.valid_until)) {
      continue; // fecha malformada: la entrada no puede evaluarse -> ignorada
    }
    const reg = reviewers[a.attester];
    if (!reg || typeof reg.public_key !== "string") continue; // desconocido: ignorado
    const payload = new TextEncoder().encode(
      canon + "\n" + skill.name + "\n" + skill.sha256 + "\n" + a.signed_on + "\n" + a.valid_until
    );
    const ok = await verifyEd25519(reg.public_key, a.signature, payload);
    if (!ok) {
      hasInvalid = true; // firma que falla contra clave REGISTRADA -> invalid
      continue;
    }
    if (today > a.valid_until) {
      hasExpired = true;
      continue;
    }
    if (today >= a.signed_on && today <= a.valid_until) {
      hasValidInWindow = true;
    }
    // hoy < signed_on: fuera de ventana por izquierda -> no cuenta
  }
  if (hasInvalid) return "invalid";
  if (hasValidInWindow) return "attested";
  if (hasExpired) return "expired";
  return "unattested";
}

// Veredictos para todas las skills + conteos por veredicto (header X-Gw-Attestations). En modo off no se llama.
async function computeVerdicts(skills, origin, attestations, reviewers) {
  const verdicts = {};
  const counts = { attested: 0, expired: 0, invalid: 0, unattested: 0 };
  const today = todayUtcStr();
  for (const s of skills) {
    const v = await verdictForSkill(s, origin, attestations, reviewers, today);
    verdicts[s.name] = v;
    counts[v] = (counts[v] || 0) + 1;
  }
  return { verdicts, counts };
}

function attestHeaderStr(counts) {
  if (!counts) return null;
  return (
    counts.attested + "attested," +
    counts.expired + "expired," +
    counts.invalid + "invalid," +
    counts.unattested + "unattested"
  );
}

// T40: serializacion del RESULTADO de descubrimiento para el L2 (cross-isolate).
// TODO lo guardado es JSON-round-trippable: skills = [{name, description, code,
// sha256}] (inputSchema es undefined en runtime y JSON lo descarta; se reconstruye
// como undefined al hidratar — el schema se extrae del contexto QuickJS por
// request, no se cachea), rejected = [{name, reason}], snapshotText = string|null,
// verdicts = {verdicts,counts}|null. Marcador {kind:"gw-disc", v:1} para parse
// defensivo. code (tool.js) ya esta verificado por sha256 al poblar => el L2
// cachea contenido post-verificacion; no se re-verifica al hidratar (igual que la
// capa 1, que tampoco re-verifica en hit).
function serializeDiscL2(skills, rejected, snapshotText, verdicts, docs) {
  return JSON.stringify({
    kind: "gw-disc",
    v: 1,
    skills,
    rejected,
    snapshotText: snapshotText || null,
    verdicts: verdicts || null,
    docs: docs || [],
  });
}

// T40: parse DEFENSIVO del L2. Entrada malformada, shape inesperada o error =>
// null (el caller la trata como miss y sigue con descubrimiento completo). El L2
// nunca puede tumbar un request: cualquier duda => miss. Valida kind/v, que
// skills sea array con {name string, code string, sha256 string}, rejected array,
// y verdicts null o {verdicts, counts}. Reconstruye skills con inputSchema
// undefined (dropped por JSON).
function parseDiscL2(raw) {
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== "object" || o.kind !== "gw-disc" || o.v !== 1) return null;
    if (!Array.isArray(o.skills)) return null;
    const skills = [];
    for (const s of o.skills) {
      if (!s || typeof s !== "object") return null;
      if (typeof s.name !== "string" || typeof s.code !== "string" || typeof s.sha256 !== "string") return null;
      skills.push({
        name: s.name,
        description: typeof s.description === "string" ? s.description : "",
        inputSchema: undefined, // se extrae del contexto QuickJS en runtime
        code: s.code,
        sha256: s.sha256,
      });
    }
    if (!Array.isArray(o.rejected)) return null;
    const rejected = o.rejected.filter(
      (r) => r && typeof r === "object" && typeof r.name === "string" && typeof r.reason === "string"
    );
    let verdicts = null;
    if (o.verdicts !== null && o.verdicts !== undefined) {
      if (!o.verdicts || typeof o.verdicts !== "object") return null;
      if (!o.verdicts.verdicts || typeof o.verdicts.verdicts !== "object") return null;
      if (!o.verdicts.counts || typeof o.verdicts.counts !== "object") return null;
      verdicts = { verdicts: o.verdicts.verdicts, counts: o.verdicts.counts };
    }
    const snapshotText = typeof o.snapshotText === "string" ? o.snapshotText : null;
    // docs: tolerante — entradas L2 previas a esta version no lo traen => [].
    const docs = Array.isArray(o.docs)
      ? o.docs.filter((d) => d && typeof d === "object" && typeof d.name === "string" && typeof d.text === "string")
          .map((d) => ({ name: d.name, description: typeof d.description === "string" ? d.description : "", text: d.text }))
      : [];
    return { skills, rejected, snapshotText, verdicts, docs };
  } catch {
    return null;
  }
}

// Descubre y verifica las skills de un origin. Devuelve
// { skills, rejected, discovery, snapshotText, verdicts, counts }:
//  - skills: `code` (tool.js) verificado por sha256 e inmutable por hash (inputSchema
//    se extrae del contexto QuickJS en runtime).
//  - snapshotText: TEXTO del snapshot verificado, o null (sin memoria / unsupported /
//    verify fallo). Indice WasmOkfIndex por request desde este texto.
//  - verdicts/counts: {verdicts,counts} o null en modo off (computados al poblar;
//    revisores estable por deploy, fecha UTC estable por dia dentro del TTL 60s).
//  - discovery: "hit" (capa 1) | "l2" (capa 2 del resultado, cross-isolate) |
//    "miss" (este request hizo el fetch real).
async function discoverSkills(origin, fetchImpl, attestCtx, caps) {
  const cached = isolateCacheGet(origin);
  if (cached) {
    return {
      skills: cached.skills,
      rejected: cached.rejected,
      snapshotText: cached.snapshotText,
      verdicts: cached.verdicts,
      docs: cached.docs || [],
      discovery: "hit",
    };
  }

  // Si hay un descubrimiento en vuelo, esperarlo. Si resuelve OK, el iniciador ya
  // poblo el cache => leerlo y reportar "hit". Si fallo, el finally del iniciador
  // ya borro la entrada => cae al camino iniciador a reintentar (no envenena).
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
        verdicts: nowCached.verdicts,
        docs: nowCached.docs || [],
        discovery: "hit",
      };
    }
  }

  // En single-thread el check+set es atomico (no hay await entre medias) => un
  // solo iniciador por origin por estampida. finally borra la entrada al settle.
  const p = discoverSkillsInner(origin, fetchImpl, attestCtx, caps).finally(() => {
    discoverInflight.delete(origin);
  });
  discoverInflight.set(origin, p);
  return p; // discovery "miss": este request hizo el fetch real
}

// Cuerpo del descubrimiento (fetch llms.txt + tool.js + verify sha256). Puebla el
// cache de isolate (capa 1). Devuelve { skills, rejected, discovery:"miss"|"l2", snapshotText, verdicts, counts }.
async function discoverSkillsInner(origin, fetchImpl, attestCtx, caps) {
  const rejected = [];
  const skills = [];
  const docs = []; // recetas (SKILL.md) verificadas -> MCP resources + get_skill_guide

  // T40: cache L2 del RESULTADO (cross-isolate via caches.default). Se consulta
  // SOLO en el iniciador del single-flight (los waiters no llegan aqui): un solo
  // L2 read por discovery en isolate frio. Key = gw:disc:<origin>:<fingerprint>.
  // Hit -> parse defensivo, hidratar la capa 1 y responder "l2" SIN fetch al
  // origin ni re-verificacion criptografica (sha256/Ed25519). Miss o entrada
  // malformada -> cae al descubrimiento completo (el L2 nunca tumbla un request).
  const l2Key = "gw:disc:" + origin + ":" + await discFingerprint(attestCtx);
  const l2Raw = await cacheGet(l2Key);
  if (l2Raw !== null) {
    const hydrated = parseDiscL2(l2Raw);
    if (hydrated) {
      isolateCachePut(origin, hydrated.skills, hydrated.rejected, hydrated.snapshotText, hydrated.verdicts, hydrated.docs);
      return {
        skills: hydrated.skills,
        rejected: hydrated.rejected,
        discovery: "l2",
        snapshotText: hydrated.snapshotText,
        verdicts: hydrated.verdicts,
        docs: hydrated.docs,
      };
    }
    // malformada -> tratar como miss (caer al descubrimiento completo abajo)
  }

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
      r = await fetchText(origin + "/llms.txt", FETCH_TIMEOUT_MS, caps.llms, fetchImpl);
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

  const parsed = parseLlmsTxt(llmsText);
  const parsedSkills = parsed.skills;
  const memory = parsed.memory;

  // Skills de prosa (core llms-txt-skills spec, sin tool/tool_sha256): este
  // gateway no las ejecuta, pero reportarlas evita que un origin con SOLO
  // skills de prosa se lea como "no publica nada" -- antes parseLlmsTxt las
  // descartaba en silencio. No afecta el flujo (no se cargan, no se sirven).
  for (const ne of parsed.nonExecutable) {
    console.warn(
      "[gateway] skill de prosa (no ejecutable por este runtime): " + ne.name +
        " -> " + ne.reason + " (ver el consumer skill llms-txt-aware / el MCP server del core spec)"
    );
  }

  if (parsedSkills.length === 0) {
    const proseNote = parsed.nonExecutable.length > 0
      ? " (" + parsed.nonExecutable.length + " skill(s) de prosa encontradas, no ejecutables por este runtime)"
      : "";
    throw new Error("llms.txt: sin skills ejecutables (estado=" + llmsStatus + ")" + proseNote);
  }

  // Cruce contra la capa de metadata canonica (.well-known/agent-skills/index.json,
  // ver fetchAgentSkillsIndex arriba). Ausente/invalido -> indexByName vacio, sin
  // cruce (comportamiento identico al de antes de este cambio).
  const agentIndex = await fetchAgentSkillsIndex(origin, fetchImpl, caps.index);
  const indexByName = new Map();
  if (agentIndex && Array.isArray(agentIndex.skills)) {
    for (const it of agentIndex.skills) {
      if (it && typeof it.name === "string") indexByName.set(it.name, it);
    }
  }

  for (const s of parsedSkills) {
    // Si index.json declara tool_sha256 para esta skill, DEBE coincidir con lo
    // declarado en llms.txt: son dos fuentes que se presentan como autoritativas
    // (RFC §8 OQ5) y un desacuerdo entre ellas es exactamente la senal de drift/
    // tampering parcial que el cruce busca detectar -- ninguna de las dos gana
    // por default, se rechaza la skill entera (mismo trato que un sha256 mismatch).
    const idxEntry = indexByName.get(s.name);
    if (idxEntry && typeof idxEntry.tool_sha256 === "string" && idxEntry.tool_sha256 !== s.sha256) {
      rejected.push({
        name: s.name,
        reason:
          "tool_sha256 no coincide entre llms.txt (" + s.sha256.slice(0, 12) +
          "…) e index.json (" + idxEntry.tool_sha256.slice(0, 12) + "…) -- posible drift/tampering parcial",
      });
      continue;
    }

    const toolUrl = new URL(s.toolPath, origin).href;
    const toolKey = "gw:tool:" + toolUrl + "#" + s.sha256;

    let src = await cacheGet(toolKey);
    if (src === null) {
      let r;
      try {
        r = await fetchText(toolUrl, FETCH_TIMEOUT_MS, caps.tool, fetchImpl);
      } catch (e) {
        // T42: body que excede el cap -> skill rejected (patron del hash mismatch);
        // las demas skills del origin cargan. Otros errores -> razon de fetch.
        if (e instanceof SizeLimitError) {
          rejected.push({ name: s.name, reason: "tool.js excede el limite de tamano" });
        } else {
          rejected.push({ name: s.name, reason: "fetch tool.js fallo: " + (e && e.message) });
        }
        continue;
      }
      if (r.status !== 200) {
        rejected.push({ name: s.name, reason: "tool.js: HTTP " + r.status });
        continue;
      }
      src = r.text;
    }

    // Verificar sha256 siempre (incluso en cache hit de capa 2, barato y seguro).
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

    // La OTRA mitad de la skill: la receta (SKILL.md). Verificada contra el
    // sha256 declarado en la linea de llms.txt (core RFC) cuando esta presente.
    // Fallo/mismatch => la RECETA se omite con warn; la TOOL (ya verificada por
    // tool_sha256) carga igual — fallo controlado, mitades independientes.
    if (typeof s.skillPath === "string" && s.skillPath !== "") {
      let dr = null;
      try {
        dr = await fetchText(new URL(s.skillPath, origin).href, FETCH_TIMEOUT_MS, caps.skillmd, fetchImpl);
      } catch (e) {
        console.warn("[gateway] receta omitida: " + s.name + " -> fetch SKILL.md fallo: " + String((e && e.message) || e));
      }
      if (dr && dr.status === 200) {
        let docOk = true;
        if (s.skillSha256) {
          const dh = await sha256Hex(dr.text);
          if (dh !== s.skillSha256) {
            docOk = false;
            console.warn(
              "[gateway] receta omitida: " + s.name + " -> SKILL.md sha256 mismatch (declarado " +
                s.skillSha256.slice(0, 12) + "…, obtenido " + dh.slice(0, 12) + "…)"
            );
          }
        }
        if (docOk) docs.push({ name: s.name, description: s.description, text: dr.text });
      } else if (dr) {
        console.warn("[gateway] receta omitida: " + s.name + " -> SKILL.md HTTP " + dr.status);
      }
    }
  }

  // Si el origin declara memoria (format minimemory-okf-v1), se descarga el snapshot
  // por el mismo fetchImpl/timeout y se verifica sha256 contra snapshot_sha256. Solo
  // si coincide se cachea el TEXTO (la capability se inyecta por request desde este).
  // mismatch/fetch fallido/HTTP no-200/unsupported => snapshotText null: skills se
  // listan pero memorySearch NO se inyecta => las skills que la usen fallan controlado
  // (host.memorySearch undefined -> throw -> isError:true). No se cachea snapshot corrupto.
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
      snapResp = await fetchText(snapUrl, FETCH_TIMEOUT_MS, caps.snapshot, fetchImpl);
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

  // Modo off: no se fetchea. advisory/enforcing: descargar el array, computar
  // veredicto por skill y cacheo junto a las skills (mismo TTL). 404 = null (sin
  // atestaciones, todo unattested, NO error de descubrimiento).
  let verdicts = null;
  const mode = attestCtx && attestCtx.mode;
  if (mode && mode !== "off") {
    const attestations = await fetchAttestations(origin, fetchImpl, caps.attestations);
    verdicts = await computeVerdicts(skills, origin, attestations, attestCtx.reviewers);
  }

  // Poblar capa 1 aunque algunas skills se hayan rechazado: las rechazadas no se
  // re-intentan en cada request caliente; el TTL refresca.
  isolateCachePut(origin, skills, rejected, snapshotText, verdicts, docs);

  // T40: escribir el RESULTADO post-verificacion en el L2 (cross-isolate). Un
  // nuevo isolate (mismo deploy, misma config, mismo dia) hidrata la capa 1 desde
  // aqui y responde "l2" sin fetchar ni re-verificar. TTL 60s (mismo que capa 1).
  // El L2 nunca puede tumbar un request: cachePut ya traga errores (bypass).
  await cachePut(l2Key, serializeDiscL2(skills, rejected, snapshotText, verdicts, docs), DISC_L2_TTL_MS);

  return { skills, rejected, discovery: "miss", snapshotText, verdicts, docs };
}

// Cada skill se carga en su PROPIO contexto QuickJS (newContext propio => runtime
// y __tools/globals propios). tools/list agrega schemas de todos los contextos;
// tools/call enruta al contexto de la skill. Hardening por contexto heredado de
// AsyncToolHost. Llamadas secuenciales por request (sin concurrencia entre
// contextos) => respeta asyncify (una suspension async a la vez por modulo).
// Dispose de TODOS los contextos al final del request (try/finally en el handler).
const GUIDE_TOOL_NAME = "get_skill_guide";

class PerSkillHost {
  constructor({ quickjs, allowedOrigin, fetchImpl, skills, snapshotText, docs }) {
    this._quickjs = quickjs;
    this._allowedOrigin = allowedOrigin;
    this._fetchImpl = fetchImpl;
    this._skills = skills; // [{name, code, ...}]
    this._snapshotText = snapshotText || null; // snapshot verificado o null
    this._docs = new Map((docs || []).map((d) => [d.name, d])); // recetas verificadas
    this._byName = new Map(); // name -> AsyncToolHost
    this._order = []; // names en orden de carga
  }

  async init() {
    // Si hay snapshot verificado, se inyecta host.memorySearch en TODAS las skills
    // via extraCapabilities (puente raw-JSON asyncified). Misma closure a cada
    // skill => una sola instancia WasmOkfIndex por request (sin estado compartido
    // entre requests: la closure se crea por request aqui). Sin snapshot ->
    // extraCapabilities null => comportamiento byte-identico al previo.
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

  // tools/list: agrega los schemas de todos los contextos.
  listTools() {
    const all = [];
    for (const name of this._order) {
      const tools = this._byName.get(name).listTools();
      for (const t of tools) all.push(t);
    }
    if (this._docs.size > 0) {
      // Tool sintetica del gateway (no sandboxeada): fallback universal para
      // clientes MCP sin soporte de resources — devuelve la receta verificada.
      all.push({
        name: GUIDE_TOOL_NAME,
        description:
          "Return the verified SKILL.md guide (when/how to use, sequencing, constraints) " +
          "for one of this origin's skills. Read it BEFORE composing multi-step calls. " +
          "Available: " + [...this._docs.keys()].join(", "),
        inputSchema: {
          type: "object",
          properties: { name: { type: "string", description: "skill name" } },
          required: ["name"],
        },
      });
    }
    return all;
  }

  // tools/call: enruta al contexto de la skill.
  async callTool(name, args) {
    if (name === GUIDE_TOOL_NAME && this._docs.size > 0) {
      const doc = this._docs.get(args && args.name);
      if (!doc) throw new Error("skill sin receta disponible: " + ((args && args.name) || "(sin nombre)") + " — disponibles: " + [...this._docs.keys()].join(", "));
      return { name: doc.name, guide: doc.text };
    }
    const h = this._byName.get(name);
    if (!h) throw new Error("tool no encontrada: " + name);
    return await h.callTool(name, args);
  }

  // MCP resources: la receta (SKILL.md verificado en discovery) de cada skill.
  listResources() {
    return [...this._docs.values()].map((d) => ({
      uri: "skill://" + d.name,
      name: d.name + " — SKILL.md",
      description: d.description,
      mimeType: "text/markdown",
    }));
  }

  readResource(uri) {
    const m = /^skill:\/\/(.+)$/.exec(uri || "");
    const doc = m ? this._docs.get(m[1]) : undefined;
    if (!doc) return null;
    return [{ uri, mimeType: "text/markdown", text: doc.text }];
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

function json(obj, status = 200, discovery, attest, client, rl) {
  const headers = { "content-type": "application/json", "access-control-allow-origin": "*" };
  // X-Gw-Discovery: "miss"|"hit"|"l2"|"none" (antes de descubrimiento). hit=capa
  // 1 (isolate), l2=capa 2 del resultado (cross-isolate via caches.default), miss
  // = fetch real, none = pre-descubrimiento. Observabilidad, no filtra nada
  // sensible (estado del cache del isolate para este origin).
  if (discovery) headers["x-gw-discovery"] = discovery;
  // X-Gw-Attestations: conteos por veredicto, solo en modo != off.
  if (attest) headers["x-gw-attestations"] = attest;
  // X-Gw-Client: identidad del cliente (T37), solo en modo por-cliente tras auth.
  if (client) headers["x-gw-client"] = client;
  // X-Gw-RateLimit-* (T38): estado del rate limiter, solo cuando el limiter esta
  // ACTIVO y la request esta dentro de cuota (rl = {allowed,limit,remaining,
  // reset_epoch_ms}). El 429 y el 500-unavailable arman sus propios headers.
  if (rl) {
    headers["x-gw-ratelimit-limit"] = String(rl.limit);
    headers["x-gw-ratelimit-remaining"] = String(rl.remaining);
    headers["x-gw-ratelimit-reset"] = String(Math.floor(rl.reset_epoch_ms / 1000));
  }
  return new Response(JSON.stringify(obj), { status, headers });
}

function allowedOrigins(env) {
  const raw = (env && env.ALLOWED_ORIGINS) || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Comparacion de strings en tiempo (aprox) constante para el header Authorization.
// "Double HMAC": clave efimera por llamada, HMAC-SHA256 de cada valor, comparacion
// XOR de los dos digests (32 bytes fijos) sin short-circuit. Neutraliza contenido y
// longitud (los digests siempre miden 32 bytes => no ramifica por longitud).
// WebCrypto puro, valido en workerd.
async function timingSafeEqualStr(a, b) {
  const enc = new TextEncoder();
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const [da, db] = await Promise.all([
    crypto.subtle.sign("HMAC", key, enc.encode(a)),
    crypto.subtle.sign("HMAC", key, enc.encode(b)),
  ]);
  const xa = new Uint8Array(da);
  const xb = new Uint8Array(db);
  let acc = 0;
  for (let i = 0; i < xa.length; i++) {
    acc |= xa[i] ^ xb[i];
  }
  return acc === 0;
}

// T37: identidad por cliente (opt-in, retrocompatible). env.CLIENTS es un string
// JSON (se despliega como secret): {sha256_hex_del_token: {client_id, rpm?}}. Los
// tokens NUNCA aparecen en claro en config: la clave es el sha256 hex (minusculas)
// de los bytes UTF-8 del token. Devuelve {mode, registry}:
//  - mode "none": CLIENTS ausente/vacio -> comportamiento legado (AUTH_TOKEN o dev).
//  - mode "clients": CLIENTS valido -> registro {hash: {client_id, rpm}}. Un JSON
//    valido pero con objeto vacio {} -> mode "clients" con registro vacio (todo
//    token -> 401, fail-closed por configuracion vacia, no por error).
//  - mode "failclosed": CLIENTS definido pero JSON invalido -> FAIL-CLOSED.
// El campo rpm se parsea y queda en el registro para T38 (rate limiting) pero NO
// se aplica todavia (solo se conserva aqui).
function parseClients(env) {
  const raw = (env && env.CLIENTS) || "";
  if (!raw || raw.trim().length === 0) return { mode: "none", registry: null };
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { mode: "failclosed", registry: null };
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return { mode: "failclosed", registry: null };
  }
  const registry = {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (!v || typeof v !== "object") continue;
    if (typeof v.client_id !== "string" || v.client_id.length === 0) continue;
    // rpm opcional: se conserva (lo usara T38) pero aqui no se aplica.
    const rpm = typeof v.rpm === "number" && Number.isFinite(v.rpm) ? Math.floor(v.rpm) : null;
    registry[String(k).toLowerCase()] = { client_id: v.client_id, rpm };
  }
  return { mode: "clients", registry };
}

// T38: rate limiting por cliente (opt-in, sin tocar el default). Llama al DO
// RateLimiter (binding env.RATE_LIMITER) con body {rpm}; el DO id por nombre =
// client_id => una instancia de storage aislada por cliente. Devuelve
// {allowed, limit, remaining, reset_epoch_ms}. Lanza ante cualquier fallo del DO
// (HTTP no-ok, JSON invalido, excepcion) => el caller responde 500 fail-closed
// observable (rate_limiter_unavailable). Solo se invoca si rateLimiterActive.
async function checkRateLimit(env, clientId, rpm) {
  const id = env.RATE_LIMITER.idFromName(clientId);
  const stub = env.RATE_LIMITER.get(id);
  const doResp = await stub.fetch("http://rate-limiter.local/check", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rpm }),
  });
  if (!doResp.ok) {
    throw new Error("rate limiter DO HTTP " + doResp.status);
  }
  let data;
  try {
    data = await doResp.json();
  } catch (e) {
    throw new Error("rate limiter DO respuesta no-JSON: " + String(e && e.message || e));
  }
  if (
    !data ||
    typeof data.allowed !== "boolean" ||
    typeof data.limit !== "number" ||
    typeof data.remaining !== "number" ||
    typeof data.reset_epoch_ms !== "number"
  ) {
    throw new Error("rate limiter DO respuesta malformada");
  }
  return data;
}

// T38: RateLimiter Durable Object. Contador de ventana fija persistido en el
// storage del DO (NO en memoria: el DO puede ser evictado del memory y re-creado
// per-request; el storage sobrevive). Una instancia por client_id (el gateway la
// direcciona con env.RATE_LIMITER.idFromName(client_id) => storage aislado por
// cliente). Protocolo interno: POST /check con body {rpm} -> JSON
// {allowed, limit, remaining, reset_epoch_ms}. Ventana: env.RATE_WINDOW_MS
// (default 60000; configurable SOLO para testear el reset sin esperar 60s).
//
// Semantica de ventana fija con precheck: allowed iff count_previo < rpm; el
// contador SOLO se incrementa si la request es admitida (las rechazadas no
// consumen cuota). remaining = rpm - count_previo => la secuencia de responses
// admitidos muestra rpm, rpm-1, ..., 1 y el primer rechazo muestra 0. El
// reset_epoch_ms es el borde final de la ventana actual (epoch ms). SQLite-backed
// (wrangler migration new_sqlite_classes) => funciona en todos los planes.
export class RateLimiter {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    // Body {rpm}: lo provee el gateway desde el registro del cliente (T37).
    let rpm = null;
    try {
      const body = await request.json();
      if (body && typeof body.rpm === "number" && Number.isFinite(body.rpm)) {
        rpm = Math.floor(body.rpm);
      }
    } catch {
      return new Response(JSON.stringify({ error: "bad request" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    if (typeof rpm !== "number" || rpm < 1) {
      return new Response(JSON.stringify({ error: "rpm invalido" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const windowMs = Number(this.env && this.env.RATE_WINDOW_MS) || 60000;
    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const windowEnd = windowStart + windowMs;

    // Registro persistido: {windowStart, count}. Si no hay o la ventana expiro,
    // se reinicia (count 0 en la ventana nueva). El storage sobrevive a eviccion.
    let rec = await this.state.storage.get("rl");
    if (!rec || typeof rec.windowStart !== "number" || typeof rec.count !== "number") {
      rec = { windowStart, count: 0 };
    }
    if (rec.windowStart !== windowStart) {
      rec = { windowStart, count: 0 };
    }

    const allowed = rec.count < rpm;
    const remaining = Math.max(0, rpm - rec.count);
    if (allowed) {
      rec.count += 1;
      await this.state.storage.put("rl", { windowStart: rec.windowStart, count: rec.count });
    }
    return new Response(
      JSON.stringify({
        allowed,
        limit: rpm,
        remaining,
        reset_epoch_ms: windowEnd,
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // T37: modo de auth se computa una vez (lo usa GET / y POST /mcp).
    const clientsCtx = parseClients(env);

    if (request.method === "GET") {
      let authLine;
      if (clientsCtx.mode === "failclosed") {
        authLine =
          "Auth FAIL-CLOSED: env.CLIENTS definido pero JSON invalido -> todo POST /mcp da 401. " +
          "Corregir el secret CLIENTS (mapa {sha256_hex_del_token: {client_id, rpm?}}).\n";
      } else if (clientsCtx.mode === "clients") {
        const n = Object.keys(clientsCtx.registry).length;
        authLine =
          "Auth ACTIVADO (modo por-cliente): POST /mcp exige Authorization: Bearer <token>; identidad " +
          "por sha256 del token (env.CLIENTS, " + n + " cliente(s) registrado(s)). Header X-Gw-Client en " +
          "todas las respuestas. AUTH_TOKEN ignorado en este modo.\n";
      } else {
        const authOn = !!(env && env.AUTH_TOKEN && env.AUTH_TOKEN.length > 0);
        authLine = authOn
          ? "Auth ACTIVADO (token compartido legado): POST /mcp exige header Authorization: Bearer <AUTH_TOKEN>.\n"
          : "Auth DESACTIVADO (modo dev): sin token. Definir env.CLIENTS (por-cliente) o env.AUTH_TOKEN (legado) para activarlo.\n";
      }
      // T38: estado del rate limiting (opt-in por binding env.RATE_LIMITER). Solo
      // aplica en modo por-cliente y para clientes con rpm definido; sin binding el
      // limiter queda inactivo y el flujo es byte-identico al previo.
      const rlOn = !!(env && env.RATE_LIMITER);
      const rateLine = rlOn
        ? "Rate limiting ACTIVADO: clientes con rpm (env.CLIENTS) se limitan por ventana fija via Durable Object (binding RATE_LIMITER); headers X-Gw-RateLimit-Limit/-Remaining/-Reset, 429 al exceder.\n"
        : "Rate limiting INACTIVO (binding RATE_LIMITER ausente): sin limitacion por cliente.\n";
      return new Response(
        "llmstxt-gateway\n" +
          "Gateway llms.txt -> MCP (Streamable HTTP, JSON-RPC 2.0 por POST).\n" +
          "Uso: POST " + url.origin + "/mcp?origin=<url-encoded-origin>\n" +
          "El origin debe estar en la allowlist (ALLOWED_ORIGINS).\n" +
          authLine +
          rateLine +
          "Metodos MCP: initialize | tools/list | tools/call\n",
        { headers: { "content-type": "text/plain; charset=utf-8" } }
      );
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // --- Auth (T37: identidad por cliente, opt-in y retrocompatible) -------------
    // Precedencia: si env.CLIENTS definido y no vacio -> modo por-cliente (AUTH_TOKEN
    // se IGNORA en este modo). Se extrae el Bearer, se computa sha256 hex de sus
    // bytes UTF-8 y se hace lookup EXACTO en el registro {sha256_hex: {client_id,
    // rpm}}. El lookup por hash ES el mecanismo timing-safe: nunca se compara el
    // token en claro contra secretos (el hash es digest fijo). Token conocido ->
    // pasa y client_id queda para el header X-Gw-Client en TODAS las respuestas de
    // /mcp. Token desconocido / header ausente / malformado -> 401 identico al
    // legado. CLIENTS definido con JSON invalido -> FAIL-CLOSED: todo POST /mcp da
    // 401 (nunca abrir por error de config). Sin CLIENTS -> comportamiento legado
    // intacto (AUTH_TOKEN comparacion tiempo-constante, o modo dev si ausente).
    // rpm queda en el registro para T38 (rate limiting) pero NO se aplica todavia.
    let clientId = null; // null = no exponer X-Gw-Client (legado/dev, o 401)
    let clientRpm = null; // T38: rpm del cliente (numero) o null (sin rate limit)
    if (clientsCtx.mode === "failclosed") {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
      });
    }
    if (clientsCtx.mode === "clients") {
      const got = request.headers.get("authorization") || "";
      const m = /^Bearer\s+(.+)$/.exec(got);
      if (!m) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
        });
      }
      const tokenHash = await sha256Hex(m[1]);
      const entry = clientsCtx.registry[tokenHash] || null;
      if (!entry) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
        });
      }
      clientId = entry.client_id;
      clientRpm = typeof entry.rpm === "number" ? entry.rpm : null; // T38
    } else if (env && env.AUTH_TOKEN && env.AUTH_TOKEN.length > 0) {
      // modo legado: AUTH_TOKEN compartido (comparacion tiempo-constante).
      const expected = "Bearer " + env.AUTH_TOKEN;
      const got = request.headers.get("authorization") || "";
      if (!(await timingSafeEqualStr(got, expected))) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
        });
      }
    }

    // --- Rate limiting por cliente (T38, opt-in) -------------------------------
    // Activo SOLO si se cumplen las 3: modo clients + rpm del cliente no-null +
    // binding env.RATE_LIMITER presente. En cualquier otro caso (modo legado, modo
    // dev, cliente sin rpm, binding ausente) NO se llama al DO y el flujo queda
    // intacto (rl = null -> json() no añade headers, comportamiento byte-identico).
    // DO id por nombre = client_id (storage aislado por cliente). Fallo del DO con
    // el limiter activo -> 500 fail-closed observable (rate_limiter_unavailable).
    let rl = null;
    const rateLimiterActive =
      clientsCtx.mode === "clients" &&
      clientId !== null &&
      typeof clientRpm === "number" &&
      !!(env && env.RATE_LIMITER);
    if (rateLimiterActive) {
      try {
        rl = await checkRateLimit(env, clientId, clientRpm);
      } catch (e) {
        console.warn("[gateway] rate limiter DO fallo: " + String((e && e.message) || e) + " -> 500 fail-closed");
        return new Response(JSON.stringify({ error: "rate_limiter_unavailable" }), {
          status: 500,
          headers: {
            "content-type": "application/json",
            "access-control-allow-origin": "*",
            "x-gw-client": clientId,
          },
        });
      }
      if (!rl.allowed) {
        // Cuota excedida: 429 + Retry-After (segundos hasta la ventana nueva) +
        // los mismos headers con Remaining 0. X-Gw-Client (post-auth).
        const retryAfterSec = Math.max(1, Math.ceil((rl.reset_epoch_ms - Date.now()) / 1000));
        return new Response(JSON.stringify({ error: "rate_limited" }), {
          status: 429,
          headers: {
            "content-type": "application/json",
            "access-control-allow-origin": "*",
            "x-gw-client": clientId,
            "retry-after": String(retryAfterSec),
            "x-gw-ratelimit-limit": String(rl.limit),
            "x-gw-ratelimit-remaining": "0",
            "x-gw-ratelimit-reset": String(Math.floor(rl.reset_epoch_ms / 1000)),
          },
        });
      }
    }

    const originParam = url.searchParams.get("origin");
    if (!originParam) {
      return json(
        { jsonrpc: "2.0", id: null, error: { code: -32602, message: "falta parametro origin" } },
        403,
        "none",
        null,
        clientId,
        rl
      );
    }
    let origin;
    try {
      origin = new URL(originParam).origin;
    } catch {
      return json(
        { jsonrpc: "2.0", id: null, error: { code: -32602, message: "origin invalido: " + originParam } },
        403,
        "none",
        null,
        clientId,
        rl
      );
    }
    const allowed = allowedOrigins(env);
    if (!allowed.includes(origin)) {
      return json(
        { jsonrpc: "2.0", id: null, error: { code: -32602, message: "origin no permitido: " + origin } },
        403,
        "none",
        null,
        clientId,
        rl
      );
    }

    let msg;
    try {
      msg = await request.json();
    } catch {
      return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400, "none", null, clientId, rl);
    }

    // fetch inyectado (binding para same-account, fetch global para el resto).
    const fetchImpl = makeFetchImpl(env);

    // Modo de atestacion + registro de revisores (config del runtime). rawMode/
    // rawReviewers son los strings crudos de env para el fingerprint del L2 (T40):
    // un cambio de ATTESTATION_MODE o REVIEWERS => fingerprint distinto => key L2
    // distinta (cero veredictos stale). El modo normalizado y el objeto parseado
    // (mode, reviewers) se usan para la logica de atestacion como antes.
    const mode = attestationMode(env);
    const reviewers = parseReviewers(env);
    const attestCtx = {
      mode,
      reviewers,
      rawMode: (env && env.ATTESTATION_MODE) || "off",
      rawReviewers: (env && env.REVIEWERS) || "",
    };
    // T42: caps de tamano para los fetches de descubrimiento (env con defaults).
    const caps = parseSizeCaps(env);

    let skills;
    let snapshotText = null;
    let discovery = "none";
    let verdicts = null; // {verdicts, counts} o null (modo off)
    let docs = []; // recetas (SKILL.md verificado) -> resources + get_skill_guide
    try {
      const discovered = await discoverSkills(origin, fetchImpl, attestCtx, caps);
      skills = discovered.skills;
      snapshotText = discovered.snapshotText || null;
      discovery = discovered.discovery;
      verdicts = discovered.verdicts || null;
      docs = discovered.docs || [];
      for (const r of discovered.rejected) {
        console.warn("[gateway] skill rechazada: " + r.name + " -> " + r.reason);
      }
    } catch (e) {
      return json(
        { jsonrpc: "2.0", id: msg && msg.id !== undefined ? msg.id : null, error: { code: -32603, message: "descubrimiento fallo: " + String(e && e.message || e) } },
        502,
        "miss",
        null,
        clientId,
        rl
      );
    }

    // Header X-Gw-Attestations: conteos por veredicto sobre TODAS las skills
    // descubiertas (antes del filtrado enforcing), solo en modo != off.
    const aHeader = attestHeaderStr(verdicts && verdicts.counts);

    if (mode === "enforcing" && verdicts) {
      const kept = [];
      for (const s of skills) {
        if (verdicts.verdicts[s.name] === "attested") {
          kept.push(s);
        } else {
          console.warn(
            "[gateway] skill excluida (enforcing): " + s.name +
              " -> attestation " + verdicts.verdicts[s.name]
          );
        }
      }
      skills = kept;
      // La receta acompana a su skill: si la skill quedo excluida (enforcing),
      // su SKILL.md tampoco se sirve como resource/guide.
      const keptNames = new Set(kept.map((s) => s.name));
      docs = docs.filter((d) => keptNames.has(d.name));
    }

    if (skills.length === 0) {
      return json(
        { jsonrpc: "2.0", id: msg && msg.id !== undefined ? msg.id : null, error: { code: -32603, message: "ninguna skill verificada para el origin" } },
        502,
        discovery,
        aHeader,
        clientId,
        rl
      );
    }

    // Un contexto QuickJS por skill. TODA la ejecucion que toca/suspende el wasm
    // (init, handleMcp, dispose) ocurre sobre una instancia del pool adquirida en
    // EXCLUSIVA para este request: dentro del request las llamadas son
    // secuenciales (una suspension asyncify a la vez sobre SU instancia) y los
    // requests concurrentes usan instancias distintas (hasta N en paralelo). La
    // espera en acquire ocurre ANTES de correr nada => no cuenta contra el
    // fetchTimeoutMs de este request (se arma dentro de la ejecucion propia).
    let response;
    const pool = getPool(env);
    const slot = await pool.acquire();
    let slotDiscarded = false;
    try {
      let quickjs;
      try {
        quickjs = await slot.modP;
      } catch (e) {
        // Instanciacion del modulo fallida: descartar el slot (no envenenar el
        // pool; el proximo acquire reintenta) y responder 500.
        slotDiscarded = true;
        pool.discard(slot);
        throw e;
      }
      const host = new PerSkillHost({ quickjs, allowedOrigin: origin, fetchImpl, skills, snapshotText, docs });
      try {
        await host.init();
        response = await handleMcpMessageAsync(host, msg);
      } finally {
        // Dispose de TODOS los contextos (uno por skill) ANTES de liberar el
        // slot: los contextos pertenecen a esta instancia del modulo.
        try {
          host.dispose();
        } catch {
          // best-effort: no bloquear el release del slot.
        }
      }
    } catch (e) {
      return json(
        { jsonrpc: "2.0", id: msg && msg.id !== undefined ? msg.id : null, error: { code: -32603, message: "host fallo: " + String(e && e.message || e) } },
        500,
        discovery,
        aHeader,
        clientId,
        rl
      );
    } finally {
      if (!slotDiscarded) pool.release(slot);
    }
    // serverInfo propio del gateway: el core generico (mcp-core-async) trae el
    // nombre del spike (toolhost-mcp-spike-async); el runtime local ya pisaba el
    // suyo y el gateway no — todo cliente MCP veia el nombre del spike.
    if (msg && msg.method === "initialize" && response && response.result) {
      response.result.serverInfo = GATEWAY_SERVER_INFO;
    }
    // Exposicion advisory — tag " [attestation: <verdict>]" al final de la
    // description de cada tool en tools/list (modo != off). En enforcing las tools
    // cargadas son solo attested, pero igual se etiquetan.
    if (mode !== "off" && verdicts && response && response.result && Array.isArray(response.result.tools)) {
      for (const t of response.result.tools) {
        const v = verdicts.verdicts[t.name];
        if (v && typeof t.description === "string") {
          t.description = t.description + " [attestation: " + v + "]";
        }
      }
    }
    if (response === null) {
      const headers202 = { "x-gw-discovery": discovery };
      if (aHeader) headers202["x-gw-attestations"] = aHeader;
      if (clientId) headers202["x-gw-client"] = clientId;
      if (rl) {
        headers202["x-gw-ratelimit-limit"] = String(rl.limit);
        headers202["x-gw-ratelimit-remaining"] = String(rl.remaining);
        headers202["x-gw-ratelimit-reset"] = String(Math.floor(rl.reset_epoch_ms / 1000));
      }
      return new Response(null, { status: 202, headers: headers202 });
    }
    return json(response, 200, discovery, aHeader, clientId, rl);
  },

  // Precalentamiento por cron (trigger en wrangler-gateway.toml): corre el
  // descubrimiento de TODOS los origins del allowlist para poblar la capa 1
  // (este isolate) y la capa 2 (Cache API del colo), y deja instanciado al
  // menos un modulo wasm del pool. Ataca el costo dominante medido en
  // BENCHMARK.md: el miss de descubrimiento (~250-400ms) + la instanciacion
  // del modulo que paga el primer request de cada isolate/TTL.
  //
  // Honesto: la Cache API es POR COLO y el evento scheduled corre en UN punto
  // de presencia, no en todos — el precalentamiento garantiza L2 caliente en
  // el colo del cron y L1 en este isolate; trafico servido desde otros colos
  // sigue pagando su primer miss. Con el cron cada minuto y TTL 60s puede
  // haber huecos breves entre expiracion y el siguiente tick.
  //
  // Fallos por-origin no tumban el resto (allSettled + warn); un fallo del
  // preheat nunca afecta requests reales (solo deja el cache frio, como hoy).
  async scheduled(event, env, ctx) {
    const fetchImpl = makeFetchImpl(env);
    const attestCtx = {
      mode: attestationMode(env),
      reviewers: parseReviewers(env),
      rawMode: (env && env.ATTESTATION_MODE) || "off",
      rawReviewers: (env && env.REVIEWERS) || "",
    };
    const caps = parseSizeCaps(env);
    const origins = allowedOrigins(env);

    // Precalienta una instancia del modulo wasm (compile/instancia es parte
    // del costo cold). acquire/release del pool: si la instanciacion falla se
    // descarta el slot (no envenenar), igual que en el camino de request.
    let slot = null;
    try {
      const pool = getPool(env);
      slot = await pool.acquire();
      await slot.modP;
      pool.release(slot);
      slot = null;
    } catch (e) {
      if (slot) getPool(env).discard(slot);
      slot = null;
      console.warn("[gateway] preheat wasm fallo: " + String((e && e.message) || e));
    }

    const results = await Promise.allSettled(
      origins.map((o) => discoverSkills(o, fetchImpl, attestCtx, caps))
    );
    for (let i = 0; i < origins.length; i++) {
      const r = results[i];
      if (r.status === "fulfilled") {
        console.log(
          "[gateway] preheat " + origins[i] + ": " + r.value.skills.length +
            " skills (discovery=" + r.value.discovery + ")"
        );
      } else {
        console.warn(
          "[gateway] preheat " + origins[i] + " fallo: " +
            String((r.reason && r.reason.message) || r.reason)
        );
      }
    }
  },
};