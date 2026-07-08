# TAREA37 — Identidad por cliente en el gateway (opt-in, retrocompatible)

## Qué se hizo

Identidad por cliente en `worker-gateway.mjs` vía nuevo env `CLIENTS` (string JSON desplegable como secret), con precedencia sobre `AUTH_TOKEN` y fail-closed ante config inválida. Sin `CLIENTS` el comportamiento legado queda **intacto**.

### worker-gateway.mjs

- **`parseClients(env)`** (nueva, antes de `export default`): parsea `env.CLIENTS` y devuelve `{mode, registry}`:
  - `"none"`: `CLIENTS` ausente o string vacío → comportamiento legado (`AUTH_TOKEN` o modo dev).
  - `"clients"`: JSON válido → registro `{sha256_hex: {client_id, rpm?}}` (claves normalizadas a minúsculas; entradas sin `client_id` string se descartan; `rpm` numérico finito se conserva como `Math.floor`, si no `null`). Un JSON válido pero con objeto vacío `{}` → modo `clients` con registro vacío (todo token → 401).
  - `"failclosed"`: `CLIENTS` definido pero JSON inválido (o no-objeto/array) → fail-closed.
- **Auth en POST /mcp** (precedencia):
  1. `failclosed` → 401 `{"error":"unauthorized"}` idéntico al legado, sin tocar el resto.
  2. `clients` → se extrae el Bearer (`/^Bearer\s+(.+)$/`), se computa `sha256Hex` de sus bytes UTF-8 y se hace **lookup exacto** en el registro. El lookup por hash **es** el mecanismo timing-safe: nunca se compara el token en claro contra secretos (digest fijo). Token conocido → pasa y `clientId` queda para `X-Gw-Client`; token desconocido / header ausente / malformado → 401 idéntico al legado.
  3. `else` (modo legado) → `AUTH_TOKEN` con `timingSafeEqualStr` (double-HMAC) si está definido, o modo dev si no.
  - `AUTH_TOKEN` se **ignora** cuando `CLIENTS` está en modo `clients` o `failclosed` (la rama legada sólo se evalúa cuando `mode === "none"`).
- **`X-Gw-Client: <client_id>`** en **todas** las respuestas de /mcp tras auth (200, 202, 400, 403, 500, 502). No se setea en los 401 (idénticos al legado) ni en modo legado/dev (`clientId` queda `null`). Se hilvana como 5º arg de `json()` y se agrega al `Response` 202.
- **`rpm`** se parsea y queda en el registro (`{client_id, rpm}`) pero **no se aplica** — comentado in situ: lo usará T38 (rate limiting).
- **GET /** muestra los 3 modos: por-cliente (con n° de clientes registrados), token compartido legado, o dev; y mensaje `FAIL-CLOSED` si el JSON de `CLIENTS` es inválido.

### mf-gateway.mjs (tests T37)

Bloque `[T37]` con instancia Miniflare propia (`mfT37`) que usa **siempre** los fakes de T35 (`buildOfflineFakes()` + `serviceBindings: { DEMO: t37Fakes.demo }`) → **hermética en ambos modos** (el origin DEMO se enruta al binding, sin fetch saliente; en online `gwMiniflare` no añade interceptor, pero no hace falta porque el binding cubre el origin; en offline añade el interceptor T35). Patrón `mfFake`/`attMf`. Tokens de fantasía obvios (`FAKE` en el literal).

Casos:
- **(a)** token válido → 200 y `X-Gw-Client: cliente-alfa`.
- **(a2)** `tools/list` también lleva `X-Gw-Client` (todas las respuestas de /mcp).
- **(b)** token desconocido → 401, sin `X-Gw-Client`.
- **(c)** sin header → 401.
- **(d)** `CLIENTS` + `AUTH_TOKEN` definidos a la vez, token legado presentado → 401 (precedencia: `CLIENTS` manda).
- **(e)** `CLIENTS` con JSON inválido → 401 fail-closed (incluso con token válido); GET / indica `FAIL-CLOSED`.
- **(f)** los checks existentes de `AUTH_TOKEN` legado (bloque `[f]`/T28) siguen verdes **sin tocarse**.

### wrangler-gateway.toml

Sólo un **comentario** documentando que `CLIENTS` se define como **secret** (`wrangler secret put CLIENTS`) con el formato del JSON. Ningún valor real.

## DEFINICIÓN DE HECHO — salidas reales

### 1. `npm run gateway:offline` → verde, exit 0

```
$ npm run gateway:offline > /tmp/t37_offline.log 2>&1; echo "EXIT_OFFLINE=$?"
EXIT_OFFLINE=0
```

Tramo con los PASS T37:

```
[T37] identidad por cliente (env.CLIENTS, fakes T35, hermetica):
[T37.a] token alfa -> status=200 X-Gw-Client=cliente-alfa
PASS T37.a: token valido -> HTTP 200
PASS T37.a: header X-Gw-Client === cliente-alfa
PASS T37.a2: tools/list tambien lleva X-Gw-Client (todas las respuestas de /mcp)
[T37.b] token desconocido -> status=401
PASS T37.b: token desconocido -> 401
PASS T37.b: 401 sin X-Gw-Client (identico al legado)
[T37.c] sin header -> status=401
PASS T37.c: sin Authorization -> 401
[T37.d] token legado con CLIENTS+AUTH_TOKEN -> status=401
PASS T37.d: CLIENTS manda sobre AUTH_TOKEN -> token legado da 401
[T37.e] CLIENTS JSON invalido, token valido -> status=401
PASS T37.e: CLIENTS JSON invalido -> 401 fail-closed (token valido no abre)
[T37.e] GET / fail-closed? true
PASS T37.e: GET / indica FAIL-CLOSED en su texto de estado
```

Cola:

```
TODOS LOS CHECKS VERDE
```

### 2. `npm run gateway` (online) → verde, exit 0 (no regresión)

```
$ npm run gateway > /tmp/t37_online.log 2>&1; echo "EXIT_ONLINE=$?"
EXIT_ONLINE=0
```

Cola:

```
PASS att.404: header X-Gw-Attestations = 0attested,0expired,0invalid,4unattested

TODOS LOS CHECKS VERDE
```

(La instancia T37 es hermética también en online: 9 PASS T37 sin tocar red para el origin DEMO.)

### 3. `grep -c "PASS T37"` ≥ 5

```
$ grep -c "PASS T37" /tmp/t37_offline.log
9
$ grep -c "PASS T37" /tmp/t37_online.log
9
```

9 casos nuevos (≥ 5) en ambas pasadas.

### 4. `git status --porcelain` → sólo los 4 archivos permitidos

```
$ git status --porcelain
 M mf-gateway.mjs
 M worker-gateway.mjs
 M wrangler-gateway.toml
 M TAREA37-REPORT.md
```

(`dist-gateway/` es gitignored — artefacto del build — y no aparece.)

## TRADE-OFFS

- **Lookup por hash vs. comparación tiempo-constante.** El modo por-cliente NO usa `timingSafeEqualStr`: hashea el Bearer y hace un lookup en un objeto JS (`registry[hash]`). Un hashmap lookup no es estrictamente tiempo-constante (puede ramificar por estructura interna), pero como el spec de la tarea define explícitamente que *el lookup por hash es el mecanismo timing-safe* (nunca se compara el token en claro contra secretos, y el digest es de longitud fija), se sigue esa definición. El atacante sólo observa hit/miss → 401/200, no filtra el secreto. Si se quisiera mitigar la ramificación del hashmap, habría que recorrer todo el registro con XOR de HMACs de hashes — innecesario aquí porque el secreto ya está hashed y es de longitud fija.
- **`sha256Hex` por request en modo por-cliente.** Cada POST /mcp autenticado hace un `crypto.subtle.digest` extra (≈0.01 ms). Despreciable frente al descubrimiento/QuickJS.
- **Fail-closed ante JSON inválido.** Decisión segura: un typo en el secret `CLIENTS` cierra todo POST /mcp (401) en vez de abrirlo. El costo es que un deploy con secret mal formado deja el gateway inaccesible hasta corregirlo; se surfacea en GET / (`FAIL-CLOSED`) para que el operador lo note sin inspeccionar logs.
- **`CLIENTS` vacío `{}` vs. string vacío.** String vacío/ausente → modo legado (retrocompatible). JSON `{}` válido → modo por-cliente con registro vacío → todo 401. Es fail-closed por configuración vacía, no por error; distinto de JSON inválido (ambos cierran, pero por razones distintas y con mensajes distintos en GET /).
- **`rpm` parseado pero no aplicado.** Se conserva en el registro para que T38 lo consuma sin reparsear `CLIENTS`. Comentario in situ lo aclara. No hay rate limiting todavía.
- **`X-Gw-Client` en respuestas de error post-auth.** Expone el `client_id` (no el token) en 400/403/500/502/202. Es información de observabilidad útil (atribución de errores), no sensible (el `client_id` es un nombre, no un secreto). Los 401 no lo llevan (no se sabe quién es el caller, y deben ser idénticos al legado).
- **Regex `Bearer` estricto.** `/^Bearer\s+(.+)$/` (case-sensitive, igual que el legado que compara `"Bearer " + token`). `"Bearer "` solo → no match → 401 (consistente con T28.e). No se acepta esquema en minúsculas; coherente con el comportamiento legado.