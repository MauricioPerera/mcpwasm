// preview-capability.mjs — Capability del host local: crear/descartar previews
// en cuentas temporales de Cloudflare SIN proxy.
//
// Por que en el host y no en un Worker: Cloudflare bloquea (error 1017
// worker_subrequest_blocked) que un Worker subrequestee su propio endpoint de
// provisioning (verificado en produccion, worker llmstxt-studio v01b807f7).
// El runtime local corre en Node: crypto nativo hace el PoW en ~1.9s y la API
// acepta el flujo completo (scripts/spike-ephemeral-cf.mjs PASS 9/9).
//
// Regla estructural: el apiToken de la cuenta temporal vive SOLO en este host
// (~/.mcpwasm/previews.json, 0600) — el sandbox recibe {sid, previewUrl,
// claimUrl, expiresAt} y JAMAS el token (nunca entra al contexto del LLM).
//
// Contrato (llamado como host.provisionPreview(JSON.stringify([{op, ...}]))):
//   op "create":  { files: [{name, content}], main, compatibility_date?,
//                   compatibility_flags?, sid? } -> {ok, sid, previewUrl,
//                   claimUrl, expiresAt, claimExpiresAt, accountName, created}
//   op "status":  { sid } -> {ok, sid, previewUrl, claimUrl, msToExpiry, ...}
//   op "discard": { sid } -> {ok, deleted, scriptName}
//
// ToS: crear la cuenta implica aceptar los terminos de Cloudflare, igual que
// `wrangler --temporary` y el playground de workers.new.

import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const API_DEFAULT = "https://api.cloudflare.com/client/v4";
const TERMS = {
  termsOfService: "https://www.cloudflare.com/terms/",
  privacyPolicy: "https://www.cloudflare.com/privacypolicy/",
};
const SESSION_TTL_MS = 60 * 60 * 1000; // la cuenta vive 60 min (fijado por el server)
const SESSION_TTL_KV_MARGIN_MS = 5 * 60 * 1000;
const LIMITS = { maxFiles: 20, maxTotalBytes: 8 * 1024 * 1024, maxName: 128 };

function solvePow(seed, k, g) {
  const checkpoints = new Array(k + 1);
  let h = createHash("sha256").update(seed).digest();
  checkpoints[0] = h;
  for (let j = 0; j < k; j++) {
    for (let i = 0; i < g; i++) h = createHash("sha256").update(h).digest();
    checkpoints[j + 1] = h;
  }
  return checkpoints;
}
const encodeCheckpoints = (cp) => Buffer.concat(cp).toString("base64");

function storePath() {
  return path.join(os.homedir(), ".mcpwasm", "previews.json");
}

async function readStore() {
  try {
    return JSON.parse(await readFile(storePath(), "utf8"));
  } catch {
    return {};
  }
}

async function writeStore(store) {
  await mkdir(path.dirname(storePath()), { recursive: true });
  await writeFile(storePath(), JSON.stringify(store, null, 2), { mode: 0o600 });
}

async function requestChallenge(base) {
  const res = await fetch(`${base}/provisioning/previews/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`challenge HTTP ${res.status}`);
  const body = await res.json();
  const ch = body.result ?? body;
  if (!ch?.challengeToken || !ch?.seed || !ch?.k || !ch?.g) throw new Error("challenge incompleto");
  return ch;
}

async function createTemporaryAccount(base) {
  const ch = await requestChallenge(base);
  const seed = Buffer.from(ch.seed, "base64url");
  const checkpoints = solvePow(seed, ch.k, ch.g);
  const res = await fetch(`${base}/provisioning/previews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...TERMS,
      acceptTermsOfService: "yes",
      challengeToken: ch.challengeToken,
      solution: { checkpoints: encodeCheckpoints(checkpoints) },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`creacion de cuenta temporal HTTP ${res.status} :: ${detail.slice(0, 200)}`);
  }
  const { result } = await res.json();
  const account = result?.account, claim = result?.claim;
  if (!account?.id || !account?.apiToken || !account?.expiresAt || !claim?.url) {
    throw new Error("respuesta de creacion incompleta");
  }
  return { account, claim };
}

async function uploadScript(base, apiToken, accountId, name, spec) {
  const meta = {
    main_module: spec.main,
    compatibility_date: spec.compatibility_date || "2024-01-01",
    rules: [{ type: "CompiledWasm", globs: ["**/*.wasm"], fallthrough: false }],
  };
  if (spec.compatibility_flags?.length) meta.compatibility_flags = spec.compatibility_flags;
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(meta)], { type: "application/json" }));
  for (const f of spec.files) {
    const type = f.type || (f.name.endsWith(".wasm") ? "application/wasm" : "application/javascript+module");
    form.append(f.name, new Blob([f.content], { type }), f.name);
  }
  const res = await fetch(`${base}/accounts/${accountId}/workers/scripts/${name}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${apiToken}` },
    body: form,
  });
  if (!res.ok) throw new Error(`deploy HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function getSubdomain(base, apiToken, accountId) {
  const res = await fetch(`${base}/accounts/${accountId}/workers/subdomain`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  return res.ok ? (await res.json()).result?.subdomain ?? null : null;
}

async function enableScriptSubdomain(base, apiToken, accountId, name) {
  const res = await fetch(`${base}/accounts/${accountId}/workers/scripts/${name}/subdomain`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true }),
  });
  return res.ok || res.status === 409;
}

async function deleteScript(base, apiToken, accountId, name) {
  const res = await fetch(`${base}/accounts/${accountId}/workers/scripts/${name}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  return res.ok || res.status === 404;
}

// Registro en la plataforma (best effort): el deploy se anuncia en el KV del
// worker para que el claim comercial funcione. SOLO metadatos — el apiToken
// nunca sale del store local (el worker no puede redeployar ni borrar el
// script: esas operaciones siguen siendo del runtime).
async function registerRemote(origin, meta) {
  if (!origin) return false;
  try {
    const res = await fetch(`${origin}/preview/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(meta),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function fetchRemoteStatus(origin, sid) {
  if (!origin) return null;
  try {
    const res = await fetch(`${origin}/preview?sid=${encodeURIComponent(sid)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// op "create": crea (o reusa por sid) cuenta temporal y despliega.
async function opCreate(args, origin) {
  const base = process.env.CF_API_BASE || API_DEFAULT;
  const files = args?.files;
  if (!Array.isArray(files) || files.length === 0 || files.length > LIMITS.maxFiles) {
    return { ok: false, error: `files debe ser un arreglo de 1 a ${LIMITS.maxFiles}` };
  }
  let total = 0;
  for (const f of files) {
    if (!f?.name || typeof f.name !== "string" || f.name.length > LIMITS.maxName || f.name.includes("..")) {
      return { ok: false, error: "cada file necesita name (sin traversal)" };
    }
    if (typeof f.content !== "string") return { ok: false, error: `file ${f.name}: content faltante` };
    total += Buffer.byteLength(f.content, "utf8");
    if (total > LIMITS.maxTotalBytes) return { ok: false, error: "total de archivos excede el limite" };
  }
  if (!files.some((f) => f.name === args.main)) return { ok: false, error: "main no esta en files" };

  const store = await readStore();
  let sid = typeof args.sid === "string" && args.sid ? args.sid : null;
  let session = sid ? store[sid] : null;
  const fresh = session && Date.parse(session.expiresAt) > Date.now() + SESSION_TTL_KV_MARGIN_MS;

  if (!fresh) {
    const { account, claim } = await createTemporaryAccount(base);
    sid = crypto.randomUUID();
    session = {
      accountId: account.id,
      accountName: account.name,
      apiToken: account.apiToken,
      expiresAt: account.expiresAt,
      claimUrl: claim.url,
      claimExpiresAt: claim.expiresAt,
    };
  }

  const scriptName = "mcpwasm-preview-" + sid.slice(0, 8);
  try {
    await uploadScript(base, session.apiToken, session.accountId, scriptName, {
      main: args.main, files, compatibility_date: args.compatibility_date, compatibility_flags: args.compatibility_flags,
    });
    if (!session.subdomain) session.subdomain = await getSubdomain(base, session.apiToken, session.accountId);
    if (session.subdomain) await enableScriptSubdomain(base, session.apiToken, session.accountId, scriptName);
  } catch (e) {
    return { ok: false, error: "deploy fallo: " + e.message };
  }

  const previewUrl = session.subdomain ? `https://${scriptName}.${session.subdomain}.workers.dev` : null;
  const out = {
    ok: true, sid, accountName: session.accountName, scriptName, previewUrl,
    claimUrl: session.claimUrl, expiresAt: session.expiresAt,
    claimExpiresAt: session.claimExpiresAt, created: !fresh,
  };
  // el apiToken queda SOLO en el store local (0600); nunca cruza al sandbox/LLM
  store[sid] = { ...session, scriptName, previewUrl, savedAt: new Date().toISOString() };
  await writeStore(store);
  // anunciamos el deploy a la plataforma (metadatos, sin token) para el claim
  out.registered = await registerRemote(origin, {
    sid, accountName: session.accountName, scriptName, previewUrl,
    claimUrl: session.claimUrl, expiresAt: session.expiresAt, claimExpiresAt: session.claimExpiresAt,
  });
  return out;
}

async function opStatus(args, origin) {
  const store = await readStore();
  const session = args?.sid ? store[args.sid] : null;
  if (!session) return { ok: false, error: "sesion no encontrada (puede haber expirado)" };
  const out = {
    ok: true, sid: args.sid, accountName: session.accountName, scriptName: session.scriptName,
    previewUrl: session.previewUrl, claimUrl: session.claimUrl, expiresAt: session.expiresAt,
    claimExpiresAt: session.claimExpiresAt, msToExpiry: Date.parse(session.expiresAt) - Date.now(),
  };
  // el claim vive en la plataforma: si esta registrada, mezclamos su estado
  const remote = await fetchRemoteStatus(origin, args.sid);
  if (remote && remote.sid) {
    out.claimed = remote.claimed ?? null;
    out.claim_pending = remote.claim_pending ?? null;
    if (remote.claimed && Date.parse(remote.expiresAt) > Date.parse(session.expiresAt)) {
      out.expiresAt = remote.expiresAt; // el claim extendio el TTL en la plataforma
      out.msToExpiry = Date.parse(remote.expiresAt) - Date.now();
    }
  }
  return out;
}

async function opDiscard(args, origin) {
  const store = await readStore();
  const session = args?.sid ? store[args.sid] : null;
  if (!session) return { ok: false, error: "sesion no encontrada (puede haber expirado)" };
  const base = process.env.CF_API_BASE || API_DEFAULT;
  const deleted = await deleteScript(base, session.apiToken, session.accountId, session.scriptName);
  delete store[args.sid];
  await writeStore(store);
  // la plataforma borra su registro (best effort; sin token del lado del worker)
  if (origin) {
    try { await fetch(`${origin}/preview/discard?sid=${encodeURIComponent(args.sid)}`, { method: "POST", body: "{}" }); } catch {}
  }
  return { ok: true, deleted, scriptName: session.scriptName };
}

export function makePreviewCapability(opts = {}) {
  const origin = opts.origin || null;
  return async function provisionPreviewCapability(argsJson) {
    let args = {};
    try { args = JSON.parse(argsJson); } catch { return { ok: false, error: "args no es JSON valido" }; }
    // el puente del sandbox pasa los args posicionales como array: [{...}]
    const params = Array.isArray(args) ? args[0] : args;
    const op = params?.op;
    try {
      if (op === "create") return await opCreate(params, origin);
      if (op === "status") return await opStatus(params, origin);
      if (op === "discard") return await opDiscard(params, origin);
      return { ok: false, error: "op desconocida (create|status|discard)" };
    } catch (e) {
      return { ok: false, error: e?.message ?? String(e) };
    }
  };
}