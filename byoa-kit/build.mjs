// build.mjs — Genera el worker del kit BYOA a partir de kit.config.json + content/.
// Patron identico a shop/build.mjs: hashes calculados del contenido REAL, worker
// autogenerado (no editar a mano). El publisher edita content/ y este build.

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const contentDir = join(__dirname, "content");
const read = (f) => readFileSync(join(contentDir, f), "utf8");

const config = JSON.parse(readFileSync(join(__dirname, "kit.config.json"), "utf8"));
const SKILLS = config.skills;

// Attestations (opcional): content/attestations.json se sirve en well-known.
const attestationsPath = join(contentDir, "attestations.json");
const attestationsJson = existsSync(attestationsPath) ? readFileSync(attestationsPath, "utf8").trim() : null;

const skills = {};
for (const name of SKILLS) {
  const tool = read(`${name}.tool.js`);
  const skillMd = read(`${name}.SKILL.md`);
  skills[name] = {
    tool,
    skillMd,
    hash: createHash("sha256").update(Buffer.from(tool, "utf8")).digest("hex"),
    skillHash: createHash("sha256").update(Buffer.from(skillMd, "utf8")).digest("hex"),
  };
}

const seed = JSON.parse(readFileSync(join(__dirname, "seed.json"), "utf8"));

// Monetizacion (opcional): kit.config.json -> monetize.enabled. Cuando esta
// activa, la tool de escritura (create_item) exige licencia de creador: el
// agente la compra con buy_creator_access, el HUMANO paga el paylink y recibe
// el token. Leer sigue siendo gratis.
const MON = config.monetize && config.monetize.enabled ? config.monetize : null;

// --- llms.txt (v0.4) -----------------------------------------------------------
const skillDescriptions = {
  list_items: `List ${config.entity.plural} (filter by text, limit 10). Returns live rows from D1.`,
  get_item: `Get full details of one ${config.entity.singular} by id. Returns {found:false} if unknown.`,
  create_item: MON
    ? `PAID TOOL: create a new ${config.entity.singular}. Requires a creator license token (buy with buy_creator_access — $${MON.price} for ${MON.uses} creations, ${MON.days} days). Without a valid token returns needs_payment with next steps.`
    : `Create a new ${config.entity.singular}. REAL-WORLD EFFECT: confirm name and price with the human first, then POST. Returns the created row with its id.`,
  buy_creator_access: MON ? `Start the purchase of a creator license ($${MON.price} for ${MON.uses} creations, ${MON.days} days): returns the paylink for the HUMAN to pay. After payment the human receives the license token for create_item. Free to call.` : undefined,
  check_license: MON ? `Check a creator license token: plan, uses left, expiry. Free.` : undefined,
};
const llmsTxt =
  `# ${config.name}\n\n` +
  `> ${config.description} Read tools are public; create_* is a real-world effect and always asks the human first. Static discovery with verified hashes: your agent verifies every tool before running it.\n\n` +
  `## Skills\n\n` +
  SKILLS.map((name) => {
    const title = skillDescriptions[name] || `Skill ${name}.`;
    return `- [${name}](/skills/${name}/SKILL.md): ${title} <!-- skill: {"version":"1.0.0","sha256":"${skills[name].skillHash}","tool":"/skills/${name}/tool.js","tool_sha256":"${skills[name].hash}"} -->\n`;
  }).join("");

// --- landing ---------------------------------------------------------------------
const docLinks = SKILLS.map(
  (name) => `      <li><code>${name}</code> — <a href="/skills/${name}/SKILL.md">SKILL.md</a> · <a href="/skills/${name}/tool.js">tool.js</a></li>`
).join("\n");
const seedRows = seed.map(
  (p) => `      <tr><td>${p.id ?? "-"}</td><td>${p.name}</td><td>$${Number(p.price).toFixed(2)}</td><td>${p.stock}</td></tr>`
).join("\n");
const landing =
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n` +
  `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
  `<title>${config.name} — BYOA platform</title>\n` +
  `<style>body{font-family:system-ui,sans-serif;max-width:52rem;margin:2rem auto;padding:0 1rem;line-height:1.55;color:#14181f;background:#fafbfc}code{background:#eef1f4;padding:.1rem .35rem;border-radius:4px;font-size:.92em}a{color:#0b62a4}h1{border-bottom:2px solid #e4e8ec;padding-bottom:.4rem}table{border-collapse:collapse;width:100%;margin:1rem 0}td,th{border:1px solid #e4e8ec;padding:.45rem .6rem;text-align:left;font-size:.95rem}th{background:#eef1f4}pre{background:#14181f;color:#d7e2ec;padding:.8rem 1rem;border-radius:8px;overflow-x:auto}footer{margin-top:2.5rem;color:#66707b;font-size:.9rem;border-top:1px solid #e4e8ec;padding-top:1rem}</style>\n` +
  `</head>\n<body>\n` +
  `<h1>${config.name}</h1>\n` +
  `<p>${config.description} Built with the <strong>BYOA kit</strong> on <a href="https://github.com/MauricioPerera/mcpwasm">mcpwasm</a>: static discovery with verified hashes, tools that run sandboxed on the consumer's machine, and the human holding the approval pen.</p>\n` +
  `<h2>Point your agent here</h2>\n` +
  `<pre>npx -y @rckflr/mcpwasm ${config.origin}</pre>\n` +
  `<h2>Skills</h2>\n<ul>\n${docLinks}\n  </ul>\n` +
  `<h2>Seed ${config.entity.plural}</h2>\n<table>\n      <tr><th>id</th><th>name</th><th>price</th><th>stock</th></tr>\n${seedRows}\n    </table>\n` +
  (MON
    ? `<h2>Sell here</h2>\n<p>Creating ${config.entity.plural} is the <strong>paid tool</strong>: your agent calls <code>buy_creator_access</code>, you pay the paylink (<strong>$${MON.price} / ${MON.uses} creations / ${MON.days} days</strong>), it lists ${config.entity.plural} with <code>create_item</code>. Browsing and reading are always free.</p>\n`
    : "") +
  `<footer>Generated by byoa-kit/build.mjs — do not edit the worker by hand.</footer>\n</body>\n</html>`;

// --- worker autogenerado ---------------------------------------------------------
const toolConstants = SKILLS.map(
  (name) => `const ${name.toUpperCase()}_TOOL_JS = ${JSON.stringify(skills[name].tool)};\n` +
    `const ${name.toUpperCase()}_SKILL_MD = ${JSON.stringify(skills[name].skillMd)};`
).join("\n");

const skillRoutes = SKILLS.map(
  (name) => `  if (path === "/skills/${name}/tool.js") return new Response(${name.toUpperCase()}_TOOL_JS, { headers: { "content-type": "application/javascript; charset=utf-8" } });\n` +
    `  if (path === "/skills/${name}/SKILL.md") return new Response(${name.toUpperCase()}_SKILL_MD, { headers: { "content-type": "text/markdown; charset=utf-8" } });`
).join("\n");

const attestationsRoute = attestationsJson
  ? "  if (path === \"/.well-known/agent-skills/attestations.json\") {\n" +
    "    return new Response(JSON.stringify(ATTESTATIONS), { headers: { \"content-type\": \"application/json; charset=utf-8\", \"cache-control\": \"no-store\" } });\n" +
    "  }\n\n"
  : "";

const licenseRoutes = MON
  ? `    if (path === "/api/licenses/purchase" && request.method === "POST") return await handleLicensePurchase(request, env);\n` +
    `    if (path === "/api/licenses/activate" && request.method === "POST") return await handleLicenseActivate(request, env);\n` +
    `    const licMatch = path.match(/^\\/api\\/license\\/([0-9a-fA-F-]+)$/);\n` +
    `    if (licMatch) return await handleLicenseGet(request, env, licMatch[1]);\n` +
    `    const buyMatch = path.match(/^\\/buy\\/([0-9a-fA-F-]+)$/);\n` +
    `    if (buyMatch) return await handleLicensePage(request, env, buyMatch[1], url.searchParams.get("pt") || "");\n`
  : "";

const worker =
  `// Autogenerado por byoa-kit/build.mjs — NO EDITAR A MANO.\n\n` +
  toolConstants + "\n\n" +
  `const LLMS_TXT = ${JSON.stringify(llmsTxt)};\n\n` +
  `const LANDING = ${JSON.stringify(landing)};\n\n` +
  (attestationsJson ? `const ATTESTATIONS = ${JSON.stringify(JSON.parse(attestationsJson))};\n\n` : "") +
  `function json(obj, status = 200) {\n` +
  `  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });\n` +
  `}\n\n` +
  `async function handleListItems(url, env) {\n` +
  `  const q = (url.searchParams.get("q") || "").trim().toLowerCase();\n` +
  `  const limitRaw = Number(url.searchParams.get("limit"));\n` +
  `  const limit = Number.isFinite(limitRaw) && limitRaw >= 1 && limitRaw <= 50 ? Math.floor(limitRaw) : 10;\n` +
  `  let sql = "SELECT id, name, description, price, stock FROM items";\n` +
  `  const params = [];\n` +
  `  if (q) { sql += " WHERE LOWER(name) LIKE LOWER(?) OR LOWER(description) LIKE LOWER(?)"; params.push("%" + q + "%", "%" + q + "%"); }\n` +
  `  sql += " ORDER BY id LIMIT ?"; params.push(limit);\n` +
  `  const { results } = await env.DB.prepare(sql).bind(...params).all();\n` +
  `  return json(results);\n` +
  `}\n\n` +
  `async function handleGetItem(id, env) {\n` +
  `  const item = await env.DB.prepare("SELECT id, name, description, price, stock FROM items WHERE id = ?").bind(id).first();\n` +
  `  if (!item) return json({ found: false }, 404);\n` +
  `  return json(Object.assign({ found: true }, item));\n` +
  `}\n\n` +
  (MON
    ? `const MON_CFG = ${JSON.stringify(MON)};\n\n` +
      `const handleCreateItem = ${handleCreateItemMon.toString()};\n\n` +
      `const licensePage = ${licensePage.toString()};\n\n` +
      `const handleLicensePage = ${handleLicensePage.toString()};\n\n` +
      `const handleLicensePurchase = ${handleLicensePurchase.toString()};\n\n` +
      `const handleLicenseActivate = ${handleLicenseActivate.toString()};\n\n` +
      `const handleLicenseGet = ${handleLicenseGet.toString()};\n\n`
    : `const handleCreateItem = ${handleCreateItemFree.toString()};\n\n`) +
  `export default {\n` +
  `  async fetch(request, env) {\n` +
  `    const url = new URL(request.url);\n` +
  `    const path = url.pathname;\n` +
  `    if (path === "/") return new Response(LANDING, { headers: { "content-type": "text/html; charset=utf-8" } });\n` +
  `    if (path === "/llms.txt") return new Response(LLMS_TXT, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });\n` +
  attestationsRoute +
  licenseRoutes +
  skillRoutes + "\n" +
  `    if (path === "/api/${config.entity.plural}" && request.method === "GET") return await handleListItems(url, env);\n` +
  `    if (path === "/api/${config.entity.plural}" && request.method === "POST") return await handleCreateItem(request, env);\n` +
  `    const idMatch = path.match(/^\\/api\\/${config.entity.plural}\\/(\\d+)$/);\n` +
  `    if (idMatch && request.method === "GET") return await handleGetItem(Number(idMatch[1]), env);\n` +
  `    if (path === "/") return new Response(LANDING, { headers: { "content-type": "text/html; charset=utf-8" } });\n` +
  `    return json({ error: "not found" }, 404);\n` +
  `  }\n` +
  `};\n`;

writeFileSync(join(__dirname, "worker.mjs"), worker, "utf8");
console.log(`Generated: byoa-kit/worker.mjs (${SKILLS.length} skills${MON ? ", monetize ON" : ""})`);
for (const name of SKILLS) console.log(`  ${name}: tool_sha256=${skills[name].hash.slice(0, 16)}...`);
if (!attestationsJson) console.log("  (sin attestations — corre scripts/attest.mjs sign para firmarlas)");

// --- funciones embebidas en el worker via .toString() (solo cuando MON) ---------
// Referencian MON_CFG (const embebida en el worker con price/uses/days del config).

function licensePage(lic) {
  const active = lic.status === "active";
  const body = active
    ? '<p class="ok">\u2705 Licencia ACTIVA \u2014 entrega este token a tu agente:</p>' +
      '<p><code id="tok" style="font-size:1.05rem;word-break:break-all">' + lic.token + "</code></p>" +
      '<p class="tag">' + lic.uses_left + " creaciones restantes \u00b7 vence " + String(lic.expires_at).slice(0, 10) + "</p>" +
      '<p class="tag">Guarda este token: la pagina no lo vuelve a mostrar tras cerrar (recupera con check_license).</p>'
    : '<button id="btn" onclick="pay()">Pagar $' + MON_CFG.price + " \u2014 creador: " + lic.uses_total + " creaciones / " + MON_CFG.days + " dias (simulado)</button>" +
      '<p id="msg"></p>' +
      '<p class="tag">SIMULACION: no se cobra dinero real. Al pagar se activa la licencia y la pagina muestra el token.</p>';
  return "<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\">" +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    "<title>Licencia de creador</title>" +
    "<style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem;line-height:1.6;color:#14181f;background:#fafbfc}code{background:#eef1f4;padding:.15rem .4rem;border-radius:4px;font-size:.95em;word-break:break-all}.box{border:1px solid #e4e8ec;border-radius:10px;padding:1.2rem;margin:1rem 0}button{background:#0b62a4;color:#fff;border:0;border-radius:8px;padding:.7rem 1.4rem;font-size:1rem;cursor:pointer;width:100%}button:disabled{opacity:.5}.ok{color:#0a7d32;font-weight:700}.tag{color:#66707b;font-size:.85rem}</style></head><body>" +
    "<div class=\"box\"><h2>Licencia de creador</h2>" +
    "<p>Acceso a <code>create_item</code>: " + lic.uses_total + " creaciones / " + MON_CFG.days + " dias.</p>" +
    body +
    "<script>function pay(){var b=document.getElementById('btn');if(!b)return;b.disabled=true;b.textContent='Procesando...';fetch('/api/licenses/activate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({payment_token:'" + lic.payment_token + "'})}).then(function(r){return r.json()}).then(function(j){if(j.ok){location.reload();}else{document.getElementById('msg').textContent='Error: ' + (j.error||'?');b.disabled=false;}});}<\/script>" +
    "</div></body></html>";
}

async function handleLicensePage(request, env, token, pt) {
  const lic = await env.DB.prepare("SELECT token, price, uses_total, uses_left, status, payment_token, expires_at FROM licenses WHERE token = ?").bind(token).first();
  if (!lic) return json({ error: "licencia no encontrada" }, 404);
  if (!lic.payment_token || pt !== lic.payment_token) return json({ error: "paylink invalido" }, 403);
  return new Response(licensePage(lic), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

async function handleLicensePurchase(request, env) {
  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  const email = body && body.email;
  if (typeof email !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ ok: false, error: "valid email required" }, 400);
  }
  const now = new Date();
  const expires = new Date(now.getTime() + MON_CFG.days * 86400000);
  const token = crypto.randomUUID();
  const paymentToken = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO licenses (token, email, plan, price, uses_total, uses_left, status, payment_token, created_at, expires_at) VALUES (?, ?, 'creator', ?, ?, ?, 'pending', ?, ?, ?)")
    .bind(token, email, MON_CFG.price, MON_CFG.uses, MON_CFG.uses, paymentToken, now.toISOString(), expires.toISOString()).run();
  return json({
    ok: true, status: "pending", price: MON_CFG.price, uses: MON_CFG.uses,
    payment_url: "/buy/" + token + "?pt=" + paymentToken,
    next_step: "el humano paga el paylink; tras pagar la pagina muestra el license_token para create_item"
  });
}

async function handleLicenseActivate(request, env) {
  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  const pt = body && typeof body.payment_token === "string" ? body.payment_token : "";
  if (!pt) return json({ ok: false, error: "payment_token required" }, 400);
  const lic = await env.DB.prepare("SELECT token, status, payment_token FROM licenses WHERE payment_token = ?").bind(pt).first();
  if (!lic) return json({ ok: false, error: "licencia no encontrada" }, 404);
  if (lic.status === "active") return json({ ok: true, license_token: lic.token, already: true });
  await env.DB.prepare("UPDATE licenses SET status = 'active' WHERE token = ?").bind(lic.token).run();
  return json({ ok: true, license_token: lic.token, status: "active" });
}

async function handleLicenseGet(request, env, token) {
  const lic = await env.DB.prepare("SELECT token, email, plan, uses_total, uses_left, status, created_at, expires_at FROM licenses WHERE token = ?").bind(token).first();
  if (!lic) return json({ found: false }, 404);
  const expired = lic.expires_at < new Date().toISOString();
  return json(Object.assign({ found: true, valid: lic.status === "active" && !expired && lic.uses_left > 0 }, lic));
}

async function handleCreateItemMon(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, needs_payment: true, error: "creator license required", price: MON_CFG.price, uses: MON_CFG.uses }, 401);
  const lic = await env.DB.prepare("SELECT token, uses_left, status, expires_at FROM licenses WHERE token = ?").bind(token).first();
  if (!lic || lic.status !== "active") return json({ ok: false, needs_payment: true, error: "license invalid or not active" }, 401);
  if (lic.expires_at < new Date().toISOString()) return json({ ok: false, error: "license expired" }, 403);
  if (lic.uses_left <= 0) return json({ ok: false, error: "license exhausted: no creations left" }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const name = body && body.name;
  const price = body && body.price;
  const stock = body && typeof body.stock === "number" ? body.stock : 0;
  if (typeof name !== "string" || name.trim().length === 0) return json({ error: "name required" }, 400);
  if (typeof price !== "number" || !Number.isFinite(price) || price < 0) return json({ error: "price must be a number >= 0" }, 400);
  const { meta } = await env.DB.prepare("INSERT INTO items (name, description, price, stock) VALUES (?, ?, ?, ?)")
    .bind(name, typeof body.description === "string" ? body.description : "", price, stock).run();
  await env.DB.prepare("UPDATE licenses SET uses_left = uses_left - 1 WHERE token = ?").bind(token).run();
  const row = await env.DB.prepare("SELECT id, name, description, price, stock FROM items WHERE id = ?").bind(meta.last_row_id).first();
  return json(Object.assign({ ok: true, uses_left: lic.uses_left - 1 }, row), 201);
}