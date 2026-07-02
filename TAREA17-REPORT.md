# TAREA17 — Conformidad review upstream (executable-skills v0.3)

Dos ajustes de conformidad pedidos por el review de la spec, sobre `host-async.mjs`
(AsyncToolHost) + tests + redeploy del gateway.

## Cambios (solo `host-async.mjs` y `mf-gateway.mjs`)

### 1. BODY con GET debe lanzar
En la capability `__fetchOriginRaw` (dentro del sandbox, mismo patron que los throws
de method/body): despues de validar `body` (string <=16KB) y de resolver `method`,
si `method === "GET"` y `body !== undefined` (opts.body presente, no undefined/null)
-> `throw new Error("body no permitido con GET")`. Se hace tras la validacion de body
para que un body invalido (no string / >16KB) siga lanzando su mensaje especifico.

### 2. Timeout wall-clock en fetchOrigin
Opcion `fetchTimeoutMs` del `AsyncToolHost` (default `10000`, constante
`DEFAULT_FETCH_TIMEOUT_MS`). El gas determinista (interruptMaxInvocations) acota CPU
pero no esperas de red: un origin lento colgaria la invocacion aunque el handler no
consuma invocaciones del interrupt (asyncify suspende la pila durante el `await`).

Doble mecanismo en el fetch de la capability:
- `fetchOpts.signal = AbortSignal.timeout(fetchTimeoutMs)`: un fetch bien comportado
  (global undici / workerd) aborta la conexion al vencer.
- `Promise.race` contra un timer de backstop (`setTimeout`) que garantiza el corte
  aun si el fetchImpl ignora el signal (p.ej. un service binding que descarta signal,
  ver rama binding de `makeFetchImpl` en `worker-gateway.mjs`) o si nunca resuelve.

Al disparar (signal abort o backstop) se lanza `"fetchOrigin timeout"` DENTRO del
sandbox -> la excepcion sube por asyncify -> `__dispatch` rechaza -> `callTool` lanza
-> el nucleo MCP lo envuelve como `isError:true` (NO crash del gateway).

**Verificacion de `AbortSignal.timeout` en workerd**: API Web estandar disponible en
workerd desde 2023, sin flag, soportada con `compatibility_date = "2026-06-01"` (la
del gateway). Confirmado ademas localmente (`typeof AbortSignal.timeout === "function"`).
El backstop `Promise.race` existe precisamente porque el signal solo aborta si el
fetchImpl lo observa: la rama binding del gateway descarta el signal, y el test usa
un fake que nunca resuelve, asi que el backstop es quien garantiza el corte.

**Compat**: el spike no pasa `fetchTimeoutMs` -> default 10000 -> sus fetches son
rapidos -> no timeout -> `npm run spike` sigue verde.

## Tests nuevos (bloque `[g]` en `mf-gateway.mjs`)
Reusa el modulo asyncify compartido y el patron de `fetchImpl` fake inyectado.

- `(g.a)` GET con body -> `throw "body no permitido con GET"` dentro del sandbox.
- `(g.b)` POST con body sigue funcionando (regresion: el guard GET+body no rompe POST).
- `(g.c)` timeout: `fetchImpl` fake que **nunca resuelve** + `fetchTimeoutMs: 200` ->
  error `"fetchOrigin timeout"` acotado (no cuelga); medido `elapsed=204ms`.

Salida real del bloque `[g]`:
```
[g] conformidad TAREA17 (GET+body throw, POST ok, timeout):
PASS GET+body: throw 'body no permitido con GET' dentro del sandbox
PASS POST+body: sigue funcionando (no afectado por el guard GET+body)
[g.c] timeout GET -> threw=true elapsed=204ms
PASS timeout: fake nunca-resuelve -> error 'fetchOrigin timeout'
PASS timeout: acotado (entre ~200ms y 5s, no cuelga)
```

## Regresion — 3 suites exit 0

### `npm test`
```
build OK -> dist/worker.js + dist/quickjs.wasm
initialize   -> {..."protocolVersion":"2025-06-18"...}
tools/list   -> {..."tools":[{"name":"create_payment",...},{"name":"refund_payment",...}]}
create_pay   -> {..."structuredContent":{"ok":true,"paymentId":"pay_1001","status":"succeeded"},"isError":false}
```
Exit 0 (sin checks rojos; mf-test no usa `check`/`failures`, termina normal).

### `npm run spike`
```
build-spike OK -> dist-spike/worker.js + dist-spike/quickjs-asyncify.wasm
fetch_home -> {..."structuredContent":{"status":200,"firstLine":"toolhost-mcp server"},"isError":false}
PASS fetch_home: HTTP 200
PASS fetch_home: structuredContent.status==200
PASS fetch_home: firstLine no vacia
PASS fetch_home: isError==false
fetch_evil  -> {..."isError":true}
PASS fetch_evil: isError==true
PASS fetch_evil: mensaje contiene "origin"
TODOS LOS CHECKS VERDE
```
Exit 0.

### `npm run gateway`
Todas las suites verdes: initialize/tools/list/sum_numbers/server_time, origin 403,
sin-origin 403, aislamiento [a], structuredContent [c], capability POST [d],
**conformidad TAREA17 [g]**, reenvio init binding [e], auth Bearer [f], interrupt
determinista [b] (busy_loop corto en 1021ms, count=20001).
```
TODOS LOS CHECKS VERDE
```
Exit 0.

## Deploy gateway
```
npx wrangler deploy -c wrangler-gateway.toml
Uploaded llmstxt-gateway (18.09 sec)
Deployed llmstxt-gateway triggers (4.63 sec)
  https://llmstxt-gateway.rckflr.workers.dev
Current Version ID: 1a133db3-fb73-4422-b0bf-96fd9c19fc1c
```
Bindings: env.DEMO, env.BOOKSTORE, env.ALLOWED_ORIGINS.

## Verificacion en produccion (Bearer de `.gateway-token`, redactado)

Comando (token via variable de entorno, nunca inline):
```
TOKEN=$(cat .gateway-token)
ORIGIN="https://llmstxt-bookstore.rckflr.workers.dev"
ENC=$(node -e "process.stdout.write(encodeURIComponent('$ORIGIN'))")
curl -s -X POST "https://llmstxt-gateway.rckflr.workers.dev/mcp?origin=$ENC" \
  -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '<payload>'
```

### `get_book {id:1}` (GET sigue ok)
```json
{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"{\"id\":1,\"title\":\"Dune\",\"author\":\"Frank Herbert\",\"genre\":\"science-fiction\",\"price\":18.5,\"stock\":9}"}],"structuredContent":{"id":1,"title":"Dune","author":"Frank Herbert","genre":"science-fiction","price":18.5,"stock":9},"isError":false}}
```
GET ok: 200, `isError:false`, `structuredContent` con el libro (stock 9).

### `create_order {book_id:1, qty:1}` (POST sigue ok)
```json
{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"{\"ok\":true,\"order_id\":3,\"book_id\":1,\"qty\":1,\"remaining_stock\":8}"}],"structuredContent":{"ok":true,"order_id":3,"book_id":1,"qty":1,"remaining_stock":8},"isError":false}}
```
POST ok: 200, `isError:false`.
- **order_id**: 3
- **remaining_stock**: 8

## Definicion de hecho
- [x] Tests nuevos en verde (bloque `[g]`, salida real arriba).
- [x] `npm test`, `npm run spike`, `npm run gateway` exit 0.
- [x] `npx wrangler deploy -c wrangler-gateway.toml` exit 0 (Version ID 1a133db3).
- [x] 2 curls de produccion: get_book (GET) y create_order (POST) ok, con order_id y
      remaining_stock anotados. Token no aparece completo en el report.

## Archivos tocados
- `host-async.mjs` (constante `DEFAULT_FETCH_TIMEOUT_MS`, opcion `fetchTimeoutMs` en
  constructor, guard GET+body, timeout AbortSignal.timeout + Promise.race en la
  capability).
- `mf-gateway.mjs` (bloque de tests `[g]`).

No se tocaron: `worker-gateway.mjs`, `mcp-core*.mjs`, `bookstore/**`, `demo-site/**`,
`README.md`, `wrangler-gateway.toml`. No se hicieron commits git.