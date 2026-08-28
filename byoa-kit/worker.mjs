// Autogenerado por byoa-kit/build.mjs — NO EDITAR A MANO.

const LIST_ITEMS_TOOL_JS = "registerTool({\n  name: \"list_items\",\n  description: \"List items from the platform catalog (filter by free text, limit 10). Public read: no approval needed.\",\n  inputSchema: {\n    type: \"object\",\n    properties: {\n      q: { type: \"string\", description: \"Optional free-text filter over name and description.\" },\n      limit: { type: \"number\", description: \"Optional max rows (1-50, default 10).\" }\n    },\n    required: []\n  },\n  handler: async function (args) {\n    args = args || {};\n    const params = new URLSearchParams();\n    if (typeof args.q === \"string\" && args.q.length > 0) params.set(\"q\", args.q);\n    if (typeof args.limit === \"number\" && Number.isFinite(args.limit)) params.set(\"limit\", String(Math.max(1, Math.min(50, Math.floor(args.limit)))));\n    const qs = params.toString();\n    const r = await host.fetchOrigin(\"/api/items\" + (qs ? \"?\" + qs : \"\"));\n    return JSON.parse(r.body);\n  }\n});";
const LIST_ITEMS_SKILL_MD = "---\nname: list_items\nversion: 1.0.0\nlicense: MIT\n---\n\n# list_items\n\nLista items del catálogo con filtro opcional de texto. **Lectura pública** —\nel agente puede usarla libremente, sin aprobación humana.\n\n## Uso\n\n- `list_items` → hasta 10 items (id, name, description, price, stock).\n- `list_items {q: \"widget\"}` → filtra por texto en name/description.\n- `list_items {limit: 3}` → límite explícito (máx 50).\n\n## Cuándo usarla\n\nPara descubrir qué existe antes de proponer cualquier escritura. Es el paso\nseguro: no tiene efectos en el mundo real.";
const GET_ITEM_TOOL_JS = "registerTool({\n  name: \"get_item\",\n  description: \"Get full details of one item by numeric id: name, description, price, stock. Returns {found:false} when the id does not exist.\",\n  inputSchema: {\n    type: \"object\",\n    properties: {\n      id: { type: \"number\", description: \"Numeric item id.\" }\n    },\n    required: [\"id\"]\n  },\n  handler: async function (args) {\n    args = args || {};\n    if (typeof args.id !== \"number\" || !Number.isFinite(args.id) || args.id < 1) {\n      return { found: false, error: \"id must be a positive number\" };\n    }\n    const r = await host.fetchOrigin(\"/api/items/\" + Math.floor(args.id));\n    if (r.status === 404) return { found: false };\n    return JSON.parse(r.body);\n  }\n});";
const GET_ITEM_SKILL_MD = "---\nname: get_item\nversion: 1.0.0\nlicense: MIT\n---\n\n# get_item\n\nDetalle de un item por id numérico: name, description, price, stock.\nDevuelve `{found: false}` si el id no existe. **Lectura pública** — sin\naprobación humana.\n\n## Cuándo usarla\n\n- Antes de una escritura, para verificar precios/stock del item elegido.\n- Después de un error de red durante `create_item`, para confirmar si la\n  escritura aterrizó realmente antes de reintentar.";
const CREATE_ITEM_TOOL_JS = "registerTool({\n  name: \"create_item\",\n  description: \"Create a new item on the platform (name, description, price, stock). REAL-WORLD EFFECT: this writes to the live catalog — ALWAYS confirm name and price with the human before invoking.\",\n  inputSchema: {\n    type: \"object\",\n    properties: {\n      name: { type: \"string\", description: \"Item name (non-empty).\" },\n      description: { type: \"string\", description: \"Optional item description.\" },\n      price: { type: \"number\", description: \"Price >= 0.\" },\n      stock: { type: \"number\", description: \"Optional initial stock (default 0).\" }\n    },\n    required: [\"name\", \"price\"]\n  },\n  handler: async function (args) {\n    args = args || {};\n    if (typeof args.name !== \"string\" || args.name.trim().length === 0) {\n      return { ok: false, error: \"name must be a non-empty string\" };\n    }\n    if (typeof args.price !== \"number\" || !Number.isFinite(args.price) || args.price < 0) {\n      return { ok: false, error: \"price must be a number >= 0\" };\n    }\n    const body = JSON.stringify({\n      name: args.name,\n      description: typeof args.description === \"string\" ? args.description : undefined,\n      price: args.price,\n      stock: typeof args.stock === \"number\" ? args.stock : undefined\n    });\n    const r = await host.fetchOrigin(\"/api/items\", { method: \"POST\", body });\n    let parsed = null;\n    try { parsed = JSON.parse(r.body); } catch { parsed = { error: r.body }; }\n    if (r.status >= 400) return Object.assign({ ok: false, status: r.status }, parsed);\n    return Object.assign({ ok: true }, parsed);\n  }\n});";
const CREATE_ITEM_SKILL_MD = "---\nname: create_item\nversion: 1.0.0\nlicense: MIT\n---\n\n# create_item\n\nCrea un item nuevo en el catálogo vivo (D1). Devuelve\n`{ok: true, id, name, description, price, stock}` o\n`{ok: false, status: 400, error}` si la validación falla.\n\n## LA REGLA BYOA: aprobación humana primero\n\n`create_item` es un **efecto en el mundo real** (escribe en el catálogo\npúblico). Antes de invocarla:\n\n1. Propón al humano: nombre, descripción, precio y stock.\n2. Espera un OK explícito. Un \"dale\", \"sí, créalo\" o \"adelante\".\n3. Recién entonces llama `create_item`.\n4. Reporta el resultado con el `id` creado.\n\nNunca la encadenes en un flujo automático sin ese OK. Si un error de red te\ndeja dudoso sobre si la escritura aterrizó, usa `get_item` con el id que\ndevolvió (o lista items) ANTES de reintentar — los reintentos sin verificar\nduplican.\n\n## Errores\n\n| status | significado |\n|---|---|\n| 400 | validación (name vacío, price negativo) |";

const LLMS_TXT = "# llmstxt-byoa-kit\n\n> Plantilla BYOA generica: catalogo de items en D1 con discovery verificado (llms.txt v0.4 + hashes), SKILL.md y API CRUD. Renombra la entidad, edita las tools y despliega tu propia plataforma. Read tools are public; create_* is a real-world effect and always asks the human first. Static discovery with verified hashes: your agent verifies every tool before running it.\n\n## Skills\n\n- [list_items](/skills/list_items/SKILL.md): List items (filter by text, limit 10). Returns live rows from D1. <!-- skill: {\"version\":\"1.0.0\",\"sha256\":\"9fc2b4d080dd34714556eb7f203c2e9a222007e9d27bf98232a46329d4134819\",\"tool\":\"/skills/list_items/tool.js\",\"tool_sha256\":\"d2ccdf66f3fe0e8e5559d13b1c370fdce2fb7a1a25b8fb96684bcfff30202161\"} -->\n- [get_item](/skills/get_item/SKILL.md): Get full details of one item by id. Returns {found:false} if unknown. <!-- skill: {\"version\":\"1.0.0\",\"sha256\":\"538b48c821ada9623d55aacafc64d77b0b4357e7357b1a4417e81080a6e6e07c\",\"tool\":\"/skills/get_item/tool.js\",\"tool_sha256\":\"50a9a6668512a3de748970111d8249211bd6cc902e3e76ff45c4d82aec6ce72f\"} -->\n- [create_item](/skills/create_item/SKILL.md): Create a new item. REAL-WORLD EFFECT: confirm name and price with the human first, then POST. Returns the created row with its id. <!-- skill: {\"version\":\"1.0.0\",\"sha256\":\"bc900d9f464276507f246623e6c2bcfdafad6e41349611f1ed2dea7d7446c755\",\"tool\":\"/skills/create_item/tool.js\",\"tool_sha256\":\"1e4bce0a7cfef74d5fc4766308eea0ed8848dae1bbf337db75d1c933f03ce080\"} -->\n";

const LANDING = "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>llmstxt-byoa-kit — BYOA platform</title>\n<style>body{font-family:system-ui,sans-serif;max-width:52rem;margin:2rem auto;padding:0 1rem;line-height:1.55;color:#14181f;background:#fafbfc}code{background:#eef1f4;padding:.1rem .35rem;border-radius:4px;font-size:.92em}a{color:#0b62a4}h1{border-bottom:2px solid #e4e8ec;padding-bottom:.4rem}table{border-collapse:collapse;width:100%;margin:1rem 0}td,th{border:1px solid #e4e8ec;padding:.45rem .6rem;text-align:left;font-size:.95rem}th{background:#eef1f4}pre{background:#14181f;color:#d7e2ec;padding:.8rem 1rem;border-radius:8px;overflow-x:auto}footer{margin-top:2.5rem;color:#66707b;font-size:.9rem;border-top:1px solid #e4e8ec;padding-top:1rem}</style>\n</head>\n<body>\n<h1>llmstxt-byoa-kit</h1>\n<p>Plantilla BYOA generica: catalogo de items en D1 con discovery verificado (llms.txt v0.4 + hashes), SKILL.md y API CRUD. Renombra la entidad, edita las tools y despliega tu propia plataforma. Built with the <strong>BYOA kit</strong> on <a href=\"https://github.com/MauricioPerera/mcpwasm\">mcpwasm</a>: static discovery with verified hashes, tools that run sandboxed on the consumer's machine, and the human holding the approval pen.</p>\n<h2>Point your agent here</h2>\n<pre>npx -y @rckflr/mcpwasm https://llmstxt-byoa-kit.rckflr.workers.dev</pre>\n<h2>Skills</h2>\n<ul>\n      <li><code>list_items</code> — <a href=\"/skills/list_items/SKILL.md\">SKILL.md</a> · <a href=\"/skills/list_items/tool.js\">tool.js</a></li>\n      <li><code>get_item</code> — <a href=\"/skills/get_item/SKILL.md\">SKILL.md</a> · <a href=\"/skills/get_item/tool.js\">tool.js</a></li>\n      <li><code>create_item</code> — <a href=\"/skills/create_item/SKILL.md\">SKILL.md</a> · <a href=\"/skills/create_item/tool.js\">tool.js</a></li>\n  </ul>\n<h2>Seed items</h2>\n<table>\n      <tr><th>id</th><th>name</th><th>price</th><th>stock</th></tr>\n      <tr><td>1</td><td>starter-widget</td><td>$5.00</td><td>100</td></tr>\n      <tr><td>2</td><td>demo-gadget</td><td>$12.50</td><td>40</td></tr>\n    </table>\n<footer>Generated by byoa-kit/build.mjs — do not edit the worker by hand.</footer>\n</body>\n</html>";

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

async function handleCreateItem(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const name = body && body.name;
  const price = body && body.price;
  const stock = body && typeof body.stock === "number" ? body.stock : 0;
  if (typeof name !== "string" || name.trim().length === 0) return json({ error: "name required" }, 400);
  if (typeof price !== "number" || !Number.isFinite(price) || price < 0) return json({ error: "price must be a number >= 0" }, 400);
  const { meta } = await env.DB.prepare("INSERT INTO items (name, description, price, stock) VALUES (?, ?, ?, ?)")
    .bind(name, typeof body.description === "string" ? body.description : "", price, stock).run();
  const row = await env.DB.prepare("SELECT id, name, description, price, stock FROM items WHERE id = ?").bind(meta.last_row_id).first();
  return json(Object.assign({ ok: true }, row), 201);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/") return new Response(LANDING, { headers: { "content-type": "text/html; charset=utf-8" } });
    if (path === "/llms.txt") return new Response(LLMS_TXT, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  if (path === "/skills/list_items/tool.js") return new Response(LIST_ITEMS_TOOL_JS, { headers: { "content-type": "application/javascript; charset=utf-8" } });
  if (path === "/skills/list_items/SKILL.md") return new Response(LIST_ITEMS_SKILL_MD, { headers: { "content-type": "text/markdown; charset=utf-8" } });
  if (path === "/skills/get_item/tool.js") return new Response(GET_ITEM_TOOL_JS, { headers: { "content-type": "application/javascript; charset=utf-8" } });
  if (path === "/skills/get_item/SKILL.md") return new Response(GET_ITEM_SKILL_MD, { headers: { "content-type": "text/markdown; charset=utf-8" } });
  if (path === "/skills/create_item/tool.js") return new Response(CREATE_ITEM_TOOL_JS, { headers: { "content-type": "application/javascript; charset=utf-8" } });
  if (path === "/skills/create_item/SKILL.md") return new Response(CREATE_ITEM_SKILL_MD, { headers: { "content-type": "text/markdown; charset=utf-8" } });
    if (path === "/api/items" && request.method === "GET") return await handleListItems(url, env);
    if (path === "/api/items" && request.method === "POST") return await handleCreateItem(request, env);
    const idMatch = path.match(/^\/api\/items\/(\d+)$/);
    if (idMatch && request.method === "GET") return await handleGetItem(Number(idMatch[1]), env);
    if (path === "/") return new Response(LANDING, { headers: { "content-type": "text/html; charset=utf-8" } });
    return json({ error: "not found" }, 404);
  }
};
