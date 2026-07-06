# TAREA40 — Cache L2 del RESULTADO de descubrimiento (cross-isolate)

## Qué se hizo

Cache **L2 del resultado** de descubrimiento (no solo insumos crudos), compartible
**cross-isolate** via `caches.default`. Hasta T39 la capa 2 (`caches.default`)
sólo guardaba `llms.txt` (TTL 60s) y `tool.js` (inmutable por hash); el **resultado**
post-verificación (skills+rejected+snapshotText+verdicts) vivía sólo en la capa 1
(`isolateCache`, un `Map` en memoria del isolate, TTL 60s, 16 entradas), perdido al
evictar/recrear el isolate. T40 añade ese resultado como entrada cacheable.

### worker-gateway.mjs (cambios)

1. **Fingerprint de config** (`discFingerprint`): `sha256 hex` de
   `JSON.stringify({mode: ATTESTATION_MODE||"off", reviewers: REVIEWERS||"", date: <UTC YYYY-MM-DD>})`.
   Orden de claves estable (mode, reviewers, date). Usa los strings crudos de `env`
   (`rawMode`/`rawReviewers`, añadidos al `attestCtx` en el handler) — no el modo
   normalizado ni el objeto parseado: así un config "basura" mapea a su propia key
   en vez de colisionar con `"off"`.

2. **Key del L2**: `gw:disc:<origin>:<fingerprint>` (mismo patrón de URL sintética
   `https://cache.local/<key>` que usan `gw:llms:`/`gw:tool:`). TTL 60s
   (`DISC_L2_TTL_MS`, igual que la capa 1).

3. **L2 read** al inicio de `discoverSkillsInner` (el iniciador del single-flight;
   los waiters no llegan ahí → un solo L2 read por discovery en isolate frío):
   `cacheGet(l2Key)` → `parseDiscL2` defensivo → si OK, `isolateCachePut` (hidrata
   la capa 1) y responde `discovery:"l2"` **sin fetch al origin ni re-verificación**
   criptográfica (sha256 de tool.js / Ed25519). Miss o malformada → cae al
   descubrimiento completo.

4. **L2 write** al final de `discoverSkillsInner` (tras `isolateCachePut`):
   `cachePut(l2Key, serializeDiscL2(...), 60_000)`. El `cachePut` traga errores
   (bypass) → el L2 nunca puede tumbar un request.

5. **`X-Gw-Discovery`** pasa a `"hit"|"l2"|"miss"|"none"`. Auth (T37), rate limit
   (T38) y ejecución intactos.

6. **Parse DEFENSIVO** (`parseDiscL2`): valida `kind:"gw-disc"`, `v:1`, que
   `skills` sea array con `{name, code, sha256}` strings, `rejected` array,
   `verdicts` null o `{verdicts,counts}`. Cualquier malformación / shape inesperada
   / error → `null` → miss. `cacheGet` ya traga errores de cache → `null` → miss.
   **El L2 nunca puede tumbar un request.**

### mf-gateway.mjs (tests T40, herméticos — fakes SIEMPRE)

`gwMiniflare` acepta `cachePersist` opcional (sin él, opts byte-idénticos a hoy;
sólo lo piden las instancias T40). Se simula cross-isolate apuntando dos+ instancias
**nuevas** de Miniflare al **mismo** directorio temporal (`mkdtempSync`):
`caches.default` queda respaldado en disco por Miniflare (Durable Object
`CacheObject` con `localDisk`), compartido entre instancias. Fake DEMO con
**contador de requests** (envuelve `buildOfflineFakes().demo`).

- **(a)** instancia A (cachePersist=dirX): 1er request → `miss`; 2do → `hit` (capa 1).
- **(b)** instancia B **nueva** (mismo cachePersist, misma config): 1er request al
  mismo origin → `l2`, **Y el fake no recibió ningún fetch nuevo** (contador quieto).
- **(c)** `tools/call` `sum_numbers` en B tras hidratar por `l2` → `structuredContent.result === 42`.
- **(d)** instancia C **nueva** (mismo cachePersist, `ATTESTATION_MODE` distinto) →
  `miss` (fingerprint invalida; el contador del fake **sí** incrementa) + header
  `X-Gw-Attestations` presente (veredictos computados en el miss real).
- **(e)** los checks existentes (T35 hermeticidad, T37 auth, T38 rate limit, T25
  attestations, [h] concurrencia/single-flight, etc.) **sin tocarlos**.

## Definición de hecho — salidas REALES

### 1. `npm run gateway:offline` → verde, exit 0, ≥6 "PASS T40"

```
$ npm run gateway:offline
... build-gateway OK -> dist-gateway/worker.js + quickjs-asyncify.wasm + minimemory_bg.wasm
$ echo $?
0
```

Tramo T40:

```
[T40] cache L2 del resultado (cross-isolate via cachePersist):
[T40.a] A 1er initialize -> discovery=miss status=200 fetchCount=3
PASS T40.a: A 1er request HTTP 200
PASS T40.a: A 1er request X-Gw-Discovery=miss (L2 vacio, descubrimiento real)
[T40.a] A 2do tools/list -> discovery=hit
PASS T40.a: A 2do request X-Gw-Discovery=hit (capa 1, sin fetch)
PASS T40.a: A fetcheo el origin (fetchCount=3 > 0)
[T40.b] B 1er initialize -> discovery=l2 status=200 fetchCount 3->3
PASS T40.b: B 1er request HTTP 200
PASS T40.b: B 1er request X-Gw-Discovery=l2 (L2 hit cross-isolate, hidrata capa 1)
PASS T40.b: B NO fetcheo el origin (contador quieto: 3->3, L2 short-circuit)
[T40.c] B tools/call sum_numbers -> {"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"42"}],"structuredContent":{"result":42},"isError":false}} discovery=hit
PASS T40.c: B tools/call sum_numbers HTTP 200 (ejecuta desde resultado hidratado)
PASS T40.c: B sum_numbers structuredContent.result === 42
PASS T40.c: B 2do request X-Gw-Discovery=hit (capa 1 hidratada por el L2)
[T40.d] C 1er tools/list -> discovery=miss status=200 fetchCount 3->6 attest=0attested,0expired,0invalid,2unattested
PASS T40.d: C 1er request HTTP 200
PASS T40.d: C 1er request X-Gw-Discovery=miss (fingerprint invalida el L2)
PASS T40.d: C SI fetcheo el origin (contador 3->6, fingerprint distinto => descubrimiento real)
PASS T40.d: C descubre 2 skills desde el origin (sum_numbers, server_time)
PASS T40.d: C en advisory lleva X-Gw-Attestations (veredictos computados en el miss real)
```

Conteos: `PASS T40: 15` · `PASS total: 171` · `FAIL total: 0` · final `TODOS LOS CHECKS VERDE`.

### 2. `npm run gateway` (online) → verde, exit 0 (no regresión)

```
$ npm run gateway
$ echo $?
0
```

Conteos: `PASS T40: 15` · `PASS total: 169` · `FAIL total: 0` · final `TODOS LOS CHECKS VERDE`.
(169 vs 171 offline: los 2 checks T35 de hermeticidad sólo corren con `--offline`,
como ya ocurría pre-T40.) El L2 opera online y es transparente (mismo tramo T40).

### 3. `git status --porcelain` → SOLO los 3 archivos permitidos

```
 M TAREA40-REPORT.md
 M mf-gateway.mjs
 M worker-gateway.mjs
```

## TRADE-OFFS

### Qué se serializa vs qué se reconstruye

Se serializa (JSON-round-trippable, todo texto/objetos planos):

- `skills`: `[{name, description, code, sha256}]` — `code` es el source de `tool.js`
  **ya verificado por sha256** al poblar (igual que la capa 1, que tampoco
  re-verifica en hit).
- `rejected`: `[{name, reason}]`.
- `snapshotText`: string del snapshot BM25 **ya verificado** por `snapshot_sha256`
  (o `null`).
- `verdicts`: `{verdicts, counts}` (modo != off) o `null` (modo off).
- Marcador `{kind:"gw-disc", v:1}` para parse defensivo.

Se **reconstruye** al hidratar (no se serializa):

- `inputSchema`: en runtime es `undefined` (el schema se extrae del contexto QuickJS
  por request; nunca se cacheó). `JSON.stringify` lo descarta; al hidratar se
  reconstruye explícitamente como `undefined`. Comportamiento byte-idéntico a la
  capa 1.
- La **instancia WasmOkfIndex** y los **contextos QuickJS**: NO se cachean (por
  request, como antes). El L2 guarda el **texto** (`snapshotText`, `code`); el
  índice y los contextos se construyen por request desde ese texto.

Nada del resultado resultó imposible de serializar/reconstruir con fidelidad — no
se abortó.

### Tamaño típico de la entrada L2

- Origin liviano (demo, 2 skills sin memoria): **~1.0 KB** (`1061` chars medidos:
  `kind`+`v`+2 skills con `code` de 313/284 bytes + `description` corta).
- Origin con memoria (docs, snapshot BM25): el `snapshotText` domina — **~110 KB**
  (`107669` bytes del snapshot) más las skills y verdicts. Es el mismo orden que
  lo que la capa 1 ya retiene en memoria por origin; el L2 lo pone en disco
  compartido.

El `code` (tool.js) ya estaba cacheado por separado en `gw:tool:` (insumo crudo);
el L2 lo **duplica** dentro del resultado. Es el costo de poder responder `l2`
**sin ningún fetch ni re-verify** cross-isolate: se evita el round-trip al origin y
la re-verificación a cambio de almacenar ~1 copia extra del source por origin en
`caches.default` (TTL 60s, mismo eviction que el resto de la cache).

### Por qué cachear resultado post-verificación es seguro en este dominio de confianza

- **Contenido inmutable por hash.** `code` y `snapshotText` se verifican por
  `sha256` al poblar (mismatch → no se cachea). El L2 guarda el mismo bytes
  verificado; no hay re-verificación en hit porque **no hay nada que pueda haber
  cambiado**: el contenido addressable por hash no muta. Igual que la capa 1, que
  ya confía en el hash al poblar y no re-verifica en hit.
- **El fingerprint invalida veredictos stale.** `verdicts` dependen de
  `ATTESTATION_MODE`, `REVIEWERS` y la fecha UTC (lo ya documentado ~línea 395:
  estables por deploy + día dentro del TTL). El fingerprint los incluye → un
  cambio de modo, de revisores o de día UTC → key distinta → no se sirve un
  veredicto de una config anterior. **Crítico en `enforcing`**: nunca se
  excluiría/incluiría una skill por un veredicto obsoleto.
- **Dominio de confianza.** `caches.default` es privada del gateway (misma cuenta
  Cloudflare); no es un cache público edge. Un atacante no puede inyectar entradas
  en `gw:disc:` sin comprometer el isolate del gateway mismo (y entonces el
  aislamiento QuickJS ya es el perímetro, no la cache). El `kind`/`v` y la
  validación de shape en `parseDiscL2` rechazan cualquier entrada que no haya
  escrito el propio gateway.
- **Fail-open hacia miss, nunca hacia un resultado inválido.** Cualquier duda
  (malformed, shape inesperada, error de cache, entry de otra versión) → `null` →
  descubrimiento completo. El L2 **sólo puede acelerar**, nunca degradar la
  corrección: en el peor caso se comporta como si no existiera.
- **TTL 60s acota la ventana de inconsistencia** al mismo borde que la capa 1: un
  origin que rote su `tool.js` (nuevo `tool_sha256` en `llms.txt`) se re-descubre
  en ≤60s, igual que hoy.