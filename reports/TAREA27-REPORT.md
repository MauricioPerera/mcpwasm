# TAREA27-REPORT — README.md refresh (~18 tareas de desfase)

Único archivo tocado: `README.md`. Este reporte. Nada más. Sin commits, sin deploys.

## Qué secciones cambiaron

1. **Intro / integración con el estándar** — reescrita la mención a las extensiones: antes citaba solo "executable skills (v0.3)"; ahora nombra **executable-skills v0.4 (con origin memory)** y **skill-attestations v0.2**, con punteros a las secciones nuevas.
2. **Why / Architecture** — actualizado el bullet de resource limits (gas determinista + fetch deadline 10 s) y el flujo (paso 3 añade `host.memorySearch`; paso 1 menciona origin memory). "Pieces live in" añade `worker-memspike.mjs` y describe `host-async.mjs` con `extraCapabilities`.
3. **The executable-skill line** — Status cambiado de "Draft v0.3" a **"Draft v0.4"**.
4. **NUEVA: "Origin memory (search over static content)"** — documenta la línea `<!-- skills-memory: … -->` (con su orden **antes de `## Skills`**), `host.memorySearch(query, k?)` (k default 5, clamp [1,10], shape `{hits:[{text,score,title,concept_id}]}`), verificación sha256 del snapshot, no-inyección controlada si falla, y referencia al docs-site como publisher real. Enlaza la spec v0.4.
5. **NUEVA: "Skill attestations (advisory)"** — formato del objeto atestación (origin/skill/tool_sha256/attester/signed_on/valid_until/signature base64), payload canónico firmado, `/.well-known/agent-skills/attestations.json`, verificación Ed25519 WebCrypto contra `REVIEWERS`, veredictos con precedencia invalid>attested>expired>unattested, los 3 modos, exposición (tag en description + header `X-Gw-Attestations`), y `scripts/attest.mjs` (keygen/sign) con la nota de que la privada es local y gitignored. Enlaza la spec de attestations.
6. **Quick start** — añadido `npm run memspike` (con una línea) y nota de su pipeline `build-memsnapshot → build-memspike → mf-memspike`. **Añadido `-H "Authorization: Bearer <AUTH_TOKEN>"` a los 3 curl de ejemplo** (auth está activo en prod; sin el header da 401 — verificado). `<AUTH_TOKEN>` es placeholder (es un secret, no está en el repo). Añadido el docs-site a los publishers y a "other deployed workers" (raíces 404 por diseño).
7. **Security model** — fetch deadline corregido de **5 s → 10 s**; añadido el **gas determinista (20 000 invocaciones del interruptHandler)** como corte primario con la razón (Date.now congelado en Workers) y el deadline wall-clock 2 s como backstop; añadido bullet de concurrency (mutex por módulo wasm + single-flight). Bullet de attestations apunta a la sección nueva.
8. **Repository layout** — añadidas filas: `worker-memspike.mjs`, `build-memspike.mjs`/`build-memsnapshot.mjs`, `mf-memspike.mjs`, `scripts/attest.mjs`, `bench/` + `BENCHMARK.md`, `minimemory_bg.wasm`, `docs-site/`. Fila de builds y de mf-* ampliada con los memspike. Fila `wrangler-gateway.toml` reescrita con TODAS las vars reales (`ALLOWED_ORIGINS`, `REVIEWERS`, `ATTESTATION_MODE`) + bindings (`DEMO`/`BOOKSTORE`/`DOCS`) + nota de que `AUTH_TOKEN` es secret (no está en el toml). Fila `TAREA1..TAREA7` → `TAREA*-REPORT.md (26 reports, one per milestone)`.
9. **Development notes** — reescrita la lista para enlazar además de T4/T5/T7: **T12/T12B** (reloj congelado → gas determinista), **T14** (structuredContent objeto MCP), **T19** (mutex + single-flight), **T22** (origin memory / minimemory), **T25** (attestations), **T26** (code review fixes: args posicionales + clearTimeout). Rango de reports corregido (26, TAREA1–TAREA26). Añadido párrafo que enlaza `BENCHMARK.md` con headline (~5–10 ms sandbox, gateway warm ~110 ms, cold ~250–400 ms). Añadido `npm run memspike` a la línea final de e2e.

## Cómo se verificó cada afirmación nueva

### URLs desplegadas (5) — `curl -s -o /dev/null -w "%{http_code}"`
```
https://toolhost-mcp.rckflr.workers.dev        200
https://llmstxt-demo-site.rckflr.workers.dev   404   (root 404 por diseño; /llms.txt sirve)
https://llmstxt-bookstore.rckflr.workers.dev   404   (root 404 por diseño; /llms.txt sirve)
https://llmstxt-gateway.rckflr.workers.dev    200
https://llmstxt-docs.rckflr.workers.dev       404   (root 404 por diseño; /llms.txt sirve 200)
```
Las 4 raíces 404 se documentan como "404 by design — only specific routes served". El PoC (200 en root) es la excepción (POST /mcp).

### docs-site llms.txt (origin memory) — sirve 200, skills-memory ANTES de ## Skills
`curl https://llmstxt-docs.rckflr.workers.dev/llms.txt` → 200. Contenido (grep):
```
5:<!-- skills-memory: {"snapshot":"/skills-index.snapshot","snapshot_sha256":"a0235f071aa7e28f2096312f22f1ad035901595f3fa91d2cc92b5879bbb7f6d5","format":"minimemory-okf-v1"} -->
7:## Skills
9:- [search_spec](/skills/search_spec/SKILL.md): ... <!-- skill: {...} -->
10:- [get_doc](...) ...
11:- [list_docs](...) ...
```
Línea 5 (skills-memory) antes que línea 7 (## Skills) ✓. Los 3 nombres de skills y el snapshot_sha256 citados en el README son los reales.

### Auth activo en prod — 401 sin header
`curl -X POST …/mcp?origin=…docs-site -d '{tools/list}'` (sin Authorization) → **401**. Por eso se añadió `-H "Authorization: Bearer <AUTH_TOKEN>"` a los curl de ejemplo.

### scripts/attest.mjs existe y hace keygen+sign
`[ -e scripts/attest.mjs ]` → OK. Leído entero: subcomandos `keygen` (escribe `.attester-key.json`, imprime solo la pública) y `sign <origin> <skill> <valid_until>` (lee llms.txt, firma Ed25519, emite el objeto atestación). ATTESTER = "human:mauricio". Payload canónico = `origin\nskill\ntool_sha256\nsigned_on\nvalid_until` (UTF-8) — coincide con lo documentado.

### .attester-key.json está gitignored
`grep .attester-key.json .gitignore` → línea 11. La privada es local y no se commitea ✓.

### Vars/bindings de wrangler-gateway.toml (grep)
```
ALLOWED_ORIGINS = "https://llmstxt-demo-site.rckflr.workers.dev,https://llmstxt-bookstore.rckflr.workers.dev,https://llmstxt-docs.rckflr.workers.dev"
REVIEWERS = '{"human:mauricio":{"public_key":"YghuJivYSVI458jIjwXEKDLmQaG6X4Itn1VzBXa/ikw=","registered_at":"2026-07-02"}}'
ATTESTATION_MODE = "advisory"
binding = "DEMO"
binding = "BOOKSTORE"
binding = "DOCS"
```
Las 3 vars y los 3 bindings están en el README. `AUTH_TOKEN` **NO** aparece en el toml (es secret) — documentado así en la fila del toml. Nota: el README no contiene ninguna clave ni el token; solo la **public_key** del reviewer (que es pública por diseño — va al registro `REVIEWERS`), y de hecho ya estaba en el toml pre-TAREA27. Ningún valor secreto se añadió.

### package.json scripts (grep)
```
"build":   "node build.mjs"
"test":    "node build.mjs && node mf-test.mjs"
"spike":   "node build-spike.mjs && node mf-spike.mjs"
"gateway": "node build-gateway.mjs && node mf-gateway.mjs"
"memspike":"node build-memsnapshot.mjs && node build-memspike.mjs && node mf-memspike.mjs"
```
Los 5 scripts citados en el Quick start existen; `memspike` es el nuevo y su pipeline (build-memsnapshot → build-memspike → mf-memspike) es el real ✓.

### Archivos citados en Repository layout (todos existen)
`for f in scripts/attest.mjs bench/run.mjs BENCHMARK.md minimemory_bg.wasm worker-memspike.mjs build-memspike.mjs build-memsnapshot.mjs mf-memspike.mjs docs-site worker-gateway.mjs host-async.mjs llmstxt-parse.mjs quickjs-asyncify.wasm quickjs.wasm; do [ -e ] → OK` — los 14 OK, ninguno MISS.

### Capacities del sandbox (host-async.mjs, leído entero)
- `fetchOrigin(path, opts?)` con `opts {method GET|POST, body<=16KB (MAX_BODY_BYTES=16384), contentType}` ✓ (líneas 281–329).
- `extraCapabilities` → inyecta `host.<nombre>` con puente raw-JSON asyncify; TAREA26 reenvía TODOS los args posicionales (`...args` → array JSON) ✓ (líneas 377–439).
- `memoryLimit 64*1024*1024`, `maxStack 1024*1024`, `INTERRUPT_DEADLINE_MS 2000`, `INTERRUPT_MAX_INVOCATIONS 20000`, `DEFAULT_FETCH_TIMEOUT_MS 10000` ✓ (líneas 107–124). El fetch timeout es **10 s** (el README viejo decía 5 s — corregido).

### worker-gateway.mjs (memorySearch + attestations, grep + lectura)
- `makeMemorySearch(snapshotText)` (l.95): k default 5, clamp [1,10], retorna `{hits:[{text,score,title,concept_id}]}` o `{error}` ✓.
- Snapshot: fetch + `sha256Hex` vs `memory.snapshot_sha256`; mismatch/fetch-fail/non-200 → `snapshotText=null` → capability NO inyectada (l.646–684) ✓.
- `extraCapabilities = snapshotText ? { memorySearch } : null` se inyecta a TODAS las skills del origin (l.731–733) ✓.
- Attestations: `attestationMode` (l.320, default "off"), `REVIEWERS` parse (l.326), `fetchAttestations` (l.379, `/.well-known/agent-skills/attestations.json`, 404→null), `verdictForSkill` (l.413, precedencia invalid>attested>expired>unattested), `computeVerdicts`/`attestHeaderStr` (l.453/466, header `X-Gw-Attestations`), modo enforcing excluye no-attested (l.904–913) ✓.
- `makeFetchImpl` enruta el docs origin por el binding `DOCS` (l.258–260) ✓.
- `AUTH_TOKEN` activa auth en POST /mcp (l.800–824) ✓.

### BENCHMARK.md headline (leído)
PoC sandbox `tools/call` p50=63 ms; baseline-direct p50=101 ms; gateway warm pure `sum_numbers` p50=65 ms; `stock_report` (warm, +fetchOrigin+D1) p50=113 ms; cold 257–397 ms. Documentado en el README como "~5–10 ms sandbox, gateway warm ~110 ms, cold ~250–400 ms" ✓. (Single-client desde México, no load test —advertencia preservada.)

## Afirmaciones del ESTADO REAL que NO pude verificar / decidí no escribir
- Ninguna quedada fuera. Todas las del brief se verificaron contra código/deploys.
- Decisión de redacción: la **public_key** del reviewer (pública, ya en `wrangler-gateway.toml` antes de esta tarea) se deja solo referenciada como "public keys van en REVIEWERS"; no se reprintó su valor en el README (no aporta y mantiene el texto limpio de material clave). No es un valor secreto, pero por consistencia con "no keys in README" se omite el literal.