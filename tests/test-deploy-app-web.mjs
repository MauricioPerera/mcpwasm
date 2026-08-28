// tests/test-deploy-app-web.mjs — ORACULO del contrato deploy-app-web.
// Verifica el deploy de archivos a la cuenta temporal desde el navegador:
// PUT multipart al script, GET subdomain, POST enable — fetch inyectable.
// Uso: node tests/test-deploy-app-web.mjs
import { deployAppWeb } from "../web/deploy-app-web.mjs";

const CHECKS = [];
const check = (ok, label) => { CHECKS.push(ok); console.log(`  ${ok ? "ok" : "FALLO"}: ${label}`); };

const ACCOUNT = { id: "acc-1", apiToken: "TOK-1" };
const SCRIPT = "mcpwasm-preview-deadbeef";
const API = "https://api.cf/v4";
const APP = [{
  name: "app.js",
  content: `export default{async fetch(){return new Response("<h1>hola</h1>",{headers:{"content-type":"text/html"}});}}`,
}];

// fake fetch: graba cada llamada y responde por patron de URL
function makeFake() {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const entry = { url: String(url), method: init.method || "GET", headers: init.headers || {}, body: init.body };
    calls.push(entry);
    if (entry.method === "PUT" && entry.url === `${API}/accounts/${ACCOUNT.id}/workers/scripts/${SCRIPT}`) {
      return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" };
    }
    if (entry.url === `${API}/accounts/${ACCOUNT.id}/workers/subdomain`) {
      return { ok: true, status: 200, json: async () => ({ result: { subdomain: "fake-sub" } }), text: async () => "{}" };
    }
    if (entry.method === "POST" && entry.url.endsWith("/subdomain")) {
      return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" };
    }
    return { ok: false, status: 404, text: async () => "fake 404", json: async () => ({}) };
  };
  return { fetchImpl, calls };
}

async function main() {
  // --- 1. deploy feliz -------------------------------------------------------
  const f = makeFake();
  const out = await deployAppWeb(f.fetchImpl, {
    apiBase: API, accountId: ACCOUNT.id, apiToken: ACCOUNT.apiToken,
    scriptName: SCRIPT, files: APP, main: "app.js",
  });
  check(out.deployed === true, "deployAppWeb -> {deployed:true}");
  check(out.subdomain === "fake-sub", "devuelve el subdomain");
  check(out.previewUrl === `https://${SCRIPT}.fake-sub.workers.dev`, `previewUrl derivada (${out.previewUrl})`);
  check(f.calls.length === 3, `3 requests: PUT script, GET subdomain, POST enable (${f.calls.length})`);

  const put = f.calls.find((c) => c.method === "PUT");
  check(Boolean(put) && put.url === `${API}/accounts/${ACCOUNT.id}/workers/scripts/${SCRIPT}`, "PUT contra /accounts/:id/workers/scripts/:name");
  check(put.headers.Authorization === `Bearer ${ACCOUNT.apiToken}`, "Authorization: Bearer <apiToken de la cuenta temporal>");
  check(put.body instanceof FormData, "el body del PUT es FormData (multipart)");
  const metaRaw = put.body.get("metadata");
  const meta = JSON.parse(await metaRaw.text());
  check(meta.main_module === "app.js", "metadata.main_module == main");
  check(Array.isArray(meta.rules) && meta.rules.some((r) => r.type === "CompiledWasm"), "metadata.rules con CompiledWasm");
  const appBlob = put.body.get("app.js");
  check(Boolean(appBlob), "el archivo app.js viaja en el form");
  const appText = await appBlob.text();
  check(appText.includes("hola"), "el contenido del archivo viaja intacto");

  const enable = f.calls.find((c) => c.method === "POST" && c.url.endsWith("/subdomain"));
  check(Boolean(enable), "POST enable del subdomain");
  const enableText = enable ? await enable.body.text() : "";
  check(enableText.includes('"enabled"') && enableText.includes("true"), "enable body {enabled:true}");

  // --- 2. .wasm viaja como application/wasm ---------------------------------
  const wasmCalls = [];
  const fake2 = async (url, init = {}) => {
    wasmCalls.push({ url: String(url), method: init.method || "GET", body: init.body, headers: init.headers || {} });
    return { ok: true, status: 200, json: async () => ({ result: { subdomain: "fake-sub" } }), text: async () => "{}" };
  };
  await deployAppWeb(fake2, {
    apiBase: API, accountId: ACCOUNT.id, apiToken: ACCOUNT.apiToken, scriptName: SCRIPT,
    main: "engine.wasm", files: [{ name: "engine.wasm", content: "WASM-BYTES" }],
  });
  const wasmPut = wasmCalls.find((c) => c.method === "PUT");
  check(Boolean(wasmPut), "deploy de .wasm: PUT emitido");
  const wasmBlob = wasmPut.body instanceof FormData ? wasmPut.body.get("engine.wasm") : null;
  check(Boolean(wasmBlob) && wasmBlob.type === "application/wasm", "los .wasm viajan con content-type application/wasm");

  // --- 3. error controlado ----------------------------------------------------
  let threw = "";
  const failing = async (url, init = {}) => ({ ok: false, status: 403, text: async () => "forbidden", json: async () => ({}) });
  try {
    await deployAppWeb(failing, {
      apiBase: API, accountId: ACCOUNT.id, apiToken: ACCOUNT.apiToken,
      scriptName: SCRIPT, files: APP, main: "app.js",
    });
  } catch (e) { threw = e.message; }
  check(threw.includes("403"), `PUT 403 -> throw con status (${threw})`);

  const ok = CHECKS.every(Boolean);
  console.log(`ORACULO deploy-app-web: ${ok ? "PASS" : "FALLO"} (${CHECKS.filter(Boolean).length}/${CHECKS.length})`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error("ORACULO ERROR:", e.message); process.exit(1); });