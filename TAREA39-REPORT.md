# TAREA39 — README al día con T37/T38

Actualiza README.md (INGLES, tono sobrio/honesto del README) con la identidad por
cliente (T37) y el rate limiting per-cliente (T38), neutraliza un comentario de
deploy en `wrangler-gateway.toml`, y regenera el snapshot. Sin tocar
`worker-gateway.mjs`, `mf-gateway.mjs`, ni `.github/`. Sin commit/push/deploy.

## Verificación contra el código real (abort-si-contradiccion)

Antes de escribir, grep en `worker-gateway.mjs` confirmó cada afirmación:

- Tres modos de auth por precedencia `CLIENTS` > `AUTH_TOKEN` legado > dev:
  `parseClients` (L723–745) devuelve `none|clients|failclosed`; el fetch handler
  (L905–953) aplica la precedencia y el 401 fail-closed ante JSON invalido.
- Lookup por hash sha256 del token (no token en claro): `sha256Hex(m[1])` + lookup
  exacto en el registro (L933–934); el comentario L908 declara ese lookup como el
  mecanismo timing-safe.
- `X-Gw-Client` en todas las respuestas de `/mcp` post-auth: `json()` L668.
- Rate limiting opt-in (3 condiciones): `rateLimiterActive` (L963–967) =
  `mode==="clients"` + `clientRpm` número + binding `env.RATE_LIMITER`.
- Ventana fija 60s persistida en storage SQLite del DO, una instancia por
  `client_id` (`idFromName`), `remaining = rpm - count_previo` => la secuencia
  admitida muestra `rpm, rpm-1, … 1` (incluye la request actual): `RateLimiter`
  L796–854, comentario L790–795.
- 429 con `Retry-After` y `Remaining: 0` al exceder (L982–997); headers
  `X-Gw-RateLimit-Limit/-Remaining/-Reset` dentro de cuota (L672–676).
- Fail-closed observable `500 rate_limiter_unavailable` si el DO falla con el
  limiter activo (L971–981).
- 2× rpm en el borde de ventana: consecuencia directa de ventana fija
  (`windowStart = floor(now/windowMs)*windowMs`, L825) — una ventana llena al
  final + la siguiente al inicio => burst de hasta `2 × rpm` cabalgando el borde.
  No hay suavizado ni ventana deslizante en el código, así que la afirmación es
  honesta.

Sin contradicciones → procedí.

## Cambios

### README.md — `## Security model (honest)`
Reemplazado el bullet obsoleto ("single shared bearer token … still no per-client
identity or rate limiting") por una descripcion de los **tres modos de auth**:
per-client (`CLIENTS` secret, claves sha256 del token, lookup por hash como
mecanismo timing-safe, fail-closed ante JSON invalido), legacy shared `AUTH_TOKEN`
(constant-time), y dev abierto. Sub-bullet dedicado al **rate limiting per-cliente
opt-in** via Durable Object: ventana fija 60s en storage SQLite, una instancia DO
por `client_id`, headers `X-Gw-RateLimit-*` dentro de cuota (`Remaining` cuenta
incluyendo la request actual), `429` + `Retry-After` al exceder. Edges honestos
declarados explicitamente: burst de hasta `2 × rpm` en el cambio de ventana, y
limiter por request no por costo (no acota payload/CPU/complejidad). Fail-closed
observable `500 rate_limiter_unavailable` si el DO falla. Sin binding o sin `rpm`
=> limiter inactivo, flujo byte-identico al previo.

### README.md — Quick start (`### Try the deployed gateway (curl)`)
Nota breve: el gateway desplegado puede correr en modo per-client (`CLIENTS`
secret); cada cliente envia su propio `Authorization: Bearer <client_token>` con
la misma sintaxis curl; la respuesta lleva `X-Gw-Client: <client_id>`. Sin
inventar valores.

### README.md — `## Repository layout`, fila `wrangler-gateway.toml`
Agregado `CLIENTS` (secret, no en el archivo) junto a `AUTH_TOKEN`, y el binding
Durable Object `RATE_LIMITER` (clase `RateLimiter`, migracion `v1` con
`new_sqlite_classes`) que se despliega con el worker; el limiter queda inactivo
hasta que exista un `CLIENTS` con `rpm`.

### wrangler-gateway.toml — comentario T38
Reemplazada UNICAMENTE la frase `NO desplegar todavia: el binding no existe en
produccion y el modo online no lo usa (...)` por una neutra: el binding se
despliega con el worker; el limiter sigue inactivo hasta que exista un `CLIENTS`
con `rpm`. Resto del comentario intacto.

### Snapshot
`node build-memsnapshot.mjs` corrido tras editar — **byte-identico**: mismas
8551 bytes, mismo sha256
`7dddeb8992ccda24e91f6f6b8e4c59fae88d0435ec41b438fdff0b4e7c82fd34` (las secciones
tocadas —Security model, Quick start, Repository layout— quedan fuera del
chunker del snapshot, como ya se verifico en T36). `mem-docs.snapshot` y
`mem-snapshot-sha.json` sin cambios (no aparecen en `git status`).

## Definición de hecho (salidas REALES, exit codes con `$?`, sin pipes)

### 1. Frase obsoleta eliminada
```
$ grep -n "still no per-client identity or rate limiting" README.md || echo ELIMINADO
ELIMINADO
```

### 2. Hits de CLIENTS / RateLimiter / RATE_LIMITER y de 429 / Retry-After
```
$ grep -in "CLIENTS\|RateLimiter\|RATE_LIMITER" README.md
29:MCP clients (Claude, Cursor, others) can call arbitrary tools. Running a
285:`CLIENTS` secret), in which case each client sends its own
384:  - *Per-client (`CLIENTS` secret, opt-in).* `CLIENTS` is a JSON secret mapping
392:    header yields `401`. `AUTH_TOKEN` is ignored in this mode. If `CLIENTS` is
395:  - *Legacy shared token (`AUTH_TOKEN` secret).* If `CLIENTS` is unset, the
401:    `RATE_LIMITER` Durable Object binding is present, each `POST /mcp` is
413:    `500 rate_limiter_unavailable` rather than letting the request through
453:| `wrangler-gateway.toml` | ... `AUTH_TOKEN` and `CLIENTS` are set as secrets ...
        Durable Object binding `RATE_LIMITER` (class `RateLimiter`, migration `v1` ...) ...
```
Hits en Security model (L384–413) y Repository layout (L453). ✓
```
$ grep -in "429\|Retry-After" README.md
407:    `429` with `Retry-After` and `Remaining: 0`. Honest edges: a fixed window
```
Hit. ✓

### 3. Comentario "NO desplegar todavia" eliminado del toml
```
$ grep -n "NO desplegar todavia" wrangler-gateway.toml || echo ELIMINADO
ELIMINADO
```

### 4. Snapshot regenerado tras editar + memspike
```
$ node build-memsnapshot.mjs ; echo $?
conceptos: 20, chunks insertados: 20, idx.len: 20
probe 'sandbox capability quickjs' hits: 4 mcpwasm — Static MCP
snapshot: mem-docs.snapshot (8551 bytes)
sha256:   7dddeb8992ccda24e91f6f6b8e4c59fae88d0435ec41b438fdff0b4e7c82fd34
meta:     mem-snapshot-sha.json
0
$ npm run memspike ; echo $?
... (snapshot rebuild idem + build-memspike + mf-memspike)
PASS 6a / 6b / 6c / 6d ...
INSTANCIA 1: TODOS LOS CHECKS VERDE
INSTANCIA 2: TODOS LOS CHECKS VERDE
0
```
exit 0. ✓

### 5. gateway:offline (sanity, nada mio lo toca)
```
$ npm run gateway:offline ; echo $?
... build-gateway + mf-gateway --offline
... (T37 y T38 verdes: X-Gw-Client, fail-closed, 429+Retry-After, reset de ventana,
     cliente sin rpm, sin binding, modo legado sin headers)
TODOS LOS CHECKS VERDE
0
```
exit 0. ✓

### 6. Cero español en README (suites verdes / despliegue / ventana)
```
$ grep -n "suites verdes\|despliegue\|ventana" README.md || echo SIN_MENCIONES
SIN_MENCIONES
```
✓

### 7. git status — solo archivos permitidos
```
$ git status --porcelain
 M README.md
 M wrangler-gateway.toml
```
+ `TAREA39-REPORT.md` (nuevo, este archivo). Los snapshot (`mem-docs.snapshot`,
`mem-snapshot-sha.json`) no aparecen: byte-identicos, sin cambios. ✓
Total: 3 archivos (README.md, wrangler-gateway.toml, TAREA39-REPORT.md), dentro
de los 5 permitidos.

## Trade-offs
- El snapshot quedo byte-identico (las secciones editadas son fuera del chunker),
asi que `mem-docs.snapshot` / `mem-snapshot-sha.json` no se modificaron. Es lo
esperado y lo deje asi (no forcé cambios artificiales).
- En "What it does NOT guarantee" no agregué un bullet nuevo: la aclaracion
"limiter por request, no por costo (no acota payload/CPU/complejidad)" la
incorporé dentro del sub-bullet de rate limiting del bullet de auth reescrito,
donde ya vive la descripcion del limiter. Evita duplicar la misma idea en dos
sitios.