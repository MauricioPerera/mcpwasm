// build.mjs — Empaqueta la plataforma llmstxt-shop -> worker.mjs (autogenerado).
// Mismo patron que studio/build.mjs: los hashes se calculan del contenido real.
// API: D1 (catalogo + ordenes atomicas e idempotentes por client_order_id).

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const contentDir = join(__dirname, "content");
const read = (f) => readFileSync(join(contentDir, f), "utf8");

const SKILLS = ["search_catalog", "get_product", "create_order", "order_status"];

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
  `> The BYOA storefront: your agent browses the catalog, buys with your approval, and orders are idempotent — retries never duplicate. Read tools hit a live D1 catalog; create_order is a real-world effect and always asks the human first.\n\n` +
  `## Skills\n\n` +
  SKILLS.map((name) => {
    const titles = {
      search_catalog: "Search the shop catalog by text, category and/or max price. Returns products with sku, price and live stock.",
      get_product: "Get full details of one product by SKU (name, description, price, live stock). Returns {found:false} if unknown.",
      create_order: "Create an order (atomic stock decrement). IDEMPOTENT via client_order_id: retries return the same order. 409 when unknown SKU or insufficient stock. ALWAYS confirm product, qty and email with the human first.",
      order_status: "Look up one order by numeric id. Confirms whether a doubtful purchase actually landed before retrying.",
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
  `<h2>For merchants</h2>\n<p>Orders live in D1. List them with the admin token: <code>GET /api/orders?limit=50</code> + <code>Authorization: Bearer &lt;ADMIN_TOKEN&gt;</code>. And if you want a storefront of your own: your agent can build and deploy one in seconds on <a href="https://llmstxt-studio.rckflr.workers.dev">llmstxt-studio</a> (throwaway account, claim to keep it).</p>\n` +
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
  `const LANDING_HTML = ${JSON.stringify(landing)};\n\n` +
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
  `      if (path === "/api/orders" && request.method === "GET") return await handleListOrders(request, env);\n` +
  `      const orderMatch = path.match(/^\\/api\\/orders\\/(\\d+)$/);\n` +
  `      if (orderMatch) return await handleGetOrder(Number(orderMatch[1]), env);\n` +
  `    } catch (e) {\n` +
  `      return json({ error: "error interno: " + (e && e.message ? e.message : String(e)) }, 500);\n` +
  `    }\n\n` +
  `${skillRoutes}\n\n` +
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
  `    const existing = await env.DB.prepare("SELECT order_id, sku, qty, email, total, status, created_at FROM orders WHERE client_order_id = ?").bind(clientOrderId).first();\n` +
  `    if (existing) return json(Object.assign({ idempotent: true }, existing), 200);\n` +
  `  }\n` +
  `  const product = await env.DB.prepare("SELECT sku, price, stock FROM products WHERE sku = ?").bind(sku).first();\n` +
  `  if (!product) return json({ error: "product not found", sku }, 409);\n` +
  `  if (product.stock < qty) {\n` +
  `    return json({ error: "insufficient stock", requested: qty, available: product.stock }, 409);\n` +
  `  }\n` +
  `  const now = new Date().toISOString();\n` +
  `  const results = await env.DB.batch([\n` +
  `    env.DB.prepare("INSERT INTO orders (sku, qty, email, total, client_order_id, status, created_at) VALUES (?, ?, ?, ?, ?, 'confirmed', ?)")\n` +
  `      .bind(sku, qty, email, product.price * qty, clientOrderId, now),\n` +
  `    env.DB.prepare("UPDATE products SET stock = stock - ? WHERE sku = ? AND stock >= ?").bind(qty, sku, qty),\n` +
  `  ]);\n` +
  `  const orderId = results[0] && results[0].meta && results[0].meta.last_row_id;\n` +
  `  const changes = results[1] && results[1].meta && results[1].meta.changes;\n` +
  `  if (!changes) {\n` +
  `    return json({ error: "insufficient stock (race)", requested: qty, available: product.stock }, 409);\n` +
  `  }\n` +
  `  return json({ order_id: orderId, sku, qty, total: product.price * qty, remaining_stock: product.stock - qty, order_status: "confirmed", idempotent: false }, 200);\n` +
  `}\n\n` +
  `async function handleGetOrder(id, env) {\n` +
  `  const order = await env.DB.prepare("SELECT order_id, sku, qty, email, total, status, created_at FROM orders WHERE order_id = ?").bind(id).first();\n` +
  `  if (!order) return json({ error: "Not Found", id }, 404);\n` +
  `  return json(order);\n` +
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
  `}\n`;

writeFileSync(join(__dirname, "worker.mjs"), worker, "utf8");

console.log("Generated: shop/worker.mjs");
for (const name of SKILLS) console.log(`  ${name}: tool_sha256=${skills[name].hash}`);