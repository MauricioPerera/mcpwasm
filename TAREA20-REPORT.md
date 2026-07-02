# TAREA20 — Spike de viabilidad: minimemory (BM25) + QuickJS en el mismo Worker

**Objetivo (spike, no producto):** demostrar en workerd (Miniflare v4) que la base
embebida minimemory puede convivir con QuickJS-asyncify en el MISMO Worker y servir
de capability de búsqueda BM25 para una skill sandboxeada (`search_docs` cuyo
handler hace `await host.memorySearch(args.q)`).

**Resultado: LISTO.** Las dos piezas de wasm coexisten, `host.memorySearch` inyectada
vía `extraCapabilities` (extensión compatible de `host-async.mjs`, vía A) funciona
como puente raw-JSON asyncified, y los 4 checks e2e (6a–6d) pasan en dos corridas
deterministas. Las 3 suites de regresión siguen verdes.

---

## 1. Hallazgo de viabilidad crítico (honestidad temprana)

La premisa del task asume el wasm **~563 KB** de minimemory con BM25. La realidad del
paquete npm publicado difiere y hubo que resolverlo antes de escribir una línea del
Worker:

- **`npm view @rckflr/minimemory` → versiones `2.5.0, 2.6.0, 3.0.0, 3.0.1`; `latest = 3.0.1`.**
  `^3.0.1` instaló **3.0.1** (wasm **466 KB**, 44 exports, todos `wasmvectordb_*`).
- **v3.0.1 NO expone BM25 usable desde JS.** `WasmVectorDB.keyword_search()` lanza
  siempre `"Invalid configuration: BM25 index required for keyword search"`. El único
  modo de activar BM25 en Rust es `VectorDB::with_fulltext(config, indexed_fields)`,
  que **ningún constructor wasm-expuesto llama** (`new`/`new_int8`/`new_int3`/
  `new_binary`/`new_hnsw`/`new_with_config`). El string del wasm lo confirma:
  `"Full-text search not enabled. Use VectorDB::with_fulltext() to enable."` — pero
  esa API **no está exportada** en la binding JS de 3.0.1.
- **v3.1.0 y v3.2.0 NO están publicadas en npm** (commits de hoy 2026-07-02, solo en
  el repo GitHub). v3.2.0 agrega `WasmOkfIndex` — índice **BM25-only, sin embeddings**,
  expuesto a wasm (`new`, `with_chunk_size`, `ingest_concept`, `search`, `export_snapshot`,
  `import_snapshot`) — y es el wasm de **563 KB** que cita el task (`commit e62ff51:
  "docs: wasm binary is 563KB with WasmOkfIndex"`).

**Alternativa razonable (una, como autoriza el task):** construir v3.2.0 desde el
fuente con el toolchain Rust disponible localmente (`rustc 1.96`, `wasm-pack 0.15`) y
usar ese wasm directamente. Build OK en 34 s:

```
wasm-pack build --target web --release -- --features wasm   # en el clone del repo
=> pkg/minimemory_bg.wasm  576 072 bytes (~563 KB), 58 exports con wasmokfindex_*
```

El wasm + wrapper generados se **vendorizaron** en `vendor-minimemory/` (necesario:
v3.2.0 no está en npm; es el input del spike). No se modificó el fuente del repo
minimemory — solo se consumió su build.

**API usada (WasmOkfIndex, v3.2.0):** ingest de conceptos en formato OKF (markdown +
frontmatter YAML con campo `type` obligatorio; `title` opcional que surfacea en los
hits), `search(query, k, typeFilter)` → `[{concept_id, chunk_id, score, title?, snippet}]`,
snapshot JSON vía `export_snapshot`/`import_snapshot` (round-trip verificado).

Verificación de viabilidad en Node (antes de construir el Worker): `ingest_concept`
con `type: docs` inserta chunks; `search("sandbox capability")` devuelve el chunk
relacionado (score −2.30); `search("receta de paella")` → `[]`; snapshot 848 bytes
→ `import_snapshot` → 4 docs → `search("asyncify")` devuelve el chunk correcto.

---

## 2. Construcción del snapshot

`node build-memsnapshot.mjs` parsea `README.md` por secciones, extrae 20 párrafos
reales de prosa (sin bloques de código), los ingesta como 20 conceptos OKF
(`type: docs`, `title: <sección>`) con `WasmOkfIndex.with_chunk_size(800, 50)`
(cada párrafo ≤ 400 chars → 1 chunk), exporta el snapshot y computa su sha256.

```
conceptos: 20, chunks insertados: 20, idx.len: 20
probe 'sandbox capability quickjs' hits: 5 mcpwasm — Static MCP
snapshot: mem-docs.snapshot (8109 bytes)
sha256:   668fa20fa59d05303703749872ff6bcecde16d6c6030317f548bae8137dfaae5
meta:     mem-snapshot-sha.json
```

El sha256 se hornea en el bundle como `EXPECTED_SNAPSHOT_SHA_DEFAULT` (vía `define`
de esbuild, leído de `mem-snapshot-sha.json`). El Worker lo usa como valor por
defecto de integridad; `env.EXPECTED_SNAPSHOT_SHA` lo overridea (test negativo 6d).
Determinista: dos corridas producen el mismo sha.

---

## 3. `npm run memspike` — exit 0, DOS corridas

Script: `node build-memsnapshot.mjs && node build-memspike.mjs && node mf-memspike.mjs`.
Las dos corridas son idénticas (mismo sha, mismos hits). Salida:

```
tools/list -> ["search_docs","echo"]
PASS tools/list: search_docs + echo presentes

6a) search_docs 'sandbox capability' -> {"jsonrpc":"2.0","id":2,"result":{
  "content":[{"type":"text","text":"{\"hits\":[
    {\"text\":\"Think \\\"php-wasm, but for MCP tools\\\": the platform owner embeds the host, loads `tool.js` files, and each tool runs isolated in a QuickJS WebAssembly sandbox. The only bridge from the sandbox to the pl\",
     \"score\":-5.161484718322754,\"section\":\"mcpwasm — Static MCP\"},
    {\"text\":\"- `host.mjs` — synchronous `ToolHost` ... `host.fetchOrigin` capability, resource hardening ...\",
     \"score\":-2.78489...,\"section\":\"Architecture\"}, ...]}"},
  "structuredContent":{"hits":[{"text":"...sandbox...","score":-5.161...,"section":"mcpwasm — Static MCP"},...]},
  "isError":false}}
PASS 6a: HTTP 200, no isError
PASS 6a: hits no vacios
PASS 6a: top hit tiene score numerico
PASS 6a: top hit tiene section
PASS 6a: top hit contiene texto relacionado (sandbox/capability)

6b) search_docs 'receta de paella'  -> {"jsonrpc":"2.0","id":3,"result":{
  "content":[{"type":"text","text":"{\"hits\":[]}"}],
  "structuredContent":{"hits":[]},"isError":false}}
PASS 6b: HTTP 200
PASS 6b: 0 hits (query sin relacion)

6c) echo 'hola-memspike'             -> {"jsonrpc":"2.0","id":4,"result":{
  "content":[{"type":"text","text":"{\"echo\":\"hola-memspike\"}"}],
  "structuredContent":{"echo":"hola-memspike"},"isError":false}}
PASS 6c: echo HTTP 200, no isError
PASS 6c: echo devuelve el mensaje (QuickJS puro coexiste)

INSTANCIA 1: TODOS LOS CHECKS VERDE

6d) [sha incorrecto] echo 'sobrevivo' -> {..."structuredContent":{"echo":"sobrevivo"},"isError":false}
PASS 6d: Worker vivo (echo funciona) pese a sha incorrecto
6d) [sha incorrecto] search_docs    -> {"jsonrpc":"2.0","id":6,"result":{
  "content":[{"type":"text","text":"Error en la tool: snapshot integrity check failed: sha256 mismatch (expected 000000000000... got 668fa20fa59d...)"}],
  "isError":true}}
PASS 6d: HTTP 200 (no crash/500)
PASS 6d: isError:true (error controlado)
PASS 6d: mensaje menciona integridad/sha mismatch

INSTANCIA 2: TODOS LOS CHECKS VERDE
```

**Notas sobre los checks:**
- **6a:** query relacionada → 4 hits, top hit score −5.161 (BM25: mayor magnitud =
  mejor match), `section` = "mcpwasm — Static MCP", texto contiene "sandbox".
- **6b:** query sin relación → `[]` (0 hits).
- **6c:** `echo` (skill QuickJS pura, sin tocar minimemory) funciona → los 2 wasm
  coexisten en el mismo Worker.
- **6d:** segunda instancia Miniflare con `bindings.EXPECTED_SNAPSHOT_SHA =
  0000…0000`. El check de sha es perezoso (al primer `memorySearch`); `echo` sigue
  funcionando (Worker vivo, no crash). `search_docs` reporta `isError:true` con
  "snapshot integrity check failed: sha256 mismatch" — error controlado, HTTP 200,
  no 500. El skill lanza cuando `memorySearch` devuelve `{error}`, y `mcp-core` lo
  envuelve como `isError`.

---

## 4. Regresión — las 3 suites exit 0

Tras la extensión compatible de `host-async.mjs` (`extraCapabilities`, vía A):

```
===== npm test =====
build OK -> dist/worker.js + dist/quickjs.wasm
initialize/tools-list/create_payment -> 200, structuredContent.ok=true, isError=false
(create_payment OK)

===== npm run spike =====
PASS fetch_home: HTTP 200 / status==200 / firstLine no vacia / isError==false
PASS fetch_evil: isError==true / mensaje contiene "origin"
TODOS LOS CHECKS VERDE

===== npm run gateway =====
PASS auth Bearer (sin/equivocado 401, correcto 200)
PASS concurrencia fan-out 5 -> 0 errores 500, single-flight 1 miss + 4 hit
PASS interrupt determinista busy_loop -> "interrupted" <10s
TODOS LOS CHECKS VERDE
```

`extraCapabilities` por defecto es `null` → sin capabilities extra el comportamiento
es byte-idéntico al previo (las 3 suites lo confirman).

---

## 5. Tabla de tamaños (relevante para límites de Workers)

| Componente | Bytes | ~ Tamaño |
|---|---|---|
| wasm minimemory (v3.2.0, WasmOkfIndex) | 576 072 | 563 KB |
| wasm QuickJS asyncify | 1 027 523 | 1003 KB |
| bundle `worker.js` (esbuild, snapshot/wasm external) | 164 518 | 161 KB |
| snapshot `mem-docs.snapshot` (texto, 20 chunks) | 8 137 | 8 KB |
| wrapper `minimemory.js` (incluido en el bundle) | 47 287 | 46 KB |

Suma no comprimida cargada por el Worker (2 wasm + bundle + snapshot):
~1.77 MB. Límite de Workers: 3 MB (free) / 10 MB (paid) sobre el bundle comprimido;
gzip de ~1.77 MB → ~600 KB. **Holgado en ambos planes.** Dos módulos `CompiledWasm`
coexistentes (QuickJS + minimemory) — demostrado funcionando en workerd.

---

## 6. Elección de vía para la capability (punto 4 del task)

**Vía (A) — PREFERIDA, elegida.** Extensión COMPATIBLE de `host-async.mjs` con opción
nueva `extraCapabilities: { nombre: async (argsJson) => resultJson }`. Inyecta
`host.<nombre>` con el mismo puente raw-JSON asyncified que `fetchOrigin`:
- El host registra `vm.newFunction("__<nombre>Raw", async (argsH) => vm.newString(await fn(vm.getString(argsH))))`.
- El prelude base queda intacto; tras evaluarlo se inyecta
  `host.<nombre> = (args) => JSON.parse(__<nombre>Raw(JSON.stringify(args)))`.
- Sin `extraCapabilities` → ninguna inyección → comportamiento byte-idéntico.

El wasm de minimemory se invoca (sync `idx.search`) mientras asyncify suspende la
pila del wasm QuickJS: dos instancias wasm independientes coexistentes, exactamente
el objetivo del spike. No hizo falta vía (B) (`hostmem-spike.mjs`).

---

## 7. Archivos

**Creados:**
- `build-memsnapshot.mjs` — construye `mem-docs.snapshot` + sha256 desde el README.
- `mem-docs.snapshot` — snapshot JSON (20 chunks, 8137 bytes).
- `mem-snapshot-sha.json` — sha256 + meta (consumido por `build-memspike.mjs`).
- `worker-memspike.mjs` — Worker: carga 2 wasm + snapshot, verifica sha, construye
  `AsyncToolHost` con `extraCapabilities.memorySearch`, skills `search_docs` + `echo`.
- `build-memspike.mjs` — esbuild (conditions workerd, external `*.wasm`+`*.snapshot`,
  define del sha, copia 2 wasm + snapshot a `dist-memspike/`).
- `mf-memspike.mjs` — e2e Miniflare v4 (checks 6a–6d, segunda instancia con sha mal).
- `vendor-minimemory/` — build v3.2.0 vendorizado (`minimemory_bg.wasm` 576 KB,
  `minimemory.js`, `minimemory.d.ts`). Necesario: v3.2.0 no está en npm.
- `dist-memspike/` (gitignore) — salida del build.
- `TAREA20-REPORT.md` — este reporte.

**Modificados:**
- `host-async.mjs` — vía (A): opción `extraCapabilities` (constructor + init +
  inyección de `host.<nombre>`). Extensión compatible; las 3 suites siguen verdes.
- `package.json` — script `"memspike"`; devDependency `@rckflr/minimemory` (npm install).
- `.gitignore` — `dist-memspike/`.

**No tocados (respetado el alcance):** `worker-gateway.mjs`, `mcp-core*.mjs`,
`bookstore/**`, `demo-site/**`, `README.md`, `bench/**`. No se desplegó nada (spike
local; Miniflare ES workerd). No se hicieron commits git.

---

## 8. Cómo reproducir

```
npm install                       # ya hecho (@rckflr/minimemory devDep)
# vendor-minimemory/ ya contiene el build v3.2.0 (generado con wasm-pack; ver §1)
npm run memspike                  # build snapshot + bundle + e2e (6a-6d)
npm test && npm run spike && npm run gateway   # regresión (3 suites)
```

Si hubiera que regenerar `vendor-minimemory/` (p.ej. tras bump de minimemory):
`git clone https://github.com/MauricioPerera/minimemory && wasm-pack build --target web --release -- --features wasm` y copiar `pkg/minimemory_bg.wasm` + `pkg/minimemory.js` a `vendor-minimemory/`.