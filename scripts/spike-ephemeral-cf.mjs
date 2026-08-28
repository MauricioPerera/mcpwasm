// spike-ephemeral-cf.mjs — Cuentas temporales de Cloudflare (fuente primaria: wrangler 4.127.1)
//
// Mecanismo extraido del bundle de wrangler (wrangler-dist/cli.js):
//   1. POST {API}/provisioning/previews/challenge  {}        -> {challengeToken, seed, k, g}
//   2. PoW local: cadena sha256 desde seed, k checkpoint cada g iteraciones
//   3. POST {API}/provisioning/previews {termsOfService, privacyPolicy, acceptTermsOfService:"yes", challengeToken, solution:{checkpoints}}
//      -> result.account {id, name, apiToken, expiresAt} + result.claim {url, expiresAt}
//   El apiToken de la cuenta temporal VIAJA EN LA RESPUESTA DE CREACION: no hay login.
//   El TTL y el vencimiento del claim los decide el servidor (expiresAt).
//   Requiere compliance region "public" y es mutuamente excluyente con credenciales reales.
//
// Este spike verifica EMPIRICAMENTE: alcanzable sin auth, PoW resoluble, creacion real,
// deploy real de un modulo Workers con el token temporal y URL publica accesible.

import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const API = "https://api.cloudflare.com/client/v4";
const PREVIEWS = `${API}/provisioning/previews`;
const SCRIPT_NAME = "mcpwasm-ephemeral-spike";
const CHECKS = [];
const check = (ok, label) => { CHECKS.push(ok); console.log(`  ${ok ? "ok" : "FALLO"}: ${label}`); };

// --- PoW (identico a wrangler) ---------------------------------------------
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
function encodeCheckpoints(checkpoints) {
  return Buffer.concat(checkpoints).toString("base64");
}

// --- flujo ------------------------------------------------------------------
async function main() {
  console.log("[1] challenge sin autenticacion");
  const chRes = await fetch(`${PREVIEWS}/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  check(chRes.ok, `challenge HTTP ${chRes.status} (sin auth)`);
  if (!chRes.ok) throw new Error("challenge fallo: " + chRes.status);
  const ch = await chRes.json();
  const challenge = ch.result ?? ch;
  check(Boolean(challenge?.challengeToken && challenge?.seed && challenge?.k && challenge?.g),
    `challenge completo (k=${challenge?.k}, g=${challenge?.g})`);

  console.log("[2] resolver proof-of-work");
  const t0 = Date.now();
  const checkpoints = solvePow(Buffer.from(challenge.seed, "base64url"), challenge.k, challenge.g);
  const ms = Date.now() - t0;
  check(checkpoints.length === challenge.k + 1, `PoW resuelto en ${ms} ms (${checkpoints.length} checkpoints)`);

  console.log("[3] crear cuenta temporal (ToS de Cloudflare aceptados para el preview desechable)");
  const crRes = await fetch(PREVIEWS, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      termsOfService: "https://www.cloudflare.com/terms/",
      privacyPolicy: "https://www.cloudflare.com/privacypolicy/",
      acceptTermsOfService: "yes",
      challengeToken: challenge.challengeToken,
      solution: { checkpoints: encodeCheckpoints(checkpoints) },
    }),
  });
  check(crRes.ok, `creacion HTTP ${crRes.status}`);
  if (!crRes.ok) throw new Error("creacion fallo: " + crRes.status + " " + (await crRes.text()).slice(0, 200));
  const created = (await crRes.json()).result;
  const account = created?.account;
  const claim = created?.claim;
  check(Boolean(account?.id && account?.apiToken), "cuenta temporal con apiToken en la respuesta (sin login)");
  const ttlMin = account?.expiresAt ? ((Date.parse(account.expiresAt) - Date.now()) / 60000).toFixed(0) : "?";
  const claimMin = claim?.expiresAt ? ((Date.parse(claim.expiresAt) - Date.now()) / 60000).toFixed(0) : "?";
  console.log(`    cuenta: ${account?.name}`);
  console.log(`    expira en: ${ttlMin} min | claim expira en: ${claimMin} min`);
  console.log(`    claim URL: ${claim?.url}`);

  console.log("[4] deploy de modulo Workers con el token temporal (API estandar)");
  const metadata = {
    main_module: "spike.js",
    compatibility_date: "2024-01-01",
  };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  // el filename del part DEBE coincidir con main_module (si no, error 10021 "No such module")
  form.append("spike.js", new Blob([`
export default {
  async fetch() {
    return new Response(JSON.stringify({ ok: true, from: "mcpwasm-ephemeral-spike" }), {
      headers: { "content-type": "application/json" },
    });
  },
};
`], { type: "application/javascript+module" }), "spike.js");
  const depRes = await fetch(`${API}/accounts/${account.id}/workers/scripts/${SCRIPT_NAME}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${account.apiToken}` },
    body: form,
  });
  check(depRes.ok, `deploy HTTP ${depRes.status}`);
  if (!depRes.ok) throw new Error("deploy fallo: " + (await depRes.text()).slice(0, 300));

  console.log("[5] subdomain workers.dev y URL publica");
  const subRes = await fetch(`${API}/accounts/${account.id}/workers/subdomain`, {
    headers: { Authorization: `Bearer ${account.apiToken}` },
  });
  let subdomain = null;
  if (subRes.ok) subdomain = (await subRes.json()).result?.subdomain;
  check(Boolean(subdomain), `workers.dev subdomain: ${subdomain ?? "(no disponible)"}`);
  if (subdomain) {
    // habilitar workers.dev para el script (wrangler hace este POST tras el deploy)
    const enRes = await fetch(`${API}/accounts/${account.id}/workers/scripts/${SCRIPT_NAME}/subdomain`, {
      method: "POST",
      headers: { Authorization: `Bearer ${account.apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    check(enRes.ok || enRes.status === 409, `workers.dev habilitado para el script (HTTP ${enRes.status})`);
  }
  let publicOk = false;
  if (subdomain) {
    const url = `https://${SCRIPT_NAME}.${subdomain}.workers.dev/`;
    for (let i = 0; i < 15 && !publicOk; i++) {
      await delay(1500);
      try {
        const r = await fetch(url);
        if (r.ok) {
          const body = await r.json();
          publicOk = body?.ok === true && body?.from === "mcpwasm-ephemeral-spike";
          if (publicOk) console.log(`    URL publica: ${url} -> ${JSON.stringify(body)}`);
        }
      } catch { /* propagando */ }
    }
  }
  check(publicOk, "worker temporal accesible desde internet");

  console.log("SPIKE EPHEMERAL CF: " + (CHECKS.every(Boolean) ? "PASS" : "FALLO") + ` (${CHECKS.filter(Boolean).length}/${CHECKS.length})`);
}

main().catch((e) => {
  console.error("SPIKE EPHEMERAL CF: ERROR —", e.message);
  process.exit(1);
});