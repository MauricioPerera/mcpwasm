# TAREA28 — Comparacion de tiempo constante del header Authorization (hardening)

Hardening menor senalado por code-review del PM: la comparacion del header
`Authorization` en `worker-gateway.mjs` usaba `got !== expected` (comparacion
de strings JS, **no** de tiempo constante) -> fuga de timing teorica sobre el
token. Se reemplaza por una comparacion de tiempo (aprox) constante con
WebCrypto, manteniendo EXACTAMENTE el comportamiento observable.

## Archivos tocados
- `worker-gateway.mjs` — helper nuevo + reemplazo del `!==`.
- `mf-gateway.mjs` — 6 casos nuevos (T28.a–T28.f).

No se tocaron `host-async.mjs`, `mcp-core*.mjs`, `llmstxt-parse.mjs`,
`bookstore/**`, `demo-site/**`, `docs-site/**`, `README.md`, `scripts/**`.

## Diff conceptual

### 1) Helper nuevo `timingSafeEqualStr(a, b)` (antes de `export default`)
Patron **double HMAC** (WebCrypto puro; `crypto.subtle` +
`crypto.getRandomValues`, validos en workerd — NO `node:crypto`):

```js
async function timingSafeEqualStr(a, b) {
  const enc = new TextEncoder();
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const [da, db] = await Promise.all([
    crypto.subtle.sign("HMAC", key, enc.encode(a)),
    crypto.subtle.sign("HMAC", key, enc.encode(b)),
  ]);
  const xa = new Uint8Array(da);
  const xb = new Uint8Array(db);
  let acc = 0;
  for (let i = 0; i < xa.length; i++) {
    acc |= xa[i] ^ xb[i];
  }
  return acc === 0;
}
```

Por que neutraliza contenido Y longitud:
- Clave efimera por llamada (`getRandomValues(32)`) => los digests cambian
  cada request, sin valor reusable para el atacante.
- Ambos valores se pasan por HMAC-SHA256 => los dos digests siempre miden
  **32 bytes** (la longitud del input no ramifica: no hay early-return por
  `a.length !== b.length`).
- Comparacion de los 32 bytes con acumulador XOR **sin short-circuit**
  (`acc |= xa[i] ^ xb[i]`), `acc === 0` al final => tiempo constante en el
  contenido de los digests.
- `Promise.all` computa ambos HMAC en paralelo (sin ramificar por cual
  acaba antes).

### 2) Reemplazo en el bloque "Auth Bearer opcional-por-config TAREA15"
Antes:
```js
const expected = "Bearer " + env.AUTH_TOKEN;
const got = request.headers.get("authorization") || "";
if (got !== expected) { return 401 }
```
Ahora:
```js
const expected = "Bearer " + env.AUTH_TOKEN;
const got = request.headers.get("authorization") || "";
if (!(await timingSafeEqualStr(got, expected))) { return 401 }
```

El resto del bloque queda IGUAL:
- `expected = "Bearer " + env.AUTH_TOKEN`.
- 401 JSON `{"error":"unauthorized"}` con los mismos headers
  (`content-type: application/json`, `access-control-allow-origin: "*"`).
- Caso `env.AUTH_TOKEN` vacio/undefined => el `if (env && env.AUTH_TOKEN &&
  env.AUTH_TOKEN.length > 0)` salta el bloque entero (auth desactivada, modo
  dev) — sin cambios.
- `fetch` ya era async => `await` valido aqui.

## Tests nuevos (mf-gateway.mjs, patron Miniflare + AUTH_TOKEN de prueba)
6 casos (T28.a–T28.f), todos VERDE:

| Caso | Escenario | Esperado | Resultado |
|------|-----------|----------|-----------|
| T28.a | sin header Authorization | 401 | PASS (401) |
| T28.b | token incorrecto, **misma longitud** que el correcto | 401 | PASS (401) |
| T28.c | token incorrecto, **distinta longitud** | 401 | PASS (401) |
| T28.d | token correcto (happy path) | 200 | PASS (200) |
| T28.e | `"Bearer "` solo (prefijo ok, token vacio) | 401 | PASS (401) |
| T28.f | sin `env.AUTH_TOKEN` configurado | 200 (pasa sin auth) | PASS (200) |

Detalle de los casos de longitud:
- Correcto: `Bearer test-token-0123456789abcdef` (27 chars tras `Bearer `).
- T28.b misma longitud: `Bearer test-token-0123456789abcdeg` (ultimo byte
  cambiado `f`->`g`, misma longitud) -> 401. Verifica que el helper no
  ramifica por longitud ni short-circuit en el primer byte distinto.
- T28.c distinta longitud: `Bearer short` -> 401.
- T28.e: `Bearer ` (token vacio) -> 401.

Salida literal de los casos nuevos:
```
PASS T28.a: sin Authorization -> 401 (timing-safe)
PASS T28.b: sanity mismo-longitud construido bien
[T28.b] bearer mismo-longitud incorrecto -> {"error":"unauthorized"}
PASS T28.b: token incorrecto misma longitud -> 401
[T28.c] bearer distinta-longitud incorrecto -> {"error":"unauthorized"}
PASS T28.c: token incorrecto distinta longitud -> 401
PASS T28.d: token correcto -> 200 (timing-safe no rompe happy path)
[T28.e] 'Bearer ' solo -> {"error":"unauthorized"}
PASS T28.e: 'Bearer ' solo (token vacio) -> 401
PASS T28.f: sin env.AUTH_TOKEN -> pasa sin auth (200, modo dev)
```

Los tests e2e existentes (cache miss/hit, sum_numbers, server_time, origins
403, aislamiento, structuredContent, fetchOrigin POST/GET/timeout, binding,
concurrencia, interrupt, attestations T25) siguen VERDE.

## Regresion — 4 suites exit 0
- `npm test` -> `TODOS LOS CHECKS VERDE` (mf-test.mjs)
- `npm run spike` -> `TODOS LOS CHECKS VERDE` (mf-spike.mjs)
- `npm run memspike` -> `INSTANCIA 2: TODOS LOS CHECKS VERDE` (mf-memspike.mjs)
- `npm run gateway` -> `TODOS LOS CHECKS VERDE` (mf-gateway.mjs, incluye T28)

## Deploy
```
npx wrangler deploy -c wrangler-gateway.toml
Uploaded llmstxt-gateway (7.33 sec)
Deployed llmstxt-gateway triggers (1.16 sec)
https://llmstxt-gateway.rckflr.workers.dev
Version ID: 3996a076-08b1-443a-836b-b3dfbbe76f98
```

## Verificacion en produccion (3 http codes reales)
Contra `https://llmstxt-gateway.rckflr.workers.dev`, origin=demo:

| Request | HTTP code |
|---------|-----------|
| `Authorization: Bearer <correcto de .gateway-token>` -> tools/list | **200** |
| sin header Authorization -> tools/list | **401** |
| `Authorization: Bearer tokenfalso` -> tools/list | **401** |

(Token nunca impreso; leido de `.gateway-token` en la variable del curl.)

## Sanidad
`search_spec` en docs-site (origin=docs, `q:"attestation"`, `k:3`) ->
`http hits: 3 | isError: false`. La capability de memoria sigue intacta.

## Definicion de hecho
- [x] Diff conceptual (helper double-HMAC + reemplazo `!==` -> `!(await timingSafeEqualStr(...))`).
- [x] 6 tests nuevos en verde (T28.a–T28.f).
- [x] 4 suites exit 0 (test, spike, memspike, gateway).
- [x] Deploy a produccion.
- [x] 3 http codes reales: 200 correcto / 401 sin header / 401 token falso.
- [x] Solo WebCrypto (`crypto.subtle`, `crypto.getRandomValues`); sin `node:crypto`.
- [x] Token nunca en claro.