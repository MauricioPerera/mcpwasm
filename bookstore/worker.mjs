// AUTOGENERADO por build.mjs. No editar a mano.
const SEARCH_CATALOG_TOOL_JS = "registerTool({\n  name: \"search_catalog\",\n  description: \"Search the bookstore catalog by text (matches title or author), optionally filtered by genre and a maximum price. Returns up to 10 matching books.\",\n  inputSchema: {\n    type: \"object\",\n    properties: {\n      q: { type: \"string\", description: \"Free-text query, matched against title and author.\" },\n      genre: { type: \"string\", description: \"Exact genre filter, e.g. science-fiction.\" },\n      max_price: { type: \"number\", description: \"Maximum price (inclusive) filter.\" }\n    }\n  },\n  handler: async function (args) {\n    args = args || {};\n    // Construir el query string a mano: URLSearchParams no existe en el sandbox\n    // QuickJS (solo built-ins ECMAScript; URLSearchParams es WHATWG). Usar\n    // encodeURIComponent (built-in) para escapar cada valor.\n    const parts = [];\n    if (typeof args.q === \"string\" && args.q.length > 0) {\n      parts.push(\"q=\" + encodeURIComponent(args.q));\n    }\n    if (typeof args.genre === \"string\" && args.genre.length > 0) {\n      parts.push(\"genre=\" + encodeURIComponent(args.genre));\n    }\n    if (typeof args.max_price === \"number\" && Number.isFinite(args.max_price)) {\n      parts.push(\"max_price=\" + String(args.max_price));\n    }\n    const qs = parts.join(\"&\");\n    const path = qs ? (\"/api/search?\" + qs) : \"/api/search\";\n    const r = await host.fetchOrigin(path);\n    return JSON.parse(r.body);\n  }\n});";
const SEARCH_CATALOG_SKILL_MD = "---\nname: search_catalog\nversion: 1.0.0\nlicense: MIT\n---\n\n# search_catalog\n\nSearch the bookstore catalog. Matches free text against `title` and `author`,\noptionally filtered by `genre` (exact match) and `max_price` (inclusive).\nReturns up to 10 books as a JSON array.\n\n## Arguments\n\n- `q` (string, optional): free-text query matched against title and author.\n- `genre` (string, optional): exact genre filter, e.g. `science-fiction`.\n- `max_price` (number, optional): maximum price, inclusive.\n\n## Example\n\n```json\n{ \"q\": \"dune\", \"max_price\": 20 }\n```";
const GET_BOOK_TOOL_JS = "registerTool({\n  name: \"get_book\",\n  description: \"Get full details of a single book by its numeric id. Returns {found:false} when the book does not exist.\",\n  inputSchema: {\n    type: \"object\",\n    properties: {\n      id: { type: \"number\", description: \"Book id.\" }\n    },\n    required: [\"id\"]\n  },\n  handler: async function (args) {\n    args = args || {};\n    if (typeof args.id !== \"number\" || !Number.isFinite(args.id)) {\n      throw new Error(\"id must be a finite number\");\n    }\n    const r = await host.fetchOrigin(\"/api/book/\" + encodeURIComponent(args.id));\n    if (r.status === 404) return { found: false };\n    return JSON.parse(r.body);\n  }\n});";
const GET_BOOK_SKILL_MD = "---\nname: get_book\nversion: 1.0.0\nlicense: MIT\n---\n\n# get_book\n\nGet full details of a single book by its numeric `id`. Returns the book object,\nor `{ \"found\": false }` when no book has that id.\n\n## Arguments\n\n- `id` (number, required): book id.\n\n## Example\n\n```json\n{ \"id\": 1 }\n```";
const STOCK_REPORT_TOOL_JS = "registerTool({\n  name: \"stock_report\",\n  description: \"Return an inventory stock report: total number of titles, sum of stock across all titles, number of titles out of stock, and the top 3 titles by stock.\",\n  inputSchema: {\n    type: \"object\",\n    properties: {}\n  },\n  handler: async function (args) {\n    const r = await host.fetchOrigin(\"/api/stock-report\");\n    return JSON.parse(r.body);\n  }\n});";
const STOCK_REPORT_SKILL_MD = "---\nname: stock_report\nversion: 1.0.0\nlicense: MIT\n---\n\n# stock_report\n\nReturn an inventory stock report with no arguments:\n\n- `total_titles`: number of distinct titles.\n- `total_stock`: sum of `stock` across all titles.\n- `out_of_stock`: number of titles with `stock = 0`.\n- `top3_by_stock`: the 3 titles with the highest stock.";
const CORRUPT_SKILL_TOOL_JS = "registerTool({\n  name: \"corrupt_skill\",\n  description: \"TEST FIXTURE for gateway robustness: this tool.js is valid and served correctly, but the tool_sha256 declared for it in /llms.txt is intentionally WRONG. A conforming gateway MUST exclude this skill from discovery.\",\n  inputSchema: {\n    type: \"object\",\n    properties: {}\n  },\n  handler() {\n    return { ok: true, note: \"corrupt_skill fixture: declared hash is intentionally wrong\" };\n  }\n});";
const CORRUPT_SKILL_SKILL_MD = "---\nname: corrupt_skill\nversion: 1.0.0\nlicense: MIT\n---\n\n# corrupt_skill\n\n**TEST FIXTURE — not a real skill.**\n\nThis skill is a deliberate trap for gateway robustness testing. The `tool.js`\nserved at `/skills/corrupt_skill/tool.js` is valid JavaScript, but the\n`tool_sha256` declared for this skill in `/llms.txt` is intentionally wrong\n(64 zero chars). A conforming gateway MUST detect the hash mismatch and\nexclude this skill from discovery / execution.";
const BUSY_LOOP_TOOL_JS = "registerTool({\n  name: \"busy_loop\",\n  description: \"TEST FIXTURE for gateway interrupt: handler runs an infinite while loop. A conforming gateway with a QuickJS sandbox using interrupt/timeout MUST abort this. Do NOT call outside a sandbox.\",\n  inputSchema: {\n    type: \"object\",\n    properties: {}\n  },\n  handler() {\n    while (true) {}\n  }\n});";
const BUSY_LOOP_SKILL_MD = "---\nname: busy_loop\nversion: 1.0.0\nlicense: MIT\n---\n\n# busy_loop\n\n**TEST FIXTURE — not a real skill.**\n\nThis skill is a deliberate trap for gateway interrupt/timeout testing. Its\n`handler` runs an infinite `while (true) {}` loop with a correct `tool_sha256`\nin `/llms.txt`. A conforming gateway running the tool inside a QuickJS sandbox\nwith an interrupt handler / timeout MUST abort execution rather than hang.";
const LLMS_TXT = "# llmstxt-bookstore\n\n> A realistic publisher exposing a D1-backed bookstore API and 5 executable skills (3 legitimate + 2 deliberate trap fixtures) per the llms-txt-skills executable-skills extension v0.2.\n\n## Skills\n\n- [search_catalog](/skills/search_catalog/SKILL.md): Search the bookstore catalog by text, genre, and/or max price. <!-- skill: {\"version\":\"1.0.0\",\"tool\":\"/skills/search_catalog/tool.js\",\"tool_sha256\":\"d1220dcd2dd6b6c57b363edbfc2f0f620457cc98d2cc087baa3c7ef45782f175\"} -->\n- [get_book](/skills/get_book/SKILL.md): Get details of a single book by id. Returns {found:false} if not found. <!-- skill: {\"version\":\"1.0.0\",\"tool\":\"/skills/get_book/tool.js\",\"tool_sha256\":\"1b9a78f984ba5bf66450b422b23d151e37139dd05330b73f1b0bd42ae2b8b2ca\"} -->\n- [stock_report](/skills/stock_report/SKILL.md): Return an inventory stock report (totals + top 3 by stock). <!-- skill: {\"version\":\"1.0.0\",\"tool\":\"/skills/stock_report/tool.js\",\"tool_sha256\":\"86b166f2e9ec95112a18ec6bd4a12b2e5ee707137bace0366c74114a42e99b1f\"} -->\n- [corrupt_skill](/skills/corrupt_skill/SKILL.md): TEST FIXTURE: valid tool.js with a deliberately wrong declared sha256 (gateway exclusion test). <!-- skill: {\"version\":\"1.0.0\",\"tool\":\"/skills/corrupt_skill/tool.js\",\"tool_sha256\":\"0000000000000000000000000000000000000000000000000000000000000000\"} -->\n- [busy_loop](/skills/busy_loop/SKILL.md): TEST FIXTURE: infinite-loop handler with correct sha256 (gateway interrupt test). <!-- skill: {\"version\":\"1.0.0\",\"tool\":\"/skills/busy_loop/tool.js\",\"tool_sha256\":\"82475a8dfefeeb60fc997379c2d71bf68c621f3b967bc8b411d3991562585a16\"} -->\n";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/llms.txt") {
      return new Response(LLMS_TXT, { headers: { "content-type": "text/plain; charset=utf-8" } });
    }

    if (path === "/api/search") {
      return handleSearch(url, env);
    }
    const bookMatch = path.match(/^\/api\/book\/(\d+)$/);
    if (bookMatch) {
      return handleBook(Number(bookMatch[1]), env);
    }
    if (path === "/api/stock-report") {
      return handleStockReport(env);
    }

    if (path === "/skills/search_catalog/tool.js") { return new Response(SEARCH_CATALOG_TOOL_JS, { headers: { "content-type": "application/javascript; charset=utf-8" } }); }
    if (path === "/skills/search_catalog/SKILL.md") { return new Response(SEARCH_CATALOG_SKILL_MD, { headers: { "content-type": "text/markdown; charset=utf-8" } }); }
    if (path === "/skills/get_book/tool.js") { return new Response(GET_BOOK_TOOL_JS, { headers: { "content-type": "application/javascript; charset=utf-8" } }); }
    if (path === "/skills/get_book/SKILL.md") { return new Response(GET_BOOK_SKILL_MD, { headers: { "content-type": "text/markdown; charset=utf-8" } }); }
    if (path === "/skills/stock_report/tool.js") { return new Response(STOCK_REPORT_TOOL_JS, { headers: { "content-type": "application/javascript; charset=utf-8" } }); }
    if (path === "/skills/stock_report/SKILL.md") { return new Response(STOCK_REPORT_SKILL_MD, { headers: { "content-type": "text/markdown; charset=utf-8" } }); }
    if (path === "/skills/corrupt_skill/tool.js") { return new Response(CORRUPT_SKILL_TOOL_JS, { headers: { "content-type": "application/javascript; charset=utf-8" } }); }
    if (path === "/skills/corrupt_skill/SKILL.md") { return new Response(CORRUPT_SKILL_SKILL_MD, { headers: { "content-type": "text/markdown; charset=utf-8" } }); }
    if (path === "/skills/busy_loop/tool.js") { return new Response(BUSY_LOOP_TOOL_JS, { headers: { "content-type": "application/javascript; charset=utf-8" } }); }
    if (path === "/skills/busy_loop/SKILL.md") { return new Response(BUSY_LOOP_SKILL_MD, { headers: { "content-type": "text/markdown; charset=utf-8" } }); }

    return json({ error: "Not Found", path }, 404);
  }
};

async function handleSearch(url, env) {
  const q = (url.searchParams.get("q") || "").trim();
  const genre = (url.searchParams.get("genre") || "").trim();
  const maxPriceRaw = url.searchParams.get("max_price");
  const maxPrice = maxPriceRaw !== null ? Number(maxPriceRaw) : null;

  const where = [];
  const params = [];
  if (q.length > 0) {
    where.push("(LOWER(title) LIKE LOWER(?) OR LOWER(author) LIKE LOWER(?))");
    params.push("%" + q + "%", "%" + q + "%");
  }
  if (genre.length > 0) {
    where.push("genre = ?");
    params.push(genre);
  }
  if (maxPrice !== null && Number.isFinite(maxPrice)) {
    where.push("price <= ?");
    params.push(maxPrice);
  }
  const sql = "SELECT id, title, author, genre, price, stock FROM books" +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY id LIMIT 10";
  const { results } = await env.DB.prepare(sql).bind(...params).all();
  return json(results);
}

async function handleBook(id, env) {
  const book = await env.DB.prepare("SELECT id, title, author, genre, price, stock FROM books WHERE id = ?").bind(id).first();
  if (!book) return json({ error: "Not Found", id }, 404);
  return json(book);
}

async function handleStockReport(env) {
  const totals = await env.DB.prepare(
    "SELECT COUNT(*) AS total_titles, COALESCE(SUM(stock),0) AS total_stock, SUM(CASE WHEN stock = 0 THEN 1 ELSE 0 END) AS out_of_stock FROM books"
  ).first();
  const { results: top3 } = await env.DB.prepare(
    "SELECT id, title, author, stock FROM books ORDER BY stock DESC, id ASC LIMIT 3"
  ).all();
  return json({
    total_titles: totals.total_titles,
    total_stock: totals.total_stock,
    out_of_stock: totals.out_of_stock,
    top3_by_stock: top3,
  });
}
