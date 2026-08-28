// tests/test-deploy-preview-web.mjs — ORACULO del contrato deploy-preview-web.
// Orquestador del navegador: cuenta temporal (ephemeral-account-web) + deploy
// (deploy-app-web) + registro en la plataforma (SOLO metadatos, sin apiToken).
// Uso: node tests/test-deploy-preview-web.mjs
import { deployPreviewWeb } from "../web/deploy-preview-web.mjs";

const CHECKS = [];
const check = (ok, label) => { CHECKS.push(ok); console.log(`  ${ok ? "ok" : "FALLO"}: ${label}`); };

const SEED_B64URL = Buffer.from("seed-fake-2026").toString("base64url");
const APP = [{
  name: "app.js",
  content: `export default{async fetch(){return new Response("<h1>hola</h1>",{headers:{"content-type":"text/html"}});}}`,
}];
const PLATFORM = "https://studio.test";
const API = "https://api.cf/v4";

function jsonRes(status, obj) {
  return { ok: status >= 200 && status < 300, status, json: async () => obj, text: async () => JSON.stringify(obj) };
}

// fake: provisioning completo de CF + el endpoint /preview/register de la plataforma
function makeFake(opts = {}) {
  const state = { calls: [], registerBody: null, failRegister: opts.failRegister || false, challengeCalls: 0 };
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || "GET").toUpperCase();
    state.calls.push({ url: u, method, body: init.body, headers: init.headers || {} });
    if (u.endsWith("/provisioning/previews/challenge")) {
      state.challengeCalls++;
      return jsonRes(200, { result: { challengeToken: "ct-1", seed: SEED_B64URL, k: 2, g: 2 } });
    }
    if (u.endsWith("/provisioning/previews")) {
      return jsonRes(200, {
        result: {
          account: { id: "acc-9", name: "Fake Nine", apiToken: "TOK-9", expiresAt: "2026-08-28T22:00:00Z" },
          claim: { url: "https://dash/claim?token=fake", expiresAt: "2026-08-28T21:00:00Z" },
        },
      });
    }
    if (method === "PUT" && u.includes("/workers/scripts/")) return jsonRes(200, {});
    if (u.endsWith("/workers/subdomain") && method !== "POST") {
      return jsonRes(200, { result: { subdomain: "nine-sub" } });
    }
    if (method === "POST" && u.endsWith("/subdomain")) return jsonRes(200, {});
    if (u === PLATFORM + "/preview/register") {
      state.registerBody = JSON.parse(init.body);
      if (state.failRegister) return { ok: false, status: 500, json: async () => ({}), text: async () => "boom" };
      return jsonRes(200, { ok: true, registered: true });
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => "404" };
  };
  return { fetchImpl, state };
}

async function main() {
  // --- 1. flujo completo: cuenta + deploy + registro -------------------------
  const f = makeFake();
  const out = await deployPreviewWeb(f.fetchImpl, { platformOrigin: PLATFORM, apiBase: API, files: APP, main: "app.js" });
  check(typeof out.sid === "string" && out.sid.length >= 8, `sid generado (${out.sid})`);
  check(out.account && out.account.apiToken === "TOK-9", "devuelve la account (con apiToken, para el store LOCAL)");
  check(out.previewUrl === `https://mcpwasm-preview-${out.sid.slice(0, 8)}.nine-sub.workers.dev`, `previewUrl derivada del sid: ${out.previewUrl}`);
  check(Boolean(out.claim && out.claim.url), "claimUrl presente para el humano");
  check(f.state.calls.length === 6, `6 llamadas: challenge, create, PUT, subdomain, enable, register (${f.state.calls.length})`);

  // registro en la plataforma: SOLO metadatos — el apiToken JAMAS viaja
  const reg = f.state.registerBody;
  check(Boolean(reg), "la plataforma recibio el registro");
  check(reg && reg.sid === out.sid && reg.scriptName === "mcpwasm-preview-" + out.sid.slice(0, 8), "registro con sid + scriptName correctos");
  check(reg && reg.previewUrl && reg.claimUrl && reg.expiresAt, "registro con previewUrl/claimUrl/expiresAt");
  const regStr = JSON.stringify(reg || {});
  check(regStr.includes("TOK-9") === false, "EL APITOKEN NUNCA VIAJA AL REGISTRO (regla estructural)");

  // --- 2. fallo del registro: best effort, el deploy sigue siendo ok --------
  const f2 = makeFake({ failRegister: true });
  const out2 = await deployPreviewWeb(f2.fetchImpl, { platformOrigin: PLATFORM, apiBase: API, files: APP, main: "app.js" });
  check(out2.ok === true && out2.registered === false, `registro caido -> no rompe el deploy (registered:${out2.registered})`);

  // --- 3. reuse: opts.sid + opts.account evitan nuevo provisioning ----------
  const f3 = makeFake();
  const account = { id: "acc-stored", name: "Stored", apiToken: "STORED-TOK", expiresAt: "2026-08-28T22:00:00Z" };
  const out3 = await deployPreviewWeb(f3.fetchImpl, {
    platformOrigin: PLATFORM, apiBase: API, files: APP, main: "app.js",
    sid: "sid-guardado", account: f_storedAccount(),
  });
  function f_storedAccount() { return { ...account, claimUrl: "https://dash/claim?token=fake", claimExpiresAt: "2026-08-28T21:00:00Z" }; }
  check(out3.sid === "sid-guardado", "reuse: sid dado se respeta");
  check(f3.state.challengeCalls === 0, "reuse: SIN nuevo challenge/PoW");
  const create3 = f3.state.calls.find((c) => c.url.endsWith("/provisioning/previews"));
  check(!create3, "reuse: sin creacion de cuenta nueva");

  const ok = CHECKS.every(Boolean);
  console.log(`ORACULO deploy-preview-web: ${ok ? "PASS" : "FALLO"} (${CHECKS.filter(Boolean).length}/${CHECKS.length})`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error("ORACULO ERROR:", e.message); process.exit(1); });