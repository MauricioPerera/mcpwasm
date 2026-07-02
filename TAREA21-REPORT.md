# TAREA21 — Publisher "llmstxt-docs" (estático: docs del estándar + snapshot BM25 pineado por hash + skills)

**Objetivo:** un nuevo publisher DESPLEGADO que sirve los documentos del estándar
llms-txt-skills, publica un snapshot de búsqueda BM25 pineado por hash, y 3 skills
executables para consultarlos. La ejecución vía gateway es la tarea siguiente; aquí
el publisher + verificación local y de producción.

**Resultado: LISTO.** `https://llmstxt-docs.rckflr.workers.dev` desplegado. `/llms.txt`
con 3 skills (`tool_sha256`) + línea `skills-memory` (`snapshot_sha256`); los 7 checks
(7a–7d) pasan con salidas reales.

---

## 1. Estructura creada (`docs-site/**`)

```
docs-site/
  wrangler.toml          # name "llmstxt-docs", main worker.mjs, compat 2026-06-01, account 091122c…
  build.mjs              # fetch docs + ingesta OKF + snapshot/sha + genera worker.mjs y wrangler.toml
  worker.mjs             # AUTOGENERADO por build.mjs (contenido incrustado byte-exacto)
  skills-index.snapshot  # snapshot BM25 (93107 bytes), pineado por sha256
  doc-sources.json       # provenance de los 4 docs (rama/commit/local)
  verify.mjs             # 7b: re-hash de tool.js + snapshot vs declarado
  verify-snapshot.mjs    # 7c: importa snapshot de producción en WasmOkfIndex + 2 búsquedas
  content/
    search_spec.tool.js  search_spec.SKILL.md
    get_doc.tool.js      get_doc.SKILL.md
    list_docs.tool.js    list_docs.SKILL.md
    docs/                # 4 markdown (descargados por build.mjs)
      rfc-skills-in-llms-txt.md   ext-executable-skills.md
      ext-skill-attestations.md   mcpwasm-readme.md
```

No se tocó nada fuera de `docs-site/**` y este reporte (ni gateway, ni host-async,
ni vendor-minimemory — solo se consume). No se hicieron commits git.

---

## 2. Contenido — 4 documentos (descarga en build)

`build.mjs` hace `fetch` de los markdown RAW del repo `MauricioPerera/llms-txt-skills`
y los guarda en `content/docs/<name>.md`. Provenance registrado en `doc-sources.json`:

| doc | fuente | rama | commit | bytes |
|---|---|---|---|---|
| `rfc-skills-in-llms-txt` | github-raw | master | `2429f1c` (2026-07-02) | 35379 |
| `ext-executable-skills` | github-raw | master | `2429f1c` (2026-07-02) | 11995 |
| `ext-skill-attestations` | github-raw | **ext-skill-attestations** | `abc8898` | 7048 |
| `mcpwasm-readme` | local | — | `../README.md` | 16221 |

`ext-skill-attestations` **404 en master** → fallback a la rama `ext-skill-attestations`
(lógica `candidates` en `build.mjs`: intenta master primero, si 404 usa la rama).

```
doc rfc-skills-in-llms-txt: 35379 bytes <- github-raw master@2429f1c
doc ext-executable-skills: 11995 bytes <- github-raw master@2429f1c
doc ext-skill-attestations: 7048 bytes <- github-raw ext-skill-attestations@abc8898
doc mcpwasm-readme: 16221 bytes <- local
```

---

## 3. Snapshot BM25 (ingesta OKF en WasmOkfIndex)

Patrón de `build-memsnapshot.mjs`: cada doc se parsea por headings (H1–H3) → secciones;
de cada sección se extraen párrafos de prosa (≥ 40 chars, sin bloques de código, sin
blockquotes — ver §6), `type: docs`, `title: "<doc>: <sección>"`, `chunk_size 800/50`.

**Filtro de blockquotes añadido:** los párrafos que empiezan con `>` (ejemplos/citas)
se descartan. Razón: el RFC incluye un ejemplo de instrucción en español
`> "crea una imagen de 600 x 50 px de color verde …"` cuyo token `de` (df=1 → idf alto)
producía un hit espurio para la query `"receta de paella"` con score −7.78, no
"claramente peor" que el hit relevante (−8.75). Es un ejemplo, no prosa; descartarlo
alinea con "parrafos de prosa por seccion" y deja la query sin relación en 0 hits.

```
conceptos: 160, chunks insertados: 171, idx.len: 171
probe 'tool_sha256 integrity verification' hits: 5 top: rfc-skills-in-llms-txt: 2.2 Optional inline metadata score=-8.75338363647461
probe 'receta de paella' hits: 0
snapshot: 93107 bytes, sha256: e0923930c971a097986083a2ca1e026059199c2434f18b36a8bfeb34f045bbca
```

`skills-index.snapshot` = JSON (`export_snapshot`), servido byte-exacto; su sha256 se
declara en la línea `skills-memory` del `/llms.txt`.

---

## 4. Skills (3) — `tool.js` + `SKILL.md`

| skill | input | handler |
|---|---|---|
| `search_spec` | `{q: string, k?: number ≤10}` | valida tipos (`q` string no vacío; `k` entero 1..10, default 5) → `await host.memorySearch(args.q, k)` → devuelve `{hits}` |
| `get_doc` | `{name: enum de 4}` | valida `name` contra enum → `await host.fetchOrigin("/docs/<name>.md")` → `{name, length, content}` (body recortado a 4000 chars) |
| `list_docs` | `{}` | lista estática de los 4 docs `{name, title, path}` (sin fetch) |

Sandbox ECMAScript puro: sin `URLSearchParams` (query strings a mano con
`encodeURIComponent`). `search_spec` valida tipos de args; `get_doc` valida el enum.

**`tool_sha256` declarados** (calculados por `build.mjs` sobre el string UTF-8 exacto
servido):

```
search_spec: 4a78c2cc78cfec62bfe908aaf7801ed79465f983a220eaf18bf4a7b749a959f2
get_doc:      7cff29b54d5fdecb3c203c749475e9bae1955d3f5c397df4fb2ee9ac5a4eecd0
list_docs:    17d6175805386a0829012ab088c72ca98058255564a47230903c697432666735
```

---

## 5. Formato `/llms.txt` (provisional nuevo, respetado EXACTO)

Sección `## Skills` normal + UNA línea a nivel origin (tras la sección Skills):

```
<!-- skills-memory: {"snapshot":"/skills-index.snapshot","snapshot_sha256":"<sha256 hex>","format":"minimemory-okf-v1"} -->
```

Las skills del origin usan la capability `await host.memorySearch(query, k?)` →
`{hits:[{text,score,title,concept_id}]}` (la implementa el gateway en la próxima tarea;
los `tool.js` ya la usan según este contrato).

---

## 6. `worker.mjs` — rutas

Servido byte-exacto (contenido incrustado vía `JSON.stringify`), `Cache-Control: no-store`
en todas las respuestas (evita staleness cross-deploy del snapshot, que rompería el
check de integridad del gateway):

- `/llms.txt` → `text/plain`
- `/skills/<name>/SKILL.md` → `text/markdown`
- `/skills/<name>/tool.js` → `application/javascript`
- `/docs/<name>.md` → `text/markdown`
- `/skills-index.snapshot` → `application/octet-stream`
- resto → 404 JSON `{"error":"Not Found","path":...}`

Los `tool_sha256` y `snapshot_sha256` del `/llms.txt` se generan desde el contenido
exacto servido (mismo string hasheado === mismo string servido).

---

## 7. Deploy + verificación (salidas reales)

**Deploy:** `npx wrangler deploy -c docs-site/wrangler.toml`

```
Total Upload: 172.51 KiB / gzip: 50.14 KiB
Uploaded llmstxt-docs (3.06 sec)
Deployed llmstxt-docs triggers (1.24 sec)
  https://llmstxt-docs.rckflr.workers.dev
Current Version ID: 02339e4e-dc05-48ba-8dd6-933a5de57e12
```

### 7a) `curl /llms.txt` (producción) — 3 skills con `tool_sha256` + línea `skills-memory` con `snapshot_sha256`

```
# llmstxt-docs

> Publisher of the llms-txt-skills standard documents. Serves the RFC, the executable-skills and skill-attestations extensions, and the mcpwasm reference README, plus a hash-pinned BM25 search snapshot and 3 executable skills to query them.

## Skills

- [search_spec](/skills/search_spec/SKILL.md): BM25 search over the llms-txt-skills spec snapshot (4 docs). Returns hits {text,score,title,concept_id}. <!-- skill: {"version":"1.0.0","tool":"/skills/search_spec/tool.js","tool_sha256":"4a78c2cc78cfec62bfe908aaf7801ed79465f983a220eaf18bf4a7b749a959f2"} -->
- [get_doc](/skills/get_doc/SKILL.md): Fetch one of the 4 published documents by name. Returns {name,length,content} (content truncated to 4000 chars). <!-- skill: {"version":"1.0.0","tool":"/skills/get_doc/tool.js","tool_sha256":"7cff29b54d5fdecb3c203c749475e9bae1955d3f5c397df4fb2ee9ac5a4eecd0"} -->
- [list_docs](/skills/list_docs/SKILL.md): List the 4 published documents with title and path. Static, no fetch. <!-- skill: {"version":"1.0.0","tool":"/skills/list_docs/tool.js","tool_sha256":"17d6175805386a0829012ab088c72ca98058255564a47230903c697432666735"} -->

<!-- skills-memory: {"snapshot":"/skills-index.snapshot","snapshot_sha256":"e0923930c971a097986083a2ca1e026059199c2434f18b36a8bfeb34f045bbca","format":"minimemory-okf-v1"} -->
```

### 7b) `verify.mjs` — re-hash de cada `tool.js` + snapshot vs declarado → TODO OK

```
declared snapshot_sha256: e0923930c971a097986083a2ca1e026059199c2434f18b36a8bfeb34f045bbca
/skills/search_spec/tool.js  declared 4a78c2cc…  actual 4a78c2cc…  match: OK
/skills/get_doc/tool.js      declared 7cff29b5…  actual 7cff29b5…  match: OK
/skills/list_docs/tool.js    declared 17d61758…  actual 17d61758…  match: OK
/skills-index.snapshot       declared e0923930…  actual e0923930…  match: OK
snapshot bytes: 93107
OVERALL: OK
```

### 7c) `verify-snapshot.mjs` — snapshot de PRODUCCIÓN importado en WasmOkfIndex (vendor) + 2 búsquedas

```
downloaded /skills-index.snapshot: 93107 bytes
imported concepts/chunks: 171

query "tool_sha256 integrity verification" -> 5 hits
  [0] score=-8.75338363647461 title="rfc-skills-in-llms-txt: 2.2 Optional inline metadata"
      text="**For integrity verification and full metadata** (sha256, license, cost estimates, requirements), agents SHOULD fetch `/.well-known/agent-skills/index.json` if "
  [1] score=-6.408968925476074 title="rfc-skills-in-llms-txt: 8. Open Questions"
  [2] score=-5.894683361053467 title="ext-skill-attestations: 4. Runtime behavior"
TOP HIT: {"text":"**For integrity verification and full metadata** (sha256, license, cost estimates, requirements), agents SHOULD fetch `/.well-known/agent-skills/index.json` if available. That document is the canonica","score":-8.75338363647461,"title":"rfc-skills-in-llms-txt: 2.2 Optional inline metadata","concept_id":"rfc-skills-in-llms-txt-2-2-optional-inline-metadata-21"}

query "receta de paella" -> 0 hits
relevantes |score|=8.75 vs paella |score|=0.00 -> OK (paella 0 hits o claramente peor)
OVERALL: OK
```

### 7d) `curl /docs/ext-executable-skills.md` → 200 con el markdown

```
HTTP 200 bytes=12018 cc=no-store
# Extension: Executable Skills

**Status:** Draft (v0.3)
**Date:** 2026-07-02
**Extends:** [RFC: Publishing Agent Skills through `llms.txt`](./rfc-skills-in-llms-txt.md) (v0.8)
```

### Extra (rutas/headers)

```
404 JSON:        {"error":"Not Found","path":"/nope"}
search_spec/SKILL.md: HTTP 200  ct=text/markdown; charset=utf-8   cc=no-store
snapshot:             HTTP 200  ct=application/octet-stream       cc=no-store
```

---

## 8. Definición de hecho — cumplida

- [x] `docs-site/` con `wrangler.toml` (name `llmstxt-docs`, account `091122c…`), `worker.mjs`, `build.mjs`, `content/`.
- [x] 4 docs descargados en build (3 raw GitHub + README local); `ext-skill-attestations` desde rama `ext-skill-attestations` (404 en master); commit/rama registrados.
- [x] Snapshot BM25 (WasmOkfIndex, 160 conceptos / 171 chunks, `chunk_size 800/50`) + sha256.
- [x] 3 skills (`search_spec` valida tipos y k≤10; `get_doc` enum + fetchOrigin + recorte 4000; `list_docs` estática) + `SKILL.md`.
- [x] `worker.mjs` sirve `/llms.txt`, skills, `/docs/<name>.md`, `/skills-index.snapshot`, 404 JSON; hashes generados desde el contenido exacto servido.
- [x] Deploy con `npx wrangler deploy`.
- [x] 7a–7d completos con salidas reales en este reporte.

**URL pública:** `https://llmstxt-docs.rckflr.workers.dev`