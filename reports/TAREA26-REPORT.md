# TAREA26-REPORT — BUG 1 (k descartado en extraCapabilities) + BUG 2 (leak de timer en fetchOrigin)

## Opción elegida: A (arreglo de raíz)

**Por qué A y no B:** el defecto está en el puente genérico de `extraCapabilities`
de `host-async.mjs`, no en `memorySearch` ni en `search_spec`. El wrapper tomaba un
único parámetro `args` y reenviaba solo ese, de modo que **cualquier** capability
invocada con más de un argumento posicional perdía los restantes — `memorySearch` era
solo el caso visible. La Opción A arregla el patrón de raíz para **todas** las
capabilities futuras (no solo `memorySearch`): el wrapper reenvía TODOS los args
posicionales como un array JSON, y cada fn host desempaqueta ese array según su
contrato. La Opción B solo parcheaba `search_spec.tool.js` (y exigía rebuild +
redeploy del docs-site) dejando el puente roto para la próxima capability posicional.

A es viable y limpia: los consumidores del contrato viejo son exactamente dos
(`makeMemorySearch` en `worker-gateway.mjs` y `worker-memspike.mjs`), ambos
adaptados a desempaquetar el array manteniendo compat hacia atrás con el estilo
objeto/string. `docs-site/worker.mjs` es un servidor estático independiente (sin
`AsyncToolHost`/`extraCapabilities`) → bajo A **no se toca** el docs-site (sin
rebuild, sin redeploy, `tool_sha256` de `search_spec` inalterado).

## BUG 1 — puente reenvía todos los args posicionales (Opción A)

**`host-async.mjs`** (wrapper inyectado en `init()`):
```js
// antes: function (args) { ... JSON.stringify(args === undefined ? null : args) }
// ahora:
"globalThis.host." + name + " = function (...args) {" +
" return JSON.parse(globalThis.__" + name + "Raw(JSON.stringify(args)));" +
"};"
```
Con rest params `args` es siempre un array → la llamada `host.memorySearch(q, k)`
envía `'["<q>",k]'` (antes enviaba solo `'"<q>"'` y perdía `k`). El guard
`args === undefined` se elimina (un rest nunca es undefined). `__<name>Raw` no
cambia: ya tomaba el string JSON y lo pasaba a la fn.

**`worker-gateway.mjs`** `makeMemorySearch`: desempaqueta el array a `(first, second)`:
- `["<q>", k]` → `q` + `k` posicionales (caso `search_spec`).
- `[{q,k}]` → `q` + `k` del objeto (estilo objeto posicional).
- `["<q>"]` → `q`, `k` default 5.
- Compat hacia atrás (arg suelto sin envolver): `"<q>"` string y `{q,k}` objeto.
- `k` sigue acotado a `[1,10]`.

**`worker-memspike.mjs`** `makeMemorySearch`: desempaqueta el array (`search_docs`
llama `host.memorySearch({q})` → `[{q}]`); mantiene `k=5` fijo (el spike no declara
`k`). Compat string/objeto preservada. `memspike` verde.

## BUG 2 — clearTimeout del backstop timer en fetchOrigin

**`host-async.mjs`** (`__fetchOriginRaw`): el `setTimeout` del backstop de
`Promise.race` nunca se cancelaba en el camino feliz (fetch resuelve rápido) →
timer colgado hasta `fetchTimeoutMs` (10s) por cada `fetchOrigin`. Fix: capturar el
id y `clearTimeout(timerId)` en un `finally` tras el `Promise.race` (corre tanto en
resolve como en el re-throw del `catch`). Comportamiento de timeout intacto: si el
fetch no resuelve y vence el timer, sigue lanzando `TIMEOUT_TAG` → `"fetchOrigin timeout"`.

## Tests nuevos (mf-gateway.mjs)

- **T26.a** `memorySearch` respeta `k` (e2e contra docs-site real): `search_spec
  {"q":"attestation","k":1}` → **1 hit**; `{"q":"attestation","k":8}` → **8 hits**.
  Verifica `k=8 > k=1` (antes `k` se descartaba y siempre devolvía 5). Query
  "attestation" matches 23 chunks del snapshot → caben ambos topes.
- **T26.b** extraCapability recibe DOS+ args posicionales (carga local):
  AsyncToolHost con capability fake `probe` que graba el `argsJson` recibido; skill
  llama `host.probe('x', 5, true)` → la capability recibe exactamente
  `'["x",5,true]'` (3 args posicionales preservados, no solo el primero).

Tests existentes siguen verdes (T22.b/c search_spec, T22.f snapshot corrupto,
aislamiento, conformidad, POST, timeout, auth, concurrencia, T25 attestations).

## Regresión — 4 suites exit 0

- `npm test` → TODOS LOS CHECKS VERDE, exit 0.
- `npm run spike` → TODOS LOS CHECKS VERDE, exit 0.
- `npm run gateway` → TODOS LOS CHECKS VERDE, exit 0.
- `npm run memspike` → INSTANCIA 1/2 TODOS LOS CHECKS VERDE, exit 0.

## Deploys

- **Gateway**: `npx wrangler deploy -c wrangler-gateway.toml` → Deployed
  `llmstxt-gateway`, Version ID `e8ed9f48-bb71-4d56-b302-3720cfa4e7dd`.
- **docs-site**: NO redeployado (Opción A no toca `search_spec.tool.js` →
  `tool_sha256` inalterado → sin rebuild).

## Verificación en producción (Bearer, tras TTL 60s)

`tools/call search_spec` contra `https://llmstxt-docs.rckflr.workers.dev`:

| arguments | hits |
|-----------|------|
| `{"q":"attestation","k":2}` | **2** |
| `{"q":"attestation","k":8}` | **8** |

`k=8` (8) > `k=2` (2) → **k se respeta de extremo a extremo** (antes siempre 5).

Sanidad:
- `stock_report` (bookstore) → `isError:false`, structuredContent con
  `total_titles/total_stock/out_of_stock/top3_by_stock`.
- `sum_numbers {a:2,b:40}` (demo) → `structuredContent.result === 42`, `isError:false`.

## Archivos tocados

- `host-async.mjs` (BUG 1 puente + doc-comment; BUG 2 clearTimeout).
- `worker-gateway.mjs` (`makeMemorySearch` desempaqueta array).
- `worker-memspike.mjs` (`makeMemorySearch` desempaqueta array).
- `mf-gateway.mjs` (tests T26.a y T26.b).

No se tocaron: `mcp-core*.mjs`, `llmstxt-parse.mjs`, `bookstore/**`, `demo-site/**`,
`README.md`, `scripts/attest.mjs`, `docs-site/**` (sin rebuild/redeploy).