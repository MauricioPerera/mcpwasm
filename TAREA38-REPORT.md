# TAREA38 — Rate limiting por cliente con Durable Object (opt-in)

Rate limiting por cliente vía un Durable Object `RateLimiter`, **opt-in** y **sin
tocar el comportamiento por defecto**. El limiter solo se activa cuando se cumplen
las 3 condiciones; en cualquier otro caso el flujo es byte-identico al previo.

## Lo hecho

### `worker-gateway.mjs`
- **`export class RateLimiter`** (export nombrado, preservado por el build esbuild
  del entry → `var RateLimiter = class{}` + `export { RateLimiter }` en
  `dist-gateway/worker.js`). Contador de **ventana fija persistido en el storage
  del DO** (no en memoria: el DO puede evictarse y re-crearse; el storage sobrevive).
  - Protocolo interno: `POST /check` con body `{rpm}` → JSON
    `{allowed, limit, remaining, reset_epoch_ms}`.
  - Ventana: `env.RATE_WINDOW_MS` (default `60000`; configurable **solo** para
    testear el reset sin esperar 60s).
  - Semántica ventana fija con precheck: `allowed iff count_previo < rpm`; el
    contador **solo** se incrementa si la request es admitida (las rechazadas no
    consumen cuota). `remaining = rpm - count_previo` → la secuencia de responses
    admitidos muestra `rpm, rpm-1, …, 1` y el primer rechazo muestra `0`.
  - Storage key `rl` = `{windowStart, count}`; si la ventana expiró se reinicia.
- **Activación en `POST /mcp`**, DESPUÉS de la auth por-cliente de T37, **solo** si
  se cumplen las 3: `mode === "clients"` + `rpm` del cliente no-null + binding
  `env.RATE_LIMITER` presente. En cualquier otro caso (modo legado, modo dev,
  cliente sin rpm, binding ausente) **no se llama al DO** y `rl = null` → el helper
  `json()` no añade headers → flujo intacto.
  - DO id por nombre = `client_id` (`env.RATE_LIMITER.idFromName(clientId)`):
  storage aislado por cliente.
  - **Dentro de cuota**: la respuesta lleva `X-Gw-RateLimit-Limit` / `-Remaining` /
    `-Reset` (epoch segundos), enhebrados en `json()` y el path 202.
  - **Cuota excedida**: `429` JSON `{"error":"rate_limited"}` + `Retry-After`
    (segundos hasta la ventana nueva) + los mismos headers con `Remaining: 0` +
    `X-Gw-Client` (post-auth).
  - **DO lanza error con el limiter activo**: `500` JSON
    `{"error":"rate_limiter_unavailable"}` + `X-Gw-Client` (**fail-closed
    observable**).
- **Captura de `rpm`** en el auth de T37 (`clientRpm = entry.rpm` cuando es número,
  si no `null`) — no debilita ni saltea los checks T37.
- **`GET /`** menciona el estado del rate limiting (ACTIVADO/INACTIVO según
  `env.RATE_LIMITER`).

### `wrangler-gateway.toml`
- `[[durable_objects.bindings]]` `name = "RATE_LIMITER"`, `class_name = "RateLimiter"`.
- `[[migrations]]` tag `"v1"` con `new_sqlite_classes = ["RateLimiter"]`
  (SQLite-backed → funciona en todos los planes, no solo Workers Paid).
- Comentario breve explicando el opt-in. **No se despliega nada**: el binding no
  existe en producción y el modo online no lo usa.

### `mf-gateway.mjs` (tests T38, en instancia propia hermética)
- `gwMiniflare` acepta `durableObjects` opcional (solo lo piden las instancias
  T38; sin él, opts byte-identicos a hoy → default intacto, checks T37 sin binding
  siguen verdes sin tocarlos).
- Instancia T38 con `durableObjects: { RATE_LIMITER: "RateLimiter" }`,
  `env.CLIENTS` (cliente `rpm=3` + cliente sin rpm), `RATE_WINDOW_MS=1500` y fake
  DEMO (hermético, sin red). Alinea el inicio al borde de ventana fresca para
  evitar flakiness por straddle. Casos:
  - **(a)** rpm=3 → 3 OK con `Remaining` `3→2→1` y 4to → `429` con `Retry-After` y
    `Remaining: 0` (+ `X-Gw-Client` post-auth).
  - **(b)** tras esperar la ventana corta (1500ms+250), reset: vuelve a pasar
    (`200`, `Remaining=3`).
  - **(c)** cliente sin rpm en el mismo registro → 5 requests `200`, nunca `429`,
    sin headers de rate limit (DO no invocado).
  - **(d)** modo clients con rpm pero **sin binding** `RATE_LIMITER` → 5 requests
    `200`, sin headers (opt-in por binding) + `GET /` indica INACTIVO.
  - **(e)** modo legado `AUTH_TOKEN` → `200` sin headers de rate limit ni
    `X-Gw-Client`.

## Viabilidad verificada antes de construir
- Miniflare `4.20260630.0`: `durableObjects: Record<string, string | {className,
  useSQLite, …}>` (forma string = className, resuelto contra los exports del entry
  del worker) → **soporta correr el DO del propio worker**. Forma usada en tests:
  `{ RATE_LIMITER: "RateLimiter" }`.
- Build esbuild (`format: "esm"`, entry `worker-gateway.mjs`) preserva exports
  nombrados del entry → `export class RateLimiter` sobrevive en
  `dist-gateway/worker.js` como `export { RateLimiter }`.
- No se tocó `README.md` → no hay que regenerar `mem-docs.snapshot`/sha ni correr
  memspike (regla de memoria respetada).

## DEFINICIÓN DE HECHO — salidas reales

### 1. `npm run gateway:offline` → verde, exit 0, con `>=6` "PASS T38"

```
$ npm run gateway:offline
> build-gateway OK -> dist-gateway/worker.js + quickjs-asyncify.wasm + minimemory_bg.wasm
...
$ echo $?
0
```

Tramo T38 (24 "PASS T38"):
```
[T38] rate limiting por cliente (Durable Object, hermetico):
[T38.a] rem seq: 3 2 1 | r4 status=429 rem=0 retry-after=2
PASS T38.a: 3 requests OK (200) dentro de cuota
PASS T38.a: 1er OK Remaining=3
PASS T38.a: 2do OK Remaining=2
PASS T38.a: 3er OK Remaining=1
PASS T38.a: header Limit=3
PASS T38.a: header Reset presente (epoch seg)
PASS T38.a: X-Gw-Client en respuesta OK
PASS T38.a: 4to request -> 429
PASS T38.a: 429 body {"error":"rate_limited"}
PASS T38.a: 429 Remaining=0
PASS T38.a: 429 lleva Retry-After
PASS T38.a: Retry-After >= 1 seg
PASS T38.a: 429 lleva X-Gw-Client (post-auth)
[T38.b] tras ventana: status=200 remaining=3
PASS T38.b: tras ventana -> 200 (reset, vuelve a pasar)
PASS T38.b: reset -> Remaining=3 (contador reiniciado)
[T38.c] cliente sin rpm: 5x 200? true sin rate hdr? true
PASS T38.c: cliente sin rpm -> 5 requests 200 (sin limitar)
PASS T38.c: cliente sin rpm -> nunca 429
PASS T38.c: cliente sin rpm -> sin headers de rate limit (DO no invocado)
[T38.d] sin binding: 5x 200? true sin rate hdr? true
PASS T38.d: sin binding RATE_LIMITER -> 5 requests 200 (limiter inactivo, opt-in por binding)
PASS T38.d: sin binding -> sin headers de rate limit (DO no invocado)
PASS T38.d: GET / indica Rate limiting INACTIVO (binding ausente)
[T38.e] modo legado: status=200 rate rem hdr? undefined
PASS T38.e: modo legado AUTH_TOKEN -> 200
PASS T38.e: modo legado -> sin headers de rate limit (limiter inactivo)
PASS T38.e: modo legado -> sin X-Gw-Client (no modo por-cliente)
...
TODOS LOS CHECKS VERDE
```
Exit code: `0` (verificado con `echo $?` tras la corrida, sin pipes). Verde en 3
corridas consecutivas (24 PASS T38 cada una).

### 2. `npm run gateway` (online) → verde, exit 0 (no regresión)

```
$ npm run gateway
...
TODOS LOS CHECKS VERDE
$ echo $?
0
```
En producción el binding `RATE_LIMITER` aún no existe y el modo online no lo usa;
los tests T38 son herméticos (fake DEMO) y pasan en ambos modos. Sin regresión: los
checks T37 (sin binding) siguen verdes intactos.

### 3. `git status --porcelain` → SOLO los 4 archivos permitidos

```
$ git status --porcelain
 M mf-gateway.mjs
 M worker-gateway.mjs
 M wrangler-gateway.toml
?? TAREA38-REPORT.md
```
(`dist-gateway/` no está trackeado → el build artifact no cuenta.) Los 4
permitidos: `worker-gateway.mjs`, `mf-gateway.mjs`, `wrangler-gateway.toml`,
`TAREA38-REPORT.md`.

## TRADE-OFFS

- **Fail-closed vs fail-open del DO**: si el DO lanza error con el limiter activo,
  el gateway responde `500 {"error":"rate_limiter_unavailable"}` (**fail-closed
  observable**) en vez de dejar pasar la request (fail-open). Decisión: un rate
  limiter que falla abierto es peor que no tenerlo — abre la puerta a abuso exacto
  cuando el componente de protección falla (el momento en que más se lo necesita).
  El trade-off es disponibilidad: una incidencia del DO (o del runtime de DOs)
  degrada `POST /mcp` a 500 para los clientes con `rpm` mientras dure. Es
  **observable** (código/body propios, distinguible de un 500 del host) para que
  ops lo detecte y no se confunda con un fallo del gateway. El modo legado/dev y
  los clientes sin `rpm` son ajenos al DO → no se ven afectados.
- **Ventana fija vs sliding window**: ventana fija (alinea a `floor(now/windowMs)`):
  barata (un contador por ventana en storage), pero permite ráfagas de hasta `2×rpm`
  en el borde (una ventana termina y la siguiente empieza: `rpm` al final + `rpm` al
  inicio). Sliding window (log/ventana por request o token bucket) suaviza los
  bordes pero cuesta más estado y I/O al DO por request. Decisión: ventana fija por
  simplicidad y bajo costo de storage; `rpm` ya es un techo por minuto aproximado,
  y los bordes son aceptables para el caso de uso. `RATE_WINDOW_MS` es configurable
  solo para testear el reset sin esperar 60s.
- **DO id por `client_id`**: una instancia de DO (y su storage) por `client_id` vía
  `idFromName(clientId)`. Aislamiento natural entre clientes (un cliente no puede
  consumir la cuota de otro) y el conteo sobrevive a evicción del DO (storage
  persistido). Trade-off: el número de DOs escala con el número de clientes
  (potencialmente muchos objetos con estado pequeño); las ventanas inactivas
  conservan su último `{windowStart, count}` en storage hasta la próxima request
  (no se purgan, pero es un registro mínimo). Usar el `client_id` (no el hash del
  token) como nombre hace el id estable y legible, y desacopla rotación de tokens
  del conteo (mismo `client_id` aunque cambie el token del cliente).