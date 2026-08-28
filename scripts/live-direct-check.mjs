// scripts/live-direct-check.mjs — prueba el flujo DIRECTO (sin proxy) con los
// modulos reales: si aqui funciona y via proxy no, el problema es del proxy.
import { deployPreviewWeb } from "../web/deploy-preview-web.mjs";

const t0 = Date.now();
try {
  const out = await deployPreviewWeb(globalThis.fetch, {
    platformOrigin: "https://llmstxt-studio.rckflr.workers.dev",
    apiBase: "https://api.cloudflare.com/client/v4",
    files: [{ name: "app.js", content: "export default{async fetch(){return new Response('<h1>browser e2e</h1>');}}" }],
    main: "app.js",
  });
  console.log("ok:", out.ok, "sid:", out.sid.slice(0, 8), "preview:", out.previewUrl);
  console.log("tiempo:", ((Date.now() - t0) / 1000).toFixed(1) + "s", "— registro plataforma:", out.registered);
  const res = await fetch(out.previewUrl);
  console.log("preview HTTP:", res.status);
  process.exit(out.ok && res.status === 200 ? 0 : 1);
} catch (e) {
  console.error("FALLO:", (e && e.message ? e.message : String(e)).slice(0, 300));
  process.exit(1);
}