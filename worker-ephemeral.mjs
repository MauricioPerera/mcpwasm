// worker-ephemeral.mjs — Proxy de cuentas temporales de Cloudflare para mcpwasm.
//
// Mecanismo (verificado empiricamente en scripts/spike-ephemeral-cf.mjs y
// scripts/spike-ephemeral-gateway.mjs; fuente primaria: wrangler 4.127.1):
//   1. POST {CF_API_BASE}/provisioning/previews/challenge {} -> {challengeToken, seed, k, g}
//   2. PoW local: cadena sha256 desde seed, k checkpoints cada g pasos
//   3. POST {CF_API_BASE}/provisioning/previews -> account {id,name,apiToken,expiresAt}
//      + claim {url,expiresAt}. El apiToken VIAJA EN LA RESPUESTA: no hay login.
//   4. Deploy = API estandar de Workers con el apiToken (multipart, CompiledWasm).
//
// Este proxy lo encapsula para el runtime web de mcpwasm: la tool del navegador
// llama fetchOrigin("/preview", {method:"POST", body:...}) — sin headers (el
// scope de fetchOrigin no permite headers) — y la sesion viaja en cookie httpOnly.
// El apiToken de la cuenta temporal JAMAS sale de este worker (regla estructural:
// las credenciales nunca entran al contexto del LLM). La respuesta solo contiene
// lo que el modelo puede ver: previewUrl, claimUrl y vencimientos.
//
// Estado: KV (SESSIONS) con expirationTtl = vida de la cuenta. Reuso: misma
// sesion redeploya sobre la misma cuenta temporal mientras viva (igual que el
// cache local de wrangler). El PoW solo se paga una vez por sesion.
//
// CPU del PoW: k=1000 x g=2000 ~ 2M hashes sha256. Con sha256 puro-JS esto
// excede el presupuesto de 10ms del plan free: el proxy requiere Workers Paid
// (30s CPU) o un plan con CPU extendida. Los tests usan k/g diminutos (fake).

// ---------------------------------------------------------------------------
// sha256 puro-JS (tablas H y K generadas de las raices de primos 2..311).
// Suficiente para el PoW; los tests lo verifican contra node:crypto.
// ---------------------------------------------------------------------------
const H0 = [];
const K = [];
{
  const isPrime = (n) => {
    for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;
    return true;
  };
  const frac32 = (x) => Math.floor((x - Math.floor(x)) * 0x100000000);
  let count = 0;
  for (let p = 2; count < 64; p++) {
    if (!isPrime(p)) continue;
    const s = Math.sqrt(p), c = Math.cbrt(p);
    if (count < 8) H0.push(frac32(s) | 0);
    K.push(frac32(c) | 0);
    count++;
  }
}
const rotr = (x, n) => (x >>> n) | (x << (32 - n));

function sha256(msg) {
  const len = msg.length;
  const bitLen = len * 8;
  const withPad = new Uint8Array((((len + 8) >> 6) + 1) << 6);
  withPad.set(msg);
  withPad[len] = 0x80;
  const dv = new DataView(withPad.buffer);
  dv.setUint32(withPad.length - 4, bitLen >>> 0);
  dv.setUint32(withPad.length - 8, Math.floor(bitLen / 0x100000000));
  const w = new Int32Array(64);
  let h0 = H0[0], h1 = H0[1], h2 = H0[2], h3 = H0[3],
    h4 = H0[4], h5 = H0[5], h6 = H0[6], h7 = H0[7];
  for (let off = 0; off < withPad.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((x, i) => odv.setUint32(i * 4, x >>> 0));
  return out;
}

// Identico a solvePow de wrangler: checkpoints[j] = sha256^g aplicado (j*g) veces.
function solvePow(seedBytes, k, g) {
  const checkpoints = new Array(k + 1);
  let h = sha256(seedBytes);
  checkpoints[0] = h;
  for (let j = 0; j < k; j++) {
    for (let i = 0; i < g; i++) h = sha256(h);
    checkpoints[j + 1] = h;
  }
  return checkpoints;
}
function encodeCheckpoints(checkpoints) {
  let bin = "";
  for (const cp of checkpoints) bin += String.fromCharCode(...cp);
  return btoa(bin);
}
export const _pow = { sha256, solvePow, encodeCheckpoints };

// ---------------------------------------------------------------------------
// Sesion: cookie httpOnly sid -> KV con TTL = vida de la cuenta.
// El apiToken vive SOLO en KV; ninguna respuesta lo contiene.
// ---------------------------------------------------------------------------
const COOKIE = "mcpwasm_preview_sid";
const SESSION_TTL = 3600 + 120; // 60 min de vida + margen (KV expirationTtl)
const LIMITS = { maxFiles: 20, maxTotalBytes: 8 * 1024 * 1024, maxName: 128 };

function getSid(request) {
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.match(new RegExp(`${COOKIE}=([A-Za-z0-9-]+)`));
  return m ? m[1] : null;
}

function sessionCookie(sid) {
  return `${COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL}`;
}

function sessionKey(sid) {
  return `sid:${sid}`;
}

function parseBody(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("body no es JSON valido");
  }
  const files = parsed?.files;
  if (!Array.isArray(files) || files.length === 0 || files.length > LIMITS.maxFiles) {
    throw new Error(`files debe ser un arreglo de 1 a ${LIMITS.maxFiles} entradas`);
  }
  let total = 0;
  for (const f of files) {
    if (!f?.name || typeof f.name !== "string" || f.name.length > LIMITS.maxName || f.name.includes("..")) {
      throw new Error("cada file necesita name (sin traversal)");
    }
    if (typeof f.content !== "string") throw new Error(`file ${f.name}: content faltante`);
    total += f.base64 ? Math.ceil(f.content.length * 0.75) : f.content.length;
    if (total > LIMITS.maxTotalBytes) throw new Error("total de archivos excede el limite");
  }
  if (!files.some((f) => f.name === parsed.main)) throw new Error("main no esta en files");
  return { files, main: parsed.main, compat: parsed.compatibility_date, flags: parsed.compatibility_flags };
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

async function loadSession(env, sid) {
  if (!sid) return null;
  const raw = await env.SESSIONS.get(sessionKey(sid));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function mainHandler(request, env) {
  const base = env.CF_API_BASE || API_DEFAULT;
  const url = new URL(request.url);
  const route = url.pathname.replace(/\/+$/, "");

  if (request.method !== "POST" && request.method !== "GET" && request.method !== "DELETE") {
    return json({ error: "metodo no soportado" }, 405);
  }
  if (route !== "/preview" && !route.startsWith("/preview/")) {
    return json({ error: "ruta desconocida" }, 404);
  }

  // GET /preview: estado de la sesion (sin crear nada).
  if (request.method === "GET") {
    const sid = getSid(request);
    const session = await loadSession(env, sid);
    if (!session) return json({ error: "sin sesion de preview" }, 404);
    return json({
      accountName: session.accountName,
      scriptName: session.scriptName,
      previewUrl: session.previewUrl,
      claimUrl: session.claimUrl,
      expiresAt: session.expiresAt,
      claimExpiresAt: session.claimExpiresAt,
      msToExpiry: Date.parse(session.expiresAt) - Date.now(),
    });
  }

  // POST /preview: crear (o reusar) cuenta temporal y desplegar.
  const bodyText = await request.text();
  let spec;
  try {
    spec = parseBody(bodyText);
  } catch (e) {
    return json({ error: e.message }, 400);
  }

  let sid = getSid(request);
  let session = await loadSession(env, sid);
  const fresh = session && Date.parse(session.expiresAt) > Date.now() + 5 * 60 * 1000;

  if (!fresh) {
    // Nueva cuenta temporal: el PoW se paga aqui, una vez por sesion.
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

  const scriptName = (env.SCRIPT_PREFIX || "mcpwasm-preview-") + sid.slice(0, 8);
  try {
    await uploadScript(base, session.apiToken, session.accountId, scriptName,
      { main: spec.main, files: spec.files }, spec.compat, spec.flags);
    if (!session.subdomain) {
      session.subdomain = await getSubdomain(base, session.apiToken, session.accountId);
    }
    if (session.subdomain) {
      await enableScriptSubdomain(base, session.apiToken, session.accountId, scriptName);
    }
  } catch (e) {
    return json({ error: "deploy fallo: " + e.message }, 502);
  }

  const previewUrl = session.subdomain
    ? `https://${scriptName}.${session.subdomain}.workers.dev`
    : null;
  const out = {
    accountName: session.accountName,
    scriptName,
    previewUrl,
    claimUrl: session.claimUrl,
    expiresAt: session.expiresAt,
    claimExpiresAt: session.claimExpiresAt,
    created: !fresh,
  };
  await env.SESSIONS.put(sessionKey(sid), JSON.stringify({ ...session, scriptName, previewUrl }), {
    expirationTtl: SESSION_TTL,
  });
  const headers = fresh ? {} : { "Set-Cookie": sessionCookie(sid) };
  return json(out, 200, headers);
}

async function handleDelete(request, env) {
  const sid = getSid(request);
  const session = await loadSession(env, sid);
  if (!session) return json({ error: "sin sesion de preview" }, 404);
  const base = env.CF_API_BASE || API_DEFAULT;
  const ok = await deleteScript(base, session.apiToken, session.accountId, session.scriptName);
  await env.SESSIONS.delete(sessionKey(sid));
  return json({ deleted: ok, scriptName: session.scriptName });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === "DELETE") return await handleDelete(request, env);
      return await mainHandler(request, env);
    } catch (e) {
      return json({ error: "error interno: " + (e?.message ?? String(e)) }, 500);
    }
  },
};

// ---------------------------------------------------------------------------
// Cliente de la API de Cloudflare. CF_API_BASE es reemplazable en tests.
// ---------------------------------------------------------------------------
const API_DEFAULT = "https://api.cloudflare.com/client/v4";
const TERMS = {
  termsOfService: "https://www.cloudflare.com/terms/",
  privacyPolicy: "https://www.cloudflare.com/privacypolicy/",
};

async function requestChallenge(base) {
  const res = await fetch(`${base}/provisioning/previews/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`challenge HTTP ${res.status}`);
  const body = await res.json();
  const ch = body.result ?? body;
  if (!ch?.challengeToken || !ch?.seed || !ch?.k || !ch?.g) {
    throw new Error("challenge incompleto");
  }
  return ch;
}

async function createTemporaryAccount(base) {
  const ch = await requestChallenge(base);
  const seed = Uint8Array.from(atob(ch.seed.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
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
  if (!res.ok) throw new Error(`creacion de cuenta temporal HTTP ${res.status}`);
  const { result } = await res.json();
  const account = result?.account, claim = result?.claim;
  if (!account?.id || !account?.apiToken || !account?.expiresAt || !claim?.url) {
    throw new Error("respuesta de creacion incompleta");
  }
  return { account, claim };
}

// Upload estandar de Workers: multipart con metadata + modulo principal + extras.
// rules CompiledWasm permite import "./x.wasm" dentro del modulo subido.
async function uploadScript(base, apiToken, accountId, name, files, compat, flags) {
  const meta = {
    main_module: files.main,
    compatibility_date: compat || "2024-01-01",
    rules: [{ type: "CompiledWasm", globs: ["**/*.wasm"], fallthrough: false }],
  };
  if (flags && flags.length) meta.compatibility_flags = flags;
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(meta)], { type: "application/json" }));
  for (const f of files.files) {
    const type = f.type || (f.name.endsWith(".wasm") ? "application/wasm" : "application/javascript+module");
    const blob = f.base64
      ? new Blob([Uint8Array.from(atob(f.content), (c) => c.charCodeAt(0))], { type })
      : new Blob([f.content], { type });
    // el filename del part DEBE coincidir con el nombre del modulo (error 10021 si no)
    form.append(f.name, blob, f.name);
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
  if (!res.ok) throw new Error(`subdomain HTTP ${res.status}`);
  return (await res.json()).result?.subdomain ?? null;
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