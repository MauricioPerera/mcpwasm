// live-claim-e2e.mjs — E2E EN VIVO del claim comercial del studio:
// create_preview (cuenta temporal REAL) -> claim_preview -> paylink -> pago
// (simulado via API) -> preview_status refleja claimed + TTL extendido.
// Uso: node scripts/live-claim-e2e.mjs  (descarta la sesion al final)
import { spawn } from "node:child_process";

const ORIGIN = "https://llmstxt-studio.rckflr.workers.dev";
const EMAIL = "claim-live-" + Date.now() + "@example.com";
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
const toolOut = (res) => {
  const c = res.result?.content?.find((x) => x.type === "text");
  try { return JSON.parse(c.text); } catch { return { error: c?.text }; }
};

const proc = spawn(process.execPath, ["bin/mcpwasm-local.mjs", ORIGIN, "--previews"], { stdio: ["pipe", "pipe", "pipe"] });
let errTxt = "";
proc.stderr.on("data", (d) => { errTxt += String(d); });

try {
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("runtime no listo: " + errTxt.slice(-300))), 90000);
    proc.stderr.on("data", (d) => { if (String(d).includes("listo:")) { clearTimeout(t); resolve(); } });
  });
  console.log("[live] runtime listo contra " + ORIGIN);
  check(errTxt.includes("4 skill(s) verificadas"), "4 skills verificadas contra el ORIGIN REAL (hashes remotos)");

  console.log("[live] create_preview (PoW real contra Cloudflare)");
  const t0 = Date.now();
  const call1 = await rpc(proc, 2, "tools/call", {
    name: "create_preview",
    arguments: { files: [{ name: "app.js", content: `export default{async fetch(){return new Response("<h1>claim demo</h1>",{headers:{"content-type":"text/html"}});}}` }], main: "app.js" },
  });
  const out = toolOut(call1);
  check(out.ok === true, `create_preview ok (${((Date.now() - t0) / 1000).toFixed(1)}s) ${out.error ? "— " + out.error : ""}`);
  check(Boolean(out.sid) && Boolean(out.previewUrl), `sid + previewUrl: ${out.previewUrl}`);
  const sid = out.sid;

  let res = null, body = "";
  try { res = await fetch(out.previewUrl); body = await res.text(); } catch { res = null; }
  check(res && res.status === 200 && body.includes("claim demo"), `previewUrl responde HTTP ${res ? res.status : "?"}`);

  console.log("[live] claim_preview (la tool gratis del agente)");
  const call2 = await rpc(proc, 3, "tools/call", { name: "claim_preview", arguments: { sid, email: EMAIL } });
  const claim = toolOut(call2);
  check(claim.ok === true && typeof claim.payment_url === "string" && claim.payment_url.includes("/claim/"), `claim start -> paylink ${claim.payment_url || claim.error || ""}`);
  check(claim.price === 19 && claim.days === 30, "precio $19 / 30 dias en la respuesta");

  const pt = claim.payment_url.split("pt=")[1];
  const page = await fetch(claim.payment_url);
  const html = await page.text();
  check(page.status === 200 && html.includes("Reclamar"), "paylink page HTTP 200 con boton Reclamar (el HUMANO paga aqui)");

  console.log("[live] pago simulado -> confirmacion (lo que hace el boton del paylink)");
  const confirm = await fetch(ORIGIN + "/api/claim/" + sid, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payment_token: pt }),
  });
  const c = await confirm.json();
  check(confirm.status === 200 && c.ok === true && c.claimed?.email === EMAIL, `pago -> deploy RECLAMADO por ${c.claimed?.email}`);
  check(Date.parse(c.expiresAt) > Date.now() + 29 * 86400000, `TTL extendido hasta ${c.expiresAt}`);

  console.log("[live] preview_status refleja el claim");
  const call3 = await rpc(proc, 4, "tools/call", { name: "preview_status", arguments: { sid } });
  const st = toolOut(call3);
  check(st.claimed?.email === EMAIL, "estado: claimed con el email del dueno");

  console.log("[live] limpieza: descartamos la sesion de prueba (el claim quedo verificado)");
  const call4 = await rpc(proc, 5, "tools/call", { name: "discard_preview", arguments: { sid } });
  const d = toolOut(call4);
  check(d.deleted === true, "sesion de prueba descartada");
} finally {
  try { proc.kill(); } catch {}
}

const ok = CHECKS.every(Boolean);
console.log(`LIVE CLAIM E2E: ${ok ? "PASS" : "FALLO"} (${CHECKS.filter(Boolean).length}/${CHECKS.length})`);
process.exit(ok ? 0 : 1);