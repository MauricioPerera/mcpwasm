// build.mjs — Empaqueta la plataforma llmstxt-shop -> worker.mjs (autogenerado).
// Mismo patron que studio/build.mjs: los hashes se calculan del contenido real.
// API: D1 (catalogo + ordenes atomicas e idempotentes por client_order_id).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const contentDir = join(__dirname, "content");
const read = (f) => readFileSync(join(contentDir, f), "utf8");

const SKILLS = ["search_catalog", "get_product", "create_order", "order_status", "create_product", "buy_creator_access", "check_license"];

// Licencia de creador: el acceso a create_product se VENDE (paylink -> token).
const CREATOR_LICENSE = { price: 19, uses: 25, days: 30 };

// Attestations Ed25519 (opcional): si content/attestations.json existe, el worker
// lo sirve en /.well-known/agent-skills/attestations.json (patron bookstore).
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

const catalog = JSON.parse(readFileSync(join(__dirname, "catalog.json"), "utf8"));

// --- llms.txt (v0.4) ----------------------------------------------------------
const llmsTxt =
  `# llmstxt-shop\n\n` +
  `> The BYOA storefront: your agent browses the catalog, buys with your approval, and orders are idempotent — retries never duplicate. Browsing and buying are free; LISTING products is the paid tool (creator license, $19 for 25 listings via paylink). Read tools hit a live D1 catalog; every write is a real-world effect and asks the human first.\n\n` +
  `## Skills\n\n` +
  SKILLS.map((name) => {
    const titles = {
      search_catalog: "Search the shop catalog by text, category and/or max price. Returns products with sku, price and live stock.",
      get_product: "Get full details of one product by SKU (name, description, price, live stock). Returns {found:false} if unknown.",
      create_order: "Create an order (atomic stock decrement). IDEMPOTENT via client_order_id: retries return the same order. 409 when unknown SKU or insufficient stock. ALWAYS confirm product, qty and email with the human first.",
      order_status: "Look up one order by numeric id. Confirms whether a doubtful purchase actually landed before retrying.",
      create_product: "PAID TOOL: list a new product on the marketplace. Requires a creator license token (buy with buy_creator_access — $19 for 25 listings, 30 days). Without a valid token returns needs_payment with the paylink.",
      buy_creator_access: "Start the purchase of a creator license: returns the paylink for the HUMAN to pay. After payment the human receives the license token to use in create_product.",
      check_license: "Check a creator license token: plan, uses left, expiry. Free.",
    };
    return `- [${name}](/skills/${name}/SKILL.md): ${titles[name]} <!-- skill: {"version":"1.0.0","sha256":"${skills[name].skillHash}","tool":"/skills/${name}/tool.js","tool_sha256":"${skills[name].hash}"} -->\n`;
  }).join("");

// --- landing -------------------------------------------------------------------
const docLinks = SKILLS.map(
  (name) => `      <li><code>${name}</code> — <a href="/skills/${name}/SKILL.md">SKILL.md</a> · <a href="/skills/${name}/tool.js">tool.js</a></li>`
).join("\n");
const catalogRows = catalog.map(
  (p) => `      <tr><td><code>${p.sku}</code></td><td>${p.name}</td><td>$${p.price.toFixed(2)}</td><td>${p.stock}</td></tr>`
).join("\n");
const landing =
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n` +
  `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
  `<title>llmstxt-shop — the BYOA storefront</title>\n` +
  `<style>body{font-family:system-ui,sans-serif;max-width:52rem;margin:2rem auto;padding:0 1rem;line-height:1.55;color:#14181f;background:#fafbfc}code{background:#eef1f4;padding:.1rem .35rem;border-radius:4px;font-size:.92em}a{color:#0b62a4}h1{border-bottom:2px solid #e4e8ec;padding-bottom:.4rem}table{border-collapse:collapse;width:100%;margin:1rem 0}td,th{border:1px solid #e4e8ec;padding:.45rem .6rem;text-align:left;font-size:.95rem}th{background:#eef1f4}pre{background:#14181f;color:#d7e2ec;padding:.8rem 1rem;border-radius:8px;overflow-x:auto}footer{margin-top:2.5rem;color:#66707b;font-size:.9rem;border-top:1px solid #e4e8ec;padding-top:1rem}.pill{display:inline-block;background:#0b62a4;color:#fff;border-radius:99px;padding:.1rem .6rem;font-size:.85rem;margin-right:.4rem}</style>\n` +
  `</head>\n<body>\n` +
  `<h1>llmstxt-shop</h1>\n` +
  `<p>The <strong>BYOA storefront</strong>: no cart UI, no checkout wizard. Your agent browses the catalog, proposes the purchase, <em>you approve</em>, and the order is real — atomic stock, idempotent retries, an <code>order_id</code> you can query forever. Built on <a href="https://github.com/MauricioPerera/mcpwasm">mcpwasm</a>: static discovery with verified hashes, tools that run sandboxed on the consumer's machine.</p>\n` +
  `<h2>Point your agent here</h2>\n` +
  `<pre>npx -y @rckflr/mcpwasm https://llmstxt-shop.rckflr.workers.dev</pre>\n` +
  `<p>...or through the gateway: <code>POST https://llmstxt-gateway.rckflr.workers.dev/mcp?origin=${encodeURIComponent("https://llmstxt-shop.rckflr.workers.dev")}</code></p>\n` +
  `<h2>Skills</h2>\n<ul>\n${docLinks}\n  </ul>\n` +
  `<h2>Catalog (live)</h2>\n<table>\n      <tr><th>SKU</th><th>Product</th><th>Price</th><th>Stock</th></tr>\n${catalogRows}\n    </table>\n` +
  `<h2>For merchants</h2>\n<p>Orders live in D1. List them with the admin token: <code>GET /api/orders?limit=50</code> + <code>Authorization: Bearer &lt;ADMIN_TOKEN&gt;</code>. Want to SELL here? Your agent buys a <strong>creator license</strong> ($19 / 25 listings / 30 days): it calls <code>buy_creator_access</code>, you pay the paylink, it lists products with <code>create_product</code>. And if you want a storefront of your own: your agent can build and deploy one in seconds on <a href="https://llmstxt-studio.rckflr.workers.dev">llmstxt-studio</a> (throwaway account, claim to keep it).</p>\n` +
  `<footer>Generated by shop/build.mjs — do not edit the worker by hand. BYOA: your agent, your model, our catalog and orders.</footer>\n</body>\n</html>`;

// --- worker autogenerado --------------------------------------------------------
const toolConstants = SKILLS.map(
  (name) => `const ${name.toUpperCase()}_TOOL_JS = ${JSON.stringify(skills[name].tool)};\n` +
    `const ${name.toUpperCase()}_SKILL_MD = ${JSON.stringify(skills[name].skillMd)};`
).join("\n");

const skillRoutes = SKILLS.map(
  (name) =>
    `    if (path === "/skills/${name}/tool.js") { return new Response(${name.toUpperCase()}_TOOL_JS, { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" } }); }\n` +
    `    if (path === "/skills/${name}/SKILL.md") { return new Response(${name.toUpperCase()}_SKILL_MD, { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" } }); }`
).join("\n");

const worker =
  `// AUTOGENERADO por shop/build.mjs. No editar a mano.\n` +
  `${toolConstants}\n\n` +
  `const LLMS_TXT = ${JSON.stringify(llmsTxt)};\n` +
  `const LANDING_HTML = ${JSON.stringify(landing)};\n` +
  (attestationsJson ? `  const ATTESTATIONS = ${attestationsJson};\n\n` : "") +
  `const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };\n` +
  `const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });\n\n` +
  `export default {\n` +
  `  async fetch(request, env) {\n` +
  `    const url = new URL(request.url);\n` +
  `    const path = url.pathname;\n\n` +
  `    if (path === "/" || path === "/index.html") {\n` +
  `      return new Response(LANDING_HTML, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });\n` +
  `    }\n` +
  `    if (path === "/llms.txt") {\n` +
  `      return new Response(LLMS_TXT, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });\n` +
  `    }\n\n` +
  `    try {\n` +
  `      if (path === "/api/search") return await handleSearch(url, env);\n` +
  `      const productMatch = path.match(/^\\/api\\/product\\/([^/]+)$/);\n` +
  `      if (productMatch) return await handleProduct(decodeURIComponent(productMatch[1]), env);\n` +
  `      if (path === "/api/orders" && request.method === "POST") return await handleCreateOrder(request, env);\n` +
  `      if (path === "/api/orders" && request.method === "GET") return await handleListOrders(request, env);
      const payPageMatch = path.match(/^\\/pay\\/(\\d+)$/);
      if (payPageMatch) return await handlePayPage(request, env, Number(payPageMatch[1]), url.searchParams.get("pt") || "");
      const payApiMatch = path.match(/^\\/api\\/pay\\/(\\d+)$/);
      if (payApiMatch && request.method === "POST") return await handlePay(request, env, Number(payApiMatch[1]));
      if (path === "/api/products" && request.method === "POST") return await handleProductCreate(request, env);
      if (path === "/api/licenses/purchase" && request.method === "POST") return await handleLicensePurchase(request, env);
      if (path === "/api/licenses/activate" && request.method === "POST") return await handleLicenseActivate(request, env);
      const licMatch = path.match(/^\\/api\\/license\\/([0-9a-fA-F-]+)$/);
      if (licMatch) return await handleLicenseGet(request, env, licMatch[1]);
      const buyPageMatch = path.match(/^\\/buy\\/([0-9a-fA-F-]+)$/);
      if (buyPageMatch) return await handleLicensePage(request, env, buyPageMatch[1], url.searchParams.get("pt") || "");\n` +
  `      const orderMatch = path.match(/^\\/api\\/orders\\/(\\d+)$/);\n` +
  `      if (orderMatch) return await handleGetOrder(Number(orderMatch[1]), env);\n` +
  `    } catch (e) {\n` +
  `      return json({ error: "error interno: " + (e && e.message ? e.message : String(e)) }, 500);\n` +
  `    }\n\n` +
  `${skillRoutes}\n\n` +
  (attestationsJson
    ? "  if (path === \"/.well-known/agent-skills/attestations.json\") {\n" +
      "      return new Response(JSON.stringify(ATTESTATIONS), { headers: { \"content-type\": \"application/json; charset=utf-8\", \"cache-control\": \"no-store\" } });\n" +
      "    }\n\n"
    : "") +
  `    return json({ error: "Not Found", path }, 404);\n` +
  `  }\n` +
  `};\n\n` +
  `async function handleSearch(url, env) {\n` +
  `  const q = (url.searchParams.get("q") || "").trim();\n` +
  `  const category = (url.searchParams.get("category") || "").trim();\n` +
  `  const maxPriceRaw = url.searchParams.get("max_price");\n` +
  `  const maxPrice = maxPriceRaw !== null ? Number(maxPriceRaw) : null;\n` +
  `  const where = [];\n` +
  `  const params = [];\n` +
  `  if (q.length > 0) {\n` +
  `    where.push("(LOWER(name) LIKE LOWER(?) OR LOWER(description) LIKE LOWER(?))");\n` +
  `    params.push("%" + q + "%", "%" + q + "%");\n` +
  `  }\n` +
  `  if (category.length > 0) { where.push("category = ?"); params.push(category); }\n` +
  `  if (maxPrice !== null && Number.isFinite(maxPrice)) { where.push("price <= ?"); params.push(maxPrice); }\n` +
  `  const sql = "SELECT sku, name, description, category, price, stock FROM products" +\n` +
  `    (where.length ? " WHERE " + where.join(" AND ") : "") + " ORDER BY sku LIMIT 10";\n` +
  `  const { results } = await env.DB.prepare(sql).bind(...params).all();\n` +
  `  return json(results);\n` +
  `}\n\n` +
  `async function handleProduct(sku, env) {\n` +
  `  const product = await env.DB.prepare("SELECT sku, name, description, category, price, stock FROM products WHERE sku = ?").bind(sku).first();\n` +
  `  if (!product) return json({ error: "product not found", sku }, 404);\n` +
  `  return json(Object.assign({ found: true }, product));\n` +
  `}\n\n` +
  `async function handleCreateOrder(request, env) {\n` +
  `  let body;\n` +
  `  try { body = await request.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }\n` +
  `  const sku = body && body.sku;\n` +
  `  const qty = body && body.qty;\n` +
  `  const email = body && body.email;\n` +
  `  const clientOrderId = body && typeof body.client_order_id === "string" && body.client_order_id.length > 0 ? body.client_order_id : null;\n` +
  `  if (typeof sku !== "string" || sku.length === 0) return json({ error: "sku required" }, 400);\n` +
  `  if (typeof qty !== "number" || !Number.isFinite(qty) || qty < 1 || Math.floor(qty) !== qty) {\n` +
  `    return json({ error: "qty must be an integer >= 1" }, 400);\n` +
  `  }\n` +
  `  if (typeof email !== "string" || !/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)) {\n` +
  `    return json({ error: "valid email required" }, 400);\n` +
  `  }\n` +
  `  // Idempotencia: mismo client_order_id -> la orden original (nunca duplicado).\n` +
  `  if (clientOrderId) {\n` +
  `    const existing = await env.DB.prepare("SELECT order_id, sku, qty, email, total, status, payment_token, created_at FROM orders WHERE client_order_id = ?").bind(clientOrderId).first();\n` +
  `    if (existing) {\n` +
  `      const payUrl = existing.payment_token ? "/pay/" + existing.order_id + "?pt=" + existing.payment_token : null;\n` +
  `      return json(Object.assign({ idempotent: true }, existing, { payment_url: payUrl }), 200);\n` +
  `    }\n` +
  `  }\n` +
  `  const product = await env.DB.prepare("SELECT sku, price, stock FROM products WHERE sku = ?").bind(sku).first();\n` +
  `  if (!product) return json({ error: "product not found", sku }, 409);\n` +
  `  if (product.stock < qty) {\n` +
  `    return json({ error: "insufficient stock", requested: qty, available: product.stock }, 409);\n` +
  `  }\n` +
  `  const now = new Date().toISOString();\n` +
  `  const paymentToken = crypto.randomUUID();\n` +
  `  const results = await env.DB.batch([\n` +
  `    env.DB.prepare("INSERT INTO orders (sku, qty, email, total, client_order_id, status, payment_token, created_at) VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?)")\n` +
  `      .bind(sku, qty, email, product.price * qty, clientOrderId, paymentToken, now),\n` +
  `    env.DB.prepare("UPDATE products SET stock = stock - ? WHERE sku = ? AND stock >= ?").bind(qty, sku, qty),\n` +
  `  ]);\n` +
  `  const orderId = results[0] && results[0].meta && results[0].meta.last_row_id;\n` +
  `  const changes = results[1] && results[1].meta && results[1].meta.changes;\n` +
  `  if (!changes) {\n` +
  `    return json({ error: "insufficient stock (race)", requested: qty, available: product.stock }, 409);\n` +
  `  }\n` +
  `  const paymentUrl = "/pay/" + orderId + "?pt=" + paymentToken;\n` +
  `  return json({ order_id: orderId, sku, qty, total: product.price * qty, remaining_stock: product.stock - qty, order_status: "confirmed", payment_url: paymentUrl, idempotent: false }, 200);\n` +
  `}\n\n` +
  `async function handleGetOrder(id, env) {\n` +
  `  const order = await env.DB.prepare("SELECT order_id, sku, qty, email, total, status, payment_token, created_at FROM orders WHERE order_id = ?").bind(id).first();\n` +
  `  if (!order) return json({ error: "Not Found", id }, 404);\n` +
  `  const out = { order_id: order.order_id, sku: order.sku, qty: order.qty, email: order.email, total: order.total, status: order.status, created_at: order.created_at };\n` +
  `  if (order.payment_token && order.status !== "paid") out.payment_url = "/pay/" + order.order_id + "?pt=" + order.payment_token;\n` +
  `  return json(out);\n` +
  `}\n\n` +
  `async function handleListOrders(request, env) {\n` +
  `  const auth = request.headers.get("Authorization") || "";\n` +
  `  const expected = "Bearer " + (env.ADMIN_TOKEN || "");\n` +
  `  if (!env.ADMIN_TOKEN || auth !== expected) {\n` +
  `    return json({ error: "unauthorized: merchant token required" }, 401);\n` +
  `  }\n` +
  `  const limitRaw = Number(new URL(request.url).searchParams.get("limit"));\n` +
  `  const limit = Number.isFinite(limitRaw) && limitRaw >= 1 && limitRaw <= 200 ? Math.floor(limitRaw) : 50;\n` +
  `  const { results } = await env.DB.prepare("SELECT order_id, sku, qty, email, total, status, client_order_id, created_at FROM orders ORDER BY order_id DESC LIMIT ?").bind(limit).all();\n` +
  `  return json({ orders: results, count: results.length });\n` +
  `}\n\n` +
  `const paylinkPage = ${paylinkPage.toString()};\n\n` +
  `const handlePayPage = ${handlePayPage.toString()};\n\n` +
  `const handlePay = ${handlePay.toString()};\n\n` +
  `const licensePage = ${licensePage.toString()};\n\n` +
  `const handleLicensePage = ${handleLicensePage.toString()};\n\n` +
  `const handleLicensePurchase = ${handleLicensePurchase.toString()};\n\n` +
  `const handleLicenseActivate = ${handleLicenseActivate.toString()};\n\n` +
  `const handleLicenseGet = ${handleLicenseGet.toString()};\n\n` +
  `const handleProductCreate = ${handleProductCreate.toString()};\n`;

writeFileSync(join(__dirname, "worker.mjs"), worker, "utf8");

console.log("Generated: shop/worker.mjs");
for (const name of SKILLS) console.log(`  ${name}: tool_sha256=${skills[name].hash}`);
// --- funciones embebidas en el worker via .toString() -------------------------

function paylinkPage(order) {
  const paid = order.status === "paid";
  const btn = paid
    ? '<p class="ok">\u2705 Esta orden ya esta PAGADA.</p>'
    : '<button id="btn" onclick="pay()">Pagar $' + order.total.toFixed(2) + " (simulado)</button>" +
      '<p id="msg"></p>' +
      '<p class="tag">SIMULACION: no se cobra dinero real. Este paylink autoriza marcar la orden como pagada.</p>';
  return "<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\">" +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    "<title>Pagar orden #" + order.order_id + "</title>" +
    "<style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem;line-height:1.6;color:#14181f;background:#fafbfc}code{background:#eef1f4;padding:.1rem .35rem;border-radius:4px}.box{border:1px solid #e4e8ec;border-radius:10px;padding:1.2rem;margin:1rem 0}button{background:#0b62a4;color:#fff;border:0;border-radius:8px;padding:.7rem 1.4rem;font-size:1rem;cursor:pointer;width:100%}button:disabled{opacity:.5}.ok{color:#0a7d32;font-weight:700}.tag{color:#66707b;font-size:.85rem}</style></head><body>" +
    "<h1>llmstxt-shop</h1><div class=\"box\"><h2>Orden #" + order.order_id + "</h2>" +
    "<p><code>" + order.sku + "</code> x" + order.qty + " \u2014 <strong>$" + order.total.toFixed(2) + "</strong></p>" +
    "<p>Confirmacion a: " + order.email + "</p>" +
    btn +
    "<script>function pay(){var b=document.getElementById('btn');b.disabled=true;b.textContent='Procesando...';fetch('/api/pay/" + order.order_id + "',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({payment_token:'" + order.payment_token + "'})}).then(function(r){return r.json()}).then(function(j){if(j.ok){document.getElementById('msg').textContent='\u2705 Pago registrado \u2014 orden ' + j.order_id + ' pagada';b.textContent='Pagado \u2713';}else{document.getElementById('msg').textContent='Error: ' + (j.error||'desconocido');b.disabled=false;}});}<\/script>" +
    "</div></body></html>";
}

async function handlePayPage(request, env, id, pt) {
  const order = await env.DB.prepare("SELECT order_id, sku, qty, email, total, status, payment_token FROM orders WHERE order_id = ?").bind(id).first();
  if (!order) return json({ error: "Not Found", id }, 404);
  if (!order.payment_token || pt !== order.payment_token) {
    return json({ error: "paylink invalido o expirado" }, 403);
  }
  return new Response(paylinkPage(order), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

async function handlePay(request, env, id) {
  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  const pt = body && typeof body.payment_token === "string" ? body.payment_token : new URL(request.url).searchParams.get("pt") || "";
  const order = await env.DB.prepare("SELECT order_id, status, payment_token FROM orders WHERE order_id = ?").bind(id).first();
  if (!order) return json({ ok: false, error: "order not found" }, 404);
  if (!order.payment_token || pt !== order.payment_token) return json({ ok: false, error: "paylink invalido" }, 403);
  if (order.status === "paid") return json({ ok: true, order_id: order.order_id, status: "paid", already: true });
  await env.DB.prepare("UPDATE orders SET status = 'paid' WHERE order_id = ? AND status = 'confirmed'").bind(order.order_id).run();
  return json({ ok: true, order_id: order.order_id, status: "paid" });
}

// --- licencias de creador (el acceso a create_product se vende) ---------------
// Precios en un solo lugar: $19 / 25 listados / 30 dias (CREATOR_LICENSE arriba).

function licensePage(lic) {
  const active = lic.status === "active";
  const body = active
    ? '<p class="ok">\u2705 Licencia ACTIVA \u2014 entrega este token a tu agente:</p>' +
      '<p><code id="tok" style="font-size:1.05rem;word-break:break-all">' + lic.token + "</code></p>" +
      '<p class="tag">' + lic.uses_left + " listados restantes \u00b7 vence " + lic.expires_at.slice(0, 10) + "</p>" +
      '<p class="tag">Guarda este token: la pagina no lo vuelve a mostrar tras cerrar (recupera con check_license).</p>'
    : '<button id="btn" onclick="pay()">Pagar $' + lic.price.toFixed(2) + " \u2014 creador: " + lic.uses_total + " listados / 30 dias (simulado)</button>" +
      '<p id="msg"></p>' +
      '<p class="tag">SIMULACION: no se cobra dinero real. Al pagar se activa la licencia y la pagina muestra el token.</p>';
  return "<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\">" +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    "<title>Licencia de creador \u2014 llmstxt-shop</title>" +
    "<style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem;line-height:1.6;color:#14181f;background:#fafbfc}code{background:#eef1f4;padding:.15rem .4rem;border-radius:4px;font-size:.95em}button{background:#0b62a4;color:#fff;border:0;border-radius:8px;padding:.7rem 1.4rem;font-size:1rem;cursor:pointer;width:100%}button:disabled{opacity:.5}.ok{color:#0a7d32;font-weight:700}.tag{color:#66707b;font-size:.85rem}</style></head><body>" +
    "<h1>llmstxt-shop</h1><div class=\"box\"><h2>Licencia de creador</h2>" +
    '<p>Acceso a <code>create_product</code> para listar productos en el marketplace.</p>' +
    body +
    "<script>function pay(){var b=document.getElementById('btn');if(!b)return;b.disabled=true;b.textContent='Procesando...';fetch('/api/licenses/activate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({payment_token:'" + lic.payment_token + "'})}).then(function(r){return r.json()}).then(function(j){if(j.ok){location.reload();}else{document.getElementById('msg').textContent='Error: ' + (j.error||'?');b.disabled=false;}});}<\/script>" +
    "</div></body></html>";
}

async function handleLicensePage(request, env, token, pt) {
  const lic = await env.DB.prepare("SELECT token, email, price, uses_total, uses_left, status, payment_token, expires_at FROM licenses WHERE token = ?").bind(token).first();
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
  const expires = new Date(now.getTime() + 30 * 86400000);
  const token = crypto.randomUUID();
  const paymentToken = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO licenses (token, email, plan, price, uses_total, uses_left, status, payment_token, created_at, expires_at) VALUES (?, ?, 'creator', 19, 25, 25, 'pending', ?, ?, ?)")
    .bind(token, email, paymentToken, now.toISOString(), expires.toISOString()).run();
  return json({
    ok: true, status: "pending", price: 19, uses: 25,
    payment_url: "/buy/" + token + "?pt=" + paymentToken,
    next_step: "entrega el paylink al HUMANO; tras pagar, la pagina muestra el license_token para create_product"
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
  await env.DB.prepare("UPDATE licenses SET status = 'active' WHERE token = ? AND status = 'pending'").bind(lic.token).run();
  return json({ ok: true, license_token: lic.token, status: "active" });
}

async function handleLicenseGet(request, env, token) {
  const lic = await env.DB.prepare("SELECT token, email, plan, uses_total, uses_left, status, created_at, expires_at FROM licenses WHERE token = ?").bind(token).first();
  if (!lic) return json({ found: false }, 404);
  const expired = lic.expires_at < new Date().toISOString();
  return json(Object.assign({ found: true, valid: lic.status === "active" && !expired && lic.uses_left > 0 }, lic));
}

async function handleProductCreate(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  const lic = token ? await env.DB.prepare("SELECT token, uses_left, status, expires_at FROM licenses WHERE token = ?").bind(token).first() : null;
  if (!lic || lic.status !== "active") {
    return json({ ok: false, error: "creator license required", needs_payment: true, price: 19, uses: 25, next_step: "llama buy_creator_access con el email del humano; tras pagar el paylink el humano recibe el license_token" }, 401);
  }
  if (lic.expires_at < new Date().toISOString()) {
    return json({ ok: false, error: "licencia expirada", needs_payment: true }, 403);
  }
  if (lic.uses_left <= 0) return json({ ok: false, error: "licencia agotada: sin listados restantes", uses_left: 0 }, 403);
  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  const name = body && body.name;
  const price = body && body.price;
  if (typeof name !== "string" || name.trim().length === 0) return json({ ok: false, error: "name required" }, 400);
  if (typeof price !== "number" || !Number.isFinite(price) || price < 0) return json({ ok: false, error: "price must be >= 0" }, 400);
  const stock = typeof body.stock === "number" && Number.isFinite(body.stock) && body.stock >= 0 ? Math.floor(body.stock) : 0;
  const category = typeof body.category === "string" && body.category.length > 0 ? body.category : "marketplace";
  let sku = (typeof body.sku === "string" && body.sku.length > 0 ? body.sku : name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)).slice(0, 60);
  const exists = await env.DB.prepare("SELECT sku FROM products WHERE sku = ?").bind(sku).first();
  if (exists) sku = sku.slice(0, 46) + "-" + crypto.randomUUID().slice(0, 8);
  const description = typeof body.description === "string" ? body.description.slice(0, 500) : "";
  await env.DB.prepare("INSERT INTO products (sku, name, description, category, price, stock) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(sku, name, description, category, price, stock).run();
  await env.DB.prepare("UPDATE licenses SET uses_left = uses_left - 1 WHERE token = ?").bind(lic.token).run();
  return json({ ok: true, sku, name, price, stock, category, uses_left: lic.uses_left - 1 }, 201);
}
