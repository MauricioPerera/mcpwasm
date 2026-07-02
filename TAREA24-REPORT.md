# TAREA24 — Jubilar vendor-minimemory/ → paquete npm @rckflr/minimemory@3.2.0

**Objetivo:** todo el repo consume `@rckflr/minimemory` desde npm; `vendor-minimemory/` eliminado; 4 suites en verde; gateway redeployado y verificado en producción; docs-site sin redeploy (snapshot byte-idéntico).

## 1) Instalación + comparación wrapper npm vs vendor

```
$ npm install -D @rckflr/minimemory@^3.2.0
changed 1 package, and audited 45 packages in 1s
found 0 vulnerabilities
```

`package.json` (devDependencies): `"@rckflr/minimemory": "^3.2.0"`.

Estructura del paquete npm (`node_modules/@rckflr/minimemory/`):
`minimemory.js` (47287 B), `minimemory_bg.wasm` (576072 B), `minimemory.d.ts` (18244 B), `package.json` (`"main":"minimemory.js"`, `"type":"module"`, sin `exports`).

**Comparación byte a byte (sha256) — npm vs vendor-minimemory/:**

| archivo | sha256 (npm) | sha256 (vendor) | resultado |
|---|---|---|---|
| `minimemory.js`    | `202ad04622dc4b2a90c16487c436650ba197883723fc448e0f80aa94386d437c` | `202ad04622dc4b2a90c16487c436650ba197883723fc448e0f80aa94386d437c` | idéntico |
| `minimemory_bg.wasm` | `10e7dd6715ecc236622479de458977a72de712ea00e482c0a960bef2871ea71e` | `10e7dd6715ecc236622479de458977a72de712ea00e482c0a960bef2871ea71e` | idéntico |
| `minimemory.d.ts`  | `c44e8e4ff9e556ba568d26e7c79fcf949c93bdc9cda107a4a65518a794c96045` | `c44e8e4ff9e556ba568d26e7c79fcf949c93bdc9cda107a4a65518a794c96045` | idéntico |

**Diferencias de API: NINGUNA.** El wrapper es el mismo de wasm-bindgen v3.2.0. Exporta idéntico:
- `export class WasmOkfIndex` (línea 15) — presente, con `with_chunk_size`, `ingest_concept`, `search`, `export_snapshot`, `import_snapshot`, `len`, `is_empty`, `remove_concept`, `concepts`.
- `function initSync(module)` (línea 1217) — presente.
- `export default function init(...)` — usado por los workers como `initMem`.
- El wrapper **no contiene imports internos de `.wasm`** ni `import.meta` (verificado con grep: solo referencias `wasm.<fn>` y comentarios), por lo que esbuild lo bundlea limpio desde node_modules.

**Conclusión:** el paquete npm 3.2.0 es funcionalmente equivalente (de hecho byte-idéntico) al vendor. No fue necesario adaptar la API; solo las rutas de import/copias.

## 2) Cambios de imports/rutas (consumidores del vendor)

Dos patrones de consumo, adaptados:

**A) Scripts Node (ejecutan minimemory en Node vía `initSync` + `readFileSync` del wasm):**
- `build-memsnapshot.mjs`, `docs-site/build.mjs`, `docs-site/verify-snapshot.mjs`.
- Import: `import { initSync, WasmOkfIndex } from "@rckflr/minimemory";`
- Ruta del wasm resuelta vía `createRequire(import.meta.url)` + `require.resolve("@rckflr/minimemory/minimemory_bg.wasm")` (verificado que resuelve: `D:\Repo\mcpwasm\node_modules\@rckflr\minimemory\minimemory_bg.wasm`). El paquete no tiene `exports`, así que Node permite acceso al subpath.

**B) Workers (bundleados con esbuild, `external: ["*.wasm"]`):**
- `worker-gateway.mjs`, `worker-memspike.mjs`.
- Wrapper JS: `import initMem, { WasmOkfIndex } from "@rckflr/minimemory";` (esbuild lo bundlea desde node_modules).
- Wasm: `import MEM_WASM from "./minimemory_bg.wasm";` (queda verbatim por `external *.wasm`; workerd/Miniflare lo resuelve vía regla `CompiledWasm`). Antes era `./vendor-minimemory/minimemory_bg.wasm`.

**C) Builds (copia del wasm junto al bundle):**
- `build-gateway.mjs`: `memWasmSrc = node_modules/@rckflr/minimemory/minimemory_bg.wasm`. Copia a `dist-gateway/minimemory_bg.wasm` (para Miniflare local) **y a raíz `minimemory_bg.wasm`** (para que wrangler, que bundlea `worker-gateway.mjs` desde la raíz con `main="worker-gateway.mjs"`, resuelva `./minimemory_bg.wasm`). Mismo patrón que ya usaba `quickjs-asyncify.wasm`.
- `build-memspike.mjs`: copia a `dist-memspike/minimemory_bg.wasm` (memspike es solo local; `mf-memspike` corre `dist-memspike/worker.js`).

**`.gitignore`:** añadido `minimemory_bg.wasm` (junto a `quickjs-asyncify.wasm`), porque el build materializa ese binario en la raíz del repo como artefacto de build regenerable (no debe commitearse). Justificado: replica el patrón existente de `quickjs-asyncify.wasm`.

## 3) Borrado de vendor-minimemory/

```
$ rm -rf vendor-minimemory
```

`git status` confirma `D vendor-minimemory/{minimemory.d.ts,minimemory.js,minimemory_bg.wasm}`. No se hizo `git rm` ni commit (el PM commitea).

## 4) Suites — las 4 exit 0

```
$ npm test            # build.mjs + mf-test.mjs
EXIT=0   (initialize / tools/list / create_payment -> pay_1001 succeeded)

$ npm run spike       # build-spike.mjs + mf-spike.mjs
EXIT=0   (TODOS LOS CHECKS VERDE: fetch_home 200, fetch_evil origin bloqueado)

$ npm run memspike    # build-memsnapshot + build-memspike + mf-memspike
EXIT=0   (snapshot 8109 bytes sha 668fa20f...; 6a hits sandbox/capability;
          6b paella 0 hits; 6c echo; 6d sha-mismatch -> error controlado, worker vivo)

$ npm run gateway     # build-gateway.mjs + mf-gateway.mjs
EXIT=0   (TODOS LOS CHECKS VERDE: binding POST, auth Bearer, concurrencia 5x
          single-flight 1 miss+4 hit, interrupt determinista)
```

minimemory consumida desde npm verificada end-to-end en `memspike` (search_docs BM25) y `gateway` (capability host.memorySearch sobre el snapshot del docs-site).

## 5) Redeploy gateway + verificación en producción

```
$ node build-gateway.mjs   # materializa raíz/minimemory_bg.wasm + dist-gateway/
build-gateway OK -> dist-gateway/worker.js + quickjs-asyncify.wasm + minimemory_bg.wasm

$ npx wrangler deploy -c wrangler-gateway.toml
Total Upload: 1748.36 KiB / gzip: 616.19 KiB
Worker Startup Time: 4 ms
env.DEMO (llmstxt-demo-site)        Worker
env.BOOKSTORE (llmstxt-bookstore)   Worker
env.DOCS (llmstxt-docs)             Worker
env.ALLOWED_ORIGINS ("https://llmstxt-demo-site..., ...docs..., ...bookstore...")
Deployed llmstxt-gateway -> https://llmstxt-gateway.rckflr.workers.dev
Version ID: 9b12479a-dbdb-4524-86e5-063d36098472
DEPLOY_EXIT=0
```

**Verificación en prod (Bearer de `.gateway-token`, no impreso):** gateway stateless — cada POST es un msg JSON-RPC independiente.

```
docs tools/list        -> 200  tools: search_spec, get_doc, list_docs
docs search_spec {"q":"origin memory snapshot"}
  -> 200  hits: 5  isError: false
     TOP title: ext-executable-skills: 7. Changelog | score: -11.09

bookstore tools/list   -> 200  tools: search_catalog, get_book, stock_report, create_order, busy_loop
                       stock_report schema: {"type":"object","properties":{}}
bookstore stock_report {}
  -> 200  isError: false
     keys: total_titles, total_stock, out_of_stock, top3_by_stock
     total_titles: 52  total_stock: 503

SUMMARY: search_spec hits no vacios -> PASS
```

`search_spec` (docs, origin=docs) devuelve hits no vacíos; `stock_report` (bookstore) devuelve `isError:false` con `total_titles:52, total_stock:503`. Requisitos del PM cumplidos.

## 6) docs-site — snapshot byte-idéntico, NO redeploy

```
$ node docs-site/build.mjs
doc rfc-skills-in-llms-txt: 35379 bytes <- github-raw master@2429f1c
doc ext-executable-skills: 15042 bytes <- github-raw master@2429f1c
doc ext-skill-attestations: 8139 bytes <- github-raw master@2429f1c
doc mcpwasm-readme: 16221 bytes <- local
conceptos: 166, chunks insertados: 180, idx.len: 180
snapshot: 98619 bytes, sha256: a0235f071aa7e28f2096312f22f1ad035901595f3fa91d2cc92b5879bbb7f6d5
Declared snapshot_sha256: a0235f071aa7e28f2096312f22f1ad035901595f3fa91d2cc92b5879bbb7f6d5
BUILD_EXIT=0
```

Comparación con el snapshot desplegado en prod (`https://llmstxt-docs.rckflr.workers.dev/skills-index.snapshot`):

```
prod  bytes: 98619  sha256: a0235f071aa7e28f2096312f22f1ad035901595f3fa91d2cc92b5879bbb7f6d5
local bytes: 98619  sha256: a0235f071aa7e28f2096312f22f1ad035901595f3fa91d2cc92b5879bbb7f6d5
byte-identico: SI
```

**El snapshot regenerado es byte-idéntico al desplegado** (mismo wasm + mismos docs fuente = mismo `export_snapshot`). **No se redeploya docs-site.** Confirmación adicional: `git status` no muestra `docs-site/worker.mjs`, `wrangler.toml`, `skills-index.snapshot` ni `doc-sources.json` como modificados — el build los regeneró idénticos a lo trackeado.

## 7) Grep final — cero referencias a vendor-minimemory en código

```
$ grep -rn "vendor-minimemory" . | grep -vE "node_modules|\.git/|TAREA20-REPORT|TAREA21-REPORT|TAREA22-REPORT"
>>> CERO referencias a vendor-minimemory en codigo del repo <<<
```

(Los únicos matches restantes son los reportes históricos TAREA20/21/22 — no se tocan — y `.git/index` binario, esperado porque no se commiteó ni `git rm`: el PM commitea.)

## 8) Alcance de archivos tocados (git status)

```
 M .gitignore                      (añadido minimemory_bg.wasm)
 M build-gateway.mjs               (wasm src -> npm; copia a raíz + dist)
 M build-memsnapshot.mjs           (import + wasm path -> npm vía createRequire)
 M build-memspike.mjs              (wasm src -> npm; copia a dist raíz)
 M docs-site/build.mjs             (import + wasm path -> npm vía createRequire)
 M docs-site/verify-snapshot.mjs   (import + wasm path -> npm vía createRequire)
 M package-lock.json               (npm install)
 M package.json                    (@rckflr/minimemory ^3.2.0 en devDependencies)
 D vendor-minimemory/minimemory.d.ts
 D vendor-minimemory/minimemory.js
 D vendor-minimemory/minimemory_bg.wasm
 M worker-gateway.mjs              (imports -> @rckflr/minimemory + ./minimemory_bg.wasm)
 M worker-memspike.mjs             (imports -> @rckflr/minimemory + ./minimemory_bg.wasm)
?? TAREA24-REPORT.md
```

No se tocaron `host-async.mjs`, `mcp-core*.mjs`, `llmstxt-parse.mjs`, `bookstore/**`, `demo-site/**`, `README.md`. No se hicieron commits git. No se usó `wrangler dev`. El token nunca se imprimió.

## Definición de hecho

- [x] Diferencias de wrapper: ninguna (byte-idéntico los 3 archivos, mismo API `WasmOkfIndex`+`initSync`).
- [x] grep CERO referencias a vendor-minimemory en código del repo.
- [x] 4 suites exit 0 (test, spike, memspike, gateway).
- [x] Gateway redeployado (Version 9b12479a) y verificado en prod (search_spec 5 hits, stock_report isError:false total_titles:52).
- [x] docs-site: snapshot byte-idéntico -> no redeploy (reportado).