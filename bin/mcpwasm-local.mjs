#!/usr/bin/env node
// bin/mcpwasm-local.mjs — runtime MCP LOCAL (stdio) para skills ejecutables.
//
// "Static MCP sin gateway": lee /llms.txt de UN origin (p.ej. un GitHub Pages),
// verifica tool_sha256 sobre los bytes exactos, carga cada skill verificada en
// su PROPIO contexto QuickJS-wasm (mismo modelo de aislamiento que el gateway)
// y expone MCP por stdio (JSON-RPC 2.0, un mensaje JSON por linea) — el
// transporte que consumen Claude Code / Cursor / etc. sin cambios.
//
// Uso:            mcpwasm <origin>
//                 mcpwasm --serve <dir> [--port N]
//   p.ej.:        npx @rckflr/mcpwasm https://usuario.github.io
//                 npx @rckflr/mcpwasm --serve ./mi-repo-clonado
//
// --serve <dir> levanta un file server estatico interno (solo 127.0.0.1, sin
// exponer a la red) sobre <dir> y usa ese origin para el descubrimiento —
// combina "clonar un repo de skills + servirlo + conectar" en un solo paso.
// Pensado para el loop de desarrollo local de un publisher (tu propio repo de
// llms.txt + tool.js) antes de publicarlo en GitHub Pages o donde sea. NO
// sirve para apuntar directo a una URL raw de GitHub: origin ahi colapsa a
// https://raw.githubusercontent.com (el path usuario/repo/rama se pierde al
// tomar solo el origin), asi que no hay forma de que ese origin sirva
// /llms.txt correctamente — hay que clonar y usar --serve.
//
// Config de cliente MCP tipica:
//   {"mcpServers":{"misitio":{"command":"npx","args":["-y","@rckflr/mcpwasm","https://usuario.github.io"]}}}
//
// Reglas de canal: stdout es EXCLUSIVO del protocolo MCP; todo diagnostico
// (skills cargadas/rechazadas, errores de descubrimiento) sale por stderr.
//
// Limites, explicitos:
//  - Origin-memory: si el origin declara skills-memory (format minimemory-okf-v1),
//    el snapshot se descarga, se verifica sha256 contra snapshot_sha256 y, solo si
//    coincide, se inyecta host.memorySearch en todas las skills (mismo contrato que
//    el gateway). Mismatch / fetch fallido / format desconocido / engine ausente =>
//    capability NO inyectada y la skill que la use falla controlado (isError:true).
//    El engine (@rckflr/minimemory) es una optionalDependency: npx la instala por
//    defecto; si falta, el runtime lo dice por stderr y sigue sin memoria.
//  - Sin atestaciones: en el runtime local la decision de confianza es del
//    usuario que ELIGE el origin; la verificacion sha256 sigue siendo MUST.
//  - Descubrimiento UNA vez al arrancar (proceso local efimero): reiniciar el
//    proceso refresca las skills.
//  - Caps de tamano post-descarga (llms 256KB, tool.js 1MB): proceso local con
//    origin elegido por el usuario; el streaming defensivo byte-a-byte queda
//    en el gateway (T42), aqui el chequeo es sobre el texto ya recibido.

import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { newQuickJSAsyncWASMModuleFromVariant, newVariant } from "quickjs-emscripten-core";
import baseAsyncifyVariant from "@jitl/quickjs-wasmfile-release-asyncify";
import { AsyncToolHost } from "../host-async.mjs";
import { handleMcpMessageAsync } from "../mcp-core-async.mjs";
import { parseLlmsTxt } from "../llmstxt-parse.mjs";
import { verifySigstoreAttestation } from "../sigstore-attest.mjs";

const PKG = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const MAX_LLMS_BYTES = 262144; // 256 KB (mismos defaults que el gateway)
const MAX_TOOL_BYTES = 1048576; // 1 MB
const MAX_INDEX_BYTES = 262144; // 256 KB (mismo default que el gateway)
const MAX_ATTESTATIONS_BYTES = 262144; // 256 KB (mismo default que el gateway)
const MAX_SNAPSHOT_BYTES = 4194304; // 4 MB (mismo default que el gateway)
const MAX_SKILLMD_BYTES = 262144; // 256 KB — la receta (SKILL.md) servida como MCP resource
const FETCH_TIMEOUT_MS = 10000;

function err(msg) {
  process.stderr.write("[mcpwasm-local] " + msg + "\n");
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

const USAGE =
  "uso: mcpwasm <origin>                 (ej: npx @rckflr/mcpwasm https://usuario.github.io)\n" +
  "     mcpwasm --serve <dir> [--port N] (sirve un directorio local, ej. un git clone, y conecta ahi)\n" +
  "     --require-attestation <issuer>|<identity>  (opcional, ambos modos: exige una\n" +
  "         atestacion Sigstore valida de esa identidad OIDC exacta para CADA skill;\n" +
  "         sin ella, la skill se excluye igual que un tool_sha256 mismatch. Ej:\n" +
  "         --require-attestation 'https://token.actions.githubusercontent.com|https://github.com/OWNER/REPO/.github/workflows/release.yml@refs/heads/main')";

const argv = process.argv.slice(2);
let originArg = null;
let serveDir = null;
let fixedPort = null;
let requireAttestation = null; // { issuer, identity } | null (opt-in)
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--serve") {
    serveDir = argv[++i];
  } else if (a === "--port") {
    const p = Number(argv[++i]);
    if (!Number.isInteger(p) || p < 0 || p > 65535) {
      err("--port invalido");
      process.exit(2);
    }
    fixedPort = p;
  } else if (a === "--require-attestation") {
    const raw = argv[++i] || "";
    const sep = raw.indexOf("|");
    if (sep === -1) {
      err("--require-attestation requiere '<issuer>|<identity>'");
      process.exit(2);
    }
    requireAttestation = { issuer: raw.slice(0, sep), identity: raw.slice(sep + 1) };
    if (!requireAttestation.issuer || !requireAttestation.identity) {
      err("--require-attestation: issuer e identity no pueden estar vacios");
      process.exit(2);
    }
  } else if (originArg === null && serveDir === null) {
    originArg = a;
  }
}
if (!originArg && !serveDir) {
  err(USAGE);
  process.exit(2);
}

// origin se resuelve en start(): sincrono desde originArg, o asincrono desde
// el file server interno cuando --serve levanta primero. LocalPerSkillHost
// cierra sobre esta misma variable de modulo; el closure ve el valor final
// porque host.init() corre DESPUES de que start() la termine de asignar.
let origin = null;
if (originArg) {
  try {
    origin = new URL(originArg).origin;
  } catch {
    err("origin invalido: " + originArg);
    process.exit(2);
  }
}

// MIME minimo para el file server interno de --serve. Cosmetico: discover()
// no valida content-type, solo status + body — esto es prolijidad, no
// seguridad (la seguridad real sigue siendo el sha256 sobre los bytes).
const MIME_TYPES = {
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
};

// Resuelve un pathname de request contra rootDir sin permitir escapar via
// "../" (traversal). Devuelve null si el resultado cae fuera de rootDir.
function safeJoin(rootDir, pathname) {
  const decoded = decodeURIComponent(pathname.split("?")[0]);
  const normalized = path.normalize(decoded).replace(/^([.]{2}[/\\])+/, "");
  const resolved = path.resolve(rootDir, "." + path.sep + normalized);
  const rootResolved = path.resolve(rootDir);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
    return null;
  }
  return resolved;
}

// File server estatico interno para --serve. Solo 127.0.0.1 (nunca 0.0.0.0):
// esto es un atajo de desarrollo local, no un publisher real — no debe
// quedar alcanzable desde la red mientras el proceso corre.
function serveDirectory(dir, port) {
  const rootDir = path.resolve(dir);
  if (!existsSync(rootDir) || !statSync(rootDir).isDirectory()) {
    throw new Error("--serve: no es un directorio: " + dir);
  }
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      // safeJoin decodifica el pathname (decodeURIComponent): un percent-encoding
      // malformado (p.ej. "/%c0%af") lanza URIError. Sin este try/catch esa
      // excepcion no se captura dentro del handler de 'request' y tumba TODO el
      // proceso (confirmado: crash real, no solo un 500) — este mismo proceso
      // sirve tambien el runtime MCP por stdio, asi que una sola request mal
      // formada mataria la sesion del agente conectado.
      let filePath;
      try {
        filePath = safeJoin(rootDir, req.url || "/");
      } catch (e) {
        res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
        res.end("bad request: " + (e && e.message));
        return;
      }
      if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("not found");
        return;
      }
      let body;
      try {
        body = readFileSync(filePath);
      } catch (e) {
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        res.end("read error: " + (e && e.message));
        return;
      }
      const ct = MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
      res.writeHead(200, { "content-type": ct });
      res.end(body);
    });
    server.once("error", reject);
    server.listen(port || 0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, origin: "http://127.0.0.1:" + addr.port });
    });
  });
}

let internalServer = null;

async function fetchText(url, maxBytes) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "follow",
  });
  const text = await res.text();
  // Cap en BYTES reales (UTF-8), no en unidades UTF-16: text.length subcuenta
  // los multi-byte y dejaba pasar bodies por encima del cap nominal.
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new Error("body excede el cap (" + maxBytes + " bytes): " + url);
  }
  return { status: res.status, text };
}

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// Descarga /.well-known/agent-skills/index.json: la capa de metadata CANONICA
// (RFC §8 OQ5) -- llms.txt es el puntero de descubrimiento, index.json es la
// fuente de verdad de metadata/verificacion. Se usa SOLO para cruzar tool_sha256
// contra lo declarado en llms.txt (ver discover() abajo); no reemplaza llms.txt
// como fuente primaria. Ausente/HTTP no-200/JSON invalido -> null (el origin
// puede no publicarlo; no es un error, simplemente no hay nada que cruzar).
async function fetchAgentSkillsIndex() {
  let r;
  try {
    r = await fetchText(origin + "/.well-known/agent-skills/index.json", MAX_INDEX_BYTES);
  } catch (e) {
    err("agent-skills index.json fetch fallo: " + (e && e.message) + " -> sin cruce de metadata");
    return null;
  }
  if (r.status !== 200) return null; // 404 u otro estado: origin no lo publica
  try {
    const obj = JSON.parse(r.text);
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    err("agent-skills index.json invalido -> sin cruce de metadata");
    return null;
  }
}

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
const ATTEST_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Descarga /.well-known/agent-skills/attestations.json. Solo se llama si
// --require-attestation esta presente (opt-in; el runtime local no verificaba
// NINGUNA atestacion antes de este cambio -- limite v1 documentado en el
// README). 404/no-200/JSON no-array -> [] (sin atestaciones publicadas; con
// --require-attestation activo, [] excluye TODAS las skills -- el usuario
// pidio explicitamente exigirla, asi que ausencia es fail-CLOSED aqui, a
// diferencia del gateway en modo advisory/off donde ausencia es fail-open).
async function fetchAttestations() {
  let r;
  try {
    r = await fetchText(origin + "/.well-known/agent-skills/attestations.json", MAX_ATTESTATIONS_BYTES);
  } catch (e) {
    err("attestations.json fetch fallo: " + (e && e.message) + " -> 0 atestaciones");
    return [];
  }
  if (r.status !== 200) return [];
  try {
    const arr = JSON.parse(r.text);
    return Array.isArray(arr) ? arr : [];
  } catch {
    err("attestations.json invalido -> 0 atestaciones");
    return [];
  }
}

// ---- origin memory (Executable Skills v0.4 §2.4) ---------------------------
// Engine BM25 (@rckflr/minimemory, wasm). optionalDependency: import perezoso;
// si no esta instalada, se degrada a "sin memoria" con aviso por stderr (la
// capability queda ausente y las skills que la usen fallan controlado).
async function loadMemoryEngine() {
  try {
    const require = createRequire(import.meta.url);
    const mod = await import("@rckflr/minimemory");
    mod.initSync({ module: readFileSync(require.resolve("@rckflr/minimemory/minimemory_bg.wasm")) });
    return mod;
  } catch (e) {
    err("origin-memory: engine @rckflr/minimemory no disponible (" + String((e && e.message) || e).slice(0, 120) + ")");
    return null;
  }
}

// Puente raw-JSON asyncified (extraCapabilities de AsyncToolHost) — mismo
// contrato que el gateway: acepta ["<q>",k] | [{q,k}] | ["<q>"] (k default 5,
// acotado a [1,10]); devuelve {hits:[{text,score,title,concept_id}]} o {error}.
// El indice se construye UNA vez por proceso desde el snapshot YA verificado
// (inmutable; el proceso local es efimero, el equivalente del "per request"
// del gateway).
function makeMemorySearch(mem, snapshotText) {
  let idx = null;
  return async function memorySearch(argsJson) {
    let q = null;
    let k = 5;
    try {
      const parsed = JSON.parse(argsJson);
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
      if (!idx) {
        idx = new mem.WasmOkfIndex();
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

// Descubrimiento: llms.txt -> skills ejecutables -> fetch + verify sha256.
// Mismatch/HTTP != 200/cap excedido => skill rechazada (stderr), las demas cargan.
// Devuelve { skills, snapshotText }: snapshotText es el snapshot de origin-memory
// YA verificado contra snapshot_sha256, o null (sin memoria / verify fallo).
async function discover() {
  const r = await fetchText(origin + "/llms.txt", MAX_LLMS_BYTES);
  if (r.status !== 200) {
    throw new Error("llms.txt: HTTP " + r.status);
  }
  const { skills: parsed, nonExecutable, memories } = parseLlmsTxt(r.text);

  // Skills de prosa (core llms-txt-skills spec, sin tool/tool_sha256): este
  // runtime no las ejecuta, pero reportarlas evita que un origin con SOLO
  // skills de prosa se lea como "no publica nada".
  for (const ne of nonExecutable) {
    err("skill de prosa (no ejecutable por este runtime): " + ne.name + " -> " + ne.reason);
  }

  if (parsed.length === 0) {
    const proseNote = nonExecutable.length > 0
      ? " (" + nonExecutable.length + " skill(s) de prosa encontradas, no ejecutables por este runtime)"
      : "";
    throw new Error("llms.txt sin skills ejecutables (lineas <!-- skill: {...} -->)" + proseNote);
  }
  // Origin memory (ext v0.5: una entrada POR scope): descargar y verificar cada
  // snapshot contra su snapshot_sha256. snapshots = { "<scope|''>": texto } solo
  // con los VERIFICADOS; una skill cuyo scope no tiene snapshot verificado
  // simplemente no recibe la capability (falla controlado en sandbox).
  const snapshots = {};
  for (const mem of memories) {
    const scopeKey = mem.scope || "";
    const label = "origin-memory" + (mem.scope ? "[" + mem.scope + "]" : "");
    if (mem.unsupported) {
      err(label + ": format desconocido '" + mem.format + "' -> memory NO inyectada");
      continue;
    }
    const snapUrl = new URL(mem.snapshot, origin).href;
    let snapResp = null;
    try {
      snapResp = await fetchText(snapUrl, MAX_SNAPSHOT_BYTES);
    } catch (e) {
      err(label + ": snapshot fetch fallo: " + String((e && e.message) || e) + " -> memory NO inyectada");
      continue;
    }
    if (snapResp.status !== 200) {
      err(label + ": snapshot HTTP " + snapResp.status + " -> memory NO inyectada");
      continue;
    }
    const snapHash = sha256Hex(snapResp.text);
    if (snapHash === mem.snapshot_sha256) {
      snapshots[scopeKey] = snapResp.text;
    } else {
      err(
        label + ": snapshot sha256 mismatch (declarado " +
          mem.snapshot_sha256.slice(0, 12) + "…, obtenido " + snapHash.slice(0, 12) +
          "…) -> memory NO inyectada (las skills se listan, memorySearch falla controlado)"
      );
    }
  }

  const agentIndex = await fetchAgentSkillsIndex();
  const indexByName = new Map();
  if (agentIndex && Array.isArray(agentIndex.skills)) {
    for (const it of agentIndex.skills) {
      if (it && typeof it.name === "string") indexByName.set(it.name, it);
    }
  }

  // --require-attestation (opt-in): fetch UNA vez, verificar por-skill abajo.
  const attestations = requireAttestation ? await fetchAttestations() : [];
  const canonOrigin = canonicalOrigin(origin);
  const todayStr = todayUtcStr();

  const verified = [];
  for (const s of parsed) {
    // Si index.json declara tool_sha256 para esta skill, debe coincidir con lo
    // declarado en llms.txt -- un desacuerdo entre las dos fuentes autoritativas
    // es la senal de drift/tampering parcial que el cruce busca detectar.
    const idxEntry = indexByName.get(s.name);
    if (idxEntry && typeof idxEntry.tool_sha256 === "string" && idxEntry.tool_sha256 !== s.sha256) {
      err(
        "skill rechazada: " + s.name + " -> tool_sha256 no coincide entre llms.txt (" +
          s.sha256.slice(0, 12) + "…) e index.json (" + idxEntry.tool_sha256.slice(0, 12) +
          "…) -- posible drift/tampering parcial"
      );
      continue;
    }

    // --require-attestation: exige una atestacion Sigstore valida, sin expirar,
    // de la identidad OIDC exacta pedida por linea de comandos. Fail-closed: sin
    // match (o firma/identidad invalida, o expirada) -> skill excluida, igual
    // trato que un tool_sha256 mismatch.
    if (requireAttestation) {
      const match = attestations.find(
        (a) => a && a.skill === s.name && a.tool_sha256 === s.sha256 && canonicalOrigin(a.origin) === canonOrigin
      );
      if (!match) {
        err("skill rechazada: " + s.name + " -> --require-attestation activo, ninguna atestacion coincide (origin+skill+tool_sha256)");
        continue;
      }
      if (!ATTEST_DATE_RE.test(match.signed_on) || !ATTEST_DATE_RE.test(match.valid_until)) {
        err("skill rechazada: " + s.name + " -> atestacion con signed_on/valid_until malformado");
        continue;
      }
      if (todayStr > match.valid_until) {
        err("skill rechazada: " + s.name + " -> atestacion expirada (valid_until=" + match.valid_until + ")");
        continue;
      }
      const attestOk = await verifySigstoreAttestation(match, requireAttestation);
      if (!attestOk) {
        err("skill rechazada: " + s.name + " -> firma Sigstore invalida o no coincide con la identidad esperada");
        continue;
      }
    }

    const toolUrl = new URL(s.toolPath, origin).href;
    let tr;
    try {
      tr = await fetchText(toolUrl, MAX_TOOL_BYTES);
    } catch (e) {
      err("skill rechazada: " + s.name + " -> fetch tool.js fallo: " + (e && e.message));
      continue;
    }
    if (tr.status !== 200) {
      err("skill rechazada: " + s.name + " -> tool.js HTTP " + tr.status);
      continue;
    }
    const hash = sha256Hex(tr.text);
    if (hash !== s.sha256) {
      err(
        "skill rechazada: " + s.name + " -> sha256 mismatch (declarado " +
          s.sha256.slice(0, 12) + "…, obtenido " + hash.slice(0, 12) + "…)"
      );
      continue;
    }
    // ext v0.5: nombre publico con scope; colision de nombres publicos ->
    // se salta la skill con diagnostico (gana la primera, orden del documento).
    const publicName = s.scope ? s.scope + "__" + s.name : s.name;
    if (verified.some((v) => v.publicName === publicName)) {
      err("skill rechazada: " + s.name + " -> nombre publico '" + publicName + "' ya cargado (colision; ext v0.5 SS2.5)");
      continue;
    }
    verified.push({ name: s.name, publicName, scope: s.scope, description: s.description, code: tr.text, skillPath: s.skillPath, skillSha256: s.skillSha256 });
  }
  if (verified.length === 0) {
    throw new Error("ninguna skill verificada para " + origin);
  }

  // La OTRA mitad de cada skill: la receta (SKILL.md), servida al cliente MCP
  // como resource (y via la tool get_skill_guide). Verificacion contra el
  // sha256 declarado en la linea de llms.txt (core RFC) cuando esta presente.
  // Fallo/mismatch => la RECETA se omite con aviso; la TOOL (verificada por su
  // propio tool_sha256) carga igual — fallo controlado, mitades independientes.
  const docs = [];
  for (const v of verified) {
    if (typeof v.skillPath !== "string" || v.skillPath === "") continue;
    let dr;
    try {
      dr = await fetchText(new URL(v.skillPath, origin).href, MAX_SKILLMD_BYTES);
    } catch (e) {
      err("receta omitida: " + v.name + " -> fetch SKILL.md fallo: " + ((e && e.message) || e));
      continue;
    }
    if (dr.status !== 200) {
      err("receta omitida: " + v.name + " -> SKILL.md HTTP " + dr.status);
      continue;
    }
    if (v.skillSha256) {
      const dh = sha256Hex(dr.text);
      if (dh !== v.skillSha256) {
        err(
          "receta omitida: " + v.name + " -> SKILL.md sha256 mismatch (declarado " +
            v.skillSha256.slice(0, 12) + "…, obtenido " + dh.slice(0, 12) + "…)"
        );
        continue;
      }
    }
    docs.push({ name: v.publicName, description: v.description, text: dr.text });
  }

  return { skills: verified, snapshots, docs };
}

// Un contexto QuickJS por skill (aislamiento tool<->tool, como el gateway),
// compartiendo UN modulo asyncify: valido porque el loop de mensajes procesa
// las requests EN SERIE (cola de promesas) => nunca hay dos suspensiones
// asyncify simultaneas sobre el mismo modulo.
// Tool sintetica del runtime (no sandboxeada — la provee el propio runtime,
// no el publicador): fallback universal para clientes MCP sin soporte de
// resources. Devuelve la receta (SKILL.md verificado) de una skill.
const GUIDE_TOOL_NAME = "get_skill_guide";

class LocalPerSkillHost {
  // scopedCaps: { "<scope|''>": extraCapabilities | undefined } — cada skill
  // recibe las capabilities de SU scope (ext v0.5: memoria por scope).
  constructor(quickjs, skills, scopedCaps, docs) {
    this._quickjs = quickjs;
    this._skills = skills;
    this._scopedCaps = scopedCaps || {};
    this._docs = new Map((docs || []).map((d) => [d.name, d]));
    this._byName = new Map(); // publicName de la SKILL -> AsyncToolHost
    this._routes = new Map(); // publicName de cada TOOL -> { host, internal }
    this._order = []; // publicNames de tools, en orden de carga
  }

  async init() {
    for (const s of this._skills) {
      const h = new AsyncToolHost({
        quickjs: this._quickjs,
        allowedOrigin: origin,
        extraCapabilities: this._scopedCaps[s.scope || ""],
      });
      await h.init();
      h.loadToolSource(s.code);
      this._byName.set(s.publicName, h);
      // Rutas publicas por TOOL registrada (ext v0.5 SS2.5: <scope>__<name>).
      for (const t of h.listTools()) {
        const pub = s.scope ? s.scope + "__" + t.name : t.name;
        if (this._routes.has(pub)) {
          err("tool omitida: '" + pub + "' ya registrada por otra skill (colision de nombre publico)");
          continue;
        }
        this._routes.set(pub, { host: h, internal: t.name });
        this._order.push(pub);
      }
    }
  }

  listTools() {
    const all = [];
    for (const pub of this._order) {
      const r = this._routes.get(pub);
      const t = r.host.listTools().find((x) => x.name === r.internal);
      if (t) all.push({ ...t, name: pub });
    }
    if (this._docs.size > 0) {
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

  async callTool(name, args) {
    if (name === GUIDE_TOOL_NAME && this._docs.size > 0) {
      const doc = this._docs.get(args && args.name);
      if (!doc) throw new Error("skill sin receta disponible: " + ((args && args.name) || "(sin nombre)") + " — disponibles: " + [...this._docs.keys()].join(", "));
      return { name: doc.name, guide: doc.text };
    }
    const r = this._routes.get(name);
    if (!r) throw new Error("tool no encontrada: " + name);
    return await r.host.callTool(r.internal, args);
  }

  // MCP resources: la receta de cada skill, verificada en discover().
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
        // best-effort
      }
    }
  }
}

let host = null;

async function start() {
  if (serveDir) {
    const served = await serveDirectory(serveDir, fixedPort);
    internalServer = served.server;
    origin = served.origin;
    err("sirviendo " + path.resolve(serveDir) + " en " + origin + " (solo 127.0.0.1, no expuesto a la red)");
  }
  err("descubriendo skills de " + origin + " …");
  const { skills, snapshots, docs } = await discover();

  // Origin memory (ext v0.5): un closure memorySearch POR scope con snapshot
  // verificado; cada skill recibe el de su scope. Engine ausente => sin memoria.
  const scopedCaps = {};
  const scopeKeys = Object.keys(snapshots);
  if (scopeKeys.length > 0) {
    const mem = await loadMemoryEngine();
    if (mem) {
      for (const k of scopeKeys) {
        scopedCaps[k] = { memorySearch: makeMemorySearch(mem, snapshots[k]) };
        err("origin-memory" + (k ? "[" + k + "]" : "") + ": snapshot verificado -> host.memorySearch inyectada");
      }
    }
  }

  const quickjs = await newQuickJSAsyncWASMModuleFromVariant(newVariant(baseAsyncifyVariant, {}));
  host = new LocalPerSkillHost(quickjs, skills, scopedCaps, docs);
  await host.init();
  err("listo: " + skills.length + " skill(s) verificadas y cargadas (" + skills.map((s) => s.publicName).join(", ") + ")");
  if (docs && docs.length > 0) {
    err("recetas: " + docs.length + " SKILL.md verificadas -> MCP resources + tool " + GUIDE_TOOL_NAME);
  }
}

async function handleLine(line) {
  const t = line.trim();
  if (!t) return;
  let msg;
  try {
    msg = JSON.parse(t);
  } catch {
    out({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  let resp;
  try {
    resp = await handleMcpMessageAsync(host, msg);
  } catch (e) {
    resp = {
      jsonrpc: "2.0",
      id: msg && msg.id !== undefined ? msg.id : null,
      error: { code: -32603, message: String((e && e.message) || e) },
    };
  }
  if (resp === null) return; // notificacion: sin respuesta
  // serverInfo propio del runtime local (el core generico trae el del spike).
  if (msg && msg.method === "initialize" && resp.result) {
    resp.result.serverInfo = { name: "mcpwasm-local", version: PKG.version };
  }
  out(resp);
}

// El descubrimiento corre primero; las lineas que lleguen mientras tanto se
// ENCOLAN detras de la promesa de arranque (los clientes MCP mandan initialize
// inmediatamente). La cola tambien serializa los mensajes entre si (asyncify:
// una suspension a la vez sobre el modulo compartido). Un mensaje que falle no
// envenena la cola (handleLine captura y responde error JSON-RPC).
const startP = start().catch(async (e) => {
  err("descubrimiento fallo: " + String((e && e.message) || e));
  // NO process.exit() aca: la misma condicion de carrera documentada en
  // rl.on("close") mas abajo (forzar la salida mientras el server interno de
  // --serve y/o el readline de stdin todavia estan liberando sus handles
  // dispara "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" en
  // libuv/Windows). Confirmado: --serve sobre un directorio existente cuyas
  // skills fallan verificacion (0 verificadas) reproducia exit code 127 en
  // vez de 1 incluso esperando el cierre del server antes de exit().
  // process.exitCode fija el codigo de salida SIN terminar el proceso: una
  // vez cerrado el server (si lo hay) y con stdin/readline liberados por su
  // propio rl.on("close"), Node termina solo con ese exit code.
  process.exitCode = 1;
  if (internalServer) {
    await new Promise((resolve) => internalServer.close(() => resolve()));
  }
  rl.close();
});
let chain = startP;

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  chain = chain.then(() => handleLine(line));
});
rl.on("close", () => {
  chain.finally(async () => {
    if (host) host.dispose();
    if (internalServer) internalServer.close();
    // Deliberadamente SIN process.exit(): con stdin cerrado, el host
    // disposeado y el server interno (si habia) cerrado, no queda ningun
    // handle activo y Node termina solo, con exit code 0. Un process.exit()
    // forzado aca corria en paralelo con el teardown async de esos handles
    // (server.close() es async; QuickJS-wasm/asyncify tiene su propio estado
    // interno) y en Windows eso disparaba "Assertion failed:
    // !(handle->flags & UV_HANDLE_CLOSING)" en libuv (src/win/async.c) --
    // el proceso ya habia respondido bien por stdout, pero terminaba con
    // exit code 127 en vez de 0. Confirmado con --serve real: exit 127 con
    // process.exit(), exit 0 limpio sin el, en ambos modos (con y sin
    // --serve).
  });
});
