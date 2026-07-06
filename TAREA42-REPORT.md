# TAREA42 — Caps de tamaño en los fetches de descubrimiento

## Qué se hizo

Antes, **ningún fetch de discovery tenía límite de tamaño**: un origin de terceros
malicioso/roto podía servir un `tool.js` de 100 MB y reventar la memoria del worker.
Ahora **todos** los fetches de descubrimiento (`llms.txt`, `tool.js`,
`attestations.json`, `snapshot`) tienen un cap configurable por env, con defaults
sensatos, aplicado en **dos niveles**.

Archivos tocados (los únicos permitidos): `worker-gateway.mjs`, `mf-gateway.mjs`,
`TAREA42-REPORT.md` (nuevo). No se tocaron `host-async.mjs`,
`wrangler-gateway.toml`, `README.md`, `.github/`.

### 1. Límites (env con default, parse defensivo)

`parseSizeCaps(env)` en `worker-gateway.mjs`. Valor no-numero / `<=0` / ausente →
default del campo (no revienta, no abre nada):

| env                  | default        |
|----------------------|----------------|
| `MAX_LLMS_BYTES`        | 262144 (256 KB)  |
| `MAX_TOOL_BYTES`        | 1048576 (1 MB)   |
| `MAX_ATTESTATIONS_BYTES`| 262144 (256 KB)  |
| `MAX_SNAPSHOT_BYTES`     | 4194304 (4 MB)   |

Los 3 origins reales (demo, bookstore, docs) están muy por debajo de los defaults
→ no hay regresión (verificado online, HECHO 2).

### 2. Enforcement en dos niveles (`fetchText`, worker-gateway.mjs)

Nuevo error `SizeLimitError` (distinto de un fetch fallido, para que cada caller
decida la semántica de rechazo).

- **(a) Content-Length precheck**: si el header `Content-Length` declara más del cap,
  se cancela el body y se rechaza **sin leerlo** (protección de memoria; el header
  puede mentir **por exceso**).
- **(b) Streaming defensivo**: **nunca** confiar solo en `Content-Length` (puede
  faltar — chunked — o mentir). Se lee el body con `body.getReader()` acumulando hasta
  el cap; si excede, se cancela el stream (`reader.cancel()`) y se rechaza. Nunca se
  materializan más de `cap + chunk` en memoria. `TextDecoder` con `stream:true`
  reconstruye el texto igual que `resp.text()` (maneja bordes multi-byte UTF-8
  entre chunks → sin cambio de comportamiento para contenido ASCII/UTF-8 válido).

`SizeLimitError` se propaga desde `fetchText`; cada caller decide el rechazo.

### 3. Semántica de rechazo (sin tumbar nada más)

- **`llms.txt` excedido** → `fetchText` lanza → el `catch` existente lo envuelve en
  `"fetch llms.txt fallo: ..."` → el descubrimiento del origin **falla con el mismo
  error controlado** que un fetch fallido de `llms.txt` (502, code `-32603`).
- **`tool.js` excedido** → esa skill va a `rejected` con razón
  `"tool.js excede el limite de tamano"` (patrón del hash mismatch); las demás skills
  del origin cargan y ejecutan.
- **`attestations.json` excedido** → `fetchAttestations` lo atrapa y devuelve `null`
  → tratado como **ausente**: en `enforcing` las skills quedan `unattested` y son
  **excluidas** (fail-safe); en `advisory` se listan como `unattested`. No es error
  de descubrimiento.
- **`snapshot` excedido** → `snapResp = null` → `snapshotText` queda `null` →
  `memorySearch` **no se inyecta** (patrón del sha mismatch); las skills siguen.

### 4. Interacción con L1/L2

Un rechazo por tamaño **se cachea igual que hoy**: el resultado
(`skills` + `rejected` + `snapshotText` + `verdicts`) se guarda en la capa 1
(isolate, TTL 60 s) y en la capa 2 (`caches.default`, key
`gw:disc:<origin>:<fingerprint>`, TTL 60 s, cross-isolate). Un origin que **corrige**
su contenido (lo deja bajo el cap) **entra al expirar el TTL** (60 s): el siguiente
`miss`/`l2`-expirado re-hace los fetches con los caps y acepta el contenido.

No hay inconsistencia: lo cacheado es el resultado post-verificación completo (con
sus `rejected`), nunca un resultado "a medias". El `fingerprint` del L2 sigue
dependiendo de `ATTESTATION_MODE` + `REVIEWERS` + fecha UTC (cero veredictos stale);
los caps **no** forman parte del fingerprint (cambiar un cap no invalida entradas
previas — aceptable: el cap es hardening de memoria, no semántica de verificación, y
un cap más chico solo rechazaría contenido al re-descubrir tras TTL).

### 5. Pendiente colateral (NO hecho, explícito)

**`fetchOrigin` del runtime de tools (`host-async.mjs`) no se capeó** — es tarea
apart. Es el `fetch` que ejecutan las skills dentro del sandbox QuickJS (no es
discovery). Capear su body es un cambio de superficie y de semántica distinto (afecta
lo que una tool puede descargar en runtime, no el descubrimiento). Queda como
pendiente colateral.

## Definición de hecho — salidas reales

### HECHO 1 — `npm run gateway:offline`

```
$ npm run gateway:offline
... (suite completa) ...
PASS T42.a: tools/list HTTP 200 (origin descubre pese a 1 skill rechazada)
PASS T42.a: small cargada, big rechazada por tamano (cap 1000, big=1001)
PASS T42.a: small ejecuta y devuelve {ok:200}
PASS T42.a: el stderr del worker cita 'big -> tool.js excede el limite de tamano'
PASS T42.a.control: con cap 2000 big (1001) carga -> el rechazo previo era por el cap, no por sha/JS
PASS T42.b: tool.js de exactamente cap (1000) bytes carga (boundary: >cap rechaza, ==cap pasa)
PASS T42.b: la tool de cap bytes ejecuta
PASS T42.c: llms.txt excedido -> HTTP 502 (discovery falla, mismo shape que fetch fallido)
PASS T42.c: error JSON-RPC -32603 (mismo code que un fetch fallido de llms.txt)
PASS T42.c: el mensaje cita llms.txt (mismo error controlado que fetch fallido, no crash)
PASS T42.d: la skill se lista (tool.js verificado) pese al snapshot excedido
PASS T42.d: memorySearch NO inyectada (snapshot excedido -> snapshotText null -> fail controlado, no crash)
PASS T42.e.ok: enforcing con attestations validas (bajo cap) -> 2 skills attested cargan
PASS T42.e.ok: header X-Gw-Attestations = 2 attested (las firmas verifican bajo el cap)
PASS T42.e.big: attestations exceden cap -> null -> unattested -> enforcing excluye TODAS -> 502 (fail-safe)
PASS T42.e.big: el stderr cita 'attestations fetch fallo: ... excede el limite de tamano' (tratado como ausente, no crash)
PASS T42.f.clhuge: Content-Length enorme (>cap) -> precheck rechaza sin leer el body -> victim rechazada, small carga
PASS T42.f.clhuge: razon de tamano en stderr (precheck por Content-Length, no se leyo el body)
PASS T42.f.chunked: tool.js chunked (sin CL) de cap+1 bytes -> streaming corta -> big rechazada, small carga
PASS T42.f.chunked: razon de tamano en stderr (streaming defensivo, no confia en CL ausente)
PASS T42.g: con caps por DEFAULT (sin env) el discovery del docs real/fake sigue HTTP 200 (no-regresion)

TODOS LOS CHECKS VERDE
$ echo $?
0
```

`grep -c "PASS T42"` → **21** (>= 7). Suite completa (incluidos T22/T25/T35/T37/T38/T40)
verde. Exit 0.

### HECHO 2 — `npm run gateway` (online, origins reales)

```
$ npm run gateway
... (suite completa contra origins reales por red) ...
PASS T42.g: con caps por DEFAULT (sin env) el discovery del docs real/fake sigue HTTP 200 (no-regresion)

TODOS LOS CHECKS VERDE
$ echo $?
0
```

`grep -c "PASS T42"` → **21**. `grep -c "FAIL "` → **0**. Los origins reales están muy
por debajo de los defaults → sin regresión. Exit 0.

### HECHO 3 — `git status --porcelain`

```
$ git status --porcelain
 M mf-gateway.mjs
 M worker-gateway.mjs
?? TAREA42-REPORT.md
```

Solo los 3 archivos permitidos.

## Tests nuevos (mf-gateway.mjs, etiqueta T42, herméticos)

Caps chicos por env (p.ej. `MAX_TOOL_BYTES=1000`) → no genera megabytes. Origin
reutiliza `DOCS_ORIGIN` (allowlist) con un service binding `DOCS` propio por caso.
Las razones de rechazo se capturan vía `handleRuntimeStdio` (stderr del worker).

- **(a)** `tool.js` cap+1 → skill `rejected` con razón de tamaño; la otra skill carga
  y ejecuta. Contrcontrol con cap 2000 → ambas cargan (prueba que el rechazo es por
  el cap, no por sha/JS roto).
- **(a.boundary)** `tool.js` de **exactamente** cap bytes → pasa y ejecuta.
- **(c)** `llms.txt` excedido → 502, code `-32603`, mensaje cita `llms.txt` (mismo
  shape que un fetch fallido).
- **(d)** `snapshot` excedido → `mem_probe` se lista pero `tools/call` da
  `isError:true` (`memorySearch` no inyectada).
- **(e)** `attestations` excedido en `enforcing` → `null` → `unattested` → excluidas
  → 502 (fail-safe). Contrcontrol: attestations válidas bajo cap → `2 attested` cargan.
- **(f)** dos niveles sin fiarse de `Content-Length`: (f.clhuge) header
  `content-length: 999999999` sobre body chico → precheck rechaza sin leer;
  (f.chunked) `ReadableStream` (sin CL) de cap+1 bytes → streaming corta.
- **(g)** smoke con caps por **default** (sin env) → discovery HTTP 200 (no-regresión).

## TRADE-OFFS (obligatoria)

1. **"Content-Length mentiroso (header chico, body gordo)" literal NO es construible en
   workerd/Miniflare.** Evidencia: un probe sirvió `new Response("x".repeat(5000),
   { headers: { "content-length": "5" } })` y el receptor leyó **5 bytes** (workerd
   enmarca el body por `Content-Length` y lo **trunca** al declarado); lo mismo con un
   `ReadableStream`. Es decir, un server **no puede** entregar más bytes que su CL
   declarado en este runtime (y tampoco sobre HTTP real: CL es framing autoritativo,
   los bytes extra pertenecen a la siguiente respuesta). El vector realista
   equivalente —y el que la spec realmente debe cubrir (punto 2b: "Content-Length
   puede **faltar**")— es **chunked / CL ausente + body gordo**, que el streaming
   atrapa (verificado: stream de 5000 bytes sin CL, cap 100 → `exceeded`). Por eso el
   test (f) cubre **(f.clhuge)** precheck por CL enorme (header que miente **por
   exceso**, construible: body chico + `content-length: 999999999` sobrevive al
   receptor y el precheck cancela sin leer) y **(f.chunked)** streaming contra un
   body sin CL. Ambos prueban "no confiar solo en Content-Length". La protección
   objetivo queda cubierta; solo cambia la forma literal del fixture, forzada por el
   runtime.

2. **Streaming con `reader` es viable para los 4 fetches** (service binding y
   `fetch` global). No se abortó. Verificado con probes antes de implementar: getReader
   + read + cancel funcionan sobre respuestas de service binding en Miniflare v4
   (workerd). No se tocó `host-async.mjs` (ver pendiente colateral).

3. **El precheck por Content-Length no dispara para bodies string sin CL.** En
   workerd, `new Response("string")` **no** setea `Content-Length` (llega `cl:null`),
   así que para los fakes (y para origins que responden sin CL) la protección recae en
   el streaming (nivel b). El precheck (nivel a) cubre el caso de origins que sí
   declaran un CL grande. Ambos niveles son necesarios y complementarios; ninguno es
   suficiente solo.

4. **Las razones de rechazo por tamaño NO se exponen en las respuestas MCP** (igual
   que las razones de hash mismatch): van a `console.warn` del worker. Los tests las
   afirman capturando el stderr vía `handleRuntimeStdio`. Observable en prod solo por
   logs. No cambiar la superficie MCP por un hardening interno.

5. **Memoria peak ~ `2 × cap`** al decodificar: los chunks decodificados
   (`parts.join("")`) coexisten brevemente con el último `value` del reader. Sigue
   siendo **O(cap)** y acotado (1 MB tool / 4 MB snapshot worst-case), muy lejos del
   escenario sin cap (100 MB+). Aceptable vs. la complejidad de decodificar
   incrementalmente sin el doble buffer.

6. **Caps fuera del fingerprint del L2.** Cambiar un cap no invalida entradas L2
   previas (un cap más chico solo rechazaría contenido al re-descubrir tras TTL 60 s).
   Aceptable: el cap es hardening de memoria, no semántica de verificación.

7. **No se debilitó ningún check existente.** Suite completa (T22/T25/T35/T37/T38/T40
   + básicos) verde offline y online, 0 FAIL, con los 21 nuevos PASS T42.