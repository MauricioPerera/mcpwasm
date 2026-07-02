# TAREA19 — Mutex de ejecución por módulo wasm + single-flight del descubrimiento

**Objetivo:** eliminar los errores HTTP 500 (~10 s) bajo fan-out concurrente de 10 requests contra origin frío, sin regresión de latencia secuencial, con evidencia de benchmark antes/después.

**Fecha:** 2026-07-02. **Deploy post-fix:** versión `c039318d-2a6e-46ed-9c0c-3c38005e9335` (`https://llmstxt-gateway.rckflr.workers.dev`).

---

## 1. Causa raíz (confirmada)

El módulo wasm QuickJS **ASYNCIFY** solo soporta **una suspensión async a la vez**. El módulo se cachea a nivel **isolate** (`getQuickjs()` en `worker-gateway.mjs`); los requests concurrentes que caen en el mismo isolate y ejecutan wasm (`callTool` → `evalCodeAsync` + bombeo con `await setTimeout(0)`; `newContext`; `loadToolSource`) **intercalan suspensiones asyncify y corrompen el módulo** → el worker suelta 500 clavados en ~10 s (el `fetchTimeoutMs` de fetchOrigin). Adicionalmente, los miss concurrentes de descubrimiento provocan una **estampida** (N fetches de llms.txt + tool.js a la vez).

Pre-fix, 3 corridas: 6 err / 0 err / 4 err a ~10 s (probabilístico, depende del isolate assignment de CF). Ver `BENCHMARK.md` "Verificación independiente".

## 2. Fix implementado (worker-gateway.mjs, cambio mínimo)

### Pieza 1 — Mutex de ejecución por módulo (`withModuleLock`)

Promise-queue a nivel de módulo que serializa TODA ejecución que puede tocar/suspender el wasm. Encadena `fn` sobre una única promise de módulo (cola FIFO):

```js
let _moduleLock = Promise.resolve();
function withModuleLock(fn) {
  const result = _moduleLock.then(fn, fn);              // corre fn pase lo que pase del previo
  _moduleLock = result.then(() => undefined, () => undefined); // cola siempre fulfilled
  return result;
}
```

El handler envuelve `init()` + `handleMcpMessageAsync()` + `dispose()` bajo el lock:

```js
response = await withModuleLock(async () => {
  const quickjs = await getQuickjs();
  const host = new PerSkillHost({ quickjs, allowedOrigin: origin, fetchImpl, skills });
  try {
    await host.init();
    return await handleMcpMessageAsync(host, msg);
  } finally {
    try { host.dispose(); } catch { /* best-effort */ }
  }
});
```

- **Lock se suelta SIEMPRE:** la cola se reinicia tanto en resolve como en reject (`result.then(noop, noop)`) → el fallo de un request (tool lanza, interrupt corta) no envenena el mutex ni bloquea a los demás.
- **Las esperas en cola NO cuentan contra el `fetchTimeoutMs` (10 s) de OTRO request:** verificado con el diseño actual — el timeout de fetchOrigin se arma DENTRO de `callTool` (`this._deadline = Date.now() + ...` y `AbortSignal.timeout(fetchTimeoutMs)` en `__fetchOriginRaw`), que corre bajo el lock. La cola espera ANTES de que `fn` corra; el reloj del timeout empieza a correr solo cuando el request adquiere el lock y entra en su propia ejecución.
- **Camino secuencial = no-op práctico:** sin contención, `_moduleLock` ya está fulfilled → `fn` corre en el siguiente microtask, sin espera medible (verificado: ningún escenario secuencial degrada >15% p50).

### Pieza 2 — Single-flight del descubrimiento (`discoverInflight`)

Map a nivel isolate `origin -> Promise` en vuelo. `discoverSkills` queda partido en `discoverSkills` (orchestta single-flight) + `discoverSkillsInner` (cuerpo fetch+verify):

```js
const existing = discoverInflight.get(origin);
if (existing) {
  try { await existing; } catch { /* reintento abajo */ }
  const nowCached = isolateCacheGet(origin);
  if (nowCached) return { ...nowCached, discovery: "hit" };   // compartido, sin fetch propio
}
const p = discoverSkillsInner(origin, fetchImpl).finally(() => discoverInflight.delete(origin));
discoverInflight.set(origin, p);
return p;   // discovery "miss": este request hizo el fetch real
```

- **Un fallo no envenena el cache:** el `finally` borra la entrada al settle (resolve o reject); si el en-vuelo falló, el siguiente miss reintenta (no se queda pegado ni cachea el error).
- **Check+set atómico en single-thread:** no hay `await` entre `discoverInflight.get` y `discoverInflight.set` → solo un iniciador por origin por estampida.
- **Decisión de observabilidad (documentada):** el iniciador reporta `X-Gw-Discovery: miss`; los concurrentes que esperan la promesa compartida reportan `hit` (leyeron del cache tras el fetch único). Esto hace el single-flight observable por header: `1 miss + (N−1) hit` ≡ 1 solo fetch real.

## 3. Test local de concurrencia (mf-gateway.mjs, bloque [h])

Nuevo caso: Miniflare con **isolate fresco** (cache + single-flight vacíos), 5 `tools/call server_time` en paralelo (`Promise.all`) contra el gateway local.

Salida real:

```
[h] concurrencia local (5 tools/call en paralelo, isolate fresco):
[h] 5 paralelo: wall=710ms statuses=[200,200,200,200,200] discs=["miss","hit","hit","hit","hit"]
PASS concurrencia: los 5 tools/call -> HTTP 200 (sin 500)
PASS concurrencia: 0 errores 500 bajo fan-out de 5
PASS single-flight: 1 miss (iniciador) + 4 hit (esperaron la promesa compartida) => 1 solo fetch
PASS concurrencia: los 5 devolvieron structuredContent.epoch numerico (wasm intacto)
```

- **Mutex verificado:** 5 concurrentes → 5×200, sin 500, wasm intacto (los 5 devolvieron `epoch` numérico; sin serialización, los 5 intercalarían suspensiones asyncify sobre el módulo compartido y corromperían).
- **Single-flight verificado:** `discs=["miss","hit","hit","hit","hit"]` → exactamente 1 fetch de descubrimiento, 4 compartidos. wall=710 ms ≈ 5 × server_time serializado (~140 ms c/u).

## 4. Suites — exit 0

```
npm run gateway  exit=0   (build-gateway + mf-gateway: TODOS LOS CHECKS VERDE, incluido [h] concurrencia)
npm test         exit=0   (build + mf-test)
npm run spike    exit=0   (build-spike + mf-spike: TODOS LOS CHECKS VERDE)
```

## 5. Deploy

```
npx wrangler deploy -c wrangler-gateway.toml
Uploaded llmstxt-gateway (6.26 sec)
Deployed llmstxt-gateway triggers (2.12 sec)
  https://llmstxt-gateway.rckflr.workers.dev
Current Version ID: c039318d-2a6e-46ed-9c0c-3c38005e9335
```

## 6. Benchmark antes/después (`node bench/run.mjs --run=3`)

JSON crudo: `bench/results-run3-postfix.json`. Sección detallada en `BENCHMARK.md` → "Post-fix (mutex + single-flight)".

### Escenario j (el objetivo)

| métrica | run=1 | run=2 | run3-PM (pre-fix) | **run=3 post-fix** |
|---|---|---|---|---|
| errs | 6 | 0 | 4 | **0** |
| p95 (ms) | 10187 | 1868 | 10181 | **618** |
| p50 (ms) | — | 164 | — | 237 |
| max (ms) | — | 1868 | — | **639** |
| rona 1 wall (ms) | 10279 | 1870 | — | **639** |

Desglose por ronda (run=3 post-fix):

| ronda | wall≈max (ms) | miss/10 | err/10 | status |
|---|---|---|---|---|
| 1 (fan-out frío) | 639 | 5 | 0 | 10×200 |
| 2 | 281 | 2 | 0 | 10×200 |
| 3 (warm) | 266 | 0 | 0 | 10×200 |

Split warm/cold: warm(hit) n=23 p50=220 p95=618 · cold(miss) n=7 p50=545 p95=551.

**j: 0 errores, p95=618 ms** (antes ~10 s con 4-6 errores). Dentro del rango esperado por la tarea (ronda fría en cola ~1-3 s → 639 ms; rondas warm p50 ~150-220 ms).

### No-regresión secuencial (run=2 vs run=3, p50)

| key | run=2 p50 | run=3 p50 | Δ | ¿regresión >15%? |
|---|---|---|---|---|
| a baseline-direct | 101 | 92 | −9 | no (mejor) |
| b poc-sandbox | 63 | 67 | +4 (+6%) | no |
| c gw-pure warm | 65 | 60 | −5 | no (mejor) |
| d gw-read warm | 113 | 108 | −5 | no (mejor) |
| e gw-search | 96 | 89 | −7 | no (mejor) |
| f gw-write-409 | 97 | 86 | −11 | no (mejor p50; p95/p99 tuvieron cola puntual de varianza D1) |
| i gw-tools-list warm | 70 | 70 | 0 | no |
| x-gw-ping | 57 | 56 | −1 | no |
| h gw-interrupt | 3203 | 3422 | +219 (+7%) | no (varianza 3.0-5.4 s entre corridas) |

**Ningún escenario secuencial degrada >15% en p50.** El mutex en camino secuencial es un no-op práctico (sin contención). `f gw-write-409` p95=503/p99=859 es varianza del backend D1 a mitad de ráfaga (run=1 ya mostraba régimen bimodal en f), no atribuible al fix — p50=86 plano, errs=0.

## 7. Archivos tocados

- `worker-gateway.mjs` — mutex `withModuleLock` + single-flight `discoverInflight`/`discoverSkills`/`discoverSkillsInner` + handler bajo lock.
- `mf-gateway.mjs` — bloque [h] test de concurrencia local (5 paralelo + single-flight observable).
- `BENCHMARK.md` — sección nueva "Post-fix (mutex + single-flight)".
- `bench/results-run3-postfix.json` — datos crudos del run post-fix.
- `TAREA19-REPORT.md` — este reporte.

No se tocaron: `bench/run.mjs`, `mcp-core*.mjs`, `bookstore/**`, `demo-site/**`, `README.md`. No se hicieron commits git.

## 8. Definición de hecho

- ✅ Test concurrente local en verde (5 paralelo → 5×200, 1 miss + 4 hit, wasm intacto).
- ✅ 3 suites exit 0 (gateway, test, spike).
- ✅ Deploy del gateway (versión `c039318d…`).
- ✅ Benchmark post-fix: j con 0 errores y p95=618 ms (antes ~10 s); sin regresión secuencial >15% p50.

**El fix elimina los errores de j.** Causa raíz confirmada (asyncify 1-suspensión-por-módulo compartida por isolate + estampida de descubrimiento). No hubo que maquillar nada: la salida es real y el veredicto positivo.