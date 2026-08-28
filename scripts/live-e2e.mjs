// live-e2e.mjs — E2E EN VIVO: runtime local real contra el studio desplegado,
// creando una cuenta temporal REAL de Cloudflare con la tool del sandbox.
// Uso: node live-e2e.mjs  (limpia su sesion al final con discard_preview)
import { spawn } from "node:child_process";

const ORIGIN = "https://llmstxt-studio.rckflr.workers.dev";
const CHECKS = [];
const check = (ok, label) => { CHECKS.push(ok); console.log(`  ${ok ? "ok" : "FALLO"}: ${label}`); };

function rpc(proc, id, method, params, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    const timer = setTimeout(() => reject(new Error("timeout " + method)), timeoutMs);
    let buf = "";
    const onLine = (line) => {
      try {
        const obj = JSON.parse(line);
        if (obj.id === id) { clearTimeout(timer); resolve(obj); }
      } catch { /* partial */ }
    };
    proc.stdout.on("data", (d) => { buf += d; const lines = buf.split("\n"); buf = lines.pop(); lines.forEach(onLine); });
    proc.stdin.write(msg);
  });
}

const proc = spawn(process.execPath, [
  "bin/mcpwasm-local.mjs", ORIGIN, "--previews",
], { stdio: ["pipe", "pipe", "pipe"] });
let errTxt = "";
proc.stderr.on("data", (d) => { errTxt += d; });

try {
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("runtime no listo: " + errTxt.slice(-300))), 90000);
    proc.stderr.on("data", (d) => { if (String(d).includes("listo:")) { clearTimeout(t); resolve(); } });
  });
  console.log("[live] runtime listo contra " + ORIGIN);
  check(errTxt.includes("previews: capability inyectada"), "capability inyectada");
  check(errTxt.includes("3 skill(s) verificadas"), "3 skills verificadas contra el ORIGIN REAL (hashes remotos)");

  await rpc(proc, 1, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "studio-live", version: "1.0.0" } });

  console.log("[live] tools/call create_preview (PoW real contra Cloudflare, ~2s con crypto nativo)");
  const t0 = Date.now();
  const call = await rpc(proc, 2, "tools/call", {
    name: "create_preview",
    arguments: {
      files: [{
        name: "app.js",
        content: `const page = "<!doctype html><html><head><meta charset=utf-8><title>Hecho por un agente</title><style>body{font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:linear-gradient(135deg,#0b62a4,#14181f);color:#fff}div{text-align:center}small{opacity:.75}</style></head><body><div><h1>Construido y desplegado por un agente</h1><p>mcpwasm + llmstxt-studio + una cuenta temporal de Cloudflare</p><small>Reclama esta app en 60 min o muere.</small></div></body></html>";export default{async fetch(){return new Response(page,{headers:{"content-type":"text/html; charset=utf-8"}})}}`,
      }],
      main: "app.js",
    },
  });
  const out = call.result?.structuredContent?.result ?? call.result?.structuredContent ?? {};
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  check(out.ok === true, `create_preview ok (${dt}s) ${out.error ? "— " + out.error : ""}`);
  check(Boolean(out.previewUrl), `previewUrl: ${out.previewUrl}`);
  check(Boolean(out.claimUrl), `claimUrl: ${out.claimUrl}`);
  // el claimUrl CONTIENE un claimToken (para el humano) — eso no es el apiToken
  const flat = JSON.stringify(out);
  check(!("apiToken" in out) && !flat.includes("apiToken") && !flat.includes("Authorization"), "sin apiToken en la respuesta MCP");
  console.log(`  cuenta: ${out.accountName} | expira: ${out.expiresAt}`);

  // workers.dev puede tardar unos segundos en enrutar el script recien subido
  let res = null, body = "";
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    try { res = await fetch(out.previewUrl); body = await res.text(); } catch { res = null; }
    if (res && res.status === 200) break;
  }
  check(res && res.status === 200 && body.includes("agente"), `previewUrl responde HTTP ${res ? res.status : "?"} con la app REAL`);

  console.log("[live] reuso con sid (redeploy rapido, sin PoW)");
  const call2 = await rpc(proc, 3, "tools/call", {
    name: "create_preview",
    arguments: { files: [{ name: "app.js", content: `export default{async fetch(){return new Response("v2 - redeploy con sid")}}` }], main: "app.js", sid: out.sid },
  });
  const out2 = call2.result?.structuredContent?.result ?? call2.result?.structuredContent ?? {};
  if (out2.created !== false) console.log("  [debug reuso]:", JSON.stringify(call2.result).slice(0, 600));
  check(out2.created === false, "redeploy sobre la misma cuenta (created=false)");

  console.log("[live] discard (limpieza de la demo)");
  const call3 = await rpc(proc, 4, "tools/call", { name: "discard_preview", arguments: { sid: out.sid } });
  const out3 = call3.result?.structuredContent?.result ?? call3.result?.structuredContent ?? {};
  if (out3.deleted !== true) console.log("  [debug discard]:", JSON.stringify(call3.result).slice(0, 600));
  check(out3.deleted === true, "script borrado de la cuenta temporal");
} finally {
  proc.kill();
}

const ok = CHECKS.every(Boolean);
console.log(`LIVE E2E: ${ok ? "PASS" : "FALLO"} (${CHECKS.filter(Boolean).length}/${CHECKS.length})`);
process.exit(ok ? 0 : 1);