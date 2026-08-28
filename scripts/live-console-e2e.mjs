// scripts/live-console-e2e.mjs — e2e EN VIVO del flujo de la consola:
// ejecuta los MODULOS REALES verificados por KDD (deploy-preview-web y su
// cadena) contra produccion, con el fetch redirigido al proxy /console/cf
// del studio — exactamente lo que corre en el navegador de la consola.
// Uso: node scripts/live-console-e2e.mjs
import { deployPreviewWeb } from "../web/deploy-preview-web.mjs";

const ORIGIN = process.env.CONSOLE_ORIGIN || "https://llmstxt-studio.rckflr.workers.dev";
// apiBase: el relay de provisioning (CF_RELAY del round): p.ej.
//   https://<relay>.deno.dev/client/v4   (deno deploy)
//   http://localhost:8000/client/v4      (relay local)
const API_BASE = process.env.CONSOLE_API_BASE || ORIGIN + "/console/cf";

const APP_FILES = [{
  name: "app.js",
  content:
    "export default {\n" +
    "  async fetch(request) {\n" +
    "    return new Response('<!doctype html><meta charset=\"utf-8\"><body style=\"font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#0d1117;color:#e6edf3\"><div><h1>Deploy desde el navegador 🎉</h1><p>Cuenta temporal de Cloudflare + deploy multipart + registro en la plataforma — sin cuenta, sin wrangler.</p></div>',{headers:{\"content-type\":\"text/html; charset=utf-8\"}});\n" +
    "  },\n" +
    "};",
}];

const t0 = Date.now();
const out = await deployPreviewWeb(globalThis.fetch, {
  platformOrigin: ORIGIN,
  apiBase: API_BASE,
  files: APP_FILES,
  main: "app.js",
});
const secs = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`ok:           ${out.ok}`);
console.log(`sid:          ${out.sid}`);
console.log(`scriptName:   ${out.scriptName}`);
console.log(`previewUrl:   ${out.previewUrl}`);
console.log(`claimUrl:     ${out.claimUrl}`);
console.log(`expiresAt:    ${out.expiresAt}`);
console.log(`registered:   ${out.registered}`);
console.log(`apiToken:     ${out.account.apiToken ? "PRESENTE en el store local (correcto)" : "FALTA"}`);
console.log(`tiempo total: ${secs}s (challenge+PoW+create+deploy+enable+register, k=1000 g=2000)`);

// el resultado VISIBLE AL AGENTE nunca incluye el apiToken: la consola lo
// deja dentro de este objeto (store local), el resto del objeto no lo contiene
const visible = { ok: out.ok, sid: out.sid, scriptName: out.scriptName, previewUrl: out.previewUrl, claimUrl: out.claimUrl, expiresAt: out.expiresAt, registered: out.registered };
if (JSON.stringify(visible).includes(out.account.apiToken)) {
  console.error("FALLO: el apiToken aparecio en el resultado visible");
  process.exit(1);
}

// verificacion del deploy: el preview responde en publico (el subdomain recien
// creado tarda unos segundos en propagarse: reintentos con espera)
let res = null;
let text = "";
for (let i = 0; i < 6; i++) {
  await new Promise((r) => setTimeout(r, 4000));
  res = await fetch(out.previewUrl);
  text = await res.text();
  if (res.status === 200) break;
  console.log(`  preview HTTP ${res.status} — reintento ${i + 1}/6 (propagacion del subdomain)…`);
}
console.log(`preview HTTP: ${res.status} — contenido: ${text.includes("desplegada") || text.includes("Hola") ? "ok" : text.slice(0, 80)}`);

// verificacion del registro: la plataforma conoce la sesion (GET /preview?sid=)
const st = await (await fetch(ORIGIN + "/preview?sid=" + encodeURIComponent(out.sid))).json();
console.log(`plataforma:   preview registrado=${Boolean(st.scriptName)} claimed=${Boolean(st.claimed)} expiresAt=${st.expiresAt}`);

if (out.ok && res.status === 200 && out.registered) {
  console.log("LIVE CONSOLE E2E: PASS");
  process.exit(0);
}
console.error("LIVE CONSOLE E2E: FALLO");
process.exit(1);