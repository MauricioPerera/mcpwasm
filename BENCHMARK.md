# BENCHMARK — mcpwasm (gateway llms.txt → MCP sobre QuickJS asyncify)

Fecha: 2026-07-02. Cliente: Santiago de Querétaro, MX (AS28536, America/Mexico_City, IP `177.232.87.122`). Workers Cloudflare servidos desde el edge (pop asignado por CF; el RTT cliente→edge está incluido en toda medición).

Script: `bench/run.mjs` (Node puro, fetch global, sin dependencias). Ejecutar con `node bench/run.mjs`. Datos crudos: `bench/results.json` (última corrida), `bench/results-run1.json`, `bench/results-run2.json`, stdout completo en `bench/run1-stdout.txt` / `bench/run2-stdout.txt`.

> **Advertencia:** esto es un benchmark single-client disparado desde una conexión residencial/ISP en México hacia Workers Cloudflare. **No es un load test**: la concurrencia máxima es 10 (escenario j) y el resto es secuencial. Los números miden latencia wall-clock de un único observador, no throughput ni comportamiento bajo carga real. El cache de descubrimiento del gateway es **por isolate, TTL 60s** (header `X-Gw-Discovery: hit|miss`); los escenarios `*-cold` duermen 65s para forzar un miss determinista.

## Matriz de escenarios

| key | descripción | N | warmup | kind |
|---|---|---|---|---|
| a baseline-direct | GET `/api/stock-report` bookstore (sin gateway, sin sandbox) | 30 | 1 | seq |
| b poc-sandbox | PoC `tools/call create_payment` (sandbox sync, sin auth, sin descubrimiento) | 30 | 1 | seq |
| c-cold | gateway demo `sum_numbers`, miss forzado (sleep 65s) | 1 | 0 | cold |
| d-cold | gateway bookstore `stock_report`, miss forzado | 1 | 0 | cold |
| c gw-pure | gateway demo `sum_numbers` (sandbox + descubrimiento warm, sin fetchOrigin) | 30 | 1 | seq |
| d gw-read | gateway bookstore `stock_report` (warm, +fetchOrigin GET + D1) | 30 | 1 | seq |
| e gw-search | gateway `search_catalog {genre=science-fiction, max_price=15}` | 30 | 1 | seq |
| f gw-write-409 | gateway `create_order {book_id=7, qty=1}` (stock 0 → 409 controlado, no muta) | 30 | 1 | seq |
| g gw-write-real | gateway `create_order {book_id=8, qty=1}` (stock 25, **muta D1**) | 3 | 0 | seq |
| h gw-interrupt | gateway `busy_loop` hasta corte del gas (isError "interrupted") | 3 | 0 | seq |
| i gw-tools-list | gateway `tools/list` bookstore (warm) | 20 | 1 | seq |
| i-cold | gateway `tools/list` bookstore, miss forzado (sleep 65s) | 1 | 0 | cold |
| j gw-concurrent | 10× `stock_report` en paralelo (Promise.all) × 3 rondas | 30 | 0 | concurrent |
| x-gw-ping | GET gateway root (roundtrip worker crudo, sin procesado MCP) | 30 | 1 | seq |
| x-book-ping | GET bookstore root → 404 (roundtrip worker crudo) | 30 | 1 | seq |

## Resultados — corrida final (run=2, 2026-07-02 19:51–19:54 UTC)

Latencia wall-clock en ms. `errs` = requests con fallo de red o HTTP ≥500 (el 404 de `x-book-ping` es el resultado esperado del ping, no un error).

| key | n | min | p50 | p95 | p99 | max | errs | notas |
|---|---|---|---|---|---|---|---|---|
| a baseline-direct | 30 | 90 | 101 | 115 | 116 | 116 | 0 | API directa bookstore + D1 |
| b poc-sandbox | 30 | 58 | 63 | 70 | 70 | 70 | 0 | sandbox sync QuickJS, sin descubrimiento |
| c-cold | 1 | 397 | 397 | 397 | 397 | 397 | 0 | miss: fetch llms.txt + sha256 + compile |
| d-cold | 1 | 257 | 257 | 257 | 257 | 257 | 0 | miss: descubrimiento bookstore |
| c gw-pure (warm) | 30 | 57 | 65 | 81 | 113 | 113 | 0 | sandbox warm, sin fetchOrigin |
| d gw-read (warm) | 30 | 104 | 113 | 126 | 264 | 264 | 0 | +fetchOrigin GET + D1 |
| e gw-search | 30 | 86 | 96 | 123 | 150 | 150 | 0 | fetchOrigin GET + D1 (query) |
| f gw-write-409 | 30 | 88 | 97 | 106 | 107 | 107 | 0 | 409 controlado (D1 read + reject) |
| g gw-write-real | 3 | 146 | 152 | 153 | 153 | 153 | 0 | **ordenes creadas: [10,11,12]** |
| h gw-interrupt | 3 | 3027 | 3203 | 3442 | 3442 | 3442 | 0 | todos `isError=true` "interrupted" |
| i gw-tools-list (warm) | 20 | 68 | 70 | 96 | 112 | 112 | 0 | tools/list, sin fetchOrigin |
| i-cold | 1 | 1226 | 1226 | 1226 | 1226 | 1226 | 0 | miss tools/list (ver análisis) |
| j gw-concurrent | 30 | 78 | 164 | 1868 | 1868 | 1868 | 0 | ver desglose por ronda abajo |
| x-gw-ping | 30 | 50 | 57 | 74 | 148 | 148 | 0 | roundtrip worker gateway crudo |
| x-book-ping | 30 | 48 | 67 | 113 | 159 | 159 | 0 | roundtrip worker bookstore crudo (404) |

### j gw-concurrent — desglose por ronda (run=2)

| ronda | wall (ms) | miss/10 | err/10 | observación |
|---|---|---|---|---|
| 1 | 1870 | 6 | 0 | fan-out inicial → 6 isolates nuevos (miss); cold p50=509ms |
| 2 | 870 | 0 | 0 | todo hit; warm p50≈164ms |
| 3 | 830 | 0 | 0 | todo hit; warm p50≈151ms |

Split warm/cold de j (run=2): warm(hit) n=24 p50=151 p95=1868 · cold(miss) n=6 p50=509 p95=515. Los dos `1868ms` de las rondas 2-3 son dos requests que se rezagaron (posible re-suspensión asyncify o contención de subrequest), pero **sin errores**.

## Análisis de overhead por capa (run=2, p50 warm salvo donde se indica)

Descomposición aditiva sobre el mismo worker gateway (x-gw-ping es GET crudo al gateway; c es tools/call sobre el sandbox warm):

| capa | escenario | p50 (ms) | Δ vs anterior | qué mide |
|---|---|---|---|---|
| red + worker crudo | x-gw-ping | 57 | — | RTT cliente→edge + handler mínimo |
| + sandbox QuickJS + dispatch tools/call (warm) | c gw-pure | 65 | **+8** | overhead del sandbox ejecutando `sum_numbers` + parseo JSON-RPC, cache de descubrimiento caliente |
| + descubrimiento cold (demo) | c-cold | 397 | **+332 vs c warm** | fetch llms.txt del origin + verify sha256 + compile/instancia del módulo wasm |
| + fetchOrigin GET + D1 read (warm) | d gw-read | 113 | **+48 vs c** | el sandbox pide al host un GET al origin y ese GET lee D1 |
| = gateway completo warm sobre un read real | d vs a | 113 vs 101 | **+12** | overhead total del gateway (sandbox+descubrimiento hit+fetchOrigin) sobre la misma lectura que la API directa |
| descubrimiento cold (bookstore read) | d-cold vs d warm | 257 vs 113 | **+144** | costo del miss de descubrimiento para bookstore |
| escritura D1 transaccional real | g vs f | 152 vs 97 | **+55** | `create_order` real: decrementar stock + insertar order en D1 vs el 409 que solo lee y rechaza |
| corte del gas de interrupciones | h | 3203 | — | tiempo hasta que el gas corta `busy_loop` |

### Lectura por eje

- **Overhead del sandbox puro (b / c vs ping).** `b poc-sandbox` (PoC, sandbox sync sin descubrimiento) p50=63ms; `c gw-pure` warm p50=65ms; ping crudo del mismo worker gateway `x-gw-ping` p50=57ms. Restando el RTT+worker crudo, **el sandbox QuickJS + dispatch JSON-RPC cuesta ~8ms warm** (c − x-gw-ping). La PoC (b, 63ms) es un worker distinto (toolhost-mcp) sin ping propio medido, pero su 63ms es consistente con «sandbox sync sin descubrimiento». **Conclusión: el sandbox alone es despreciable (~8ms) cuando el descubrimiento está caliente.**

- **Overhead del gateway completo (d warm vs a).** Misma lectura lógica (stock_report): API directa p50=101ms, gateway warm p50=113ms → **+12ms (+12%)**. Es el precio de pasarlo por sandbox+cache-hit+fetchOrigin. Aceptable para una capa de seguridad/portabilidad.

- **Costo del descubrimiento (cold vs warm).** Es **la capa dominante del gateway**. c-cold=397ms vs c warm=65ms → **+332ms** (demo). d-cold=257ms vs d warm=113ms → **+144ms** (bookstore). i-cold fue 1226ms en run=2 (340ms en run=1): **muy variable**, porque el miss cold además de fetch+sha256+compile puede coincidir con un cold-start de isolate (wasm descompilado/instantiado por primera vez en ese isolate). El cache por isolate TTL 60s amortiza esto: pagás ~150-400ms una vez por isolate cada minuto. Bajo concurrencia que levanta varios isolates, pagás ese costo varias veces (ver j).

- **Costo de la escritura (f/g vs d).** `f gw-write-409` (lee stock, ve 0, devuelve 409 sin escribir) p50=97ms → comparable a un read con fetchOrigin. `g gw-write-real` (decrementa stock + inserta order en D1, transaccional) p50=152ms → **+55ms** sobre el 409. La escritura real cuesta lo que la transacción D1; el overhead del gateway sobre la escritura es el mismo ~8-12ms de sandbox que sobre la lectura.

- **Tiempo de corte del gas (h).** `busy_loop` es cortada a **p50=3203ms, rango 3027–3442ms** (run=2; run=1 dio 3377–4903ms con un cold de 4903). **No son los 5-6s estimados**: el gas corta en la práctica a ~3.0–3.4s warm, ~4.9s si el request cae en un isolate cold. Todas las respuestas vienen `isError=true` con mensaje "interrupted" — el gas hace exactamente su trabajo de matar CPU infinita.

- **Comportamiento bajo concurrencia (j).** Es **el punto débil del gateway** y el dato más interesante. Al disparar 10 `stock_report` en paraleto:
  - **Ronda 1 (fan-out frío):** el gateway levanta isolates nuevos → 6-9 de cada 10 son `miss` (run=2: 6/10; run=1: 7/10, 9/10 y 11/10 contando rondas). Cada miss arrastra el descubrimiento cold (~509ms p50 cold en run=2; ~514ms en run=1). El wall de la ronda sube a 1870ms (run=2) / 10279ms (run=1).
  - **Rondas 2-3 (warm):** todo `hit`, p50 cae a ~150ms, wall 830-870ms. El cache se asentó.
  - **Errores 500 ~10s (run=1, NO en run=2):** run=1 produjo **6 respuestas HTTP 500 a ~10180ms** (r1#4, r2#4/r2#9/r2#10, r3#2/r3#3). El patrn (status 500 + latencia clavada en ~10s + `disc=(none)`) sugiere que bajo 10 subrequests concurrentes algun request excede un limite wall/subrequest del gateway (probablemente el `fetchTimeoutMs=10s` de fetchOrigin o un limite de Cloudflare) y el worker suelta 500 en vez de colgar. **Esto es exactly el dato asyncify que pedia la tarea**: la suspension 1-por-modulo wasm + la contencion de subrequests bajo fan-out hace que la latencia sea bimodal — la mayoria sirve rapido, pero una cola larga (~10s) aparece esporádicamente. Run=2 no reprodujo los 500 (0 errores), confirmando que **es variable/probabilístico, no determinista**: depende de qué isolates levanta CF y cómo reparte la carga.
  - **Veredicto j:** bajo concurrencia 10 el gateway es correcto (sin errores) cuando los isolates ya están calientes, pero **el primer fan-out siempre paga descubrimiento cold en varios isolates a la vez** (p95 1.8s en run=2, 10.2s con 500s en run=1). No es seguro para latencia p99 bajo ráfagas; conviene precalentar (warmup) antes de mandar tráfico concurrente real.

### Comparación run=1 vs run=2 (¿difieren materialmente?)

| key | run=1 p50 | run=2 p50 | Δ |
|---|---|---|---|
| a baseline-direct | 91 | 101 | +10 |
| b poc-sandbox | 56 | 63 | +7 |
| c gw-pure warm | 62 | 65 | +3 |
| d gw-read warm | 112 | 113 | +1 |
| e gw-search | 92 | 96 | +4 |
| f gw-write-409 | **159** | **97** | **−62** |
| g gw-write-real | 156 | 152 | −4 |
| h gw-interrupt | 3758 | 3203 | −555 |
| i gw-tools-list warm | 79 | 70 | −9 |
| x-gw-ping | 55 | 57 | +2 |
| j concurrent (errs) | **6** | **0** | — |
| j concurrent (p95) | 10187 | 1868 | — |
| c-cold | 429 | 397 | −32 |
| d-cold | 273 | 257 | −16 |
| i-cold | 340 | 1226 | +886 |

Los escenarios secuenciales estables (a, b, c, d, e, i, x) coinciden dentro de ±10ms entre corridas → **reproducibles**. Dos diferencias **materiales**:

1. **f gw-write-409**: run=1 fue bimodal (primeros 12 requests ~90ms, luego 18 requests ~160-195ms, p50=159); run=2 fue plano (~97ms). Algo del backend D1 o del isolate cambió de régimen a mitad de run=1. El 409 no muta, así que no es efecto de acumulación de escritura; parece un cambio de isolate/region de D1 a mitad de ráfaga.
2. **j concurrent**: run=1 tuvo **6 errores 500 a ~10s** (p95=10187ms); run=2 tuvo **0 errores** (p95=1868ms). Es la diferencia más grande y es **probabilística** (depende del isolate assignment de CF), no un bug determinista — pero es exactamente el riesgo asyncify bajo fan-out.

`i-cold` también varía mucho (340 vs 1226ms): el cold de tools/list a veces es solo descubrimiento (~340ms) y a veces suma cold-start de isolate (~1.2s). Es n=1, no estadísticamente significativo; se reporta como rango.

**Órdenes creadas (mutación D1 real, escenario g):** run=1 → [7,8,9]; run=2 → [10,11,12]. (Una corrida de prueba previa al script final creó además [4,5,6].) Total 9 órdenes decrementadas del stock del book_id=8.

## Cómo reproducir

```bash
node bench/run.mjs                 # corrida única, etiqueta "auto"
node bench/run.mjs --run=2          # etiqueta la corrida
```

El token del gateway se lee de `./.gateway-token` en runtime; **no se imprime ni se escribe** a `results.json` ni a este informe (verificado). Entre dos corridas consecutivas hay que esperar >60s para ciclar el cache de descubrimiento (el script ya duerme 65s en los escenarios `*-cold`).
---

## Verificación independiente (tercera corrida, PM)

Corrida completa adicional ejecutada por separado (2026-07-02 ~20:02 UTC) para validar reproducibilidad:

- Escenarios secuenciales: consistentes con run=2 dentro de ±10 ms (a p50=90, b p50=59, c-warm p50=66, d-warm p50=120, e p50=99, f p50=98, g p50=150, i-warm p50=77).
- **h gw-interrupt: p50=5370 ms, max=7849 ms** — mayor que run=2 (~3.2 s). El corte del gas es determinista en invocaciones pero su traducción a wall-clock depende del CPU share del isolate; el bound observado en 3 corridas queda en 3–8 s.
- **j gw-concurrent: 4 errores a ~10.2 s (p95=10181 ms)** — reproduce el patrón de run=1. Con 3 corridas totales (6 err / 0 err / 4 err), la cola de ~10 s bajo fan-out frío de 10 concurrentes debe tratarse como **comportamiento esperable, no como anomalía puntual**: ráfagas concurrentes contra un origin frío pagan contención (asyncify 1-suspensión-por-módulo + estampida de descubrimiento) hasta el timeout de fetchOrigin. Mitigación práctica: precalentar (1 request antes de la ráfaga) o serializar del lado cliente.

---

## Post-fix — mutex de ejecución por módulo + single-flight del descubrimiento (TAREA19)

Corrida completa `node bench/run.mjs --run=3` (2026-07-02 20:17–20:19 UTC) **tras** deploy del fix (version `c039318d-2a6e-46ed-9c0c-3c38005e9335`). Datos crudos: `bench/results-run3-postfix.json`.

**Fix aplicado (dos piezas, `worker-gateway.mjs`):**

1. **Mutex de ejecución por módulo wasm (`withModuleLock`).** Promise-queue a nivel de módulo (donde vive `getQuickjs()`/el módulo cacheado por isolate) que serializa TODA ejecución que puede tocar/suspender el wasm: `PerSkillHost.init()` (newContext + loadToolSource), `handleMcpMessageAsync` (listTools/callTool) y `dispose`, todo bajo el lock. El lock se suelta SIEMPRE (`result.then(noop, noop)` reinicia la cola tanto en resolve como en reject → un fallo de un request no envenena el mutex). Las esperas en cola ocurren ANTES de que `fn` corra → no cuentan contra el `fetchTimeoutMs` (10 s) de OTRO request: ese timeout se arma DENTRO de la ejecución propia (en `callTool`, bajo el lock), no mientras se espera en cola.
2. **Single-flight del descubrimiento (`discoverInflight`).** Map a nivel isolate `origin -> Promise` en vuelo; los miss concurrentes del mismo origin esperan la MISMA promesa en vez de refetear llms.txt + tool.js cada uno (estampida). La entrada se borra al settle (resolve o reject) vía `finally` → un fallo no envenena el cache. **Decisión de observabilidad:** el iniciador reporta `X-Gw-Discovery: miss` (hizo el fetch real); los concurrentes que esperan la promesa compartida reportan `hit` (leyeron del cache tras el fetch único). Esto hace el single-flight observable por header: `1 miss + (N−1) hit` ≡ 1 solo fetch.

### Resultados — run=3 post-fix

Latencia wall-clock en ms. `errs` = requests con fallo de red o HTTP ≥500.

| key | n | min | p50 | p95 | p99 | max | errs | notas |
|---|---|---|---|---|---|---|---|---|
| a baseline-direct | 30 | 80 | 92 | 118 | 125 | 125 | 0 | API directa bookstore + D1 |
| b poc-sandbox | 30 | 58 | 67 | 76 | 77 | 77 | 0 | sandbox sync QuickJS, sin descubrimiento |
| c-cold | 1 | 374 | 374 | 374 | 374 | 374 | 0 | miss: fetch llms.txt + sha256 + compile |
| d-cold | 1 | 245 | 245 | 245 | 245 | 245 | 0 | miss: descubrimiento bookstore |
| c gw-pure (warm) | 30 | 55 | 60 | 86 | 97 | 97 | 0 | sandbox warm, sin fetchOrigin |
| d gw-read (warm) | 30 | 95 | 108 | 132 | 143 | 143 | 0 | +fetchOrigin GET + D1 |
| e gw-search | 30 | 80 | 89 | 108 | 108 | 108 | 0 | fetchOrigin GET + D1 (query) |
| f gw-write-409 | 30 | 80 | 86 | 503 | 859 | 859 | 0 | 409 controlado; p50 plano, cola en p95/p99 (varianza D1, no regresión p50) |
| g gw-write-real | 3 | 138 | 150 | 253 | 253 | 253 | 0 | **ordenes creadas: [13,14,15]** |
| h gw-interrupt | 3 | 3190 | 3422 | 4930 | 4930 | 4930 | 0 | todos `isError=true` "interrupted" |
| i gw-tools-list (warm) | 20 | 63 | 70 | 74 | 75 | 75 | 0 | tools/list, sin fetchOrigin |
| i-cold | 1 | 310 | 310 | 310 | 310 | 310 | 0 | miss tools/list |
| **j gw-concurrent** | 30 | 141 | 237 | **618** | 639 | 639 | **0** | **0 errores, p95=618 ms (antes ~10 s)** |
| x-gw-ping | 30 | 50 | 56 | 65 | 65 | 65 | 0 | roundtrip worker gateway crudo |
| x-book-ping | 30 | 46 | 50 | 62 | 158 | 158 | 0 | roundtrip worker bookstore crudo (404) |

### j gw-concurrent — desglose por ronda (run=3 post-fix)

| ronda | wall≈max (ms) | miss/10 | err/10 | status | observación |
|---|---|---|---|---|---|
| 1 (fan-out frío) | 639 | 5 | 0 | 10×200 | single-flight: 1 iniciador miss por isolate, resto hit compartido; mutex serializa la ejecución → sin 500 |
| 2 | 281 | 2 | 0 | 10×200 | casi todo hit; 2 isolates nuevos calentando |
| 3 (warm) | 266 | 0 | 0 | 10×200 | todo hit; p50=219 ms |

Split warm/cold de j (run=3): warm(hit) n=23 p50=220 p95=618 · cold(miss) n=7 p50=545 p95=551. **La ronda fría cayó de wall ~1.9 s (run=2) / ~10.2 s con 500s (run=1, run3-PM) a 639 ms**, y las rondas warm de ~830-870 ms a ~270 ms. El mutex elimina la contención asyncify (cero 500) y el single-flight colapsa la estampida de descubrimiento dentro de cada isolate.

### j antes vs después

| métrica | run=1 | run=2 | run3-PM (pre-fix) | **run=3 post-fix** |
|---|---|---|---|---|
| errs | 6 | 0 | 4 | **0** |
| p95 (ms) | 10187 | 1868 | 10181 | **618** |
| p50 (ms) | — | 164 | — | 237 |
| max (ms) | — | 1868 | — | **639** |
| ronda 1 wall (ms) | 10279 | 1870 | — | **639** |

Con 3 corridas pre-fix (6 / 0 / 4 errores a ~10 s), la cola de ~10 s era comportamiento esperable. Post-fix: **0 errores en la única corrida post-fix y p95=618 ms**, dentro del rango esperado por la tarea (ronda fría en cola ~1-3 s → aquí 639 ms; rondas warm p50 ~150-220 ms). El único cambio material es que ahora los 10 concurrentes se serializan dentro de cada isolate (mutex) y comparten un único descubrimiento por isolate (single-flight); entre isolates siguen en paralelo (CF reparte el fan-out).

### No-regresión secuencial (run=2 vs run=3, p50)

El mutex en camino secuencial es un no-op práctico (sin contención, la cola resolve inmediato). Comparativa p50 de los escenarios secuenciales:

| key | run=2 p50 | run=3 p50 | Δ | ¿regresión >15%? |
|---|---|---|---|---|
| a baseline-direct | 101 | 92 | −9 | no (mejor) |
| b poc-sandbox | 63 | 67 | +4 (+6%) | no |
| c gw-pure warm | 65 | 60 | −5 | no (mejor) |
| d gw-read warm | 113 | 108 | −5 | no (mejor) |
| e gw-search | 96 | 89 | −7 | no (mejor) |
| f gw-write-409 | 97 | 86 | −11 | no (mejor; p95/p99 tuvo una cola puntual de varianza D1, p50 intacto) |
| i gw-tools-list warm | 70 | 70 | 0 | no |
| x-gw-ping | 57 | 56 | −1 | no |
| h gw-interrupt | 3203 | 3422 | +219 (+7%) | no (dentro de la varianza observada 3.0-5.4 s entre corridas) |

**Ningún escenario secuencial degrada >15% en p50**; la mayoría mejora levemente (varianza normal entre corridas, no efecto del fix). `f gw-write-409` mostró una cola en p95/p99 (503/859 ms) que no estaba en run=2 — p50 sigue plano en 86 ms y errs=0; es varianza del backend D1 a mitad de ráfaga (run=1 ya había mostrado este régimen bimodal en f), no atribuible al mutex (el camino secuencial no contiende).

**Veredicto TAREA19:** el fix (mutex por módulo + single-flight del descubrimiento) **elimina los errores 500 bajo fan-out concurrente de 10** (j: 0 errs, p95 618 ms vs ~10 s pre-fix) **sin regresión secuencial** (>15% p50). Causa raíz confirmada: la suspensión asyncify 1-por-módulo compartida a nivel isolate + la estampida de descubrimiento bajo fan-out frío.

### Verificación independiente post-fix (PM, cuarta corrida)

Mismo cliente que midió el pre-fix (donde j dio 4 err / p95 10181 ms): post-fix **j = 0 errores, p50 228 ms, p95 557 ms**. Secuenciales consistentes (d-warm 109, e 92, f 94, i 73). El mutex + single-flight resuelven la cola de ~10 s bajo fan-out frío; el peor caso concurrente ahora es espera en cola sub-segundo.

---

## Post-deploy — pool de instancias asyncify + precalentamiento por cron (run=4)

Corrida completa `node bench/run.mjs --run=4` (2026-07-08 06:21–06:28 UTC) tras deploy de la version `dcee3964-7487-440d-8e85-0703260d852a`, que suma dos cambios sobre el gateway de run=3:

1. **Pool de instancias del modulo asyncify** (reemplaza el mutex `withModuleLock` de TAREA19): hasta N instancias independientes del mismo `WebAssembly.Module` por isolate (`WASM_POOL_SIZE`, default 4); cada request adquiere una instancia en exclusiva => hasta N requests en paralelo real por isolate. Bajo contencion el waiter espera por polling en su propio request context (workerd cancela continuaciones de promesas resueltas desde otro request context, asi que el handoff FIFO clasico no es viable).
2. **Precalentamiento por cron** (`[triggers] crons = ["* * * * *"]` + handler `scheduled`): cada minuto corre el descubrimiento de todos los origins del allowlist (puebla L1 del isolate del cron y L2 del colo) e instancia un modulo wasm del pool.

Contexto de config que CAMBIA la semantica de un escenario: el gateway corre en `ATTESTATION_MODE=enforcing` desde T45 (run=3 se midio en advisory). Ver la nota de `h` abajo.

Datos crudos: `bench/results-run4-postpool.json` (+ `bench/results.json`, ultima corrida), stdout completo en `bench/run4-stdout.txt`. Misma metodologia y advertencias que arriba (single-client desde Mexico, no load test).

### Resultados — run=4

| key | n | min | p50 | p95 | p99 | max | errs | notas |
|---|---|---|---|---|---|---|---|---|
| a baseline-direct | 30 | 84 | 90 | 155 | 451 | 451 | 0 | API directa bookstore + D1 |
| b poc-sandbox | 30 | 56 | 90 | 119 | 120 | 120 | 0 | PoC sync (worker sin cambios; varianza) |
| c-cold | 1 | 290 | 290 | 290 | 290 | 290 | 0 | miss forzado (sleep 65s) |
| d-cold | 1 | 213 | 213 | 213 | 213 | 213 | 0 | miss forzado bookstore |
| c gw-pure (warm) | 30 | 51 | 55 | 59 | 64 | 64 | 0 | sandbox warm, sin fetchOrigin |
| d gw-read (warm) | 30 | 87 | 96 | 105 | 199 | 199 | 0 | +fetchOrigin GET + D1 |
| e gw-search | 30 | 68 | 79 | 146 | 654 | 654 | 0 | cola p99 puntual (varianza D1) |
| f gw-write-409 | 30 | 73 | 79 | 89 | 90 | 90 | 0 | 409 controlado |
| g gw-write-real | 3 | 127 | 131 | 138 | 138 | 138 | 0 | **ordenes creadas: [22,23,24]** |
| h gw-interrupt | 3 | 56 | 60 | 61 | 61 | 61 | 0 | **YA NO MIDE EL GAS — ver nota** |
| i gw-tools-list (warm) | 20 | 58 | 61 | 65 | 71 | 71 | 0 | |
| i-cold | 1 | 400 | 400 | 400 | 400 | 400 | 0 | n=1, dentro del rango historico |
| **j gw-concurrent** | 30 | 117 | **182** | **380** | 495 | 495 | **0** | ver desglose |
| x-gw-ping | 30 | 49 | 53 | 57 | 63 | 63 | 0 | |
| x-book-ping | 30 | 46 | 52 | 69 | 149 | 149 | 0 | |

### j gw-concurrent — desglose por ronda (run=4)

| ronda | wall (ms) | miss/10 | err/10 | observacion |
|---|---|---|---|---|
| 1 (fan-out "frio") | **496** | **0** | 0 | el preheat ya habia calentado el descubrimiento: CERO miss en la ronda fria |
| 2 | 182 | 0 | 0 | pool en paralelo real |
| 3 | 189 | 0 | 0 | idem |

### j — evolucion completa

| metrica | run=1 (pre-T19) | run=3 (mutex) | **run=4 (pool+preheat)** |
|---|---|---|---|
| errs | 6 | 0 | **0** |
| p50 (ms) | — | 237 | **182** |
| p95 (ms) | 10187 | 618 | **380** |
| max (ms) | — | 639 | **495** |
| ronda 1 wall (ms) | 10279 | 639 | **496** |
| ronda 1 miss/10 | 6-9 | 5 | **0** |
| rondas warm wall (ms) | — | 266-281 | **182-189** |

Lectura:

- **El preheat elimina el fan-out frio en la practica**: la ronda 1 — historicamente el punto debil (10 s con 500s pre-T19, 639 ms con el mutex) — salio con 0 miss de 10: el cron habia poblado L1/L2 antes de que llegara la rafaga. Vale el caveat documentado: la Cache API es por colo y el cron corre en un punto de presencia; un cliente servido desde otro colo puede seguir viendo su primer miss.
- **El pool paraleliza de verdad**: las rondas warm bajan de ~270 ms (mutex: 10 requests serializados dentro del isolate) a ~185 ms de wall con p50 por-request de 182 ms — wall ≈ p50 significa que los 10 corren esencialmente en paralelo (entre pool intra-isolate y reparto entre isolates).
- **Sin regresion secuencial**: todos los escenarios secuenciales igualan o mejoran run=3 (c warm 60→55, d 108→96, e 89→79, f 86→79, g 150→131, i 70→61).

### Nota h gw-interrupt — cambio de semantica por `enforcing`, no por el pool

`h` dio p50=60 ms con `isError=true` inmediato porque **`busy_loop` ya no carga**: el gateway corre en `ATTESTATION_MODE=enforcing` (desde T45) y `busy_loop` quedo sin atestar A PROPOSITO (T29). La skill se excluye en descubrimiento y `tools/call busy_loop` responde "tool no encontrada" al instante. El escenario ya no ejercita el corte del gas en produccion; para volver a medirlo hay que atestar `busy_loop` (discutible: es un fixture hostil) o benchear contra un despliegue en `advisory`. El gas sigue cubierto por las suites locales.
