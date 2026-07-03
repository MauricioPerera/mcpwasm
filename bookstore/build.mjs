// Build: lee content/*.tool.js + *.SKILL.md, calcula sha256 sobre los bytes UTF-8
// exactos, y genera worker.mjs (contenido incrustado via JSON.stringify, byte-exacto)
// y wrangler.toml. Los sha256 declarados en /llms.txt coinciden con el contenido
// servido porque el worker sirve el MISMO string sobre el que se hasheo.
//
// EXCEPCION INTENCIONAL: corrupt_skill es un fixture de test de robustez del
// gateway. Su tool.js es valido y se sirve normalmente, pero el tool_sha256
// declarado en /llms.txt es DELIBERADAMENTE incorrecto (64 ceros). Un gateway
// conforme DEBE excluir esta skill al detectar el mismatch. No corregir.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const contentDir = join(__dirname, "content");

const read = (name) => readFileSync(join(contentDir, name), "utf8");
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

// Skills legitimas (hash correcto)
const legit = ["search_catalog", "get_book", "stock_report", "create_order"];
// Fixtures de test
const corrupt = "corrupt_skill"; // hash declarado intencionalmente incorrecto
const busy = "busy_loop"; // hash correcto, pero handler hace while(true){}

const skills = {};

for (const name of [...legit, corrupt, busy]) {
  skills[name] = {
    tool: read(`${name}.tool.js`),
    skillMd: read(`${name}.SKILL.md`),
    realHash: null, // se asigna abajo
  };
}

for (const name of Object.keys(skills)) {
  skills[name].realHash = sha256(skills[name].tool);
}

// Hashes declarados en /llms.txt. Todos correctos salvo corrupt_skill.
const declaredHash = (name) =>
  name === corrupt ? "0".repeat(64) : skills[name].realHash;

// Construye /llms.txt
const skillLines = Object.keys(skills).map((name) => {
  const desc = {
    search_catalog: "Search the bookstore catalog by text, genre, and/or max price.",
    get_book: "Get details of a single book by id. Returns {found:false} if not found.",
    stock_report: "Return an inventory stock report (totals + top 3 by stock).",
    create_order: "Create an order for a book (decrements stock atomically). Returns {ok:true,...} or {ok:false,status:409,...} on insufficient stock / missing book.",
    corrupt_skill: "TEST FIXTURE: valid tool.js with a deliberately wrong declared sha256 (gateway exclusion test).",
    busy_loop: "TEST FIXTURE: infinite-loop handler with correct sha256 (gateway interrupt test).",
  }[name];
  const meta = JSON.stringify({
    version: "1.0.0",
    tool: `/skills/${name}/tool.js`,
    tool_sha256: declaredHash(name),
  });
  return `- [${name}](/skills/${name}/SKILL.md): ${desc} <!-- skill: ${meta} -->`;
});

const llmsTxt =
  `# llmstxt-bookstore\n\n` +
  `> A realistic publisher exposing a D1-backed bookstore API and 6 executable skills (4 legitimate + 2 deliberate trap fixtures) per the llms-txt-skills executable-skills extension v0.2.\n\n` +
  `## Skills\n\n` +
  skillLines.join("\n") + "\n";

// Attestaciones (ext-skill-attestations v0.2). Array JSON publicado en
// /.well-known/agent-skills/attestations.json. Firmado fuera de linea con
// scripts/attest.mjs (clave privada en .attester-key.json, gitignored). Solo
// se atestan las skills legitimas; corrupt_skill (hash mismatch) y busy_loop
// (fixture de interrupt) quedan unattested a proposito. Si no existe el
// archivo -> array vacio.
const attestationsRaw = existsSync(join(contentDir, "attestations.json"))
  ? readFileSync(join(contentDir, "attestations.json"), "utf8")
  : "[]";
const attestations = JSON.parse(attestationsRaw);
console.log("attestations:", attestations.length, "entrada(s)");

// Genera worker.mjs. El contenido se incrusta byte-exacto via JSON.stringify.
const workerConstants = Object.keys(skills).map((name) => {
  const s = skills[name];
  return (
    `const ${name.toUpperCase()}_TOOL_JS = ${JSON.stringify(s.tool)};\n` +
    `const ${name.toUpperCase()}_SKILL_MD = ${JSON.stringify(s.skillMd)};`
  );
}).join("\n");

const toolRouteMap = Object.keys(skills).map((name) =>
  `    if (path === "/skills/${name}/tool.js") { return new Response(${name.toUpperCase()}_TOOL_JS, { headers: { "content-type": "application/javascript; charset=utf-8" } }); }\n` +
  `    if (path === "/skills/${name}/SKILL.md") { return new Response(${name.toUpperCase()}_SKILL_MD, { headers: { "content-type": "text/markdown; charset=utf-8" } }); }`
).join("\n");

const worker =
`// AUTOGENERADO por build.mjs. No editar a mano.
${workerConstants}
const LLMS_TXT = ${JSON.stringify(llmsTxt)};
const ATTESTATIONS = ${JSON.stringify(attestations)};

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
    const bookMatch = path.match(/^\\/api\\/book\\/(\\d+)$/);
    if (bookMatch) {
      return handleBook(Number(bookMatch[1]), env);
    }
    if (path === "/api/stock-report") {
      return handleStockReport(env);
    }

    if (path === "/api/order" && request.method === "POST") {
      return handleCreateOrder(request, env);
    }
    const orderMatch = path.match(/^\\/api\\/order\\/(\\d+)$/);
    if (orderMatch) {
      return handleGetOrder(Number(orderMatch[1]), env);
    }

${toolRouteMap}

    if (path === "/.well-known/agent-skills/attestations.json") {
      return new Response(JSON.stringify(ATTESTATIONS), { headers: { "content-type": "application/json; charset=utf-8" } });
    }

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

async function handleCreateOrder(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const bookId = body && body.book_id;
  const qty = body && body.qty;
  if (typeof bookId !== "number" || !Number.isFinite(bookId) ||
      typeof qty !== "number" || !Number.isFinite(qty) || qty < 1 || Math.floor(qty) !== qty) {
    return json({ error: "book_id and qty (integer >= 1) required" }, 400);
  }
  const book = await env.DB.prepare("SELECT id, stock FROM books WHERE id = ?").bind(bookId).first();
  if (!book) return json({ error: "book not found", book_id: bookId }, 409);
  if (book.stock < qty) {
    return json({ error: "insufficient stock", requested: qty, available: book.stock }, 409);
  }
  // Transaccion D1: INSERT orden + UPDATE stock condicional (stock >= qty).
  // batch() corre ambas en una sola transaccion; si el UPDATE afecta 0 filas
  // (stock cayo por debajo de qty entre el check y el commit), aborta con 409.
  const now = new Date().toISOString();
  const results = await env.DB.batch([
    env.DB.prepare("INSERT INTO orders (book_id, qty, created_at) VALUES (?, ?, ?)").bind(bookId, qty, now),
    env.DB.prepare("UPDATE books SET stock = stock - ? WHERE id = ? AND stock >= ?").bind(qty, bookId, qty),
  ]);
  const orderId = results[0] && results[0].meta && results[0].meta.last_row_id;
  const changes = results[1] && results[1].meta && results[1].meta.changes;
  if (!changes) {
    // El UPDATE no toco filas: stock ya no alcanzaba. La transaccion de batch
    // habra insertado la orden pero el stock no bajo -> reportamos 409. (Caso
    // de race; en practica el check previo ya cubre el camino normal.)
    return json({ error: "insufficient stock (race)", requested: qty, available: book.stock }, 409);
  }
  return json({ order_id: orderId, book_id: bookId, qty: qty, remaining_stock: book.stock - qty }, 200);
}

async function handleGetOrder(id, env) {
  const order = await env.DB.prepare("SELECT id, book_id, qty, created_at FROM orders WHERE id = ?").bind(id).first();
  if (!order) return json({ error: "Not Found", id }, 404);
  return json(order);
}
`;

writeFileSync(join(__dirname, "worker.mjs"), worker, "utf8");

const wrangler =
  `name = "llmstxt-bookstore"\n` +
  `main = "worker.mjs"\n` +
  `compatibility_date = "2026-06-01"\n` +
  `account_id = "091122c40cc6f8d0d421cbc90e2caca8"\n` +
  `[[d1_databases]]\n` +
  `binding = "DB"\n` +
  `database_name = "bookstore-db"\n` +
  `database_id = "7c1279c5-7845-4221-b8a2-aa4e1ef6eeba"\n`;
writeFileSync(join(__dirname, "wrangler.toml"), wrangler, "utf8");

console.log("Generated: worker.mjs, wrangler.toml");
console.log("Declared hashes:");
for (const name of Object.keys(skills)) {
  console.log(`  ${name}: real=${skills[name].realHash} declared=${declaredHash(name)}${name === corrupt ? "  (INTENTIONALLY WRONG)" : ""}`);
}