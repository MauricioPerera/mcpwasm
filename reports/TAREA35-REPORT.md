# TAREA35 — Modo OFFLINE hermético para `mf-gateway.mjs`

## Qué se hizo

`mf-gateway.mjs` acepta ahora un modo OFFLINE hermético vía **flag argv**
`--offline` (no variable de entorno: la sintaxis `VAR=1` no es portable a Windows).

```
node build-gateway.mjs && node mf-gateway.mjs --offline
```

En modo offline, **sin un solo fetch a internet**:

1. **Fakes por service binding.** Las instancias Miniflare que hoy salían a red
   (`mf` principal, `mfAuth`, `mf2`) reciben
   `serviceBindings: { DEMO: makeFakeDemo(), DOCS: makeFakeDocsCompleto() }`.
   Los fakes se construyen leyendo el contenido **REAL** de `demo-site/` y
   `docs-site/` (leerlos sí, modificarlos no) y computando los `sha256` sobre los
   bytes exactos servidos → el `tool_sha256` declarado en `/llms.txt` coincide
   byte-a-byte con el `tool.js` servido, y el `snapshot_sha256` coincide con el
   snapshot BM25 real servido. Así **todos los checks existentes pasan idénticos**.

2. **Interceptor de red saliente.** Toda instancia Miniflare (incluidas las que ya
   usaban fakes propios, `mfFake` de T22.f y `attMf` de T25) recibe
   `outboundService: interceptor` (opción nativa de Miniflare v4 instalada,
   `4.20260630.0`). El interceptor devuelve `598` ante cualquier `fetch()` del
   worker que **no** vaya a un service binding (la rama global de `makeFetchImpl`
   en `worker-gateway.mjs:194-211`). Los service bindings **no** son interceptados
   (verificado: el binding sirve normalmente; el global es capturado).

3. **Check de hermeticidad (T35).** Un check propio del modo offline demuestra que
   el interceptor **no es decorativo**: misma gateway worker, `ALLOWED_ORIGINS=DEMO`
   (pasa el check 403), interceptor activo, **pero sin binding DEMO** →
   `makeFetchImpl` cae al `fetch` global → el interceptor lo bloquea (HTTP 598,
   firma propia) → discovery falla → `502` con `error.message` citando `HTTP 598`.

Sin `--offline`, el flujo online queda **intacto**: `gwMiniflare()` produce opts
byte-identicos a los que había antes (sin `serviceBindings` ni `outboundService`
cuando `OFFLINE=false`). No se tocó `worker-gateway.mjs`, `host-async.mjs`,
`demo-site/` ni `docs-site/`. No se debilitó ni saltó ningún check existente.

Archivos tocados: `mf-gateway.mjs`, `package.json` (solo el script
`gateway:offline`), y este reporte.

## Cómo funciona el interceptor (verificación de viabilidad previa)

Antes de escribir nada, se probó aisladamente que `outboundService` de Miniflare v4
intercepta el `fetch()` global del worker **sin tocar** los service bindings:

```
EXT: 200 ext-ok status=598          # fetch("https://example.com/") -> interceptor (598), sin red
BINDING: 200 binding-ok status=200 body=hello from f   # env.DOCS.fetch(...) -> NO interceptado
```

Esto es exactamente lo que necesita el gateway: los origins `DEMO`/`DOCS` van por
binding (servidos por los fakes, no interceptados); cualquier otro `fetch` global
cae en el interceptor. El gateway (`worker-gateway.mjs:182-212`) resuelve origins
por un mapa `URL -> service binding` (`env.DEMO`/`env.DOCS`) con fallback a
`fetch` global → el interceptor atrapa ese fallback.

---

## HECHO 1 — `node build-gateway.mjs && node mf-gateway.mjs --offline` → verde, exit 0, interceptor activo

Comando (sin pipes que enmascaren el exit code):

```
$ node build-gateway.mjs && node mf-gateway.mjs --offline; echo "EXIT=$?"
```

Salida real (cabecera de build + bloque de hermeticidad T35 + resumen final; el
resto de checks todos PASS, omitidos por brevedad pero verdes en la corrida):

```
  dist-gateway\worker.js  176.0kb
Done in 16ms
build-gateway OK -> dist-gateway/worker.js + quickjs-asyncify.wasm + minimemory_bg.wasm

[1] initialize -> {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18",...}}
PASS initialize: HTTP 200
...
[4] server_time -> {"...","structuredContent":{"now":"2026-07-02T12:00:00.000Z","epoch":1788254400000},"isError":false}
PASS server_time: structuredContent.epoch numerico
...
[T26.a] k=1 -> 1 hits; k=8 -> 8 hits
PASS T26.a: k=8 devuelve MAS hits que k=1 (k se respeta de extremo a extremo)
...
[T35] hermeticidad offline (interceptor bloquea fetch saliente):
[T35] initialize sin binding + interceptor -> {"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"descubrimiento fallo: llms.txt: HTTP 598"}}
PASS T35: sin binding + interceptor -> HTTP 502 (discovery fallo: el fetch saliente fue bloqueado, no servido por red real)
PASS T35: el error cita HTTP 598 (firma del interceptor: hermeticidad por maquina, no decorativo)

TODOS LOS CHECKS VERDE
EXIT=0
```

**Todos los checks existentes (1–6, T22, T26, T22.f, a, T26.b, c, d, g, e, f, T28,
h, b, T25) pasan en offline sin red**, más los 2 nuevos de T35. Exit 0.

## HECHO 2 — El interceptor NO es decorativo (evidencia)

El check `[T35]` (corre solo en `--offline`) usa la **misma gateway worker** con
interceptor activo y **sin binding DEMO**: fuerza la rama global de `makeFetchImpl`
y verifica que el fetch saliente es bloqueado por el interceptor (no servido por red
real). Salida real:

```
[T35] hermeticidad offline (interceptor bloquea fetch saliente):
[T35] initialize sin binding + interceptor -> {"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"descubrimiento fallo: llms.txt: HTTP 598"}}
PASS T35: sin binding + interceptor -> HTTP 502 (discovery fallo: el fetch saliente fue bloqueado, no servido por red real)
PASS T35: el error cita HTTP 598 (firma del interceptor: hermeticidad por maquina, no decorativo)
```

Dos hechos demuestran que no es decorativo:

- **HTTP 502** (no 200): el request NO fue servido. Si el interceptor no existiera,
  el gateway habría hecho un `fetch` real a `https://llmstxt-demo-site.../llms.txt`
  por red (o habría timeout). En su lugar, discovery falló → 502.
- **`HTTP 598`** en el mensaje: `598` es el status que devuelve **el interceptor**
  (su firma propia). El gateway lo surfacea como `"descubrimiento fallo: llms.txt:
  HTTP 598"`. Es la traza directa de que el `fetch` global fue capturado por el
  interceptor y no llegó a la red.

Complementariamente, la suite entera en offline (HECHO 1) corre verde **con el
interceptor activo en todas las instancias** — lo que prueba que los fakes cubren
todo lo necesario y que ninguna ruta de red del gateway escapa.

## HECHO 3 — `npm run gateway` (online normal) → sigue verde, exit 0 (no regresión)

Comando:

```
$ npm run gateway; echo "EXIT=$?"
```

Salida real (resumen final; todos los checks online PASS, incluido `server_time`
contra el `/api/time` real del demo-site en producción):

```
[4] server_time -> {"...","structuredContent":{"now":"2026-07-06T20:37:24.241Z","epoch":1783370244241},"isError":false}
PASS server_time: structuredContent.epoch numerico
...
[h] 5 paralelo: wall=830ms statuses=[200,200,200,200,200] discs=["miss","hit","hit","hit","hit"]
PASS single-flight: 1 miss (iniciador) + 4 hit (esperaron la promesa compartida) => 1 solo fetch
...
TODOS LOS CHECKS VERDE
EXIT=0
```

Sin `--offline`, el bloque T35 no corre (`OFFLINE=false`) y `gwMiniflare()` produce
opts sin `serviceBindings`/`outboundService` → comportamiento byte-identico al
previo. Exit 0, sin regresión.

## HECHO 4 — `git status --porcelain` → solo los 3 archivos permitidos

```
$ git status --porcelain
 M mf-gateway.mjs
 M package.json
?? TAREA35-REPORT.md
```

(`dist-gateway/worker.js` es build artifact gitignored, regenerado por
`build-gateway.mjs` en cada corrida; no cuenta.)

`package.json` solo añadió el script:

```json
"gateway:offline": "node build-gateway.mjs && node mf-gateway.mjs --offline",
```

---

## TRADE-OFFS (dónde difiere el fake del origin real y por qué es aceptable)

| Aspecto | Origin real | Fake offline | Por qué es aceptable |
|---|---|---|---|
| `tool.js` (demo + docs) | Servido por el worker de producción | Servido byte-identico desde `demo-site/content/*.tool.js` y `docs-site/content/*.tool.js` | **No hay diferencia**: el worker real también embedde el mismo archivo (vía `build.mjs` + `JSON.stringify`). El `tool_sha256` se computa en la suite sobre los bytes servidos → coherencia byte-a-byte garantizada por construcción, no asumida. |
| `llms.txt` | Generado por `build.mjs` del site | Reconstruido en la suite con el mismo formato que `parseLlmsTxt` exige y los mismos `sha256` computados | Mismo parser, mismo formato, mismas skills. Las descripciones se replican textualmente de `docs-site/build.mjs`; los checks no dependen del contenido exacto de la descripción, solo de nombres/estructura. |
| Snapshot BM25 (docs) | `idx.export_snapshot()` servido por el worker | `docs-site/skills-index.snapshot` (el archivo real, committeado) servido tal cual | **No hay diferencia**: es el mismo snapshot que genera `docs-site/build.mjs`. Los resultados BM25 (hits, scores, k-respeto T26.a, 0-hits paella T22.c) son idénticos a producción porque el índice es el mismo. `snapshot_sha256` computado sobre el mismo texto → verificación sha del gateway pasa. |
| `/api/time` (demo) | `Date.now()` real del worker | `epoch: 1788254400000` fijo, determinista | Los checks (`server_time`, concurrencia `h`) solo exigen `epoch` **numérico**. Un valor fijo es determinista y reproduce el contrato (número). No testea el avance del reloj del origin. |
| `attestations.json` (demo/docs) | Firmas Ed25519 reales de `human:mauricio` | `[]` (array vacío) | Los checks online de demo/docs (`mf`, `mfAuth`, `mf2`, T22, T26) corren con `ATTESTATION_MODE` **off** → el gateway **no fetchea** `attestations.json` para esos origins. El fake lo sirve vacío por completitud, pero no es ejercitado. Los checks de atestaciones (T25) usan su **propio** fake `DOCS` con un keypair Ed25519 de test generado en la suite, **inalterado** en offline. |
| Interceptor `outboundService` | No existe (red real) | Devuelve `598` para cualquier `fetch` global | Es el mecanismo que prueba hermeticidad. No altera el comportamiento del gateway: los origins permitidos van por binding; el interceptor solo atrapa el fallback global, que en offline no debe ocurrir nunca en el happy path (y de ocurrir, fallar controlado es lo correcto). |
| `mfFake` (T22.f) y `attMf` (T25) | Ya usaban fakes propios (sin red) | + `outboundService` + binding `DEMO` extra (no usado) | Estas instancias ya eran herméticas. En offline se les suma el interceptor (seguridad extra) y un binding `DEMO` que no ejercitan. Su `DOCS` propio se **preserva** (`gwMiniflare` no sobreescribe un `DOCS` que el caller ya pasó). Comportamiento de T22.f/T25 idéntico. |

**Resumen de trade-offs:** el único contenido que difiere semánticamente del
origin real es `/api/time` (epoch fijo vs. `Date.now()`) y `attestations.json`
vacío en demo/docs — ninguno de los dos es ejercitado por los checks que corren
contra esos origins en offline (el reloj solo se exige numérico; las atestaciones
se prueban con el fake dedicado de T25). Todo lo que sí se ejercuta (`tool.js`,
`llms.txt`, snapshot BM25, docs) se sirve **byte-identico** al origin real.