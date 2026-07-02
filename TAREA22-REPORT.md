# TAREA22 — Capability de memoria end-to-end en el gateway (Static MCP)

Objetivo: el gateway soporta la capability de memoria (`host.memorySearch`) en
producción: descubre la línea `skills-memory` del llms.txt de un origin,
descarga el snapshot, **verifica `snapshot_sha256`**, construye un índice
`WasmOkfIndex` (BM25) por request e inyecta `host.memorySearch` a las skills de
**ese** origin via `extraCapabilities`. Orígenes sin memoria siguen intactos.

Publisher verificado: `https://llmstxt-docs.rckflr.workers.dev` (3 skills:
`search_spec`, `get_doc`, `list_docs`; línea `skills-memory` con snapshot BM25
de 4 docs, ~93 KB, format `minimemory-okf-v1`).

## Archivos tocados

- `llmstxt-parse.mjs` — parsea también la línea `skills-memory`; devuelve
  `{skills, memory}`.
- `worker-gateway.mjs` — fetch + verify sha256 del snapshot en el
  descubrimiento (cacheado en el isolate), `WasmOkfIndex` por request,
  `memorySearch` via `extraCapabilities`.
- `wrangler-gateway.toml` — origin docs en `ALLOWED_ORIGINS` + binding `DOCS`.
- `build-gateway.mjs` — copia `vendor-minimemory/minimemory_bg.wasm` a
  `dist-gateway/vendor-minimemory/`.
- `mf-gateway.mjs` — checks nuevos contra el docs-site real + snapshot corrupto.
- `host-async.mjs` **NO tocado** (`extraCapabilities` ya existe desde T20).

## Decisiones de diseño

- **`memorySearch` solo se inyecta si el snapshot verifica sha256.** Si el
  sha declarado no coincide con el snapshot servido (o fetch falla / HTTP no-200
  / format unsupported), `snapshotText = null` y la capability **no se inyecta**.
  Las skills se siguen listando (tool.js ya verificada); las que llaman
  `host.memorySearch` ven `undefined` → throw dentro del sandbox →
  **`isError: true`** (fail controlado, HTTP 200, no crash del gateway). Es la
  opción elegida y documentada para el caso corrupto (frente a inyectar una
  capability que devuelva `{error}`: ambas afloran como `isError`, pero no
  inyectar evita ejecutar wasm sobre un snapshot no verificado).

- **Puente raw-JSON y `k` posicional.** `extraCapabilities` reenvía **solo el
  primer argumento posicional** (`host.<name>(args)` →
  `__<name>Raw(JSON.stringify(args))`). La skill `search_spec` del docs-site
  llama `host.memorySearch(args.q, k)`, así que al host llega `argsJson =
  JSON.stringify(args.q)` = `'"<query>"'` (string JSON) y `k` se descarta. La
  capability acepta ambos estilos: string (docs-site, k default 5) y objeto
  `{q,k}` (estilo memspike). `k` se acota a `[1,10]` en la capability (defensa
  en profundidad; la skill ya acota 1..10 client-side). No se tocó
  `host-async.mjs` (cambiar el reenvío rompería memspike, que pasa un objeto).

- **Índice por request, sin estado compartido.** `getMem()` cachea el init del
  wasm minimemory a nivel isolate (singleton `wasm`); `makeMemorySearch` crea
  `new WasmOkfIndex()` + `import_snapshot(snapshotText)` perezosamente por
  closure (la closure se crea por request en `PerSkillHost.init`). Una
  instancia por request. La búsqueda es sync y corre durante la suspensión
  asyncify de QuickJS, bajo `withModuleLock` → serializada (mismo modelo de
  coexistencia de 2 wasm verificado en T20).

- **Cache de snapshot en el isolate.** El TEXTO del snapshot verificado se
  cachea junto a las skills (`isolateCachePut(origin, skills, rejected,
  snapshotText)`), respetando el TTL 60s y el límite de 16 entradas (~1.5 MB
  máximo de snapshot text en isolate). No se cachea snapshot corrupto.

## 1) `llmstxt-parse.mjs`

`parseLlmsTxt(text) -> { skills, memory }`. `memory = {snapshot,
snapshot_sha256, format, unsupported}` o `null`. Solo `minimemory-okf-v1` se
procesa (`unsupported: false`); otro format → `memory` presente con
`unsupported: true` (no rompe). JSON inválido o campos faltantes → `memory:
null`. Sólo `worker-gateway.mjs` importa `parseLlmsTxt` (actualizado al nuevo
return).

## 2) `worker-gateway.mjs`

- `import initMem, { WasmOkfIndex } from "./vendor-minimemory/minimemory.js"` +
  `import MEM_WASM from "./vendor-minimemory/minimemory_bg.wasm"` (estático,
  CompiledWasm en el build).
- `getMem()` — init wasm cacheado a nivel isolate (reset on error).
- `makeMemorySearch(snapshotText)` — capability raw-JSON asyncified; parsea
  `argsJson` (string | `{q,k}`), acota `k` a 1..10, construye `WasmOkfIndex` por
  closure, devuelve `{hits:[{text, score, title, concept_id}]}` o `{error}`.
- `discoverSkillsInner` — tras verificar las skills, si `memory` soportada:
  `fetchText(snapshotUrl, 5000, fetchImpl)` (mismo bindings/timeout), sha256,
  y guarda `snapshotText` solo si coincide. Devuelve `{skills, rejected,
  discovery, snapshotText}`.
- `PerSkillHost` — acepta `snapshotText`; si está, inyecta
  `extraCapabilities: { memorySearch }` (misma closure a todas las skills del
  origin → 1 índice por request). Si no, `extraCapabilities: null` →
  comportamiento byte-identico al previo.
- `makeFetchImpl` — mapea `env.DOCS` → `https://llmstxt-docs.rckflr.workers.dev`
  (bypass error 1042 misma cuenta).

## 3) `wrangler-gateway.toml`

`ALLOWED_ORIGINS` añade `https://llmstxt-docs.rckflr.workers.dev`. Nuevo
`[[services]] binding = "DOCS" service = "llmstxt-docs"`.

## 4) `build-gateway.mjs`

Copia `vendor-minimemory/minimemory_bg.wasm` a
`dist-gateway/vendor-minimemory/` (el import `.wasm` queda verbatim en el
bundle, `external: ["*.wasm"]`).

## 5) `mf-gateway.mjs` — checks nuevos

**(a)** `tools/list origin=docs` → 3 skills (`search_spec, get_doc, list_docs`).
**(b)** `search_spec {"q":"tool_sha256 integrity verification"}` → hits no
vacíos, top hit con `title`, `score` numérico, `text` (snippet), `concept_id`.
**(c)** `search_spec {"q":"receta de paella valenciana"}` → 0 hits.
**(d)** `get_doc {"name":"ext-executable-skills"}` → `content` no vacío.
**(e)** orígenes sin memoria intactos (sum_numbers=42 cubierto por checks
1-4 existentes; bookstore no se re-prueba aquí).
**(f)** snapshot corrupto (local, service binding DOCS fake): skill listada
(tool.js sha OK), `tools/call mem_probe` → `isError: true` con
`"Error en la tool: not a function"` (memorySearch no inyectada).

## 6) Regresión — las 4 suites exit 0

```
npm test     -> EXIT=0   (TODOS LOS CHECKS VERDE)
npm run spike   -> SPIKE_EXIT=0   (TODOS LOS CHECKS VERDE)
npm run memspike -> MEMSPIKE_EXIT=0  (INSTANCIA 1 y 2: TODOS LOS CHECKS VERDE)
npm run gateway -> TODOS LOS CHECKS VERDE  (incl. T22.a-d y T22.f)
```

Salida real `npm run gateway` (T22):
```
[T22.a] docs tools/list -> 3 skills (search_spec, get_doc, list_docs)        PASS
[T22.b] docs search_spec integridad -> hits no vacios                        PASS
        top hit con title / score numerico / text / concept_id               PASS
        isError==false                                                        PASS
[T22.c] docs search_spec paella -> 0 hits (out-of-domain)                    PASS
[T22.d] docs get_doc ext-executable-skills -> content no vacio, isError=false PASS
[T22.f] corrupt: tools/list HTTP 200 (skill listada pese a snapshot corrupto) PASS
        corrupt: mem_probe isError==true (memorySearch NO inyectada)          PASS
```

Snapshot corrupto (T22.f) salida real:
```
[T22.f] fake mem_probe call ->
  {"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"Error en la tool: not a function"}],"isError":true}}
```

## 7) Deploy + verificación en producción

Deploy (`npx wrangler deploy -c wrangler-gateway.toml`):
```
Total Upload: 1748.35 KiB / gzip: 616.20 KiB
Worker Startup Time: 5 ms
env.DEMO (llmstxt-demo-site)   Worker
env.BOOKSTORE (llmstxt-bookstore) Worker
env.DOCS (llmstxt-docs)        Worker
env.ALLOWED_ORIGINS ("https://llmstxt-demo-site.rckflr.work..., ...docs..., ...bookstore...")
Deployed llmstxt-gateway -> https://llmstxt-gateway.rckflr.workers.dev
Version ID: 54b7680e-7b5c-46a0-acc5-eb6dacd83a49
DEPLOY_EXIT=0
```

Verificación en prod (Bearer de `.gateway-token`):

```
tools/list origin=docs        -> search_spec, get_doc, list_docs            (3 skills)
search_spec "tool_sha256 integrity verification"
  -> hits: 5
     TOP title:      rfc-skills-in-llms-txt: 2.2 Optional inline metadata
     TOP score:      -8.75338363647461
     TOP concept_id: rfc-skills-in-llms-txt-2-2-optional-inline-metadata-21
     TOP text:       **For integrity verification and full metadata** (sha256, license, cost estimates, requirements), agents SHOULD fetch `/.well-known/agent-skills/index.json` if ...
search_spec "receta de paella valenciana" -> hits: []   (0 hits, out-of-domain)
get_doc "ext-executable-skills"
  -> name: ext-executable-skills, length: 4096,
     content[:120]: # Extension: Executable Skills\n\n**Status:** Draft (v0.3)\n**Date:** 2026-07-02\n**Extends:** [RFC: Publishing Agent Skills
```

Sanidad (orígenes sin memoria, intactos):
```
demo sum_numbers {a:2,b:40}      -> result: 42, isError: false
bookstore tools/list             -> search_catalog, get_book, stock_report, create_order, busy_loop
bookstore stock_report {isbn:...}-> {total_titles:52,total_stock:503,out_of_stock:12,top3_by_stock:[...]} isError:false
```

> Nota: la primera llamada `search_spec paella` post-deploy devolvió
> transitoriamente `origin no permitido` (id:null) — un isolate frío aún
> servía la config anterior (sin docs en la allowlist) durante la propagación
> del deploy. Re-intento inmediato: `hits: []` correcto. No recurrente.

## Tamaño del bundle vs límite Workers

```
dist-gateway/worker.js                          172.4 KB
dist-gateway/quickjs-asyncify.wasm             1003.4 KB
dist-gateway/vendor-minimemory/minimemory_bg.wasm 562.6 KB
TOTAL dist-gateway                             1738.4 KB  (gzip subido: 616.2 KB)
```

Límite Workers: **1 MiB comprimido por Worker** (free) / 10 MiB (paid). Subido
gzip = **616.2 KB < 1 MiB** → dentro del límite free. Los dos wasm
(quickjs-asyncify + minimemory) son el grueso; `worker.js` (bundle con
quickjs-emscripten + minimemory.js + gateway) es 172 KB.

## Definición de hecho

- [x] 4 suites exit 0 (test, spike, memspike, gateway).
- [x] Deploy con binding DOCS.
- [x] Verificación en prod: tools/list (3), search_spec integridad (5 hits, top
      hit), paella (0), get_doc (contenido), sanidad demo/bookstore.
- [x] Caso snapshot corrupto local (5f): skill listada, `isError: true`.