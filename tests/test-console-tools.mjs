// tests/test-console-tools.mjs — ORACULO del contrato console-tools.
// La capa de tools de la consola del studio en el navegador: create_preview,
// preview_status, claim_preview y discard_preview operando sobre el nucleo
// de provisioning web (deploy-preview-web) y un store de sesiones inyectado.
// Uso: node tests/test-console-tools.mjs
import { makeConsoleTools } from "../web/console-tools.mjs";

const CHECKS = [];
const check = (ok, label) => { CHECKS.push(ok); console.log(`  ${ok ? "ok" : "FALLO"}: ${label}`); };

const SEED_B64URL = Buffer.from("seed-console-fake").toString("base64url");
const APP = [{
  name: "app.js",
  content: `export default{async fetch(){return new Response("<h1>tienda</h1>",{headers:{"content-type":"text/html"}});}}`,
}];
const PLATFORM = "https://studio.test";
const API = "https://api.cf/v4";

function jsonRes(status, obj) {
  return { ok: status >= 200 && status < 300, status, json: async () => obj, text: async () => JSON.stringify(obj) };
}

// store fake (la consola real usa localStorage; aqui memoria)
function makeStore(initial) {
  const mem = new Map(Object.entries(initial || {}));
  return {
    get: (sid) => (sid in mem ? mem.get(sid) : null),
    set: (sid, session) => { mem.set(sid, session); },
    remove: (sid) => { mem.delete(sid); },
    keys: () => [...mem.keys()],
  };
}

// fake CF + plataforma (igual al oraculo de deploy-preview-web, con extras)
function makeFake(opts = {}) {
  const state = { calls: [], registerBody: null, challengeCalls: 0, deleteCalls: 0, failRegister: opts.failRegister || false };
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || "GET").toUpperCase();
    state.calls.push({ url: u, method, headers: init.headers || {}, body: init.body });
    if (u.endsWith("/provisioning/previews/challenge")) {
      state.challengeCalls++;
      return jsonRes(200, { result: { challengeToken: "ct", seed: Buffer.from("s").toString("base64url"), k: 2, g: 2 } });
    }
    if (u.endsWith("/provisioning/previews")) {
      return jsonRes(200, {
        result: {
          account: { id: "acc-1", name: "Store Fake", apiToken: "CT-TOK", expiresAt: "2026-08-28T22:00:00Z" },
          claim: { url: "https://dash/claim?token=fake", expiresAt: "2026-08-28T21:00:00Z" },
        },
      });
    }
    if (method === "PUT" && u.includes("/workers/scripts/")) return jsonRes(200, {});
    if (method === "DELETE" && u.includes("/workers/scripts/")) { state.deletedScript = true; return jsonRes(200, {}); }
    if (u.endsWith("/workers/subdomain") && method !== "POST") return jsonRes(200, { result: { subdomain: "console-sub" } });
    if (method === "POST" && u.endsWith("/subdomain")) return jsonRes(200, {});
    if (u === PLATFORM + "/preview/register") {
      state.registerBody = JSON.parse(init.body);
      return jsonRes(200, { ok: true, registered: true });
    }
    if (u.startsWith(PLATFORM + "/preview?sid=")) {
      const sid = new URL(u).searchParams.get("sid");
      return jsonRes(200, { sid, claimed: { email: "humano@test", at: "2026-08-28T20:00:00Z" }, expiresAt: "2026-09-27T21:00:00Z" });
    }
    if (u === PLATFORM + "/preview/claim") {
      return jsonRes(200, { ok: true, status: "pending", payment_url: "/claim/abc?pt=pt-1", price: 19, days: 30 });
    }
    if (u.startsWith(PLATFORM + "/preview/discard")) {
      return jsonRes(200, { deleted: true });
    }
    return jsonRes(404, {});
  };
  return { fetchImpl, state };
}

async function main() {
  // --- 1. create_preview: flujo completo SIN token en el resultado ----------
  const fake = makeFake();
  const store = makeStore();
  const tools = makeConsoleTools({ fetchImpl: fake.fetchImpl, platformOrigin: PLATFORM, apiBase: API, store });
  const created = await tools.create_preview({ files: [{ name: "app.js", content: APP_JS }], main: "app.js" });
  check(created.ok === true && typeof created.sid === "string", `create_preview ok con sid (${created.sid})`);
  check(created.previewUrl && created.previewUrl.includes(".console-sub.workers.dev"), `previewUrl (${created.previewUrl})`);
  const createdStr = JSON.stringify(created);
  check(createdStr.includes("CT-TOK") === false, "EL RESULTADO DEL AGENTE NO CONTIENE EL APITOKEN (regla estructural)");
  const stored = store.get(created.sid);
  check(stored && stored.account && stored.account.apiToken === "CT-TOK", "el apiToken vive SOLO en el store local");
  check(stored && stored.claimUrl === "https://dash/claim?token=fake", "el store guarda claimUrl para el humano");

  // --- 2. reuse: mismo sid redeploya sin nuevo PoW ---------------------------
  const challengeCallsAfterFirst = fake.state.challengeCalls;
  const again = await tools.create_preview({ files: APP, main: "app.js", sid: created.sid });
  check(again.sid === created.sid && again.ok === true, "reuse con sid");
  check(fake.state.challengeCalls === challengeCallsAfterFirst, "reuse SIN nuevo challenge (el token vive en el store)");

  // --- 3. preview_status: local + claimed de la plataforma -------------------
  const st = await tools.preview_status({ sid: created.sid });
  check(st.ok === true && st.claimed && st.claimed.email === "humano@test", "status con claimed de la plataforma");
  check(st.expiresAt === "2026-09-27T21:00:00Z", "status refleja el TTL extendido por el claim");

  // --- 4. claim_preview: inicia el claim con paylink absoluto ----------------
  const claim = await tools.claim_preview({ sid: created.sid, email: "humano@test" });
  check(claim.ok === true && claim.payment_url.startsWith(PLATFORM + "/claim/"), "claim_preview -> paylink absolutizado");
  check(claim.price === 19 && claim.days === 30, "claim con precio y dias");

  // --- 5. discard: borra el script (con token del store) + registro ----------
  const delBefore = fake.state.calls.length;
  const del = await tools.discard_preview({ sid: created.sid });
  check(del.ok === true && del.deleted === true, "discard -> deleted");
  check(store.get(created.sid) === null, "discard borra la sesion del store");
  const hadDelete = fake.state.calls.slice(delBefore).some((c) => c.method === "DELETE" && c.headers.Authorization === "Bearer CT-TOK");
  check(hadDelete, "el DELETE del script va con el Bearer del token LOCAL");

  const ok = CHECKS.every(Boolean);
  console.log(`ORACULO console-tools: ${ok ? "PASS" : "FALLO"} (${CHECKS.filter(Boolean).length}/${CHECKS.length})`);
  process.exit(ok ? 0 : 1);
}

const APP_JS = `export default{async fetch(){return new Response("<h1>tienda</h1>",{headers:{"content-type":"text/html"}});}}`;

main().catch((e) => { console.error("ORACULO ERROR:", e.message); process.exit(1); });