// Autogenerado por byoa-kit/build.mjs — NO EDITAR A MANO.

const LIST_ITEMS_TOOL_JS = "registerTool({\n  name: \"list_items\",\n  description: \"List items from the platform catalog (filter by free text, limit 10). Public read: no approval needed.\",\n  inputSchema: {\n    type: \"object\",\n    properties: {\n      q: { type: \"string\", description: \"Optional free-text filter over name and description.\" },\n      limit: { type: \"number\", description: \"Optional max rows (1-50, default 10).\" }\n    },\n    required: []\n  },\n  handler: async function (args) {\n    args = args || {};\n    const params = new URLSearchParams();\n    if (typeof args.q === \"string\" && args.q.length > 0) params.set(\"q\", args.q);\n    if (typeof args.limit === \"number\" && Number.isFinite(args.limit)) params.set(\"limit\", String(Math.max(1, Math.min(50, Math.floor(args.limit)))));\n    const qs = params.toString();\n    const r = await host.fetchOrigin(\"/api/items\" + (qs ? \"?\" + qs : \"\"));\n    return JSON.parse(r.body);\n  }\n});";
const LIST_ITEMS_SKILL_MD = "---\nname: list_items\nversion: 1.0.0\nlicense: MIT\n---\n\n# list_items\n\nLista items del catálogo con filtro opcional de texto. **Lectura pública** —\nel agente puede usarla libremente, sin aprobación humana.\n\n## Uso\n\n- `list_items` → hasta 10 items (id, name, description, price, stock).\n- `list_items {q: \"widget\"}` → filtra por texto en name/description.\n- `list_items {limit: 3}` → límite explícito (máx 50).\n\n## Cuándo usarla\n\nPara descubrir qué existe antes de proponer cualquier escritura. Es el paso\nseguro: no tiene efectos en el mundo real.";
const GET_ITEM_TOOL_JS = "registerTool({\n  name: \"get_item\",\n  description: \"Get full details of one item by numeric id: name, description, price, stock. Returns {found:false} when the id does not exist.\",\n  inputSchema: {\n    type: \"object\",\n    properties: {\n      id: { type: \"number\", description: \"Numeric item id.\" }\n    },\n    required: [\"id\"]\n  },\n  handler: async function (args) {\n    args = args || {};\n    if (typeof args.id !== \"number\" || !Number.isFinite(args.id) || args.id < 1) {\n      return { found: false, error: \"id must be a positive number\" };\n    }\n    const r = await host.fetchOrigin(\"/api/items/\" + Math.floor(args.id));\n    if (r.status === 404) return { found: false };\n    return JSON.parse(r.body);\n  }\n});";
const GET_ITEM_SKILL_MD = "---\nname: get_item\nversion: 1.0.0\nlicense: MIT\n---\n\n# get_item\n\nDetalle de un item por id numérico: name, description, price, stock.\nDevuelve `{found: false}` si el id no existe. **Lectura pública** — sin\naprobación humana.\n\n## Cuándo usarla\n\n- Antes de una escritura, para verificar precios/stock del item elegido.\n- Después de un error de red durante `create_item`, para confirmar si la\n  escritura aterrizó realmente antes de reintentar.";
const CREATE_ITEM_TOOL_JS = "// Publisher: pon aqui el origin de TU plataforma desplegada.\nconst ORIGIN = \"https://llmstxt-byoa-kit.rckflr.workers.dev\";\n\nregisterTool({\n  name: \"create_item\",\n  description: \"PAID TOOL (creator license): create a new item on the platform (name, price, optional description/stock). Buy access with buy_creator_access, then pass the license token as access_token. Without a valid token returns needs_payment. REAL-WORLD EFFECT: always confirm name and price with the human first.\",\n  inputSchema: {\n    type: \"object\",\n    properties: {\n      name: { type: \"string\", description: \"Item name (non-empty).\" },\n      description: { type: \"string\", description: \"Optional item description.\" },\n      price: { type: \"number\", description: \"Price >= 0.\" },\n      stock: { type: \"number\", description: \"Optional initial stock (default 0).\" },\n      access_token: { type: \"string\", description: \"Creator license token (from the human, after paying the buy_creator_access paylink).\" }\n    },\n    required: [\"name\", \"price\"]\n  },\n  handler: async function (args) {\n    args = args || {};\n    if (typeof args.name !== \"string\" || args.name.trim().length === 0) {\n      return { ok: false, error: \"name must be a non-empty string\" };\n    }\n    if (typeof args.price !== \"number\" || !Number.isFinite(args.price) || args.price < 0) {\n      return { ok: false, error: \"price must be a number >= 0\" };\n    }\n    if (typeof args.access_token !== \"string\" || args.access_token.length === 0) {\n      return {\n        ok: false, needs_payment: true,\n        next_step: \"llama buy_creator_access {email} para generar el paylink; el humano paga y te da el license_token\",\n        price_hint: \"licencia de creador ($19 / 25 creaciones / 30 dias)\"\n      };\n    }\n    const body = JSON.stringify({\n      name: args.name,\n      description: typeof args.description === \"string\" ? args.description : undefined,\n      price: args.price,\n      stock: typeof args.stock === \"number\" ? args.stock : undefined\n    });\n    const r = await host.fetchOrigin(\"/api/items\", {\n      method: \"POST\",\n      headers: { Authorization: \"Bearer \" + args.access_token },\n      body\n    });\n    let parsed = null;\n    try { parsed = JSON.parse(r.body); } catch { parsed = { error: r.body }; }\n    if (r.status === 401) return Object.assign({ ok: false, needs_payment: true }, parsed);\n    if (r.status >= 400) return Object.assign({ ok: false, status: r.status }, parsed);\n    return Object.assign({ ok: true }, parsed);\n  }\n});";
const CREATE_ITEM_SKILL_MD = "---\nname: create_item\nversion: 2.0.0\nlicense: MIT\n---\n\n# create_item\n\n**Tool de pago** (licencia de creador): crea un item nuevo en el catálogo vivo\n(D1). Devuelve `{ok: true, id, name, price, stock}` con `uses_left`, o\n`{ok: false, needs_payment: true}` si falta el token de licencia.\n\n## El flujo que el agente debe seguir\n\n1. El humano dice que quiere crear items en la plataforma.\n2. Si aún no tiene licencia: llama `buy_creator_access` con el **email del\n   humano** → paylink. **El pago es del HUMANO** — entrégale el link y espera.\n3. La página del paylink muestra el `license_token` tras pagar; el humano te\n   lo pasa. Verifícalo gratis con `check_license`.\n4. Confirma nombre, precio y stock con el humano. Recién entonces llama\n   `create_item` con `{name, price, access_token}`.\n5. Reporta el `id` creado y los `uses_left` restantes.\n\n## Sin token\n\n- Sin `access_token` la tool responde `{ok:false, needs_payment:true}` con el\n  `next_step` — no insistas: el acceso se compra, no se salta.\n- Token inválido → el worker responde 401 (`needs_payment`).\n- Licencia expirada o agotada → 403 con la causa.\n\n## Errores\n\n| status | significado |\n|---|---|\n| 400 | validación (name vacío, price negativo) |\n| 401 | falta o es inválido el license token (needs_payment) |\n| 403 | licencia expirada o sin creaciones restantes |";
const BUY_CREATOR_ACCESS_TOOL_JS = "// Publisher: pon aqui el origin de TU plataforma desplegada.\nconst ORIGIN = \"https://llmstxt-byoa-kit.rckflr.workers.dev\";\n\nregisterTool({\n  name: \"buy_creator_access\",\n  description: \"Start the purchase of a creator license to create items on this platform. Returns the paylink for the HUMAN to pay. After payment the paylink page shows the license token: the human gives it to you for create_item. Free to call.\",\n  inputSchema: {\n    type: \"object\",\n    properties: {\n      email: { type: \"string\", description: \"Email of the human buying the license (receipt + license record).\" }\n    },\n    required: [\"email\"]\n  },\n  handler: async function (args) {\n    args = args || {};\n    if (typeof args.email !== \"string\" || args.email.length === 0) {\n      return { ok: false, error: \"email required (the human's email)\" };\n    }\n    const r = await host.fetchOrigin(\"/api/licenses/purchase\", {\n      method: \"POST\",\n      body: JSON.stringify({ email: args.email })\n    });\n    let parsed = null;\n    try { parsed = JSON.parse(r.body); } catch { parsed = { error: r.body }; }\n    if (r.status >= 400) return Object.assign({ ok: false, status: r.status }, parsed);\n    // payment_url es relativa al origin: absolutizarla para el humano\n    if (parsed.payment_url && typeof parsed.payment_url === \"string\" && parsed.payment_url.startsWith(\"/\")) {\n      parsed.payment_url = ORIGIN + parsed.payment_url;\n    }\n    return Object.assign({ ok: true }, parsed);\n  }\n});";
const BUY_CREATOR_ACCESS_SKILL_MD = "---\nname: buy_creator_access\nversion: 1.0.0\nlicense: MIT\n---\n\n# buy_creator_access\n\nInicia la compra de una **licencia de creador** para crear items en la\nplataforma: $19 por 25 creaciones, 30 días de vigencia (configurable en\n`kit.config.json` → `monetize`). La tool es gratis; lo que vende es el acceso\na `create_item`.\n\n## Flujo\n\n1. Pide el email del humano.\n2. Llama la tool → `payment_url` (paylink, absolutizada al origin de la\n   plataforma).\n3. El humano paga en el paylink (simulado en este demo — sin dinero real).\n4. La página del paylink muestra el **license_token** tras el pago.\n5. El humano te da el token → ya puedes usar `create_item`.\n\n## Reglas\n\n- El pago del paylink es del HUMANO: nunca lo ejecutes por tu cuenta salvo\n  petición explícita.\n- El token NO viene en la respuesta de esta tool — vive en la página de pago\n  que ve el humano (por diseño: el que paga, recibe).";
const CHECK_LICENSE_TOOL_JS = "registerTool({\n  name: \"check_license\",\n  description: \"Check a creator license token: status, creations left, expiry. Free. Useful before create_item, or to tell the human how many creations they have left.\",\n  inputSchema: {\n    type: \"object\",\n    properties: {\n      access_token: { type: \"string\", description: \"Creator license token.\" }\n    },\n    required: [\"access_token\"]\n  },\n  handler: async function (args) {\n    args = args || {};\n    if (typeof args.access_token !== \"string\" || args.access_token.length === 0) {\n      return { found: false, error: \"access_token required\" };\n    }\n    const r = await host.fetchOrigin(\"/api/license/\" + encodeURIComponent(args.access_token));\n    if (r.status === 404) return { found: false };\n    return JSON.parse(r.body);\n  }\n});";
const CHECK_LICENSE_SKILL_MD = "---\nname: check_license\nversion: 1.0.0\nlicense: MIT\n---\n\n# check_license\n\nConsulta el estado de un token de licencia de creador: plan, creaciones\nrestantes (`uses_left`), vencimiento. **Gratis** — sin aprobación humana.\n\n## Cuándo usarla\n\n- Antes de `create_item`, para verificar que el token del humano está activo\n  y tiene usos disponibles.\n- Para decirle al humano cuántas creaciones le quedan.\n- Si `create_item` falló con 401/403, para distinguir token inválido de\n  licencia agotada.";

const LLMS_TXT = "# llmstxt-byoa-kit\n\n> Plantilla BYOA generica: catalogo de items en D1 con discovery verificado (llms.txt v0.4 + hashes), SKILL.md y API CRUD. Renombra la entidad, edita las tools y despliega tu propia plataforma. Read tools are public; create_* is a real-world effect and always asks the human first. Static discovery with verified hashes: your agent verifies every tool before running it.\n\n## Skills\n\n- [list_items](/skills/list_items/SKILL.md): List items (filter by text, limit 10). Returns live rows from D1. <!-- skill: {\"version\":\"1.0.0\",\"sha256\":\"9fc2b4d080dd34714556eb7f203c2e9a222007e9d27bf98232a46329d4134819\",\"tool\":\"/skills/list_items/tool.js\",\"tool_sha256\":\"d2ccdf66f3fe0e8e5559d13b1c370fdce2fb7a1a25b8fb96684bcfff30202161\"} -->\n- [get_item](/skills/get_item/SKILL.md): Get full details of one item by id. Returns {found:false} if unknown. <!-- skill: {\"version\":\"1.0.0\",\"sha256\":\"538b48c821ada9623d55aacafc64d77b0b4357e7357b1a4417e81080a6e6e07c\",\"tool\":\"/skills/get_item/tool.js\",\"tool_sha256\":\"50a9a6668512a3de748970111d8249211bd6cc902e3e76ff45c4d82aec6ce72f\"} -->\n- [create_item](/skills/create_item/SKILL.md): PAID TOOL: create a new item. Requires a creator license token (buy with buy_creator_access — $19 for 25 creations, 30 days). Without a valid token returns needs_payment with next steps. <!-- skill: {\"version\":\"1.0.0\",\"sha256\":\"cf2bcb6a0eb5ba39785e3673e3f0fc79f8224f0dd840876a7274acb435e06d0e\",\"tool\":\"/skills/create_item/tool.js\",\"tool_sha256\":\"87a7a0a3ed8501de37394c3c91b5ea7d1a41e6a93cf70f1465f5d3929186f4ef\"} -->\n- [buy_creator_access](/skills/buy_creator_access/SKILL.md): Start the purchase of a creator license ($19 for 25 creations, 30 days): returns the paylink for the HUMAN to pay. After payment the human receives the license token for create_item. Free to call. <!-- skill: {\"version\":\"1.0.0\",\"sha256\":\"2509f7a0fdb0f13d8368bf88d615b08d622343fda2e04225c0b13b58ca75bbf9\",\"tool\":\"/skills/buy_creator_access/tool.js\",\"tool_sha256\":\"40b4a8012ade9792eea4adce94e3daa1c40413f45ba89fd153f427b003b6c3bd\"} -->\n- [check_license](/skills/check_license/SKILL.md): Check a creator license token: plan, uses left, expiry. Free. <!-- skill: {\"version\":\"1.0.0\",\"sha256\":\"1c93fe000b35e4fc8482d4731ea7ff7003a5efd38d11d5355748c1c62e4f5cd2\",\"tool\":\"/skills/check_license/tool.js\",\"tool_sha256\":\"9430ce844b33b3236f4ae9350c49cc768adc88f83ca3170e7626e3be2c7c8c11\"} -->\n";

const LANDING = "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>llmstxt-byoa-kit — BYOA platform</title>\n<style>body{font-family:system-ui,sans-serif;max-width:52rem;margin:2rem auto;padding:0 1rem;line-height:1.55;color:#14181f;background:#fafbfc}code{background:#eef1f4;padding:.1rem .35rem;border-radius:4px;font-size:.92em}a{color:#0b62a4}h1{border-bottom:2px solid #e4e8ec;padding-bottom:.4rem}table{border-collapse:collapse;width:100%;margin:1rem 0}td,th{border:1px solid #e4e8ec;padding:.45rem .6rem;text-align:left;font-size:.95rem}th{background:#eef1f4}pre{background:#14181f;color:#d7e2ec;padding:.8rem 1rem;border-radius:8px;overflow-x:auto}footer{margin-top:2.5rem;color:#66707b;font-size:.9rem;border-top:1px solid #e4e8ec;padding-top:1rem}</style>\n</head>\n<body>\n<h1>llmstxt-byoa-kit</h1>\n<p>Plantilla BYOA generica: catalogo de items en D1 con discovery verificado (llms.txt v0.4 + hashes), SKILL.md y API CRUD. Renombra la entidad, edita las tools y despliega tu propia plataforma. Built with the <strong>BYOA kit</strong> on <a href=\"https://github.com/MauricioPerera/mcpwasm\">mcpwasm</a>: static discovery with verified hashes, tools that run sandboxed on the consumer's machine, and the human holding the approval pen.</p>\n<h2>Point your agent here</h2>\n<pre>npx -y @rckflr/mcpwasm https://llmstxt-byoa-kit.rckflr.workers.dev</pre>\n<h2>Skills</h2>\n<ul>\n      <li><code>list_items</code> — <a href=\"/skills/list_items/SKILL.md\">SKILL.md</a> · <a href=\"/skills/list_items/tool.js\">tool.js</a></li>\n      <li><code>get_item</code> — <a href=\"/skills/get_item/SKILL.md\">SKILL.md</a> · <a href=\"/skills/get_item/tool.js\">tool.js</a></li>\n      <li><code>create_item</code> — <a href=\"/skills/create_item/SKILL.md\">SKILL.md</a> · <a href=\"/skills/create_item/tool.js\">tool.js</a></li>\n      <li><code>buy_creator_access</code> — <a href=\"/skills/buy_creator_access/SKILL.md\">SKILL.md</a> · <a href=\"/skills/buy_creator_access/tool.js\">tool.js</a></li>\n      <li><code>check_license</code> — <a href=\"/skills/check_license/SKILL.md\">SKILL.md</a> · <a href=\"/skills/check_license/tool.js\">tool.js</a></li>\n  </ul>\n<h2>Seed items</h2>\n<table>\n      <tr><th>id</th><th>name</th><th>price</th><th>stock</th></tr>\n      <tr><td>1</td><td>starter-widget</td><td>$5.00</td><td>100</td></tr>\n      <tr><td>2</td><td>demo-gadget</td><td>$12.50</td><td>40</td></tr>\n    </table>\n<h2>Sell here</h2>\n<p>Creating items is the <strong>paid tool</strong>: your agent calls <code>buy_creator_access</code>, you pay the paylink (<strong>$19 / 25 creations / 30 days</strong>), it lists items with <code>create_item</code>. Browsing and reading are always free.</p>\n<footer>Generated by byoa-kit/build.mjs — do not edit the worker by hand.</footer>\n</body>\n</html>";

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

async function handleListItems(url, env) {
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw >= 1 && limitRaw <= 50 ? Math.floor(limitRaw) : 10;
  let sql = "SELECT id, name, description, price, stock FROM items";
  const params = [];
  if (q) { sql += " WHERE LOWER(name) LIKE LOWER(?) OR LOWER(description) LIKE LOWER(?)"; params.push("%" + q + "%", "%" + q + "%"); }
  sql += " ORDER BY id LIMIT ?"; params.push(limit);
  const { results } = await env.DB.prepare(sql).bind(...params).all();
  return json(results);
}

async function handleGetItem(id, env) {
  const item = await env.DB.prepare("SELECT id, name, description, price, stock FROM items WHERE id = ?").bind(id).first();
  if (!item) return json({ found: false }, 404);
  return json(Object.assign({ found: true }, item));
}

const MON_CFG = {"enabled":true,"tool":"create_item","price":19,"uses":25,"days":30};

const handleCreateItem = async function handleCreateItemMon(request, env) {
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
};

const licensePage = function licensePage(lic) {
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
};

const handleLicensePage = async function handleLicensePage(request, env, token, pt) {
  const lic = await env.DB.prepare("SELECT token, price, uses_total, uses_left, status, payment_token, expires_at FROM licenses WHERE token = ?").bind(token).first();
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
};

const handleLicenseActivate = async function handleLicenseActivate(request, env) {
  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  const pt = body && typeof body.payment_token === "string" ? body.payment_token : "";
  if (!pt) return json({ ok: false, error: "payment_token required" }, 400);
  const lic = await env.DB.prepare("SELECT token, status, payment_token FROM licenses WHERE payment_token = ?").bind(pt).first();
  if (!lic) return json({ ok: false, error: "licencia no encontrada" }, 404);
  if (lic.status === "active") return json({ ok: true, license_token: lic.token, already: true });
  await env.DB.prepare("UPDATE licenses SET status = 'active' WHERE token = ?").bind(lic.token).run();
  return json({ ok: true, license_token: lic.token, status: "active" });
};

const handleLicenseGet = async function handleLicenseGet(request, env, token) {
  const lic = await env.DB.prepare("SELECT token, email, plan, uses_total, uses_left, status, created_at, expires_at FROM licenses WHERE token = ?").bind(token).first();
  if (!lic) return json({ found: false }, 404);
  const expired = lic.expires_at < new Date().toISOString();
  return json(Object.assign({ found: true, valid: lic.status === "active" && !expired && lic.uses_left > 0 }, lic));
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/") return new Response(LANDING, { headers: { "content-type": "text/html; charset=utf-8" } });
    if (path === "/llms.txt") return new Response(LLMS_TXT, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
    if (path === "/api/licenses/purchase" && request.method === "POST") return await handleLicensePurchase(request, env);
    if (path === "/api/licenses/activate" && request.method === "POST") return await handleLicenseActivate(request, env);
    const licMatch = path.match(/^\/api\/license\/([0-9a-fA-F-]+)$/);
    if (licMatch) return await handleLicenseGet(request, env, licMatch[1]);
    const buyMatch = path.match(/^\/buy\/([0-9a-fA-F-]+)$/);
    if (buyMatch) return await handleLicensePage(request, env, buyMatch[1], url.searchParams.get("pt") || "");
  if (path === "/skills/list_items/tool.js") return new Response(LIST_ITEMS_TOOL_JS, { headers: { "content-type": "application/javascript; charset=utf-8" } });
  if (path === "/skills/list_items/SKILL.md") return new Response(LIST_ITEMS_SKILL_MD, { headers: { "content-type": "text/markdown; charset=utf-8" } });
  if (path === "/skills/get_item/tool.js") return new Response(GET_ITEM_TOOL_JS, { headers: { "content-type": "application/javascript; charset=utf-8" } });
  if (path === "/skills/get_item/SKILL.md") return new Response(GET_ITEM_SKILL_MD, { headers: { "content-type": "text/markdown; charset=utf-8" } });
  if (path === "/skills/create_item/tool.js") return new Response(CREATE_ITEM_TOOL_JS, { headers: { "content-type": "application/javascript; charset=utf-8" } });
  if (path === "/skills/create_item/SKILL.md") return new Response(CREATE_ITEM_SKILL_MD, { headers: { "content-type": "text/markdown; charset=utf-8" } });
  if (path === "/skills/buy_creator_access/tool.js") return new Response(BUY_CREATOR_ACCESS_TOOL_JS, { headers: { "content-type": "application/javascript; charset=utf-8" } });
  if (path === "/skills/buy_creator_access/SKILL.md") return new Response(BUY_CREATOR_ACCESS_SKILL_MD, { headers: { "content-type": "text/markdown; charset=utf-8" } });
  if (path === "/skills/check_license/tool.js") return new Response(CHECK_LICENSE_TOOL_JS, { headers: { "content-type": "application/javascript; charset=utf-8" } });
  if (path === "/skills/check_license/SKILL.md") return new Response(CHECK_LICENSE_SKILL_MD, { headers: { "content-type": "text/markdown; charset=utf-8" } });
    if (path === "/api/items" && request.method === "GET") return await handleListItems(url, env);
    if (path === "/api/items" && request.method === "POST") return await handleCreateItem(request, env);
    const idMatch = path.match(/^\/api\/items\/(\d+)$/);
    if (idMatch && request.method === "GET") return await handleGetItem(Number(idMatch[1]), env);
    if (path === "/") return new Response(LANDING, { headers: { "content-type": "text/html; charset=utf-8" } });
    return json({ error: "not found" }, 404);
  }
};
