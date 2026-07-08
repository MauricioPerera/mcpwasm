# TAREA12B — Fix de los 2 bugs de producción de TAREA12 (interrupt + URLSearchParams)

Fecha: 2026-07-02
Gateway: `https://llmstxt-gateway.rckflr.workers.dev`
Bookstore: `https://llmstxt-bookstore.rckflr.workers.dev`

TAREA12 reportó DOS bugs reales en producción. Esta tarea los arregla ambos, los
verifica en producción y pasa la regresión local completa.

---

## 1. Fix BUG 1 — interrupt determinista por conteo de invocaciones (`host-async.mjs`)

**Problema (TAREA12 3c):** el `interruptHandler` usaba `Date.now() > deadline` para
cortar tools a los 2s. En Cloudflare Workers el reloj se CONGELA durante ejecución
síncrona (mitigación Spectre): dentro de un `while(true){}` `Date.now()` nunca avanza,
el handler nunca devuelve `true`, y la tool colgó ~40s hasta que la plataforma mató la
request con **1102 "Worker exceeded resource limits"**.

**Fix:** presupuesto DETERMINISTA por conteo de invocaciones del interruptHandler.
QuickJS llama al handler periódicamente mientras ejecuta bytecode; llevamos
`this._interruptCount` que se resetea a 0 al inicio de cada `callTool`/`loadToolSource`
y devuelve `true` (interrumpe) al superar `this._interruptMaxInvocations` (N). El flag
`this._interruptActive` arranca en `false` (init/listTools corren código de confianza y
no se interrumpen) y se pone `true` solo durante `callTool`/`loadToolSource`.

El handler queda:
```js
vm.runtime.setInterruptHandler(() => {
  if (!host._interruptActive) return false;
  host._interruptCount = (host._interruptCount + 1) >>> 0;
  if (host._interruptCount > host._interruptMaxInvocations) return true; // determinista
  if (Date.now() > host._deadline) return true;                          // wall-clock (Node/tests)
  return false;
});
```

El check `Date.now() > deadline` se MANTIENE como backstop secundario: en Node/tests el
reloj avanza y corta antes; en Workers el reloj está congelado y el contador es quien
salva. Un `while(true){}` vacío consume N invocaciones en milisegundos/segundos; una
tool legítima que pasa el tiempo en `await host.fetchOrigin` (asyncify suspende la pila
⇒ el handler NO se llama durante la suspensión) consume ~0.

**API compatible:** nuevo opción opcional `interruptMaxInvocations` (default
`DEFAULT_INTERRUPT_MAX_INVOCATIONS`). `npm run spike` sigue verde sin cambios en sus
opciones (usa defaults). Valores de memoria/stack intactos (64MB / 1MB).

### Calibración de N

Script temporal `_calib.mjs` (corrido y borrado; no es entregable) construye
`AsyncToolHost` en Node con un `fetchImpl` en memoria (sin red) que simula las
respuestas reales del bookstore, y lee `host._interruptCount` tras cada `callTool`.

Salida real:
```
=== Skills legitimas: invocaciones del interruptHandler por callTool ===
stock_report     count=       0  23ms  ok={"total_titles":52,...}
search_catalog   count=       0   5ms  ok=[{"id":1,"title":"Dune",...}]      (q=dune, max_price=20)
search_catalog   count=       0  14ms  ok=[{"id":1,...}]                      (genre=science-fiction, max_price=15)
fetch_home       count=       0  15ms  ok={"status":200,"firstLine":"toolhost-mcp server"}
cpu_heavy        count=      20   4ms  ok={"sum":4999950000}                  (n=100000)
cpu_heavy        count=     200  51ms  ok={"sum":499999500000}                (n=1000000)

MAX legit count = 200
N sugerido (100x, floor 10000) = 20000

=== while(true){} con reloj congelado: el contador debe cortar ===
busy_loop: tiro error en 1037ms; count=20001; msg="interrupted"
```

**Interpretación:**
- Las skills legítimas REALES (bookstore `stock_report`/`search_catalog`/`get_book`,
  spike `fetch_home`/`fetch_evil`, demo `sum_numbers`/`server_time`) consumen **0**
  invocaciones: asyncify suspende la pila durante `await host.fetchOrigin` y el handler
  no se llama; el bytecode síncrono alrededor es mínimo.
- Proxy de compute pesado legítimo (1M de adiciones en loop tight, peor caso plausible
  para una skill real de compute puro): **200** invocaciones.
- **N = 20000** = 100x ese proxy; margen amplio sobre cualquier skill legítima real
  (que es ~0). Un `while(true){}` vacío consume 20000 invocaciones en ~1s (Node, reloj
  congelado) y ~4–5s en workerd (WASM más lento) ⇒ corte acotado muy por debajo del
  límite de plataforma (1102, ~40s).

> Nota: se probó primero N=50000; en producción busy_loop cortó limpio pero a **10.2s**
> (justo sobre el objetivo <10s, por cold-start + WASM workerd más lento). Se bajó a
> **N=20000** para margen cómodo (<10s) manteniendo 100x sobre el proxy de compute.

---

## 2. Fix BUG 2 — `URLSearchParams` no existe en el sandbox (`bookstore/content/search_catalog.tool.js`)

**Problema (TAREA12 3b):** la skill usaba `new URLSearchParams()`; el sandbox QuickJS
solo expone built-ins ECMAScript (URLSearchParams es WHATWG) ⇒ `'URLSearchParams' is not defined`.

**Fix:** construir el query string a mano con `encodeURIComponent` (built-in):
```js
const parts = [];
if (typeof args.q === "string" && args.q.length > 0) parts.push("q=" + encodeURIComponent(args.q));
if (typeof args.genre === "string" && args.genre.length > 0) parts.push("genre=" + encodeURIComponent(args.genre));
if (typeof args.max_price === "number" && Number.isFinite(args.max_price)) parts.push("max_price=" + String(args.max_price));
const qs = parts.join("&");
const path = qs ? ("/api/search?" + qs) : "/api/search";
```

**Regeneración de hashes:** `node bookstore/build.mjs` regeneró `worker.mjs` (llms.txt
embebido + tool.js embebidos). El `tool_sha256` de `search_catalog` cambió:
- antes: (hash viejo de T11)
- ahora: `d1220dcd2dd6b6c57b363edbfc2f0f620457cc98d2cc087baa3c7ef45782f175`

Los demás hashes (`get_book`, `stock_report`, `busy_loop`) sin cambios; `corrupt_skill`
sigue con hash deliberadamente incorrecto (fixture). La lógica de `build.mjs` NO se tocó.

---

## 3. Test local NUEVO del interrupt (`mf-gateway.mjs`, sección `[b]`)

Un `while(true){}` vacío bloquea el event loop de Node (la ejecución QuickJS es
síncrona), así que `Promise.race` NO puede preemptarlo: si el contador fallara, el test
colgaría. Por eso la llamada corre en un **proceso hijo killable** vía
`spawnSync({timeout:15000})`: si cuelga, el OS lo mata a los 15s y el test falla en vez
de quedar colgado. Además se **congela `Date.now()`** dentro del hijo (simula workerd:
reloj congelado por mitigación Spectre), así que el deadline wall-clock (2s) NUNCA
dispara y **solo el contador determinista puede cortar**.

Salida real (`npm run gateway`):
```
[b] interrupt determinista (while(true){}, reloj congelado, hijo killable):
busy_loop -> {"ok":true,"msg":"interrupted","ms":953,"count":20001}
PASS interrupt: busy_loop termino con error (no colgo)
PASS interrupt: mensaje contiene "interrupted"
PASS interrupt: corto en <10s
PASS interrupt: el contador se invoco (>0)
TODOS LOS CHECKS VERDE
```
El contador cortó el `while(true){}` a las 20001 invocaciones en 953ms con el reloj
congelado ⇒ el mecanismo determinista es el que dispara (no el wall-clock). ✅

---

## 4. Deploys

**Bookstore** (`npx wrangler deploy -c bookstore/wrangler.toml`):
```
Total Upload: 11.76 KiB / gzip: 3.62 KiB
env.DB (bookstore-db)   D1 Database
Uploaded llmstxt-bookstore (2.93 sec)
Deployed llmstxt-bookstore triggers (0.93 sec)
  https://llmstxt-bookstore.rckflr.workers.dev
Current Version ID: 1cabedc4-25e0-4636-b97f-d287f91ad397
```

**Gateway** (`npx wrangler deploy -c wrangler-gateway.toml`) — primer deploy (N=50000):
```
Total Upload: 1130.33 KiB / gzip: 385.27 KiB
env.DEMO (llmstxt-demo-site)            Worker
env.BOOKSTORE (llmstxt-bookstore)       Worker
Uploaded llmstxt-gateway (5.54 sec)
Deployed llmstxt-gateway triggers (1.83 sec)
Current Version ID: 0a00a2aa-6da4-44f8-9d95-841998e80fb0
```
**Gateway redeploy** (N=20000, definitivo):
```
Uploaded llmstxt-gateway (5.17 sec)
Deployed llmstxt-gateway triggers (1.93 sec)
  https://llmstxt-gateway.rckflr.workers.dev
Current Version ID: 7aa044c3-f55c-450f-9513-d5046e64b212
```

---

## 5. Verificación en producción

### 5a. `tools/call busy_loop` (origin=bookstore) — ✅ el contador SÍ cortó en workerd

```
{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"Error en la tool: interrupted"}],"isError":true}}
HTTP 200 | time_total 4.762677s | x-gw-discovery:miss
```
**HTTP 200, `isError:true`, mensaje "interrupted", 4.76s.** No es 503/1102. El contador
determinista cortó el `while(true){}` en producción (workerd + asyncify) a los ~4.8s,
muy por debajo del límite de plataforma. **El hallazgo de TAREA12 (1102 a los ~40s) está
resuelto.** El reloj congelado ya no importa: el presupuesto por invocaciones no depende
del reloj.

> Confirmación adicional (N=50000, primer deploy): cortó limpio a **10.2s** con
> `isError:true` "interrupted" — ya no 1102. Descartado el temor de TAREA12 de que "el
> mecanismo de interrupt del build asyncify no dispara en workerd": SÍ dispara; lo que
> no servía era comparar contra `Date.now()` congelado.

### 5b. `stock_report` inmediatamente después de busy_loop — ✅ gateway vivo y sano

```
{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"{\"total_titles\":52,\"total_stock\":525,\"out_of_stock\":12,\"top3_by_stock\":[{\"id\":19,\"title\":\"Ender's Game\",...},{\"id\":41,\"title\":\"The Hobbit\",...},{\"id\":28,\"title\":\"1984\",...}]}"}],"structuredContent":{"total_titles":52,...},"isError":false}}
HTTP 200 | time_total 0.688819s | x-gw-discovery:miss
```
Datos reales de D1 (52 títulos, stock 525). `isError:false`, 0.69s. El gateway sigue
sano inmediatamente después de busy_loop (el interrupt terminó la request limpiamente,
no el isolate por 1102). ✅

### 5c. `search_catalog` — ✅ BUG 2 resuelto, datos reales y filtrados

**`{q:"dune", max_price:20}`:**
```
{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"[{\"id\":1,\"title\":\"Dune\",\"price\":18.5,\"stock\":12},{\"id\":2,\"title\":\"Dune Messiah\",\"price\":14,\"stock\":5},{\"id\":3,\"title\":\"Children of Dune\",\"price\":15.25,\"stock\":0},{\"id\":4,\"title\":\"God Emperor of Dune\",\"price\":16,\"stock\":3}]"}],"structuredContent":[...],"isError":false}}
HTTP 200 | time_total 0.444713s | x-gw-discovery:miss
```
4 libros de Dune, todos con `price ≤ 20`. `isError:false`. Ya NO da
`'URLSearchParams' is not defined`. ✅

**`{genre:"science-fiction", max_price:15}`:**
```
{"jsonrpc":"2.0","id":4,"result":{"content":[{"type":"text","text":"[{\"id\":2,\"title\":\"Dune Messiah\",\"price\":14},...,{\"id\":15,\"title\":\"The Left Hand of Darkness\",\"price\":13.25}]]"}],"structuredContent":[...],"isError":false}}
HTTP 200 | time_total 0.344734s | x-gw-discovery:miss
```
10 libros, todos `genre=science-fiction` y `price ≤ 15` (p.ej. Dune Messiah 14,
Foundation 12.99, I Robot 9.99, Neuromancer 11, Left Hand of Darkness 13.25). Filtrado
correcto. `isError:false`. ✅

---

## 6. Regresión local completa — ✅ las 3 suites exit 0

```
npm test        EXIT=0
npm run spike   EXIT=0
npm run gateway EXIT=0   (incluye el test nuevo [b] del interrupt, verde)
```

---

## Resumen

- **BUG 1 resuelto.** Interrupt determinista por conteo de invocaciones
  (`DEFAULT_INTERRUPT_MAX_INVOCATIONS=20000`, calibrado 100x sobre el proxy de compute
  pesado legítimo; skills legítimas reales = 0 invocaciones). `Date.now()` mantenida
  como backstop. En producción `busy_loop` corta en **4.76s** con `isError:true`
  "interrupted" (antes: 1102 a ~40s). El contador SÍ dispara en workerd+asyncify.
- **BUG 2 resuelto.** `search_catalog` construye el query string con
  `encodeURIComponent` (built-in) en vez de `URLSearchParams` (WHATWG, ausente en el
  sandbox). Hashes regenerados (`search_catalog` → `d1220dcd…`); bookstore redeployado.
  En producción devuelve resultados reales y filtrados de D1, `isError:false`.
- **Test local nuevo** del interrupt en `mf-gateway.mjs` (sección `[b]`): proceso hijo
  killable + reloj congelado ⇒ valida que el contador (no el wall-clock) corta el
  `while(true){}`. Verde.
- **3 suites exit 0.** No se hicieron commits git. Archivos tocados: `host-async.mjs`,
  `mf-gateway.mjs`, `bookstore/content/search_catalog.tool.js`,
  `bookstore/worker.mjs` (regenerado por `build.mjs`).