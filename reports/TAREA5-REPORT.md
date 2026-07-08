# TAREA5 — Spike de viabilidad: handler async + capability `host.fetchOrigin` restringida por origin

## Veredicto

**LISTO.** El spike demuestra end-to-end en workerd (vía Miniflare v4) que una tool
sandboxeada en QuickJS-wasm puede tener handler **async** con `await` y llamar a una
capability **async** `host.fetchOrigin(path)` inyectada por el host que hace `fetch`
HTTP real **restringido a un único origin permitido**, y que un intento de salirse de
ese origin es **rechazado con error visible dentro del sandbox**.

`npm run spike` exit 0 **dos veces seguidas**; `npm test` (suite existente) exit 0 —
sin regresión.

---

## Ruta técnica elegida y por qué

**ASYNCIFY** (paquete `@jitl/quickjs-wasmfile-release-asyncify` +
`newQuickJSAsyncWASMModuleFromVariant` + `vm.newFunction` con callback async +
`vm.evalCodeAsync`).

Por qué:

- El objetivo exige **dos cosas async a la vez**: (a) el handler de la tool es `async`
  con `await` dentro del sandbox; (b) la capability `host.fetchOrigin` hace un `fetch`
  real (async) del host. Asyncify es el único mecanismo de quickjs-emscripten que
  permite que código QuickJS **se vea sincrónico** mientras espera una función async
  del host (suspende/reanuda la pila wasm vía Emscripten Asyncify). Eso deja al autor de
  la tool escribir `await host.fetchOrigin("/")` con ergonomía natural, sin manejar
  promesas QuickJS a mano.
- La alternativa **promesas + `executePendingJobs`** (sin asyncify) obligaría al autor de
  la tool a lidiar con promesas QuickJS manuales (deferred, `executePendingJobs`,
  `getPromiseState`) o a reescribir el dispatcher para bombear jobs; descartada para
  conservar la ergonomía `await` pedida. (Nota: igual usamos `getPromiseState` +
  `executePendingJobs` en el **host** para desenrollar la promesa top-level que
  devuelve `__dispatch` — ver abajo —, pero eso es invisible para la tool.)

### Hallazgo clave (no obvio, verificado antes de construir)

`vm.evalCodeAsync("__dispatch(...)")` **NO** awaita automáticamente la promesa
top-level devuelta por una expresión que sea una función `async`. Devuelve el **handle
de la Promise QuickJS** (pendiente o resuelta), no el valor resuelto. Esto se verificó
con un probe aislado en Node antes de construir el spike (patrón: capability asyncified
`__capRaw` con `setTimeout` + handler `async` con `await`):

- `evalCodeAsync` → `{ value: <Promise handle> }`.
- Receta para desenrollar (sincrono, sin jobs extra si ya está settled; con bombeo si no):
  `vm.getPromiseState(handle)` → si `type === "pending"`, `vm.runtime.executePendingJobs(1)`
  + ceder al event loop (`await new Promise(r => setTimeout(r, 0))`) para que asyncify
  reanude la pila wasm cuando el `fetch` del host resuelva; repetir hasta `fulfilled`/
  `rejected`. El campo del estado es `.type` (`"fulfilled" | "pending" | "rejected"`),
  **no** `.state` como dice el `.d.ts` (el `.d.ts` y la implementación disienten; ganó la
  implementación).

`AsyncToolHost.callTool` implementa esa receta. El rechazo de la capability
(`throw new Error("origin no permitido: ...")` dentro del callback async) se propaga
como rechazo de la Promise QuickJS → `getPromiseState` → `type === "rejected"` →
`vm.dump(state.error).message` → `throw` del host → MCP lo reporta como
`isError: true` con el mensaje.

### Por qué `vm.newFunction` y no `vm.newAsyncifiedFunction`

En quickjs-emscripten 0.32, `newAsyncifiedFunction` es un alias de `newFunction`
(`return this.newFunction(name, fn)`). El comportamiento asyncify lo da el runtime de
callbacks (`handleAsyncify`/`handleSleep`), no el nombre del método. Se usó
`vm.newFunction("__fetchOriginRaw", async (pathH) => {...})` con cuerpo async; bajo
asyncify, llamarlo desde QuickJS se ve sincrónico.

---

## Restricción de origin

`host.fetchOrigin(path)` (puente `__fetchOriginRaw` asyncified en `host-async.mjs`):

- Si `path` es URL absoluta → `new URL(path)`.
- Si `path` es relativo → `new URL(path, allowedOrigin)`.
- Si `url.origin !== allowedOrigin` → `throw new Error("origin no permitido: " + url.origin)`.
- Si coincide → `fetch(url.href)`, `text()`, body truncado a 4 KB, devuelve
  `{ status, body }` como string JSON.

`allowedOrigin = "https://toolhost-mcp.rckflr.workers.dev"` (nuestro Worker desplegado,
estable — responde `200` con texto `toolhost-mcp server...` en `GET /`).

`fetch_evil` llama `host.fetchOrigin("https://example.com/")` → el host valida el origin
dentro del callback asyncified, lanza `"origin no permitido: https://example.com"`, y el
error se propaga **dentro del sandbox** (rechazo de la Promise de `__dispatch`), llegado
al cliente MCP como `isError: true`.

---

## Tamaños resultantes

| Artefacto | Bytes | Nota |
|---|---|---|
| `dist-spike/quickjs-asyncify.wasm` | 1.027.523 (~1,0 MB) | wasm asyncify (vs 503.134 del sync) |
| `dist-spike/worker.js` | 110.472 (~108 KB) | bundle spike (esbuild, `conditions=["workerd"]`) |
| `dist/quickjs.wasm` (existente, sync) | 503.134 (~0,5 MB) | sin cambios |
| `dist/worker.js` (existente) | 439.804 (~430 KB) | sin cambios |

El wasm asyncify duplica el tamaño del sync (~1 MB), dentro del rango aceptado para el
spike. El bundle del spike es menor que el productivo porque el entry es más chico (sin
`internal-logic.mjs` ni `tools-inline.mjs`).

## Miniflare y fetch saliente

Miniflare v4 **permite `fetch` saliente real por defecto** (vía undici). No hizo falta
ningún flag ni opción extra. El `fetch` desde el worker bajo Miniflare a
`https://toolhost-mcp.rckflr.workers.dev/` llegó a la red y trajo datos reales (status
`200`, `firstLine: "toolhost-mcp server"`).

---

## Limitaciones y trade-offs

1. **Una acción async a la vez por módulo wasm.** Asyncify impone que solo haya una
   suspensión async simultánea por `QuickJSAsyncWASMModule`. Para concurrencia real
   (varias tools en vuelo a la vez) haría falta un módulo wasm por request/conexión, o
   serializar. El spike construye el módulo perezosamente y lo cachea (un solo contexto
   por request, disposed al final). Aceptable para el spike; problema para producto a
   escala.
2. **`evalCodeAsync` no awaita la promesa top-level.** Hay que desenrollar
   manualmente con `getPromiseState` + `executePendingJobs` + yield al event loop (ver
   receta arriba). Es frágil pero determinista.
3. **Discrepancia `.d.ts` vs implementación.** `JSPromiseState` se tipa con `.state` en
   los `.d.ts` pero la implementación usa `.type`. Se codificó contra la
   implementación (`.type`). Si la librería corrige el tipo en una versión futura, hay
   que revisar.
4. **Tamaño del wasm asyncify.** ~1 MB vs ~0,5 MB del sync. OK para spike; importante si
   se llevase a producto (Cold start, ancho de banda).
5. **Validación de origin en el host, no en el sandbox.** La restricción la hace el
   callback `__fetchOriginRaw` (código del host), no JS del sandbox. El sandbox solo ve
   `host.fetchOrigin` sincrónico que lanza si el origin no cuadra. Esto es lo correcto:
   la tool no puede bypassar la validación porque no tiene acceso directo a `fetch`.
6. **`setTimeout` para ceder al event loop.** `callTool` usa
   `await new Promise(r => setTimeout(r, 0))` para que el event loop de workerd bombee
   la resolución del `fetch` y asyncify reanude la pila. `setTimeout` está disponible en
   workerd (estándar, sin `nodejs_compat` estrictamente necesario, pero el spike lo
   hereda del `compatibilityFlags`).
7. **`getPromiseState` sobre un no-promise** devuelve `{type:"fulfilled", value:handle,
   notAPromise:true}`. No relevante aquí (siempre es una promesa), pero documentado por
   si se reutiliza.

## Archivos creados / modificados

- **Nuevos:** `host-async.mjs`, `worker-spike.mjs`, `build-spike.mjs`, `mf-spike.mjs`,
  `mcp-core-async.mjs`, `dist-spike/` (gitignored), `TAREA5-REPORT.md`.
- **Modificados (solo dependencia nueva + script + ignore):** `package.json` (script
  `spike` + dep `@jitl/quickjs-wasmfile-release-asyncify`), `package-lock.json` (sync de
  la dep), `.gitignore` (`dist-spike/`, `quickjs-asyncify.wasm`).
- **No tocados:** `host.mjs`, `worker.mjs`, `mcp-core.mjs`, `internal-logic.mjs`,
  `tools-inline.mjs`, `shim.mjs`, `build.mjs`, `mf-test.mjs`, `wrangler.toml`, `dist/`.
  `shim.mjs` se **importa** desde `worker-spike.mjs` (sin modificarlo) por paridad con
  `worker.mjs`.

---

## Salidas reales

### `npm run spike` — corrida 1 (EXIT=0)

```
> toolhost-mcp@0.1.0 spike
> node build-spike.mjs && node mf-spike.mjs


  dist-spike\worker.js  107.9kb

Done in 13ms
build-spike OK -> dist-spike/worker.js + dist-spike/quickjs-asyncify.wasm

list -> {"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"fetch_home","description":"Hace fetch al origin permitido y devuelve status + primera linea","inputSchema":{"type":"object"}},{"name":"fetch_evil","description":"Intenta fetch a un origin NO permitido; debe fallar dentro del sandbox","inputSchema":{"type":"object"}}]}}
fetch_home -> {"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"{\"status\":200,\"firstLine\":\"toolhost-mcp server\"}"}],"structuredContent":{"status":200,"firstLine":"toolhost-mcp server"},"isError":false}}
PASS fetch_home: HTTP 200
PASS fetch_home: structuredContent.status==200
PASS fetch_home: firstLine no vacia
PASS fetch_home: isError==false
fetch_evil  -> {"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"Error en la tool: origin no permitido: https://example.com"}],"isError":true}}
PASS fetch_evil: isError==true
PASS fetch_evil: mensaje contiene "origin"

TODOS LOS CHECKS VERDE
```

### `npm run spike` — corrida 2 (EXIT=0)

```
> toolhost-mcp@0.1.0 spike
> node build-spike.mjs && node mf-spike.mjs


  dist-spike\worker.js  107.9kb

Done in 14ms
build-spike OK -> dist-spike/worker.js + dist-spike/quickjs-asyncify.wasm

list -> {"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"fetch_home","description":"Hace fetch al origin permitido y devuelve status + primera linea","inputSchema":{"type":"object"}},{"name":"fetch_evil","description":"Intenta fetch a un origin NO permitido; debe fallar dentro del sandbox","inputSchema":{"type":"object"}}]}}
fetch_home -> {"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"{\"status\":200,\"firstLine\":\"toolhost-mcp server\"}"}],"structuredContent":{"status":200,"firstLine":"toolhost-mcp server"},"isError":false}}
PASS fetch_home: HTTP 200
PASS fetch_home: structuredContent.status==200
PASS fetch_home: firstLine no vacia
PASS fetch_home: isError==false
fetch_evil  -> {"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"Error en la tool: origin no permitido: https://example.com"}],"isError":true}}
PASS fetch_evil: isError==true
PASS fetch_evil: mensaje contiene "origin"

TODOS LOS CHECKS VERDE
```

### `npm test` — regresión (EXIT=0)

```
> toolhost-mcp@0.1.0 test
> node build.mjs && node mf-test.mjs


  dist\worker.js  429.5kb

Done in 23ms
build OK -> dist/worker.js + dist/quickjs.wasm
initialize   -> {"status":200,"text":"{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{\"tools\":{\"listChanged\":false}},\"serverInfo\":{\"name\":\"toolhost-mcp\",\"version\":\"0.1.0\"}}}"}
tools/list   -> {"status":200,"text":"{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"tools\":[{\"name\":\"create_payment\",\"description\":\"Crea un pago usando la logica interna de la plataforma\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"amount\":{\"type\":\"number\",\"description\":\"Monto en centavos\"},\"currency\":{\"type\":\"string\",\"description\":\"Moneda ISO, ej: usd\"}},\"required\":[\"amount\",\"currency\"]}},{\"name\":\"refund_payment\",\"description\":\"Reembolsa un pago existente\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"paymentId\":{\"type\":\"string\"}},\"required\":[\"paymentId\"]}}]}}"}
create_pay   -> {"status":200,"text":"{\"jsonrpc\":\"2.0\",\"id\":3,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"{\\\"ok\\\":true,\\\"paymentId\\\":\\\"pay_1001\\\",\\\"status\\\":\\\"succeeded\\\"}\"}],\"structuredContent\":{\"ok\":true,\"paymentId\":\"pay_1001\",\"status\":\"succeeded\"},\"isError\":false}}"}
```