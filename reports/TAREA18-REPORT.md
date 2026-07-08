# TAREA18-REPORT — Benchmark mcpwasm, salida real de las dos corridas

Fecha: 2026-07-02. Script: `bench/run.mjs` (Node puro, fetch global). Token gateway leído de `./.gateway-token` en runtime; no aparece en ningún archivo de salida (verificado con grep). Cliente: Querétaro, MX (America/Mexico_City).

Dos corridas completas con el script final, separadas por >60s (sleep 65s entre ellas). Cada corrida incluye cold-probes con sleep 65s para forzar miss de descubrimiento (TTL cache 60s por isolate). N por escenario según la matriz; 1 warmup descartado en escenarios secuenciales con warmup=1.

A continuación las tablas resumen de cada corrida (min/p50/p95/p99/max en ms wall-clock) y el desglose del escenario concurrente j. Los datos crudos por request están en `bench/results-run1.json` y `bench/results-run2.json`; el stdout completo en `bench/run1-stdout.txt` y `bench/run2-stdout.txt`.

---

## CORRIDA 1 (run=1, 2026-07-02 19:47:05 → 19:50:23 UTC)

| key | n | min | p50 | p95 | p99 | max | errs | warm(hit) p50 | cold(miss) p50 | notas |
|---|---|---|---|---|---|---|---|---|---|---|
| a baseline-direct | 30 | 81 | 91 | 105 | 163 | 163 | 0 | — | — | |
| b poc-sandbox | 30 | 51 | 56 | 62 | 66 | 66 | 0 | — | — | |
| c-cold | 1 | 429 | 429 | 429 | 429 | 429 | 0 | — | 429 | miss forzado |
| d-cold | 1 | 273 | 273 | 273 | 273 | 273 | 0 | — | 273 | miss forzado |
| c gw-pure (warm) | 30 | 56 | 62 | 68 | 70 | 70 | 0 | 62 | — | |
| d gw-read (warm) | 30 | 104 | 112 | 128 | 132 | 132 | 0 | 112 | — | |
| e gw-search | 30 | 85 | 92 | 106 | 108 | 108 | 0 | 92 | — | |
| f gw-write-409 | 30 | 87 | 159 | 181 | 195 | 195 | 0 | 159 | — | bimodal: #1-12 ~90ms, #13-30 ~160-195ms |
| g gw-write-real | 3 | 150 | 156 | 216 | 216 | 216 | 0 | 156 | — | ordenes [7,8,9] |
| h gw-interrupt | 3 | 3377 | 3758 | 4903 | 4903 | 4903 | 0 | 3377 | 4903 | todos isError=true; 1 cold@4903 |
| i gw-tools-list (warm) | 20 | 72 | 79 | 88 | 88 | 88 | 0 | 79 | — | |
| i-cold | 1 | 340 | 340 | 340 | 340 | 340 | 0 | — | 340 | miss forzado |
| j gw-concurrent | 30 | 172 | 299 | 10187 | 10277 | 10277 | **6** | 237 | 514 | ver desglose |
| x-gw-ping | 30 | 51 | 55 | 62 | 80 | 80 | 0 | — | — | |
| x-book-ping | 30 | 51 | 55 | 82 | 191 | 191 | 0 | — | — | 404 esperado |

### j gw-concurrent — run=1, desglose por ronda

| ronda | wall (ms) | miss/10 | err/10 | detalle de errores |
|---|---|---|---|---|
| 1 | 10279 | 7 | 1 | r1#4 → 500 @10277ms |
| 2 | 10181 | 2 | 3 | r2#4 → 500 @198ms; r2#9 → 500 @10179ms; r2#10 → 500 @172ms |
| 3 | 10189 | 2 | 2 | r3#2 → 500 @183ms; r3#3 → 500 @10187ms |

Split j run=1: warm(hit) n=16 p50=237 p95=656 max=656 · cold(miss) n=11 p50=514 p95=568 max=568. **6 errores HTTP 500**, dos de ellos clavados en ~10180ms (límite wall/subrequest), el resto devueltos rápido. Patrón asyncify bajo fan-out: la mayoría sirve, una cola larga esporádica.

---

## CORRIDA 2 (run=2, 2026-07-02 19:51:48 → 19:54:37 UTC) — corrida final reportada en BENCHMARK.md

| key | n | min | p50 | p95 | p99 | max | errs | warm(hit) p50 | cold(miss) p50 | notas |
|---|---|---|---|---|---|---|---|---|---|---|
| a baseline-direct | 30 | 90 | 101 | 115 | 116 | 116 | 0 | — | — | |
| b poc-sandbox | 30 | 58 | 63 | 70 | 70 | 70 | 0 | — | — | |
| c-cold | 1 | 397 | 397 | 397 | 397 | 397 | 0 | — | 397 | miss forzado |
| d-cold | 1 | 257 | 257 | 257 | 257 | 257 | 0 | — | 257 | miss forzado |
| c gw-pure (warm) | 30 | 57 | 65 | 81 | 113 | 113 | 0 | 65 | — | |
| d gw-read (warm) | 30 | 104 | 113 | 126 | 264 | 264 | 0 | 113 | — | |
| e gw-search | 30 | 86 | 96 | 123 | 150 | 150 | 0 | 96 | — | |
| f gw-write-409 | 30 | 88 | 97 | 106 | 107 | 107 | 0 | 97 | — | plano (vs bimodal en run=1) |
| g gw-write-real | 3 | 146 | 152 | 153 | 153 | 153 | 0 | 152 | — | ordenes [10,11,12] |
| h gw-interrupt | 3 | 3027 | 3203 | 3442 | 3442 | 3442 | 0 | 3203 | — | todos isError=true |
| i gw-tools-list (warm) | 20 | 68 | 70 | 96 | 112 | 112 | 0 | 70 | — | |
| i-cold | 1 | 1226 | 1226 | 1226 | 1226 | 1226 | 0 | — | 1226 | miss forzado (cold-start isolate) |
| j gw-concurrent | 30 | 78 | 164 | 1868 | 1868 | 1868 | 0 | 151 | 509 | ver desglose |
| x-gw-ping | 30 | 50 | 57 | 74 | 148 | 148 | 0 | — | — | |
| x-book-ping | 30 | 48 | 67 | 113 | 159 | 159 | 0 | — | — | 404 esperado |

### j gw-concurrent — run=2, desglose por ronda

| ronda | wall (ms) | miss/10 | err/10 | observación |
|---|---|---|---|---|
| 1 | 1870 | 6 | 0 | fan-out frío: 6 isolates nuevos; cold p50=509ms |
| 2 | 870 | 0 | 0 | todo hit; warm p50≈164ms |
| 3 | 830 | 0 | 0 | todo hit; warm p50≈151ms |

Split j run=2: warm(hit) n=24 p50=151 p95=1868 max=1868 · cold(miss) n=6 p50=509 p95=515 max=515. **0 errores.** Dos requests rezagadas a 1868ms en rondas 2-3 pero todas 200 OK. Sin los 500 de run=1.

---

## Nota comparativa (¿difieren materialmente?)

Escenarios secuenciales estables (a, b, c, d, e, i, x-ping): coinciden dentro de ±10ms → reproducibles. Diferencias materiales:

- **f gw-write-409**: run=1 p50=159 (bimodal), run=2 p50=97 (plano). Cambio de régimen de D1/isolate a mitad de run=1; el 409 no muta así que no es acumulación de escritura.
- **j gw-concurrent**: run=1 tuvo 6 errores 500 a ~10s (p95=10187ms); run=2 0 errores (p95=1868ms). Probabilístico (isolate assignment de CF), no determinista — es el riesgo asyncify bajo fan-out.
- **i-cold**: 340 vs 1226ms (n=1, variable: a veces solo descubrimiento, a veces + cold-start de isolate).

Órdenes creadas (escenario g, mutación D1 real): run=1 [7,8,9], run=2 [10,11,12]. Una corrida de prueba previa al script final creó además [4,5,6]. Total 9 órdenes decrementadas del stock del book_id=8 "I, Robot".

El análisis de overhead por capa (sandbox ~8ms warm, descubrimiento cold +150-400ms, gateway +12ms sobre API directa, escritura +55ms, gas corta ~3.0-3.4s, concurrencia = punto débil) está en **BENCHMARK.md**.

---

## Definición de hecho — cumplimiento

- [x] `bench/run.mjs` ejecutable con `node bench/run.mjs` (Node puro, sin dependencias).
- [x] `bench/results.json` con datos crudos (+ `results-run1.json`, `results-run2.json`).
- [x] Matriz a–j completa (+ extras x-gw-ping, x-book-ping; + cold-probes c-cold/d-cold/i-cold).
- [x] Dos corridas completas separadas >60s; BENCHMARK.md reporta la segunda + comparación.
- [x] TAREA18-REPORT.md con tablas completas de ambas corridas.
- [x] Token no impreso ni escrito (verificado).
- [x] Sin commits git; nada tocado fuera de `bench/run.mjs`, `bench/results*.json`, `BENCHMARK.md`, `TAREA18-REPORT.md` (los `bench/run*-stdout.txt` son transcribras de stdout, también bajo `bench/`).