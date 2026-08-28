// AUTOGENERADO por shop/build.mjs. No editar a mano.
const SEARCH_CATALOG_TOOL_JS = "registerTool({\n  name: \"search_catalog\",\n  description: \"Search the shop catalog: free-text over name and description, optionally filtered by category and max price. Returns up to 10 products with sku, name, price, category and stock.\",\n  inputSchema: {\n    type: \"object\",\n    properties: {\n      q: { type: \"string\", description: \"Free-text query, matched against name and description.\" },\n      category: { type: \"string\", description: \"Exact category filter, e.g. merch or hardware.\" },\n      max_price: { type: \"number\", description: \"Maximum price (inclusive) filter.\" }\n    }\n  },\n  handler: async function (args) {\n    args = args || {};\n    // URLSearchParams no existe en el sandbox QuickJS (solo built-ins ECMAScript):\n    // construir el query string a mano con encodeURIComponent (built-in).\n    const parts = [];\n    if (typeof args.q === \"string\" && args.q.length > 0) {\n      parts.push(\"q=\" + encodeURIComponent(args.q));\n    }\n    if (typeof args.category === \"string\" && args.category.length > 0) {\n      parts.push(\"category=\" + encodeURIComponent(args.category));\n    }\n    if (typeof args.max_price === \"number\" && Number.isFinite(args.max_price)) {\n      parts.push(\"max_price=\" + String(args.max_price));\n    }\n    const qs = parts.join(\"&\");\n    const r = await host.fetchOrigin(qs ? \"/api/search?\" + qs : \"/api/search\");\n    return JSON.parse(r.body);\n  }\n});";
const SEARCH_CATALOG_SKILL_MD = "---\nname: search_catalog\nversion: 1.0.0\nlicense: MIT\n---\n\n# search_catalog\n\nBusca en el catálogo de la tienda. Empareja texto libre contra `name` y\n`description`, con filtros opcionales por `category` (exacta) y `max_price`\n(inclusivo). Devuelve hasta 10 productos con `sku`, `name`, `price`,\n`category` y `stock`.\n\n## Argumentos\n\n- `q` (string, opcional): texto libre contra name y description.\n- `category` (string, opcional): categoría exacta, p.ej. `merch` o `hardware`.\n- `max_price` (number, opcional): precio máximo inclusivo.\n\n## Ejemplo\n\n```json\n{ \"q\": \"mug\", \"max_price\": 20 }\n```\n\nEl `sku` devuelto es el identificador para `get_product` y `create_order`.";
const GET_PRODUCT_TOOL_JS = "registerTool({\n  name: \"get_product\",\n  description: \"Get full details of one product by SKU: name, description, category, price and live stock. Returns {found:false} when the SKU does not exist.\",\n  inputSchema: {\n    type: \"object\",\n    properties: {\n      sku: { type: \"string\", description: \"Product SKU, e.g. wasm-mug.\" }\n    },\n    required: [\"sku\"]\n  },\n  handler: async function (args) {\n    args = args || {};\n    if (typeof args.sku !== \"string\" || args.sku.length === 0) {\n      return { found: false, error: \"sku must be a non-empty string\" };\n    }\n    const r = await host.fetchOrigin(\"/api/product/\" + encodeURIComponent(args.sku));\n    if (r.status === 404) return { found: false };\n    return JSON.parse(r.body);\n  }\n});";
const GET_PRODUCT_SKILL_MD = "---\nname: get_product\nversion: 1.0.0\nlicense: MIT\n---\n\n# get_product\n\nDetalle completo de un producto por su `sku`: name, description, category,\nprice y **stock en vivo**. Devuelve `{found: false}` si el sku no existe.\n\n## Argumentos\n\n- `sku` (string, requerido): p.ej. `wasm-mug`.\n\n## Cuándo usarla\n\nAntes de crear una orden grande: el `stock` que devuelve `search_catalog`\npuede estar desactualizado (otro agente pudo comprar mientras tanto);\n`get_product` da el valor vivo y `create_order` es quien decide al final con\nsu 409 si el stock ya no alcanzó.";
const CREATE_ORDER_TOOL_JS = "registerTool({\n  name: \"create_order\",\n  description: \"Create an order for a product (decrements stock atomically). Returns {ok:true, order_id, sku, qty, total, remaining_stock, order_status}. IDEMPOTENT: pass a client_order_id (any string unique to this purchase intent, e.g. a UUID) and retries return the SAME order instead of duplicating it. Returns {ok:false, status:409} when the SKU is unknown or stock is insufficient.\",\n  inputSchema: {\n    type: \"object\",\n    properties: {\n      sku: { type: \"string\", description: \"Product SKU to order.\" },\n      qty: { type: \"number\", description: \"Quantity, integer >= 1.\" },\n      email: { type: \"string\", description: \"Customer email for the order confirmation.\" },\n      client_order_id: { type: \"string\", description: \"Optional idempotency key: a string unique to this purchase intent. On retry with the same key, the API returns the original order instead of creating a duplicate.\" }\n    },\n    required: [\"sku\", \"qty\", \"email\"]\n  },\n  handler: async function (args) {\n    args = args || {};\n    if (typeof args.sku !== \"string\" || args.sku.length === 0) {\n      return { ok: false, error: \"sku must be a non-empty string\" };\n    }\n    if (typeof args.qty !== \"number\" || !Number.isFinite(args.qty) ||\n        args.qty < 1 || Math.floor(args.qty) !== args.qty) {\n      return { ok: false, error: \"qty must be an integer >= 1\" };\n    }\n    if (typeof args.email !== \"string\" || !/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(args.email)) {\n      return { ok: false, error: \"email must be a valid address\" };\n    }\n    const body = JSON.stringify({\n      sku: args.sku, qty: args.qty, email: args.email,\n      client_order_id: typeof args.client_order_id === \"string\" ? args.client_order_id : undefined\n    });\n    const r = await host.fetchOrigin(\"/api/orders\", { method: \"POST\", body });\n    let parsed = null;\n    try { parsed = JSON.parse(r.body); } catch { parsed = { error: r.body }; }\n    if (r.status >= 400) {\n      return Object.assign({ ok: false, status: r.status }, parsed);\n    }\n    return Object.assign({ ok: true }, parsed);\n  }\n});";
const CREATE_ORDER_SKILL_MD = "---\nname: create_order\nversion: 1.0.0\nlicense: MIT\n---\n\n# create_order\n\nCrea una orden por un producto, decrementando el stock **atómicamente** en\nuna transacción D1. Devuelve `{ok: true, order_id, sku, qty, total,\nremaining_stock, order_status}` o `{ok: false, status: 409, error}` si el sku\nno existe o el stock no alcanzó.\n\n## El flujo de compra que el agente debe seguir\n\n1. `search_catalog` (o `get_product`) para elegir el producto y su `sku`.\n2. **Confirma con el humano** antes de comprar: producto, cantidad, precio y\n   el email al que va la orden. Comprar es un efecto en el mundo real — nunca\n   invoques esta tool sin un OK explícito del humano.\n3. Llama `create_order` con `{sku, qty, email, client_order_id}`.\n4. **Genera un `client_order_id` único por intención de compra** (p.ej. un\n   UUID). Si un reintento o error de red te deja dudoso, repite la llamada con\n   el MISMO `client_order_id`: la API devuelve la orden original\n   (`idempotent: true`) en vez de duplicarla.\n5. Reporta al humano: `order_id`, `total` y `remaining_stock`.\n\n## Idempotencia\n\n- `client_order_id` es una clave de deduplicación del CLIENTE.\n- Misma clave → misma orden, siempre (200, `idempotent: true`).\n- Clave distinta → orden nueva (aunque sea el mismo producto).\n- Sin clave → cada llamada crea una orden nueva. Para agentes: SIEMPRE mandar\n  la clave.\n\n## Errores\n\n| status | significado |\n|---|---|\n| 400 | validación (email inválido, qty no entera, sku vacío) |\n| 409 | sku desconocido o `insufficient stock` (trae `requested`/`available`) |";
const ORDER_STATUS_TOOL_JS = "registerTool({\n  name: \"order_status\",\n  description: \"Look up one order by its numeric id. Returns {found:true, order:{order_id, sku, qty, email, total, status, created_at}} or {found:false}.\",\n  inputSchema: {\n    type: \"object\",\n    properties: {\n      order_id: { type: \"number\", description: \"Numeric order id returned by create_order.\" }\n    },\n    required: [\"order_id\"]\n  },\n  handler: async function (args) {\n    args = args || {};\n    if (typeof args.order_id !== \"number\" || !Number.isFinite(args.order_id)) {\n      return { found: false, error: \"order_id must be a finite number\" };\n    }\n    const r = await host.fetchOrigin(\"/api/orders/\" + String(args.order_id));\n    if (r.status === 404) return { found: false };\n    const parsed = JSON.parse(r.body);\n    return { found: true, order: parsed };\n  }\n});";
const ORDER_STATUS_SKILL_MD = "---\nname: order_status\nversion: 1.0.0\nlicense: MIT\n---\n\n# order_status\n\nConsulta una orden por su id numérico. Devuelve\n`{found: true, order: {order_id, sku, qty, email, total, status, created_at}}`\no `{found: false}`.\n\n## Argumentos\n\n- `order_id` (number, requerido): el id que devolvió `create_order`.\n\n## Cuándo usarla\n\nDespués de una compra con respuesta dudosa (timeout, error de red): confirma\nsi la orden existe antes de reintentar `create_order`. Y para darle al humano\nel estado actualizado de una compra previa.";

const LLMS_TXT = "# llmstxt-shop\n\n> The BYOA storefront: your agent browses the catalog, buys with your approval, and orders are idempotent — retries never duplicate. Read tools hit a live D1 catalog; create_order is a real-world effect and always asks the human first.\n\n## Skills\n\n- [search_catalog](/skills/search_catalog/SKILL.md): Search the shop catalog by text, category and/or max price. Returns products with sku, price and live stock. <!-- skill: {\"version\":\"1.0.0\",\"sha256\":\"4a7f75400ca6879f562e996a8570a578b6dabd916db8a45856eece36383246d1\",\"tool\":\"/skills/search_catalog/tool.js\",\"tool_sha256\":\"74d717454cbc86599fbe00e49eec0d7fd2c982a5a066a2bc6188d9b89ed48e39\"} -->\n- [get_product](/skills/get_product/SKILL.md): Get full details of one product by SKU (name, description, price, live stock). Returns {found:false} if unknown. <!-- skill: {\"version\":\"1.0.0\",\"sha256\":\"e133b8e26cbd5f531f074ab0683ee487a37883385598d555211ffc56eb875060\",\"tool\":\"/skills/get_product/tool.js\",\"tool_sha256\":\"4c556c51b53670c96dd033ac79a8e92539bb8c23f77eec12f75e25404823030e\"} -->\n- [create_order](/skills/create_order/SKILL.md): Create an order (atomic stock decrement). IDEMPOTENT via client_order_id: retries return the same order. 409 when unknown SKU or insufficient stock. ALWAYS confirm product, qty and email with the human first. <!-- skill: {\"version\":\"1.0.0\",\"sha256\":\"20dc4b8665e9feaf576ac5d2073ad3c3c8b4bdcb4901269908cd78462017f1e1\",\"tool\":\"/skills/create_order/tool.js\",\"tool_sha256\":\"10fbd3f7432098aa6f3313f510856a686b6e376cd0edb3afcf1589c7119c618e\"} -->\n- [order_status](/skills/order_status/SKILL.md): Look up one order by numeric id. Confirms whether a doubtful purchase actually landed before retrying. <!-- skill: {\"version\":\"1.0.0\",\"sha256\":\"541d81ffebaf49c628e7163db1a45d684fe72f0c57a4098a2c3d4b3142365a42\",\"tool\":\"/skills/order_status/tool.js\",\"tool_sha256\":\"78e95c013ce63e9decd4e37218c8fc9d955f14c0c716ce55fb81eb0f96203336\"} -->\n";
const LANDING_HTML = "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>llmstxt-shop — the BYOA storefront</title>\n<style>body{font-family:system-ui,sans-serif;max-width:52rem;margin:2rem auto;padding:0 1rem;line-height:1.55;color:#14181f;background:#fafbfc}code{background:#eef1f4;padding:.1rem .35rem;border-radius:4px;font-size:.92em}a{color:#0b62a4}h1{border-bottom:2px solid #e4e8ec;padding-bottom:.4rem}table{border-collapse:collapse;width:100%;margin:1rem 0}td,th{border:1px solid #e4e8ec;padding:.45rem .6rem;text-align:left;font-size:.95rem}th{background:#eef1f4}pre{background:#14181f;color:#d7e2ec;padding:.8rem 1rem;border-radius:8px;overflow-x:auto}footer{margin-top:2.5rem;color:#66707b;font-size:.9rem;border-top:1px solid #e4e8ec;padding-top:1rem}.pill{display:inline-block;background:#0b62a4;color:#fff;border-radius:99px;padding:.1rem .6rem;font-size:.85rem;margin-right:.4rem}</style>\n</head>\n<body>\n<h1>llmstxt-shop</h1>\n<p>The <strong>BYOA storefront</strong>: no cart UI, no checkout wizard. Your agent browses the catalog, proposes the purchase, <em>you approve</em>, and the order is real — atomic stock, idempotent retries, an <code>order_id</code> you can query forever. Built on <a href=\"https://github.com/MauricioPerera/mcpwasm\">mcpwasm</a>: static discovery with verified hashes, tools that run sandboxed on the consumer's machine.</p>\n<h2>Point your agent here</h2>\n<pre>npx -y @rckflr/mcpwasm https://llmstxt-shop.rckflr.workers.dev</pre>\n<p>...or through the gateway: <code>POST https://llmstxt-gateway.rckflr.workers.dev/mcp?origin=https%3A%2F%2Fllmstxt-shop.rckflr.workers.dev</code></p>\n<h2>Skills</h2>\n<ul>\n      <li><code>search_catalog</code> — <a href=\"/skills/search_catalog/SKILL.md\">SKILL.md</a> · <a href=\"/skills/search_catalog/tool.js\">tool.js</a></li>\n      <li><code>get_product</code> — <a href=\"/skills/get_product/SKILL.md\">SKILL.md</a> · <a href=\"/skills/get_product/tool.js\">tool.js</a></li>\n      <li><code>create_order</code> — <a href=\"/skills/create_order/SKILL.md\">SKILL.md</a> · <a href=\"/skills/create_order/tool.js\">tool.js</a></li>\n      <li><code>order_status</code> — <a href=\"/skills/order_status/SKILL.md\">SKILL.md</a> · <a href=\"/skills/order_status/tool.js\">tool.js</a></li>\n  </ul>\n<h2>Catalog (live)</h2>\n<table>\n      <tr><th>SKU</th><th>Product</th><th>Price</th><th>Stock</th></tr>\n      <tr><td><code>mcpwasm-stickers</code></td><td>mcpwasm sticker pack</td><td>$6.00</td><td>120</td></tr>\n      <tr><td><code>llmstxt-poster</code></td><td>llms.txt poster A2</td><td>$18.00</td><td>45</td></tr>\n      <tr><td><code>wasm-mug</code></td><td>QuickJS mug</td><td>$14.00</td><td>60</td></tr>\n      <tr><td><code>byoa-tee</code></td><td>BYOA tee</td><td>$25.00</td><td>38</td></tr>\n      <tr><td><code>agent-keycaps</code></td><td>Agent keycaps</td><td>$32.00</td><td>22</td></tr>\n      <tr><td><code>ephemeral-clock</code></td><td>Ephemeral desk clock</td><td>$48.00</td><td>8</td></tr>\n      <tr><td><code>d1-coaster</code></td><td>D1 coasters (x4)</td><td>$12.00</td><td>90</td></tr>\n      <tr><td><code>static-sshirt</code></td><td>Static-first hoodie</td><td>$55.00</td><td>15</td></tr>\n    </table>\n<h2>For merchants</h2>\n<p>Orders live in D1. List them with the admin token: <code>GET /api/orders?limit=50</code> + <code>Authorization: Bearer &lt;ADMIN_TOKEN&gt;</code>. And if you want a storefront of your own: your agent can build and deploy one in seconds on <a href=\"https://llmstxt-studio.rckflr.workers.dev\">llmstxt-studio</a> (throwaway account, claim to keep it).</p>\n<footer>Generated by shop/build.mjs — do not edit the worker by hand. BYOA: your agent, your model, our catalog and orders.</footer>\n</body>\n</html>";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/" || path === "/index.html") {
      return new Response(LANDING_HTML, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    }
    if (path === "/llms.txt") {
      return new Response(LLMS_TXT, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
    }

    try {
      if (path === "/api/search") return await handleSearch(url, env);
      const productMatch = path.match(/^\/api\/product\/([^/]+)$/);
      if (productMatch) return await handleProduct(decodeURIComponent(productMatch[1]), env);
      if (path === "/api/orders" && request.method === "POST") return await handleCreateOrder(request, env);
      if (path === "/api/orders" && request.method === "GET") return await handleListOrders(request, env);
      const orderMatch = path.match(/^\/api\/orders\/(\d+)$/);
      if (orderMatch) return await handleGetOrder(Number(orderMatch[1]), env);
    } catch (e) {
      return json({ error: "error interno: " + (e && e.message ? e.message : String(e)) }, 500);
    }

    if (path === "/skills/search_catalog/tool.js") { return new Response(SEARCH_CATALOG_TOOL_JS, { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" } }); }
    if (path === "/skills/search_catalog/SKILL.md") { return new Response(SEARCH_CATALOG_SKILL_MD, { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" } }); }
    if (path === "/skills/get_product/tool.js") { return new Response(GET_PRODUCT_TOOL_JS, { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" } }); }
    if (path === "/skills/get_product/SKILL.md") { return new Response(GET_PRODUCT_SKILL_MD, { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" } }); }
    if (path === "/skills/create_order/tool.js") { return new Response(CREATE_ORDER_TOOL_JS, { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" } }); }
    if (path === "/skills/create_order/SKILL.md") { return new Response(CREATE_ORDER_SKILL_MD, { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" } }); }
    if (path === "/skills/order_status/tool.js") { return new Response(ORDER_STATUS_TOOL_JS, { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" } }); }
    if (path === "/skills/order_status/SKILL.md") { return new Response(ORDER_STATUS_SKILL_MD, { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" } }); }

    return json({ error: "Not Found", path }, 404);
  }
};

async function handleSearch(url, env) {
  const q = (url.searchParams.get("q") || "").trim();
  const category = (url.searchParams.get("category") || "").trim();
  const maxPriceRaw = url.searchParams.get("max_price");
  const maxPrice = maxPriceRaw !== null ? Number(maxPriceRaw) : null;
  const where = [];
  const params = [];
  if (q.length > 0) {
    where.push("(LOWER(name) LIKE LOWER(?) OR LOWER(description) LIKE LOWER(?))");
    params.push("%" + q + "%", "%" + q + "%");
  }
  if (category.length > 0) { where.push("category = ?"); params.push(category); }
  if (maxPrice !== null && Number.isFinite(maxPrice)) { where.push("price <= ?"); params.push(maxPrice); }
  const sql = "SELECT sku, name, description, category, price, stock FROM products" +
    (where.length ? " WHERE " + where.join(" AND ") : "") + " ORDER BY sku LIMIT 10";
  const { results } = await env.DB.prepare(sql).bind(...params).all();
  return json(results);
}

async function handleProduct(sku, env) {
  const product = await env.DB.prepare("SELECT sku, name, description, category, price, stock FROM products WHERE sku = ?").bind(sku).first();
  if (!product) return json({ error: "product not found", sku }, 404);
  return json(Object.assign({ found: true }, product));
}

async function handleCreateOrder(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const sku = body && body.sku;
  const qty = body && body.qty;
  const email = body && body.email;
  const clientOrderId = body && typeof body.client_order_id === "string" && body.client_order_id.length > 0 ? body.client_order_id : null;
  if (typeof sku !== "string" || sku.length === 0) return json({ error: "sku required" }, 400);
  if (typeof qty !== "number" || !Number.isFinite(qty) || qty < 1 || Math.floor(qty) !== qty) {
    return json({ error: "qty must be an integer >= 1" }, 400);
  }
  if (typeof email !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: "valid email required" }, 400);
  }
  // Idempotencia: mismo client_order_id -> la orden original (nunca duplicado).
  if (clientOrderId) {
    const existing = await env.DB.prepare("SELECT order_id, sku, qty, email, total, status, created_at FROM orders WHERE client_order_id = ?").bind(clientOrderId).first();
    if (existing) return json(Object.assign({ idempotent: true }, existing), 200);
  }
  const product = await env.DB.prepare("SELECT sku, price, stock FROM products WHERE sku = ?").bind(sku).first();
  if (!product) return json({ error: "product not found", sku }, 409);
  if (product.stock < qty) {
    return json({ error: "insufficient stock", requested: qty, available: product.stock }, 409);
  }
  const now = new Date().toISOString();
  const results = await env.DB.batch([
    env.DB.prepare("INSERT INTO orders (sku, qty, email, total, client_order_id, status, created_at) VALUES (?, ?, ?, ?, ?, 'confirmed', ?)")
      .bind(sku, qty, email, product.price * qty, clientOrderId, now),
    env.DB.prepare("UPDATE products SET stock = stock - ? WHERE sku = ? AND stock >= ?").bind(qty, sku, qty),
  ]);
  const orderId = results[0] && results[0].meta && results[0].meta.last_row_id;
  const changes = results[1] && results[1].meta && results[1].meta.changes;
  if (!changes) {
    return json({ error: "insufficient stock (race)", requested: qty, available: product.stock }, 409);
  }
  return json({ order_id: orderId, sku, qty, total: product.price * qty, remaining_stock: product.stock - qty, order_status: "confirmed", idempotent: false }, 200);
}

async function handleGetOrder(id, env) {
  const order = await env.DB.prepare("SELECT order_id, sku, qty, email, total, status, created_at FROM orders WHERE order_id = ?").bind(id).first();
  if (!order) return json({ error: "Not Found", id }, 404);
  return json(order);
}

async function handleListOrders(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const expected = "Bearer " + (env.ADMIN_TOKEN || "");
  if (!env.ADMIN_TOKEN || auth !== expected) {
    return json({ error: "unauthorized: merchant token required" }, 401);
  }
  const limitRaw = Number(new URL(request.url).searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw >= 1 && limitRaw <= 200 ? Math.floor(limitRaw) : 50;
  const { results } = await env.DB.prepare("SELECT order_id, sku, qty, email, total, status, client_order_id, created_at FROM orders ORDER BY order_id DESC LIMIT ?").bind(limit).all();
  return json({ orders: results, count: results.length });
}
