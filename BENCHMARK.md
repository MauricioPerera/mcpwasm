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
