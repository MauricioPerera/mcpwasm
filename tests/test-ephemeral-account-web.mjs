// tests/test-ephemeral-account-web.mjs — ORACULO del contrato ephemeral-account-web.
// Verifica la creacion de la cuenta temporal de Cloudflare desde el navegador:
// challenge -> PoW (solve-pow-web) -> POST previews, con fetch INYECTABLE.
// Los checkpoints del PoW se verifican contra node:crypto (referencia real).
// Uso: node tests/test-ephemeral-account-web.mjs
import { createHash } from "node:crypto";
import { createAccountWeb } from "../web/ephemeral-account-web.mjs";

const CHECKS = [];
const check = (ok, label) => { CHECKS.push(ok); console.log(`  ${ok ? "ok" : "FALLO"}: ${label}`); };

// --- helpers -----------------------------------------------------------------
function jsonRes(status, obj) {
  return { ok: status >= 200 && status < 300, status, json: async () => obj, text: async () => JSON.stringify(obj) };
}
function shaRef(bytes) {
  let h = createHash("sha256").update(bytes);
  return h.digest();
}
function refCheckpoints(seedBytes, k, g) {
  const cps = [];
  let h = shaRef(seedBytes);
  cps.push(h);
  for (let j = 0; j < k; j++) {
    for (let i = 0; i < g; i++) h = shaRef(h);
    cps.push(h);
  }
  return cps;
}
function expectedB64(seedBytes, k, g) {
  return Buffer.concat(refCheckpoints(seedBytes, k, g)).toString("base64");
}

// fake de la API de Cloudflare: captura los requests y responde controlado
function makeFakeCf(opts = {}) {
  const state = {
    challengeCalls: 0, createCalls: 0, lastChallengeUrl: "", lastCreateUrl: "",
    lastCreateBody: null, failChallenge: opts.failChallenge || null, failCreate: opts.failCreate || null,
    flat: opts.flat || false,
  };
  const CHALLENGE = { challengeToken: "ctok-fake", seed: SEED_B64URL, k: 3, g: 2 };
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    if (u.endsWith("/provisioning/previews/challenge")) {
      state.challengeCalls++;
      state.lastChallengeUrl = u;
      if (state.failChallenge) return jsonRes(state.failChallenge.status || 500, state.failChallenge.body || {});
      return state.flat ? jsonRes(200, CHALLENGE) : jsonRes(200, { result: CHALLENGE });
    }
    if (u.endsWith("/provisioning/previews")) {
      state.previewCalls++;
      state.lastCreateBody = JSON.parse(init.body);
      if (state.failCreate) return { ok: false, status: state.failCreate.status || 500, text: async () => state.failCreate.detail || "boom" };
      return jsonRes(200, {
        result: {
          account: { id: "acc-1", name: "Fake 1", apiToken: "TOK-1", expiresAt: "2026-08-28T22:00:00Z" },
          claim: { url: "https://dash.cloudflare.com/claim-preview?claimToken=fake", expiresAt: "2026-08-28T21:00:00Z" },
        },
      });
    }
    return { ok: false, status: 404, text: async () => "fake 404", json: async () => ({}) };
  };
  return { fetchImpl, state, CHALLENGE };
}

const SEED_B64URL = Buffer.from("fake-seed-2026-para-el-oraculo").toString("base64url");

async function main() {
  // --- 1. flujo feliz: challenge + PoW + creacion --------------------------
  const f1 = makeFakeCf();
  const out = await createAccountWeb(f1.fetchImpl, { apiBase: "https://api.cloudflare.com/client/v4" });
  check(out.account.id === "acc-1" && out.account.apiToken === "TOK-1", "devuelve account (id, apiToken)");
  check(Boolean(out.claim.url) && Boolean(out.claim.expiresAt), "devuelve claim (url + expiresAt)");
  check(f1.state.challengeCalls === 1, "un solo pedido de challenge");
  check(f1.state.lastChallengeUrl === "https://api.cloudflare.com/client/v4/provisioning/previews/challenge", "challenge contra {apiBase}/provisioning/previews/challenge");

  // --- 2. el body de creacion: token, terminos y checkpoints CORRECTOS -----
  const b = f1.state.lastCreateBody;
  check(b.acceptTermsOfService === "yes", "acceptTermsOfService: yes (ToS de Cloudflare)");
  check(b.challengeToken === "ctok-fake", "challengeToken viaja en el body");
  const expect = expectedCheckpointsB64();
  check(b.solution && typeof b.solution.checkpoints === "string", "solution.checkpoints es el base64 concatenado");
  check(b.solution.checkpoints === expect, "checkpoints == cadena sha256 de node:crypto para la seed fake (k=3, g=2)");
  function expectedCheckpointsB64() {
    const seedBytes = Buffer.from(SEED_B64URL, "base64url");
    const cps = [];
    let h = createHash("sha256").update(seedBytes).digest();
    cps.push(h);
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 2; i++) h = createHash("sha256").update(h).digest();
      cps.push(h);
    }
    return Buffer.concat(cps).toString("base64");
  }

  // --- 3. respuesta plana (sin wrapper .result) tambien se acepta ----------
  const f2 = makeFakeCf({ flat: true });
  const out2 = await createAccountWeb(f2.fetchImpl, { apiBase: "https://x.internal/v4" });
  check(out2.account.id === "acc-1" && Boolean(out2.claim.url), "respuesta plana (sin .result) tambien parsea");

  // --- 4. errores controlados ----------------------------------------------
  let threw = "";
  try {
    await createAccountWeb(makeFakeCf({ failChallenge: { status: 500 } }).fetchImpl, { apiBase: "https://x/v4" });
  } catch (e) { threw = e.message; }
  check(threw.includes("challenge HTTP 500"), `challenge 500 -> throw claro (${threw})`);

  threw = "";
  try {
    await createAccountWeb(makeFakeCf({ failCreate: { status: 403, detail: "pow invalido" } }).fetchImpl, { apiBase: "https://x/v4" });
  } catch (e) { threw = e.message; }
  check(threw.includes("403") && threw.includes("pow invalido"), `create 403 -> throw con status y detalle (${threw})`);

  threw = "";
  const f3 = makeFakeCf();
  // respuesta incompleta: account sin apiToken
  const broken = async (url, init) => {
    if (String(url).endsWith("/challenge")) return jsonRes(200, { result: { challengeToken: "t", seed: SEED_B64URL, k: 1, g: 1 } });
    return jsonRes(200, { result: { account: { id: "acc-2", expiresAt: "2026-08-28T22:00:00Z" }, claim: { url: "https://c", expiresAt: "2026-08-28T21:00:00Z" } } });
  };
  try { await createAccountWeb(broken, { apiBase: "https://x/v4" }); } catch (e) { threw = e.message; }
  check(threw.includes("incompleta"), `respuesta sin apiToken -> throw 'incompleta' (${threw})`);

  const ok = CHECKS.every(Boolean);
  console.log(`ORACULO ephemeral-account-web: ${ok ? "PASS" : "FALLO"} (${CHECKS.filter(Boolean).length}/${CHECKS.length})`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error("ORACULO ERROR:", e.message); process.exit(1); });