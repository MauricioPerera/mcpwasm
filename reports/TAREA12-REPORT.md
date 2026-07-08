# TAREA12 — Bookstore integrado al gateway en producción + robustez + latencias

Fecha: 2026-07-02
Gateway: `https://llmstxt-gateway.rckflr.workers.dev`
Bookstore: `https://llmstxt-bookstore.rckflr.workers.dev`

---

## 1. Cambios (mínimos, punto 1)

Solo se tocaron `wrangler-gateway.toml` y `worker-gateway.mjs`, exactamente lo pedido.

`wrangler-gateway.toml`:
- `ALLOWED_ORIGINS` ahora incluye `https://llmstxt-bookstore.rckflr.workers.dev`.
- Nuevo `[[services]]` binding `BOOKSTORE` -> `service = "llmstxt-bookstore"` (mismo patrón que `DEMO`).

`worker-gateway.mjs` (`makeFetchImpl`):
```js
if (env && env.BOOKSTORE) {
  bindings["https://llmstxt-bookstore.rckflr.workers.dev"] = env.BOOKSTORE;
}
```
Nada más de la lógica se tocó.

---

## 2. Deploy

```
 ⛅️ wrangler 4.106.0
Total Upload: 1129.17 KiB / gzip: 385.02 KiB
Worker Startup Time: 7 ms
Your Worker has access to the following bindings:
Binding                                                               Resource
env.DEMO (llmstxt-demo-site)                                          Worker
env.BOOKSTORE (llmstxt-bookstore)                                     Worker
env.ALLOWED_ORIGINS ("https://llmstxt-demo-site.rckflr.work...")      Environment Variable

Uploaded llmstxt-gateway (5.67 sec)
Deployed llmstxt-gateway triggers (0.82 sec)
  https://llmstxt-gateway.rckflr.workers.dev
Current Version ID: f8dd0690-07be-40c9-bc87-d9f29e87a78b
```
Bindings `DEMO` y `BOOKSTORE` activos. Desplegado OK.

---

## 3. Verificación de robustez (producción)

### 3a. tools/list (origin=bookstore) — ✅

HTTP 200 | 76ms | x-gw-discovery=hit

Tool names devueltas (exactamente 4):
```json
["search_catalog","get_book","stock_report","busy_loop"]
```
`corrupt_skill` **NO aparece** → excluida correctamente por `tool_sha256` mismatch (descubrimiento la rechaza y no se lista). ✅

### 3b. Llamadas funcionales (D1)

**search_catalog {q:"dune", max_price:20}** — ⚠️ HALLAZGO (bug de la skill, NO del gateway)
```
HTTP 200 | isError:true
text: "Error en la tool: 'URLSearchParams' is not defined"
```
**search_catalog {genre:"science-fiction", max_price:15}** — ⚠️ mismo error
```
HTTP 200 | isError:true
text: "Error en la tool: 'URLSearchParams' is not defined"
```
Causa raíz (confirmada leyendo `bookstore/content/search_catalog.tool.js`): la skill usa `new URLSearchParams()` en el handler, y el sandbox QuickJS del gateway no inyecta `URLSearchParams` como global. El gateway enruta y ejecuta la skill correctamente; la propia skill falla por una API que no existe en el sandbox. El gateway devuelve el error controladamente (HTTP 200, `isError:true`) **sin caer**. Esto es un defecto de la skill publicada en T11 (bookstore/**), fuera del alcance de esta tarea (no se permite tocar bookstore/**). `get_book` y `stock_report` sí devolvieron datos reales de D1.

**get_book {id:1}** — ✅ dato real de D1
```json
{"id":1,"title":"Dune","author":"Frank Herbert","genre":"science-fiction","price":18.5,"stock":12}
```
HTTP 200 | 372ms | isError:false

**get_book {id:99999}** — ✅ sin crash
```json
{"found":false}
```
HTTP 200 | 100ms | isError:false

**stock_report {}** — ✅ totales reales de D1
```json
{
  "total_titles": 52,
  "total_stock": 525,
  "out_of_stock": 12,
  "top3_by_stock": [
    {"id":19,"title":"Ender's Game","author":"Orson Scott Card","stock":30},
    {"id":41,"title":"The Hobbit","author":"J.R.R. Tolkien","stock":30},
    {"id":28,"title":"1984","author":"George Orwell","stock":28}
  ]
}
```
HTTP 200 | 111ms | isError:false

### 3c. busy_loop — ⚠️ HALLAZGO DESTACADO: el interrupt de 2s NO cortó

```
ELAPSED 40128ms (40.1s)
HTTP 503  ( respuesta HTML de Cloudflare )
Error code: 1102  "Worker exceeded resource limits"
Ray ID: a14f331a4e5786c1 • 2026-07-02 16:59:52 UTC
```

**Comportamiento real observado:** el `interruptHandler` de 2s del `AsyncToolHost` (`host-async.mjs`, `INTERRUPT_DEADLINE_MS=2000`, `setInterruptHandler(() => Date.now() > host._deadline)`) **no abortó** el `while(true){}` del fixture `busy_loop.tool.js`. La request quedó colgada ~40s hasta que el runtime de Cloudflare la terminó con **1102 "Worker exceeded resource limits"** (límite de CPU/wall del Worker), no por el deadline del sandbox.

Es decir: contra un bucle síncrono infinito y vacío, el mecanismo de interrupt del build asyncify de QuickJS no disparó en los 2s esperados en este runtime; fue el límite de plataforma (1102) quien cortó. No se maquilló: la salida real es el 503+1102 a los ~40s, no un `isError:true` de interrupt a los ~2-3s.

Notar: el fixture se ejecutó en su propio contexto QuickJS (aislamiento tool<->tool) y el 1102 termina la request, no el isolate entero del gateway de forma permanente (ver 3d/3e).

### 3d. Inmediatamente después de busy_loop — ✅ el gateway sigue vivo y sano

**demo sum_numbers {a:2, b:40}** (origin=demo-site)
```json
{"structuredContent":42,"isError":false}
```
HTTP 200 | 398ms | x-gw-discovery=miss

**bookstore stock_report {}** (origin=bookstore, post-busy_loop)
```json
{"total_titles":52,"total_stock":525,"out_of_stock":12,...}
```
HTTP 200 | 289ms | x-gw-discovery=miss | isError:false

Ambos `miss` porque el isolate que atendió busy_loop terminó anormalmente (1102) y el nuevo isolate reconstruye el cache de descubrimiento. El gateway respondió con datos correctos en ambos origins inmediatamente después. ✅

### 3e. demo-site sigue funcionando — ✅

tools/list (origin=demo-site):
```json
["sum_numbers","server_time"]
```
HTTP 200 | 123ms. El binding `DEMO` no se rompió con la adición de `BOOKSTORE`. ✅

---

## 4. Latencias (20 POST `tools/call stock_report` secuenciales contra producción)

Script: `bench-gateway.mjs` (Node, `fetch` global). Cada request captura `time_total` (ms) y el header `X-Gw-Discovery`. El cache de descubrimiento del isolate tiene TTL 60s; el primer request de cada isolate es `miss`, los siguientes (mismo isolate, <60s) son `hit`.

| #  | ms    | status | x-gw-discovery |
|----|-------|--------|----------------|
| 1  | 658   | 200    | miss           |
| 2  | 224   | 200    | hit            |
| 3  | 109   | 200    | hit            |
| 4  | 109   | 200    | hit            |
| 5  | 105   | 200    | hit            |
| 6  | 378   | 200    | hit            |
| 7  | 130   | 200    | hit            |
| 8  | 132   | 200    | hit            |
| 9  | 126   | 200    | hit            |
| 10 | 121   | 200    | hit            |
| 11 | 131   | 200    | hit            |
| 12 | 134   | 200    | hit            |
| 13 | 119   | 200    | hit            |
| 14 | 110   | 200    | hit            |
| 15 | 116   | 200    | hit            |
| 16 | 98    | 200    | hit            |
| 17 | 107   | 200    | hit            |
| 18 | 99    | 200    | hit            |
| 19 | 108   | 200    | hit            |
| 20 | 109   | 200    | hit            |

### Resumen p50/p95 (ms)

| grupo              | n  | min | p50 | p95 | max |
|--------------------|----|-----|-----|-----|-----|
| miss (cold)        | 1  | 658 | 658 | 658 | 658 |
| hit  (warm cache)  | 19 | 98  | 116 | 378 | 378 |
| ALL                | 20 | 98  | 116 | 378 | 658 |

- **Warm (hit) p50 = 116 ms**, p95 = 378 ms (el #6=378 es un outlier de red; el resto de hits se concentra en 98–134 ms).
- Cold (miss) p50 = 658 ms (descubrimiento completo: fetch llms.txt + fetch/verify sha256 de cada tool.js + parse).
- El cache de descubrimiento del isolate (capa 1, TTL 60s) confirma su efecto: 19/20 requests fueron `hit`.

---

## 5. Regresión local — ✅

`npm run gateway` (e2e contra demo-site) → **TODOS LOS CHECKS VERDE**, `EXIT=0`.

Salida final:
```
TODOS LOS CHECKS VERDE
EXIT=0
```
El e2e usa demo-site; el binding `DEMO` y toda la lógica preexistente siguen verdes tras añadir `BOOKSTORE`.

---

## Resumen de hallazgos

1. **Integración bookstore → gateway: OK.** Binding `BOOKSTORE` + allowlist + mapeo en `makeFetchImpl` (mismo patrón que `DEMO`). Deploy OK, bindings activos.
2. **`corrupt_skill` excluida por `tool_sha256` mismatch: OK** (no aparece en tools/list).
3. **HALLAZGO A — busy_loop / interrupt de 2s NO efectivo en producción.** El `interruptHandler` del sandbox asyncify no abortó el `while(true){}` vacío a los 2s; la request colgó ~40s y Cloudflare la cortó con **1102 "Worker exceeded resource limits"** (no el deadline del sandbox). El gateway sobrevive: 3d y 3e (demo + bookstore) respondieron correctamente e inmediatamente después. El comportamiento esperado (`isError:true` con mensaje de interrupción a ~2-3s) **no se observó**. Se reporta tal cual (regla: no maquillar).
4. **HALLAZGO B — `search_catalog` falla por `URLSearchParams` no definido en el sandbox QuickJS.** Bug de la skill publicada en T11 (`bookstore/content/search_catalog.tool.js`), fuera de alcance (no se toca bookstore/**). El gateway la ejecuta y devuelve el error controladamente (HTTP 200, `isError:true`) sin caer. `get_book` y `stock_report` devolvieron datos reales de D1 (52 títulos, stock 525, etc.).
5. **Latencias reales:** warm p50 = 116 ms, warm p95 = 378 ms, cold (miss) = 658 ms.

Archivo de benchmark creado: `bench-gateway.mjs`. No se hicieron commits git.