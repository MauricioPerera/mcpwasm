# TAREA11 — llmstxt-bookstore (publisher realista D1)

Worker `llmstxt-bookstore` con base D1 real + ~50 libros, API HTTP, y `/llms.txt`
publicando 5 skills ejecutables (3 legítimas + 2 fixtures trampa) según la
extensión executable-skills v0.2 (clave `tool_sha256`).

## Decisiones

- **Estructura**: replica `demo-site/`. `build.mjs` lee `content/*.tool.js` +
  `*.SKILL.md`, calcula `sha256` sobre los bytes UTF-8 exactos, e incrusta el
  contenido en `worker.mjs` vía `JSON.stringify` (byte-exacto: lo servido ==
  lo hasheado). Genera también `wrangler.toml`.
- **corrupt_skill**: fixture intencional. `tool.js` válido y servido, pero el
  `tool_sha256` declarado en `/llms.txt` es deliberadamente `0000…` (64 ceros).
  Comentario en `build.mjs` lo explica. Un gateway conforme DEBE excluirlo.
- **busy_loop**: fixture intencional. `handler` con `while (true) {}` y
  `tool_sha256` CORRECTO. Un gateway con sandbox QuickJS + interrupt DEBE
  abortarlo.
- **API**: 3 rutas contra D1 (`/api/search`, `/api/book/<id>`,
  `/api/stock-report`). Todo lo demás → 404 JSON.
- **Sin `wrangler dev`**; solo comandos que terminan solos. Sin commits git.
  No se tocó nada fuera de `bookstore/` y este reporte (`demo-site/` intacto).

## database_id

```
7c1279c5-7845-4221-b8a2-aa4e1ef6eeba
```

## URL pública

```
https://llmstxt-bookstore.rckflr.workers.dev
```

---

## (1) D1 create + seed + COUNT remoto

### `npx wrangler d1 create bookstore-db`

```
 ⛅️ wrangler 4.106.0
────────────────────
✅ Successfully created DB 'bookstore-db' in region WNAM
Created your new D1 database.

To access your new D1 Database in your Worker, add the following snippet to your configuration file:
[[d1_databases]]
binding = "bookstore_db"
database_name = "bookstore-db"
database_id = "7c1279c5-7845-4221-b8a2-aa4e1ef6eeba"
```

(Nota: el primer intento falló con `Authentication error [code: 10000]`; el
segundo intento, idéntico, tuvo éxito. Reutilizada esa base en adelante.)

### `npx wrangler d1 execute bookstore-db --remote --file bookstore/schema.sql -y`

```
    "results": [
      {
        "Total queries executed": 3,
        "Rows read": 53,
        "Rows written": 54,
        "Database size (MB)": "0.02"
      }
    ],
    "success": true,
    "meta": {
      "changes": 53,
      "last_row_id": 52,
      "changed_db": true,
      "num_tables": 1
    }
```

### `npx wrangler d1 execute bookstore-db --remote --command "SELECT COUNT(*) AS n FROM books" --json -y`

```
        "n": 52
      }
    ],
    "success": true,
```

→ **52 libros** seedeados (~50, como se pide).

---

## (2) Deploy con URL pública

### `npx wrangler deploy -c bookstore/wrangler.toml`

```
 ⛅️ wrangler 4.106.0
───────────────────────────────────────────────
Total Upload: 11.48 KiB / gzip: 3.51 KiB
Your Worker has access to the following bindings:
Binding                    Resource
env.DB (bookstore-db)      D1 Database

Uploaded llmstxt-bookstore (1.93 sec)
Deployed llmstxt-bookstore triggers (0.95 sec)
  https://llmstxt-bookstore.rckflr.workers.dev
Current Version ID: ba7fe9c8-abfe-4a7e-a445-5983efb160df
```

(Primeras peticiones post-deploy devolvieron transitoriamente `error code: 1042`
(cold-start del edge); al reintentar, todas las rutas respondieron correctamente.)

---

## (3) curl producción

### `GET /llms.txt`

```
# llmstxt-bookstore

> A realistic publisher exposing a D1-backed bookstore API and 5 executable skills (3 legitimate + 2 deliberate trap fixtures) per the llms-txt-skills executable-skills extension v0.2.

## Skills

- [search_catalog](/skills/search_catalog/SKILL.md): Search the bookstore catalog by text, genre, and/or max price. <!-- skill: {"version":"1.0.0","tool":"/skills/search_catalog/tool.js","tool_sha256":"02cbf0db6a0d02c22e3ad03b4f09f98195a806cad10f6c5ab25ff80bd41c7e08"} -->
- [get_book](/skills/get_book/SKILL.md): Get details of a single book by id. Returns {found:false} if not found. <!-- skill: {"version":"1.0.0","tool":"/skills/get_book/tool.js","tool_sha256":"1b9a78f984ba5bf66450b422b23d151e37139dd05330b73f1b0bd42ae2b8b2ca"} -->
- [stock_report](/skills/stock_report/SKILL.md): Return an inventory stock report (totals + top 3 by stock). <!-- skill: {"version":"1.0.0","tool":"/skills/stock_report/tool.js","tool_sha256":"86b166f2e9ec95112a18ec6bd4a12b2e5ee707137bace0366c74114a42e99b1f"} -->
- [corrupt_skill](/skills/corrupt_skill/SKILL.md): TEST FIXTURE: valid tool.js with a deliberately wrong declared sha256 (gateway exclusion test). <!-- skill: {"version":"1.0.0","tool":"/skills/corrupt_skill/tool.js","tool_sha256":"0000000000000000000000000000000000000000000000000000000000000000"} -->
- [busy_loop](/skills/busy_loop/SKILL.md): TEST FIXTURE: infinite-loop handler with correct sha256 (gateway interrupt test). <!-- skill: {"version":"1.0.0","tool":"/skills/busy_loop/tool.js","tool_sha256":"82475a8dfefeeb60fc997379c2d71bf68c621f3b967bc8b411d3991562585a16"} -->
```

5 skills, todas con clave `tool_sha256` (no `sha256`).

### `GET /api/search?q=dune&max_price=20`

```json
[{"id":1,"title":"Dune","author":"Frank Herbert","genre":"science-fiction","price":18.5,"stock":12},{"id":2,"title":"Dune Messiah","author":"Frank Herbert","genre":"science-fiction","price":14,"stock":5},{"id":3,"title":"Children of Dune","author":"Frank Herbert","genre":"science-fiction","price":15.25,"stock":0},{"id":4,"title":"God Emperor of Dune","author":"Frank Herbert","genre":"science-fiction","price":16,"stock":3}]
```

### `GET /api/book/1`

```json
{"id":1,"title":"Dune","author":"Frank Herbert","genre":"science-fiction","price":18.5,"stock":12}
```

### `GET /api/book/99999` (404 JSON)

```json
{"error":"Not Found","id":99999}
[status 404]
```

### `GET /api/stock-report`

```json
{"total_titles":52,"total_stock":525,"out_of_stock":12,"top3_by_stock":[{"id":19,"title":"Ender's Game","author":"Orson Scott Card","stock":30},{"id":41,"title":"The Hobbit","author":"J.R.R. Tolkien","stock":30},{"id":28,"title":"1984","author":"George Orwell","stock":28}]}
```

---

## (4) Verificación de hashes desde producción (`node bookstore/verify.mjs <URL>`)

```
=== /skills/search_catalog/tool.js ===
declared tool_sha256: 02cbf0db6a0d02c22e3ad03b4f09f98195a806cad10f6c5ab25ff80bd41c7e08
actual   tool_sha256: 02cbf0db6a0d02c22e3ad03b4f09f98195a806cad10f6c5ab25ff80bd41c7e08
match: OK -> OK

=== /skills/get_book/tool.js ===
declared tool_sha256: 1b9a78f984ba5bf66450b422b23d151e37139dd05330b73f1b0bd42ae2b8b2ca
actual   tool_sha256: 1b9a78f984ba5bf66450b422b23d151e37139dd05330b73f1b0bd42ae2b8b2ca
match: OK -> OK

=== /skills/stock_report/tool.js ===
declared tool_sha256: 86b166f2e9ec95112a18ec6bd4a12b2e5ee707137bace0366c74114a42e99b1f
actual   tool_sha256: 86b166f2e9ec95112a18ec6bd4a12b2e5ee707137bace0366c74114a42e99b1f
match: OK -> OK

=== /skills/corrupt_skill/tool.js ===
declared tool_sha256: 0000000000000000000000000000000000000000000000000000000000000000
actual   tool_sha256: 63103f6e48732f8499f72d1a8b74f1b5022be94c6bd8302e137542a1e54cc4a0
match: MISMATCH -> MISMATCH (expected fixture)

=== /skills/busy_loop/tool.js ===
declared tool_sha256: 82475a8dfefeeb60fc997379c2d71bf68c621f3b967bc8b411d3991562585a16
actual   tool_sha256: 82475a8dfefeeb60fc997379c2d71bf68c621f3b967bc8b411d3991562585a16
match: OK -> OK

OVERALL: OK (4 legit OK, corrupt_skill MISMATCH)
```

Resultado explícito:
- `search_catalog`, `get_book`, `stock_report`, `busy_loop` → hash declarado == hash real → **OK**.
- `corrupt_skill` → hash declarado (`0000…`) != hash real (`63103…`) → **MISMATCH (esperado, es el fixture de exclusión del gateway)**. Un gateway conforme debe excluir esta skill.

---

## (5) Los dos tool.js trampa servidos (visibles por curl)

### `GET /skills/corrupt_skill/tool.js`

```js
registerTool({
  name: "corrupt_skill",
  description: "TEST FIXTURE for gateway robustness: this tool.js is valid and served correctly, but the tool_sha256 declared for it in /llms.txt is intentionally WRONG. A conforming gateway MUST exclude this skill from discovery.",
  inputSchema: {
    type: "object",
    properties: {}
  },
  handler() {
    return { ok: true, note: "corrupt_skill fixture: declared hash is intentionally wrong" };
  }
});
```

### `GET /skills/busy_loop/tool.js`

```js
registerTool({
  name: "busy_loop",
  description: "TEST FIXTURE for gateway interrupt: handler runs an infinite while loop. A conforming gateway with a QuickJS sandbox using interrupt/timeout MUST abort this. Do NOT call outside a sandbox.",
  inputSchema: {
    type: "object",
    properties: {}
  },
  handler() {
    while (true) {}
  }
});
```

---

## Archivos creados

```
bookstore/
  wrangler.toml          (generado por build.mjs)
  worker.mjs             (generado por build.mjs)
  build.mjs              (genera worker.mjs + wrangler.toml; hash corrupt_skill intencionalmente roto)
  verify.mjs             (verificación post-deploy)
  schema.sql             (tabla books + 52 INSERTs seed)
  content/
    search_catalog.tool.js
    search_catalog.SKILL.md
    get_book.tool.js
    get_book.SKILL.md
    stock_report.tool.js
    stock_report.SKILL.md
    corrupt_skill.tool.js   (fixture: hash declarado roto)
    corrupt_skill.SKILL.md
    busy_loop.tool.js       (fixture: while(true){})
    busy_loop.SKILL.md
TAREA11-REPORT.md
```