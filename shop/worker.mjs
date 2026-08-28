// AUTOGENERADO por shop/build.mjs. No editar a mano.
const SEARCH_CATALOG_TOOL_JS = "registerTool({\n  name: \"search_catalog\",\n  description: \"Search the shop catalog: free-text over name and description, optionally filtered by category and max price. Returns up to 10 products with sku, name, price, category and stock.\",\n  inputSchema: {\n    type: \"object\",\n    properties: {\n      q: { type: \"string\", description: \"Free-text query, matched against name and description.\" },\n      category: { type: \"string\", description: \"Exact category filter, e.g. merch or hardware.\" },\n      max_price: { type: \"number\", description: \"Maximum price (inclusive) filter.\" }\n    }\n  },\n  handler: async function (args) {\n    args = args || {};\n    // URLSearchParams no existe en el sandbox QuickJS (solo built-ins ECMAScript):\n    // construir el query string a mano con encodeURIComponent (built-in).\n    const parts = [];\n    if (typeof args.q === \"string\" && args.q.length > 0) {\n      parts.push(\"q=\" + encodeURIComponent(args.q));\n    }\n    if (typeof args.category === \"string\" && args.category.length > 0) {\n      parts.push(\"category=\" + encodeURIComponent(args.category));\n    }\n    if (typeof args.max_price === \"number\" && Number.isFinite(args.max_price)) {\n      parts.push(\"max_price=\" + String(args.max_price));\n    }\n    const qs = parts.join(\"&\");\n    const r = await host.fetchOrigin(qs ? \"/api/search?\" + qs : \"/api/search\");\n    return JSON.parse(r.body);\n  }\n});";
const SEARCH_CATALOG_SKILL_MD = "---\nname: search_catalog\nversion: 1.0.0\nlicense: MIT\n---\n\n# search_catalog\n\nBusca en el catálogo de la tienda. Empareja texto libre contra `name` y\n`description`, con filtros opcionales por `category` (exacta) y `max_price`\n(inclusivo). Devuelve hasta 10 productos con `sku`, `name`, `price`,\n`category` y `stock`.\n\n## Argumentos\n\n- `q` (string, opcional): texto libre contra name y description.\n- `category` (string, opcional): categoría exacta, p.ej. `merch` o `hardware`.\n- `max_price` (number, opcional): precio máximo inclusivo.\n\n## Ejemplo\n\n```json\n{ \"q\": \"mug\", \"max_price\": 20 }\n```\n\nEl `sku` devuelto es el identificador para `get_product` y `create_order`.";
const GET_PRODUCT_TOOL_JS = "registerTool({\n  name: \"get_product\",\n  description: \"Get full details of one product by SKU: name, description, category, price and live stock. Returns {found:false} when the SKU does not exist.\",\n  inputSchema: {\n    type: \"object\",\n    properties: {\n      sku: { type: \"string\", description: \"Product SKU, e.g. wasm-mug.\" }\n    },\n    required: [\"sku\"]\n  },\n  handler: async function (args) {\n    args = args || {};\n    if (typeof args.sku !== \"string\" || args.sku.length === 0) {\n      return { found: false, error: \"sku must be a non-empty string\" };\n    }\n    const r = await host.fetchOrigin(\"/api/product/\" + encodeURIComponent(args.sku));\n    if (r.status === 404) return { found: false };\n    return JSON.parse(r.body);\n  }\n});";
const GET_PRODUCT_SKILL_MD = "---\nname: get_product\nversion: 1.0.0\nlicense: MIT\n---\n\n# get_product\n\nDetalle completo de un producto por su `sku`: name, description, category,\nprice y **stock en vivo**. Devuelve `{found: false}` si el sku no existe.\n\n## Argumentos\n\n- `sku` (string, requerido): p.ej. `wasm-mug`.\n\n## Cuándo usarla\n\nAntes de crear una orden grande: el `stock` que devuelve `search_catalog`\npuede estar desactualizado (otro agente pudo comprar mientras tanto);\n`get_product` da el valor vivo y `create_order` es quien decide al final con\nsu 409 si el stock ya no alcanzó.";
const CREATE_ORDER_TOOL_JS = "registerTool({\n  name: \"create_order\",\n  description: \"Create an order for a product (decrements stock atomically). Returns {ok:true, order_id, sku, qty, total, remaining_stock, order_status}. IDEMPOTENT: pass a client_order_id (any string unique to this purchase intent, e.g. a UUID) and retries return the SAME order instead of duplicating it. Returns {ok:false, status:409} when the SKU is unknown or stock is insufficient.\",\n  inputSchema: {\n    type: \"object\",\n    properties: {\n      sku: { type: \"string\", description: \"Product SKU to order.\" },\n      qty: { type: \"number\", description: \"Quantity, integer >= 1.\" },\n      email: { type: \"string\", description: \"Customer email for the order confirmation.\" },\n      client_order_id: { type: \"string\", description: \"Optional idempotency key: a string unique to this purchase intent. On retry with the same key, the API returns the original order instead of creating a duplicate.\" }\n    },\n    required: [\"sku\", \"qty\", \"email\"]\n  },\n  handler: async function (args) {\n    args = args || {};\n    if (typeof args.sku !== \"string\" || args.sku.length === 0) {\n      return { ok: false, error: \"sku must be a non-empty string\" };\n    }\n    if (typeof args.qty !== \"number\" || !Number.isFinite(args.qty) ||\n        args.qty < 1 || Math.floor(args.qty) !== args.qty) {\n      return { ok: false, error: \"qty must be an integer >= 1\" };\n    }\n    if (typeof args.email !== \"string\" || !/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(args.email)) {\n      return { ok: false, error: \"email must be a valid address\" };\n    }\n    const body = JSON.stringify({\n      sku: args.sku, qty: args.qty, email: args.email,\n      client_order_id: typeof args.client_order_id === \"string\" ? args.client_order_id : undefined\n    });\n    const r = await host.fetchOrigin(\"/api/orders\", { method: \"POST\", body });\n    let parsed = null;\n    try { parsed = JSON.parse(r.body); } catch { parsed = { error: r.body }; }\n    if (r.status >= 400) {\n      return Object.assign({ ok: false, status: r.status }, parsed);\n    }\n    // payment_url es RELATIVA al origin: absolutizarla para el humano\n    if (parsed.payment_url && typeof parsed.payment_url === \"string\") {\n      parsed.payment_url = \"https://llmstxt-shop.rckflr.workers.dev\" + parsed.payment_url;\n    }\n    return Object.assign({ ok: true }, parsed);\n  }\n});";
const CREATE_ORDER_SKILL_MD = "---\nname: create_order\nversion: 1.0.0\nlicense: MIT\n---\n\n# create_order\n\nCrea una orden por un producto, decrementando el stock **atómicamente** en\nuna transacción D1. Devuelve `{ok: true, order_id, sku, qty, total,\nremaining_stock, payment_url}` o `{ok: false, status: 409, error}` si el sku\nno existe o el stock no alcanzó.\n\n## El flujo de compra que el agente debe seguir\n\n1. `search_catalog` (o `get_product`) para elegir el producto y su `sku`.\n2. **Confirma con el humano** antes de comprar: producto, cantidad, precio y\n   el email al que va la orden. Comprar es un efecto en el mundo real — nunca\n   invoques esta tool sin un OK explícito del humano.\n3. Llama `create_order` con `{sku, qty, email, client_order_id}`.\n4. **Genera un `client_order_id` único por intención de compra** (p.ej. un\n   UUID). Si un reintento o error de red te deja dudoso, repite la llamada con\n   el MISMO `client_order_id`: la API devuelve la orden original\n   (`idempotent: true`) en vez de duplicarla.\n5. **Entrega al humano el `payment_url`** que devuelve la tool: es el paylink\n   (página de pago simulada en este demo) que marca la orden como `paid`.\n   El pago es del HUMANO — no lo ejecutes por tu cuenta salvo petición\n   explícita. El estado pasa de `confirmed` a `paid`.\n6. Reporta al humano: `order_id`, `total`, `remaining_stock` y el paylink.\n\n## Idempotencia\n\n- `client_order_id` es una clave de deduplicación del CLIENTE.\n- Misma clave → misma orden, siempre (200, `idempotent: true`, mismo\n  `payment_url`).\n- Clave distinta → orden nueva (aunque sea el mismo producto).\n- Sin clave → cada llamada crea una orden nueva. Para agentes: SIEMPRE mandar\n  la clave.\n\n## Errores\n\n| status | significado |\n|---|---|\n| 400 | validación (email inválido, qty no entera, sku vacío) |\n| 409 | sku desconocido o `insufficient stock` (trae `requested`/`available`) |";
const ORDER_STATUS_TOOL_JS = "registerTool({\n  name: \"order_status\",\n  description: \"Look up one order by its numeric id. Returns {found:true, order:{order_id, sku, qty, email, total, status, created_at}} or {found:false}.\",\n  inputSchema: {\n    type: \"object\",\n    properties: {\n      order_id: { type: \"number\", description: \"Numeric order id returned by create_order.\" }\n    },\n    required: [\"order_id\"]\n  },\n  handler: async function (args) {\n    args = args || {};\n    if (typeof args.order_id !== \"number\" || !Number.isFinite(args.order_id)) {\n      return { found: false, error: \"order_id must be a finite number\" };\n    }\n    const r = await host.fetchOrigin(\"/api/orders/\" + String(args.order_id));\n    if (r.status === 404) return { found: false };\n    const parsed = JSON.parse(r.body);\n    return { found: true, order: parsed };\n  }\n});";
const ORDER_STATUS_SKILL_MD = "---\nname: order_status\nversion: 1.0.0\nlicense: MIT\n---\n\n# order_status\n\nConsulta una orden por su id numérico. Devuelve\n`{found: true, order: {order_id, sku, qty, email, total, status, created_at}}`\no `{found: false}`.\n\n## Argumentos\n\n- `order_id` (number, requerido): el id que devolvió `create_order`.\n\n## Cuándo usarla\n\nDespués de una compra con respuesta dudosa (timeout, error de red): confirma\nsi la orden existe antes de reintentar `create_order`. Y para darle al humano\nel estado actualizado de una compra previa.";
const CREATE_PRODUCT_TOOL_JS = "registerTool({\n  name: \"create_product\",\n  description: \"PAID TOOL: list a new product on the marketplace catalog. Requires a creator license token (buy via buy_creator_access: $19 for 25 listings, 30 days). Without a valid token returns needs_payment with next steps. This is a real-world effect: confirm name and price with the human first.\",\n  inputSchema: {\n    type: \"object\",\n    properties: {\n      name: { type: \"string\", description: \"Product name (non-empty).\" },\n      description: { type: \"string\", description: \"Product description.\" },\n      price: { type: \"number\", description: \"Price >= 0.\" },\n      stock: { type: \"number\", description: \"Initial stock (default 0).\" },\n      category: { type: \"string\", description: \"Optional category (default 'marketplace').\" },\n      sku: { type: \"string\", description: \"Optional SKU; generated from name if omitted.\" },\n      access_token: { type: \"string\", description: \"Creator license token (from the human after paying the buy_creator_access paylink).\" }\n    },\n    required: [\"name\", \"price\"]\n  },\n  handler: async function (args) {\n    args = args || {};\n    if (typeof args.name !== \"string\" || args.name.trim().length === 0) {\n      return { ok: false, error: \"name must be a non-empty string\" };\n    }\n    if (typeof args.price !== \"number\" || !Number.isFinite(args.price) || args.price < 0) {\n      return { ok: false, error: \"price must be a number >= 0\" };\n    }\n    if (typeof args.access_token !== \"string\" || args.access_token.length === 0) {\n      return {\n        ok: false, needs_payment: true, price: 19, uses: 25,\n        next_step: \"llama buy_creator_access {email} para generar el paylink; el humano paga y te da el license_token; reintenta create_product con access_token\"\n      };\n    }\n    const body = JSON.stringify({\n      name: args.name,\n      description: typeof args.description === \"string\" ? args.description : undefined,\n      price: args.price,\n      stock: typeof args.stock === \"number\" ? args.stock : undefined,\n      category: typeof args.category === \"string\" ? args.category : undefined,\n      sku: typeof args.sku === \"string\" ? args.sku : undefined\n    });\n    const r = await host.fetchOrigin(\"/api/products\", { method: \"POST\", headers: { Authorization: \"Bearer \" + args.access_token }, body });\n    let parsed = null;\n    try { parsed = JSON.parse(r.body); } catch { parsed = { error: r.body }; }\n    if (r.status === 401) return Object.assign({ ok: false, needs_payment: true }, parsed);\n    if (r.status >= 400) return Object.assign({ ok: false, status: r.status }, parsed);\n    return Object.assign({ ok: true }, parsed);\n  }\n});";
const CREATE_PRODUCT_SKILL_MD = "---\nname: create_product\nversion: 1.0.0\nlicense: MIT\n---\n\n# create_product\n\n**Tool de pago**: publica un producto nuevo en el catálogo del marketplace.\nRequiere un token de licencia de creador ($19 → 25 listados, 30 días).\nDevuelve `{ok: true, sku, name, price, stock, uses_left}` o\n`{ok: false, needs_payment: true}` si falta el token.\n\n## El flujo de venta que el agente debe seguir\n\n1. El humano dice que quiere vender algo en la tienda.\n2. Llama `buy_creator_access` con el **email del humano** → obtiene un\n   `payment_url` (paylink de licencia).\n3. **Entrega el paylink al humano**: es SU compra, no la tuya. La página\n   muestra el `license_token` tras el pago.\n4. El humano te pasa el token. Verifícalo con `check_license` (gratis).\n5. Llama `create_product` con `{name, price, access_token, ...}` — y como\n   siempre: **confirma nombre, precio y stock con el humano antes**.\n6. Reporta el `sku` creado y los `uses_left` restantes.\n\n## Sin token\n\n- Sin `access_token` la tool responde `{ok:false, needs_payment:true}` — no\n  insistas: el acceso se compra, no se salta.\n- Token inválido/expirado/agotado → el worker responde 401/403 con la causa.\n\n## Errores\n\n| status | significado |\n|---|---|\n| 400 | validación (name vacío, price negativo) |\n| 401 | falta o es inválido el license token (needs_payment) |\n| 403 | licencia expirada o sin listados restantes |";
const BUY_CREATOR_ACCESS_TOOL_JS = "registerTool({\n  name: \"buy_creator_access\",\n  description: \"Start the purchase of a creator license to list products ($19 for 25 listings, 30 days). Returns the paylink for the HUMAN to pay. After payment the paylink page shows the license token: the human gives it to you for create_product. Free to call.\",\n  inputSchema: {\n    type: \"object\",\n    properties: {\n      email: { type: \"string\", description: \"Email of the human buying the license (for the receipt and the license record).\" }\n    },\n    required: [\"email\"]\n  },\n  handler: async function (args) {\n    args = args || {};\n    if (typeof args.email !== \"string\" || args.email.length === 0) {\n      return { ok: false, error: \"email required (the human's email)\" };\n    }\n    const r = await host.fetchOrigin(\"/api/licenses/purchase\", {\n      method: \"POST\",\n      body: JSON.stringify({ email: args.email })\n    });\n    let parsed = null;\n    try { parsed = JSON.parse(r.body); } catch { parsed = { error: r.body }; }\n    if (r.status >= 400) return Object.assign({ ok: false, status: r.status }, parsed);\n    if (parsed.payment_url && typeof parsed.payment_url === \"string\") {\n      parsed.payment_url = \"https://llmstxt-shop.rckflr.workers.dev\" + parsed.payment_url;\n    }\n    return Object.assign({ ok: true }, parsed);\n  }\n});";
const BUY_CREATOR_ACCESS_SKILL_MD = "---\nname: buy_creator_access\nversion: 1.0.0\nlicense: MIT\n---\n\n# buy_creator_access\n\nInicia la compra de una **licencia de creador** para publicar productos en el\nmarketplace: $19 por 25 listados, 30 días de vigencia. La tool es gratis;\nlo que vende es el acceso a `create_product`.\n\n## Flujo\n\n1. Pide el email del humano.\n2. Llama la tool → `payment_url` (paylink).\n3. El humano paga en el paylink (página simulada en este demo — sin dinero\n   real todavía).\n4. La página del paylink muestra el **license_token** tras el pago.\n5. El humano te da el token → ya puedes usar `create_product`.\n\n## Reglas\n\n- El pago del paylink es del HUMANO: nunca lo ejecutes por tu cuenta salvo\n  petición explícita.\n- El token NO se muestra en la respuesta de esta tool — vive en la página de\n  pago que ve el humano (por diseño: el que paga, recibe).";
const CHECK_LICENSE_TOOL_JS = "registerTool({\n  name: \"check_license\",\n  description: \"Check a creator license token: status, listings left, expiry. Free. Useful to verify a token before trying create_product, or to remind the human how many listings they have left.\",\n  inputSchema: {\n    type: \"object\",\n    properties: {\n      access_token: { type: \"string\", description: \"Creator license token.\" }\n    },\n    required: [\"access_token\"]\n  },\n  handler: async function (args) {\n    args = args || {};\n    if (typeof args.access_token !== \"string\" || args.access_token.length === 0) {\n      return { found: false, error: \"access_token required\" };\n    }\n    const r = await host.fetchOrigin(\"/api/license/\" + encodeURIComponent(args.access_token));\n    if (r.status === 404) return { found: false };\n    return JSON.parse(r.body);\n  }\n});";
const CHECK_LICENSE_SKILL_MD = "---\nname: check_license\nversion: 1.0.0\nlicense: MIT\n---\n\n# check_license\n\nConsulta el estado de un token de licencia de creador: plan, listados\nrestantes (`uses_left`), vencimiento. **Gratis** — sin aprobación humana.\n\n## Cuándo usarla\n\n- Antes de `create_product`, para verificar que el token del humano está\n  activo y tiene usos disponibles.\n- Para decirle al humano cuántos listados le quedan.\n- Si `create_product` falló con 401/403, para distinguir token inválido de\n  licencia agotada.";

const LLMS_TXT = "# llmstxt-shop\n\n> The BYOA storefront: your agent browses the catalog, buys with your approval, and orders are idempotent — retries never duplicate. Browsing and buying are free; LISTING products is the paid tool (creator license, $19 for 25 listings via paylink). Read tools hit a live D1 catalog; every write is a real-world effect and asks the human first.\n\n## Skills\n\n- [search_catalog](/skills/search_catalog/SKILL.md): Search the shop catalog by text, category and/or max price. Returns products with sku, price and live stock. <!-- skill: {\"version\":\"1.0.0\",\"sha256\":\"4a7f75400ca6879f562e996a8570a578b6dabd916db8a45856eece36383246d1\",\"tool\":\"/skills/search_catalog/tool.js\",\"tool_sha256\":\"74d717454cbc86599fbe00e49eec0d7fd2c982a5a066a2bc6188d9b89ed48e39\"} -->\n- [get_product](/skills/get_product/SKILL.md): Get full details of one product by SKU (name, description, price, live stock). Returns {found:false} if unknown. <!-- skill: {\"version\":\"1.0.0\",\"sha256\":\"e133b8e26cbd5f531f074ab0683ee487a37883385598d555211ffc56eb875060\",\"tool\":\"/skills/get_product/tool.js\",\"tool_sha256\":\"4c556c51b53670c96dd033ac79a8e92539bb8c23f77eec12f75e25404823030e\"} -->\n- [create_order](/skills/create_order/SKILL.md): Create an order (atomic stock decrement). IDEMPOTENT via client_order_id: retries return the same order. 409 when unknown SKU or insufficient stock. ALWAYS confirm product, qty and email with the human first. <!-- skill: {\"version\":\"1.0.0\",\"sha256\":\"b02464b9034d190c96c0090ddb6b183e078dfef56fa6a87ed424ac73e5929bc4\",\"tool\":\"/skills/create_order/tool.js\",\"tool_sha256\":\"94190c05b1886bd595dd50208bed35e4bc42481e7598075df807844d6deb9afd\"} -->\n- [order_status](/skills/order_status/SKILL.md): Look up one order by numeric id. Confirms whether a doubtful purchase actually landed before retrying. <!-- skill: {\"version\":\"1.0.0\",\"sha256\":\"541d81ffebaf49c628e7163db1a45d684fe72f0c57a4098a2c3d4b3142365a42\",\"tool\":\"/skills/order_status/tool.js\",\"tool_sha256\":\"78e95c013ce63e9decd4e37218c8fc9d955f14c0c716ce55fb81eb0f96203336\"} -->\n- [create_product](/skills/create_product/SKILL.md): PAID TOOL: list a new product on the marketplace. Requires a creator license token (buy with buy_creator_access — $19 for 25 listings, 30 days). Without a valid token returns needs_payment with the paylink. <!-- skill: {\"version\":\"1.0.0\",\"sha256\":\"908173e377554f8ef32bbe9d4043142ed45f6f518bd4addf7280093aacd025f8\",\"tool\":\"/skills/create_product/tool.js\",\"tool_sha256\":\"f8d4d00e26127d114b32a5a77ca333f7de53503134709452a65b9ff8da5eb6fa\"} -->\n- [buy_creator_access](/skills/buy_creator_access/SKILL.md): Start the purchase of a creator license: returns the paylink for the HUMAN to pay. After payment the human receives the license token to use in create_product. <!-- skill: {\"version\":\"1.0.0\",\"sha256\":\"d65897bd698157e2c926fdd46d5c5ddf31368c8310e12970335f89e68ec09170\",\"tool\":\"/skills/buy_creator_access/tool.js\",\"tool_sha256\":\"743800c6e1aafe31498eb5234d508a8914dbbd59e64562d309568282fc6c6b2f\"} -->\n- [check_license](/skills/check_license/SKILL.md): Check a creator license token: plan, uses left, expiry. Free. <!-- skill: {\"version\":\"1.0.0\",\"sha256\":\"1f4f77f05c7eb804b27e68b44e50be5ecde4a45444a65071cec2253574ee9061\",\"tool\":\"/skills/check_license/tool.js\",\"tool_sha256\":\"22de2bec8ffd99cee4b984c82d682dbc9eefad3445cef53906dbb125c6ca9f4a\"} -->\n";
const LANDING_HTML = "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>llmstxt-shop — the BYOA storefront</title>\n<style>body{font-family:system-ui,sans-serif;max-width:52rem;margin:2rem auto;padding:0 1rem;line-height:1.55;color:#14181f;background:#fafbfc}code{background:#eef1f4;padding:.1rem .35rem;border-radius:4px;font-size:.92em}a{color:#0b62a4}h1{border-bottom:2px solid #e4e8ec;padding-bottom:.4rem}table{border-collapse:collapse;width:100%;margin:1rem 0}td,th{border:1px solid #e4e8ec;padding:.45rem .6rem;text-align:left;font-size:.95rem}th{background:#eef1f4}pre{background:#14181f;color:#d7e2ec;padding:.8rem 1rem;border-radius:8px;overflow-x:auto}footer{margin-top:2.5rem;color:#66707b;font-size:.9rem;border-top:1px solid #e4e8ec;padding-top:1rem}.pill{display:inline-block;background:#0b62a4;color:#fff;border-radius:99px;padding:.1rem .6rem;font-size:.85rem;margin-right:.4rem}</style>\n</head>\n<body>\n<h1>llmstxt-shop</h1>\n<p>The <strong>BYOA storefront</strong>: no cart UI, no checkout wizard. Your agent browses the catalog, proposes the purchase, <em>you approve</em>, and the order is real — atomic stock, idempotent retries, an <code>order_id</code> you can query forever. Built on <a href=\"https://github.com/MauricioPerera/mcpwasm\">mcpwasm</a>: static discovery with verified hashes, tools that run sandboxed on the consumer's machine.</p>\n<h2>Point your agent here</h2>\n<pre>npx -y @rckflr/mcpwasm https://llmstxt-shop.rckflr.workers.dev</pre>\n<p>...or through the gateway: <code>POST https://llmstxt-gateway.rckflr.workers.dev/mcp?origin=https%3A%2F%2Fllmstxt-shop.rckflr.workers.dev</code></p>\n<h2>Skills</h2>\n<ul>\n      <li><code>search_catalog</code> — <a href=\"/skills/search_catalog/SKILL.md\">SKILL.md</a> · <a href=\"/skills/search_catalog/tool.js\">tool.js</a></li>\n      <li><code>get_product</code> — <a href=\"/skills/get_product/SKILL.md\">SKILL.md</a> · <a href=\"/skills/get_product/tool.js\">tool.js</a></li>\n      <li><code>create_order</code> — <a href=\"/skills/create_order/SKILL.md\">SKILL.md</a> · <a href=\"/skills/create_order/tool.js\">tool.js</a></li>\n      <li><code>order_status</code> — <a href=\"/skills/order_status/SKILL.md\">SKILL.md</a> · <a href=\"/skills/order_status/tool.js\">tool.js</a></li>\n      <li><code>create_product</code> — <a href=\"/skills/create_product/SKILL.md\">SKILL.md</a> · <a href=\"/skills/create_product/tool.js\">tool.js</a></li>\n      <li><code>buy_creator_access</code> — <a href=\"/skills/buy_creator_access/SKILL.md\">SKILL.md</a> · <a href=\"/skills/buy_creator_access/tool.js\">tool.js</a></li>\n      <li><code>check_license</code> — <a href=\"/skills/check_license/SKILL.md\">SKILL.md</a> · <a href=\"/skills/check_license/tool.js\">tool.js</a></li>\n  </ul>\n<h2>Catalog (live)</h2>\n<table>\n      <tr><th>SKU</th><th>Product</th><th>Price</th><th>Stock</th></tr>\n      <tr><td><code>mcpwasm-stickers</code></td><td>mcpwasm sticker pack</td><td>$6.00</td><td>120</td></tr>\n      <tr><td><code>llmstxt-poster</code></td><td>llms.txt poster A2</td><td>$18.00</td><td>45</td></tr>\n      <tr><td><code>wasm-mug</code></td><td>QuickJS mug</td><td>$14.00</td><td>60</td></tr>\n      <tr><td><code>byoa-tee</code></td><td>BYOA tee</td><td>$25.00</td><td>38</td></tr>\n      <tr><td><code>agent-keycaps</code></td><td>Agent keycaps</td><td>$32.00</td><td>22</td></tr>\n      <tr><td><code>ephemeral-clock</code></td><td>Ephemeral desk clock</td><td>$48.00</td><td>8</td></tr>\n      <tr><td><code>d1-coaster</code></td><td>D1 coasters (x4)</td><td>$12.00</td><td>90</td></tr>\n      <tr><td><code>static-sshirt</code></td><td>Static-first hoodie</td><td>$55.00</td><td>15</td></tr>\n    </table>\n<h2>For merchants</h2>\n<p>Orders live in D1. List them with the admin token: <code>GET /api/orders?limit=50</code> + <code>Authorization: Bearer &lt;ADMIN_TOKEN&gt;</code>. Want to SELL here? Your agent buys a <strong>creator license</strong> ($19 / 25 listings / 30 days): it calls <code>buy_creator_access</code>, you pay the paylink, it lists products with <code>create_product</code>. And if you want a storefront of your own: your agent can build and deploy one in seconds on <a href=\"https://llmstxt-studio.rckflr.workers.dev\">llmstxt-studio</a> (throwaway account, claim to keep it).</p>\n<footer>Generated by shop/build.mjs — do not edit the worker by hand. BYOA: your agent, your model, our catalog and orders.</footer>\n</body>\n</html>";
  const ATTESTATIONS = [
  {
    "origin": "https://llmstxt-shop.rckflr.workers.dev",
    "skill": "search_catalog",
    "tool_sha256": "74d717454cbc86599fbe00e49eec0d7fd2c982a5a066a2bc6188d9b89ed48e39",
    "attester": "human:mauricio-3",
    "signed_on": "2026-08-28",
    "valid_until": "2027-08-28",
    "signature": "nVK9fD6kMvPS5WiS1zVqe0//N7mlwWfqBJTmljQOtMDxwUuHu5bYtsmJbZDF8Nx08UMwBoZampRBbzPshwCJDQ=="
  },
  {
    "origin": "https://llmstxt-shop.rckflr.workers.dev",
    "skill": "get_product",
    "tool_sha256": "4c556c51b53670c96dd033ac79a8e92539bb8c23f77eec12f75e25404823030e",
    "attester": "human:mauricio-3",
    "signed_on": "2026-08-28",
    "valid_until": "2027-08-28",
    "signature": "jBr5KCSX8jquKkSglGTDERVDxGKFmm/2QwEeF+5HrbWxowuluSXXOX3dVr1F130kN2/nOlOi6B05LDDBATXlDw=="
  },
  {
    "origin": "https://llmstxt-shop.rckflr.workers.dev",
    "skill": "create_order",
    "tool_sha256": "94190c05b1886bd595dd50208bed35e4bc42481e7598075df807844d6deb9afd",
    "attester": "human:mauricio-3",
    "signed_on": "2026-08-28",
    "valid_until": "2027-08-28",
    "signature": "VGAHGp2BaD+gusHxfX3Bqdm7Y0xDa9G433lhaQC2lEwN5Ba0Y5ikNMBGw+V1jGb/RWFi7Y4VzRJQESSjGPrqCQ=="
  },
  {
    "origin": "https://llmstxt-shop.rckflr.workers.dev",
    "skill": "order_status",
    "tool_sha256": "78e95c013ce63e9decd4e37218c8fc9d955f14c0c716ce55fb81eb0f96203336",
    "attester": "human:mauricio-3",
    "signed_on": "2026-08-28",
    "valid_until": "2027-08-28",
    "signature": "hvww04Y9CtOJ3WCmlT+SxJaczLKIE0Mbw/OtmKZUQ23Z1Cvkt600iGC7BCZiGpseoPGR/f4gZoYwVhTw6GdwBQ=="
  },
  {
    "origin": "https://llmstxt-shop.rckflr.workers.dev",
    "skill": "create_product",
    "tool_sha256": "f8d4d00e26127d114b32a5a77ca333f7de53503134709452a65b9ff8da5eb6fa",
    "attester": "human:mauricio-3",
    "signed_on": "2026-08-28",
    "valid_until": "2027-08-28",
    "signature": "CaXasKXoNopX2piQV7xEsjmMTSNa+KIkuacMgpS/P1Xe9IjerBjI2ox8iVCLSFrjgVaLq4vwxM/G1rTPZm79BQ=="
  },
  {
    "origin": "https://llmstxt-shop.rckflr.workers.dev",
    "skill": "buy_creator_access",
    "tool_sha256": "743800c6e1aafe31498eb5234d508a8914dbbd59e64562d309568282fc6c6b2f",
    "attester": "human:mauricio-3",
    "signed_on": "2026-08-28",
    "valid_until": "2027-08-28",
    "signature": "EcadSjwtXaCXmd1vN9Yy8JuBbBav9w1YvWvgqkf3XfgkyXvi8Yc5/DR8+M7gfVdxJcPVAoCWRtqzs8m187B2Cg=="
  },
  {
    "origin": "https://llmstxt-shop.rckflr.workers.dev",
    "skill": "check_license",
    "tool_sha256": "22de2bec8ffd99cee4b984c82d682dbc9eefad3445cef53906dbb125c6ca9f4a",
    "attester": "human:mauricio-3",
    "signed_on": "2026-08-28",
    "valid_until": "2027-08-28",
    "signature": "WbBzPQM6RReYOgURvS+CWcO8Du4eQi1tCapJxknBbO92zqKXiP+kI/n2Y17vls21rZkZEpaY4lYwWisF7BUzCQ=="
  }
];

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
      if (path === "/api/licenses" && request.method === "GET") return await handleListLicenses(request, env);
      const payPageMatch = path.match(/^\/pay\/(\d+)$/);
      if (payPageMatch) return await handlePayPage(request, env, Number(payPageMatch[1]), url.searchParams.get("pt") || "");
      const payApiMatch = path.match(/^\/api\/pay\/(\d+)$/);
      if (payApiMatch && request.method === "POST") return await handlePay(request, env, Number(payApiMatch[1]));
      if (path === "/api/products" && request.method === "POST") return await handleProductCreate(request, env);
      if (path === "/api/licenses/purchase" && request.method === "POST") return await handleLicensePurchase(request, env);
      if (path === "/api/licenses/activate" && request.method === "POST") return await handleLicenseActivate(request, env);
      const licMatch = path.match(/^\/api\/license\/([0-9a-fA-F-]+)$/);
      if (licMatch) return await handleLicenseGet(request, env, licMatch[1]);
      const buyPageMatch = path.match(/^\/buy\/([0-9a-fA-F-]+)$/);
      if (buyPageMatch) return await handleLicensePage(request, env, buyPageMatch[1], url.searchParams.get("pt") || "");
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
    if (path === "/skills/create_product/tool.js") { return new Response(CREATE_PRODUCT_TOOL_JS, { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" } }); }
    if (path === "/skills/create_product/SKILL.md") { return new Response(CREATE_PRODUCT_SKILL_MD, { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" } }); }
    if (path === "/skills/buy_creator_access/tool.js") { return new Response(BUY_CREATOR_ACCESS_TOOL_JS, { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" } }); }
    if (path === "/skills/buy_creator_access/SKILL.md") { return new Response(BUY_CREATOR_ACCESS_SKILL_MD, { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" } }); }
    if (path === "/skills/check_license/tool.js") { return new Response(CHECK_LICENSE_TOOL_JS, { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" } }); }
    if (path === "/skills/check_license/SKILL.md") { return new Response(CHECK_LICENSE_SKILL_MD, { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" } }); }

  if (path === "/.well-known/agent-skills/attestations.json") {
      return new Response(JSON.stringify(ATTESTATIONS), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
    }

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
    const existing = await env.DB.prepare("SELECT order_id, sku, qty, email, total, status, payment_token, created_at FROM orders WHERE client_order_id = ?").bind(clientOrderId).first();
    if (existing) {
      const payUrl = existing.payment_token ? "/pay/" + existing.order_id + "?pt=" + existing.payment_token : null;
      return json(Object.assign({ idempotent: true }, existing, { payment_url: payUrl }), 200);
    }
  }
  const product = await env.DB.prepare("SELECT sku, price, stock FROM products WHERE sku = ?").bind(sku).first();
  if (!product) return json({ error: "product not found", sku }, 409);
  if (product.stock < qty) {
    return json({ error: "insufficient stock", requested: qty, available: product.stock }, 409);
  }
  const now = new Date().toISOString();
  const paymentToken = crypto.randomUUID();
  const results = await env.DB.batch([
    env.DB.prepare("INSERT INTO orders (sku, qty, email, total, client_order_id, status, payment_token, created_at) VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?)")
      .bind(sku, qty, email, product.price * qty, clientOrderId, paymentToken, now),
    env.DB.prepare("UPDATE products SET stock = stock - ? WHERE sku = ? AND stock >= ?").bind(qty, sku, qty),
  ]);
  const orderId = results[0] && results[0].meta && results[0].meta.last_row_id;
  const changes = results[1] && results[1].meta && results[1].meta.changes;
  if (!changes) {
    return json({ error: "insufficient stock (race)", requested: qty, available: product.stock }, 409);
  }
  const paymentUrl = "/pay/" + orderId + "?pt=" + paymentToken;
  return json({ order_id: orderId, sku, qty, total: product.price * qty, remaining_stock: product.stock - qty, order_status: "confirmed", payment_url: paymentUrl, idempotent: false }, 200);
}

async function handleGetOrder(id, env) {
  const order = await env.DB.prepare("SELECT order_id, sku, qty, email, total, status, payment_token, created_at FROM orders WHERE order_id = ?").bind(id).first();
  if (!order) return json({ error: "Not Found", id }, 404);
  const out = { order_id: order.order_id, sku: order.sku, qty: order.qty, email: order.email, total: order.total, status: order.status, created_at: order.created_at };
  if (order.payment_token && order.status !== "paid") out.payment_url = "/pay/" + order.order_id + "?pt=" + order.payment_token;
  return json(out);
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

async function handleListLicenses(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const expected = "Bearer " + (env.ADMIN_TOKEN || "");
  if (!env.ADMIN_TOKEN || auth !== expected) {
    return json({ error: "unauthorized: merchant token required" }, 401);
  }
  const { results } = await env.DB.prepare("SELECT token, email, plan, price, uses_total, uses_left, status, created_at, expires_at FROM licenses ORDER BY created_at DESC LIMIT 200").all();
  const active = results.filter((l) => l.status === "active");
  const revenue = active.reduce((s, l) => s + l.price, 0);
  const usesLeft = active.reduce((s, l) => s + l.uses_left, 0);
  return json({ licenses: results, count: results.length, active: active.length, revenue, uses_left: usesLeft });
}

const paylinkPage = function paylinkPage(order) {
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
};

const handlePayPage = async function handlePayPage(request, env, id, pt) {
  const order = await env.DB.prepare("SELECT order_id, sku, qty, email, total, status, payment_token FROM orders WHERE order_id = ?").bind(id).first();
  if (!order) return json({ error: "Not Found", id }, 404);
  if (!order.payment_token || pt !== order.payment_token) {
    return json({ error: "paylink invalido o expirado" }, 403);
  }
  return new Response(paylinkPage(order), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
};

const handlePay = async function handlePay(request, env, id) {
  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  const pt = body && typeof body.payment_token === "string" ? body.payment_token : new URL(request.url).searchParams.get("pt") || "";
  const order = await env.DB.prepare("SELECT order_id, status, payment_token FROM orders WHERE order_id = ?").bind(id).first();
  if (!order) return json({ ok: false, error: "order not found" }, 404);
  if (!order.payment_token || pt !== order.payment_token) return json({ ok: false, error: "paylink invalido" }, 403);
  if (order.status === "paid") return json({ ok: true, order_id: order.order_id, status: "paid", already: true });
  await env.DB.prepare("UPDATE orders SET status = 'paid' WHERE order_id = ? AND status = 'confirmed'").bind(order.order_id).run();
  return json({ ok: true, order_id: order.order_id, status: "paid" });
};

const licensePage = function licensePage(lic) {
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
};

const handleLicensePage = async function handleLicensePage(request, env, token, pt) {
  const lic = await env.DB.prepare("SELECT token, email, price, uses_total, uses_left, status, payment_token, expires_at FROM licenses WHERE token = ?").bind(token).first();
  if (!lic) return json({ error: "licencia no encontrada" }, 404);
  if (!lic.payment_token || pt !== lic.payment_token) return json({ error: "paylink invalido" }, 403);
  return new Response(licensePage(lic), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
};

const handleLicensePurchase = async function handleLicensePurchase(request, env) {
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
};

const handleLicenseActivate = async function handleLicenseActivate(request, env) {
  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  const pt = body && typeof body.payment_token === "string" ? body.payment_token : "";
  if (!pt) return json({ ok: false, error: "payment_token required" }, 400);
  const lic = await env.DB.prepare("SELECT token, status, payment_token FROM licenses WHERE payment_token = ?").bind(pt).first();
  if (!lic) return json({ ok: false, error: "licencia no encontrada" }, 404);
  if (lic.status === "active") return json({ ok: true, license_token: lic.token, already: true });
  await env.DB.prepare("UPDATE licenses SET status = 'active' WHERE token = ? AND status = 'pending'").bind(lic.token).run();
  return json({ ok: true, license_token: lic.token, status: "active" });
};

const handleLicenseGet = async function handleLicenseGet(request, env, token) {
  const lic = await env.DB.prepare("SELECT token, email, plan, uses_total, uses_left, status, created_at, expires_at FROM licenses WHERE token = ?").bind(token).first();
  if (!lic) return json({ found: false }, 404);
  const expired = lic.expires_at < new Date().toISOString();
  return json(Object.assign({ found: true, valid: lic.status === "active" && !expired && lic.uses_left > 0 }, lic));
};

const handleProductCreate = async function handleProductCreate(request, env) {
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
};
