// ephemeral-account-web.mjs — crea la cuenta temporal de Cloudflare DESDE EL
// NAVEGADOR (challenge -> PoW -> POST previews), con fetch inyectable para
// testear offline. Contrato: knowledge/contracts/ephemeral-account-web.md.
//
// Flujo idéntico a preview-capability.mjs (createTemporaryAccount, verificado
// en producción contra la API real): POST challenge -> decodifica seed
// (base64url -> bytes) -> PoW (solve-pow-web, byte-level) -> POST previews con
// {acceptTermsOfService, challengeToken, solution:{checkpoints}}.
// Sin Buffer ni Node: TextEncoder/TextDecoder + atob (estándar en Node 16+ y
// navegadores). El fetch es SIEMPRE el inyectado (en el navegador, globalThis
// fetch; en tests, el fake).
// ---------------------------------------------------------------------------

import { solvePowBytes, encodeCheckpointsWeb } from "./solve-pow-web.mjs";

const TERMS = {
  termsOfService: "https://www.cloudflare.com/terms/",
  privacyPolicy: "https://www.cloudflare.com/privacy/",
};

// Crea la cuenta temporal. fetchImpl: (url, init) => Response — en el navegador
// se pasa fetch; en los tests, el fake. opts.apiBase: base de la API de CF.
export async function createAccountWeb(fetchImpl, opts = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl requerido");
  const base = (opts && opts.apiBase) || "https://api.cloudflare.com/client/v4";

  // 1) challenge
  const ch = await requestChallenge(fetchImpl, base);

  // 2) PoW sobre la seed decodificada (base64url -> bytes)
  const seedBytes = base64UrlDecode(ch.seed);
  const checkpoints = solvePowBytes(seedBytes, ch.k, ch.g);
  const checkpointsB64 = encodeCheckpointsWeb(checkpoints);

  // 3) creación de la cuenta (mismo body que el runtime local)
  const res = await fetchImpl(`${base}/provisioning/previews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...TERMS,
      acceptTermsOfService: "yes",
      challengeToken: ch.challengeToken,
      solution: { checkpoints: checkpointsB64 },
    }),
  });
  if (!res.ok) {
    const detail = await safeText(res);
    throw new Error(`creacion de cuenta temporal HTTP ${res.status} :: ${detail.slice(0, 200)}`);
  }
  const body = await res.json();
  const result = body && body.result ? body.result : body;
  const account = result && result.account;
  const claim = result && result.claim;
  if (!account || !account.id || !account.apiToken || !account.expiresAt || !claim || !claim.url) {
    throw new Error("respuesta de creacion incompleta");
  }
  return { account, claim };
}

async function requestChallenge(fetchImpl, base) {
  const res = await fetchImpl(`${base}/provisioning/previews/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`challenge HTTP ${res.status}`);
  const body = await res.json();
  const ch = body && body.result ? body.result : body;
  if (!ch || !ch.challengeToken || !ch.seed || !ch.k || !ch.g) throw new Error("challenge incompleto");
  return ch;
}

async function safeText(res) {
  try { return await res.text(); } catch { return ""; }
}

// base64url -> bytes, estándar de navegador (sin Buffer).
function base64UrlDecode(s) {
  const b64 = String(s).replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}