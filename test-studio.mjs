// test-studio.mjs — Suite hermetica de la plataforma llmstxt-studio.
// Verifica: llms.txt con hashes correctos (tool_sha256 == bytes servidos),
// las tools servibles, el flujo completo /preview con sid explicito (el modo
// agente: sin cookies), reuso de sesion, descarte por POST, y el aislamiento
// multi-tenant. La API de Cloudflare es fake (outboundService de Miniflare).

import { Miniflare } from "miniflare";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const CHECKS = [];
const check = (ok, label) => { CHECKS.push(ok); console.log(`  ${ok ? "ok" : "FALLO"}: ${label}`); };

// --- API fake de Cloudflare ---------------------------------------------------
const challenges = new Map();
let creations = 0;
let deploys = 0;
let scriptDeletes = 0;

function fakeCloudflare(req) {
  const url = new URL(req.url);
  const p = url.pathname;

  if (req.method === "POST" && p.endsWith("/provisioning/previews/challenge")) {
    const seed = Buffer.from(Array.from({ length: 16 }, (_, i) => (i * 31 + creations) % 256));
    const token = "ct-" + creations + "-" + Math.random().toString(36).slice(2, 8);
    challenges.set(token, seed);
    return jsonResponse(200, { result: { challengeToken: token, seed: seed.toString("base64url"), k: 2, g: 3 } });
  }

  if (req.method === "POST" && p.endsWith("/provisioning/previews")) {
    return req.json().then((body) => {
      const seed = challenges.get(body.challengeToken);
      if (!seed) return jsonResponse(403, { error: "challenge desconocido" });
      // verificar PoW con crypto nativo (k=2, g=3 igual que el fake challenge)
      let h = createHash("sha256").update(seed).digest();
      const expected = [new Uint8Array(h)];
      for (let j = 0; j < 2; j++) {
        for (let i = 0; i < 3; i++) h = createHash("sha256").update(h).digest();
        expected.push(new Uint8Array(h));
      }
      const got = Buffer.from(body?.solution?.checkpoints || "", "base64");
      const okPow = expected.every((cp, i) => got.subarray(i * 32, (i + 1) * 32).equals(Buffer.from(cp)));
      if (!okPow) return jsonResponse(403, { error: "PoW invalido" });
      creations++;
      const now = Date.now();
      return jsonResponse(201, {
        result: {
          account: { id: "acc-" + creations, name: "Studio Fake " + creations, apiToken: "STUDIO-TOKEN-" + creations, expiresAt: new Date(now + 3600000).toISOString() },
          claim: { url: "https://dash.cloudflare.com/claim-preview?claimToken=fake-" + creations, expiresAt: new Date(now + 3600000).toISOString() },
        },
      });
    });
  }

  const scriptM = p.match(/\/accounts\/[^/]+\/workers\/scripts\/([^/]+)$/);
  if (scriptM) {
    const [, name] = scriptM;
    if (req.method === "PUT") { deploys++; return jsonResponse(200, { result: { id: name } }); }
    if (req.method === "DELETE") { scriptDeletes++; return jsonResponse(200, { result: { id: name } }); }
    if (req.method === "POST") return jsonResponse(200, { result: { enabled: true } });
  }
  if (req.method === "GET" && p.match(/\/workers\/subdomain$/)) {
    return jsonResponse(200, { result: { subdomain: "studio-fake" } });
  }
  return jsonResponse(404, { error: "fake: ruta desconocida " + p });
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// --- Miniflare ------------------------------------------------------------------
const mf = new Miniflare({
  scriptPath: fileURLToPath(new URL("./studio/worker.mjs", import.meta.url)),
  modules: true,
  compatibilityDate: "2026-06-01",
  compatibilityFlags: ["nodejs_compat"],
  bindings: { CF_API_BASE: "http://fake-cf.internal/client/v4" },
  kvNamespaces: { SESSIONS: "STUDIO" },
  outboundService: (req) => fakeCloudflare(req),
});

async function call(path, opts = {}) {
  const res = await mf.dispatchFetch("http://localhost" + path, opts);
  let body = null;
  try { body = await res.json(); } catch { body = await res.text(); }
  return { status: res.status, body };
}

const APP = [{
  name: "app.js",
  content: `export default { async fetch() { return new Response("<h1>hola studio</h1>", { headers: {"content-type":"text/html"} }); } }`,
}];

async function main() {
  console.log("[1] landing y descubrimiento");
  const root = await mf.dispatchFetch("http://localhost/");
  const html = await root.text();
  check(root.status === 200 && root.headers.get("content-type").includes("text/html"), "GET / -> landing HTML");
  check(html.includes("create_preview") && html.includes("claim"), "landing menciona las tools y el claim");
  const llms = await (await mf.dispatchFetch("http://localhost/llms.txt")).text();
  check(llms.includes("## Skills"), "llms.txt con seccion Skills");
  // formato v0.4: cada linea con tool + tool_sha256, y el hash == bytes servidos
  const lines = llms.split("\n").filter((l) => l.includes("<!-- skill:"));
  check(lines.length === 4, `4 skills en llms.txt (${lines.length})`);
  for (const line of lines) {
    const m = line.match(/^- \[([^\]]+)\]\(([^)]+)\):.*"tool":"([^"]+)","tool_sha256":"([a-f0-9]{64})"/);
    check(Boolean(m), `linea v0.4 parseable: ${m ? m[1] : "?"}`);
    if (m) {
      const toolRes = await mf.dispatchFetch("http://localhost" + m[3]);
      const toolJs = await toolRes.text();
      const actual = createHash("sha256").update(Buffer.from(toolJs, "utf8")).digest("hex");
      check(actual === m[4], `${m[1]}: tool_sha256 == bytes servidos`);
      check(toolJs.includes("registerTool"), `${m[1]}: tool.js ejecutable`);
    }
  }

  console.log("[1b] consola del navegador (la pagina que sirve el studio)");
  const conRes = await mf.dispatchFetch("http://localhost/console");
  const conHtml = await conRes.text();
  check(conRes.status === 200 && conHtml.includes("console-main.mjs"), "GET /console -> HTML de la consola");
  check(conHtml.includes("Probar con demo app"), "consola con boton demo (path sin agente)");
  const mainRes = await mf.dispatchFetch("http://localhost/console/console-main.mjs");
  const mainJs = await mainRes.text();
  check(mainRes.status === 200 && mainRes.headers.get("content-type").includes("text/javascript"), "console-main.mjs se sirve como JS de modulo");
  check(mainJs.includes("makeConsoleTools") && mainJs.includes("claim_preview"), "el glue expone las 4 tools");
  for (const mod of ["solve-pow-web.mjs", "ephemeral-account-web.mjs", "deploy-app-web.mjs", "deploy-preview-web.mjs", "console-tools.mjs"]) {
    const res = await mf.dispatchFetch("http://localhost/console/" + mod);
    const src = await res.text();
    check(res.status === 200 && res.headers.get("content-type").includes("text/javascript"), `modulo ${mod} servido como JS`);
    // uso real de APIs de Node (no menciones en comentarios): Buffer., from "node:", process.
    check(!/\bBuffer\s*\./.test(src) && !/\bfrom\s+["']node:/.test(src) && !/\brequire\s*\(/.test(src), `modulo ${mod} libre de APIs de Node (browser-safe)`);
  }

  console.log("[2] flujo agente: create_preview SIN cookies (sid explicito)");
  const r1 = await call("/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files: APP, main: "app.js" }),
  });
  check(r1.status === 200, `create HTTP ${r1.status}`);
  check(Boolean(r1.body?.sid), `sid devuelto en el body: ${r1.body?.sid?.slice(0, 8)}...`);
  check(Boolean(r1.body?.previewUrl) && Boolean(r1.body?.claimUrl), "previewUrl + claimUrl presentes");
  check(!JSON.stringify(r1.body).includes("STUDIO-TOKEN"), "el apiToken NUNCA sale del worker");
  const sid = r1.body.sid;
  const expectedPreview = `https://mcpwasm-preview-${sid.slice(0, 8)}.studio-fake.workers.dev`;
  check(r1.body.previewUrl === expectedPreview, "previewUrl derivada del sid");

  console.log("[3] reuso: mismo sid redeploya sobre la misma cuenta (sin nuevo PoW)");
  const r2 = await call("/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files: APP, main: "app.js", sid }),
  });
  check(r2.status === 200 && r2.body?.created === false && r2.body?.sid === sid, "reuso con sid");
  check(creations === 1, `cuentas creadas: ${creations} (el PoW se pago 1 vez)`);
  check(deploys === 2, `deploys acumulados: ${deploys}`);

  console.log("[4] estado y descarte por POST (fetchOrigin no permite DELETE)");
  const r3 = await call("/preview?sid=" + sid);
  check(r3.status === 200 && r3.body?.msToExpiry > 0, "GET /preview?sid= -> estado");
  const r4 = await call("/preview/discard?sid=" + sid, { method: "POST", body: "{}" });
  check(r4.status === 200 && r4.body?.deleted === true, "POST /preview/discard -> borrado");
  check(scriptDeletes === 1, "la API fake vio el DELETE del script");
  const r5 = await call("/preview?sid=" + sid);
  check(r5.status === 404, "sesion descartada -> 404");

  console.log("[5] aislamiento y validaciones");
  const r6 = await call("/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files: [{ name: "../x.js", content: "evil" }], main: "../x.js" }),
  });
  check(r6.status === 400, "traversal en files -> 400");
  const r7 = await call("/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files: APP, main: "otro.js" }),
  });
  check(r7.status === 400, "main fuera de files -> 400");
  const r8 = await call("/preview/discard?sid=inexistente", { method: "POST", body: "{}" });
  check(r8.status === 404, "discard de sesion inexistente -> 404");

  console.log("[6] claim comercial: paylink -> pago (simulado) -> TTL extendido");
  const rc1 = await call("/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files: APP, main: "app.js" }),
  });
  const sid2 = rc1.body.sid;
  check(rc1.status === 200 && Boolean(sid2), "nueva preview para el flujo de claim");
  const noEmail = await call("/preview/claim?sid=" + sid2, { method: "POST", body: "{}" });
  check(noEmail.status === 400, "claim sin email -> 400");
  const c1 = await call("/preview/claim?sid=" + sid2, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "owner@example.com" }),
  });
  check(c1.status === 200 && c1.body?.ok === true && typeof c1.body?.payment_url === "string" && c1.body.payment_url.startsWith("/claim/"), "claim start -> paylink con pt");
  const badPage = await mf.dispatchFetch("http://localhost/claim/" + sid2 + "?pt=falso");
  check(badPage.status === 403, "pagina de claim con pt falso -> 403");
  const page = await mf.dispatchFetch("http://localhost" + c1.body.payment_url);
  const pageHtml = await page.text();
  check(page.status === 200 && pageHtml.includes("Reclamar"), "GET /claim/:sid -> pagina del paylink");
  const wrongPay = await call("/api/claim/" + sid2, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payment_token: "falso" }) });
  check(wrongPay.status === 403, "confirmar con payment_token falso -> 403");
  const confirm = await call("/api/claim/" + sid2, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payment_token: c1.body.payment_url.split("pt=")[1] }) });
  check(confirm.status === 200 && confirm.body?.ok === true && confirm.body?.claimed?.email === "owner@example.com", "pago -> deploy reclamado");
  const again = await call("/api/claim/" + sid2, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payment_token: c1.body.payment_url.split("pt=")[1] }) });
  check(again.status === 200 && again.body?.already === true, "claim repetido -> already:true (idempotente)");
  const st = await call("/preview?sid=" + sid2);
  check(st.body?.claimed?.email === "owner@example.com", "preview_status refleja claimed con email");
  check(Date.parse(st.body.expiresAt) > Date.now() + 29 * 86400000, "TTL extendido (~30 dias)");

  const ok = CHECKS.every(Boolean);
  console.log(`TEST STUDIO: ${ok ? "PASS" : "FALLO"} (${CHECKS.filter(Boolean).length}/${CHECKS.length})`);
  await mf.dispose();
  process.exit(ok ? 0 : 1);
}

main().catch(async (e) => {
  console.error("TEST STUDIO: ERROR —", e.message);
  try { await mf.dispose(); } catch {}
  process.exit(1);
});