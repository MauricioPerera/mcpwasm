# TAREA7 — Gateway llms.txt → MCP

**URL pública del gateway:** `https://llmstxt-gateway.rckflr.workers.dev`

## Definición de hecho — estado

| # | Requisito | Estado |
|---|-----------|--------|
| 1 | `npm run gateway` exit 0 DOS veces (e2e contra demo site real) | ✅ |
| 2 | Regresión: `npm test` y `npm run spike` exit 0 | ✅ |
| 3 | Deploy real `npx wrangler deploy -c wrangler-gateway.toml` con URL pública | ✅ |
| 4 | Verificación en producción vía curl (initialize, tools/list, sum_numbers=42, server_time epoch, 403) | ✅ |

## Decisiones de diseño

### Parser (`llmstxt-parse.mjs`)
- Función pura `parseLlmsTxt(text) → [{name, description, toolPath, sha256, version}]`.
- Regex sobre cada línea: `^\s*-\s+\[([^\]]+)\]\(([^)]*)\):\s*(.*?)\s*<!--\s*skill:\s*(\{.*?\})\s*-->`.
- Solo parsea líneas con el comentario `<!-- skill: {...} -->` (skills ejecutables). Líneas sin comentario (solo enlace descriptivo) se ignoran.
- JSON inválido en el comentario o campos faltantes (`tool`/`sha256` no string) → línea omitida, sin lanzar.
- No hace fetch, no importa nada del target. Oráculo independiente.

### Cache
- **Sí, implementado** con `caches.default`, opcional (try/catch → bypass si la Cache API falla en el runtime).
  - `tool.js`: inmutable, key = `gw:tool:${url}#${sha}` (contenido addressable). Solo se cachea tras verificar sha256 OK. Sigue verificando sha256 en cache hit (barato y defensivo).
  - `llms.txt`: TTL 60s, key = `gw:llms:${origin}`, almacenado con timestamp.
- **Cache-bust en el fetch** (`?_gw=<ts>`): para los origins externos por `workers.dev`, bypassa el edge cache de Cloudflare (sin `Cache-Control`, Cloudflare cachea `.txt`/`.js` por heurística y podría servir un 404 stale). El demo site ignora el query (matchea por pathname). Las Cache API keys usan la URL limpia (sin el bust) → la dedup interna se mantiene.

### Hardening (extensión compatible de `host-async.mjs`)
Valores elegidos:
- **memoryLimit = 64 MB** (`vm.runtime.setMemoryLimit`). Cubre tools que acumulan strings/arrays enormes; QuickJS lanza "memory limit exceeded".
- **maxStackSize = 1 MB** (`vm.runtime.setMaxStackSize`). Contiene recursión explosiva antes del interrupt.
- **interruptDeadline = 2000 ms wall-clock por callTool** (`vm.runtime.setInterruptHandler`). El handler devuelve `true` cuando `Date.now() > this._deadline` y QuickJS interrumpe el bucle infinito en curso.
- APIs verificadas en `node_modules/quickjs-emscripten-core/dist/index.d.ts`: `QuickJSRuntime#setMemoryLimit`, `#setMaxStackSize`, `#setInterruptHandler` (callback `(runtime) => boolean | undefined | void`). Las tres existen en la variante asyncify instalada (`@jitl/quickjs-wasmfile-release-asyncify` ^0.32.0).

Detalles de implementación del interrupt:
- `this._deadline` inicia en `Number.MAX_SAFE_INTEGER`. `init()` (prelude) y `listTools()` (`__list`) corren código de confianza y **no** se interrumpen.
- Solo `loadToolSource` (tool.js no confiable, top-level) y `callTool` (handler no confiable) activan el deadline (`Date.now() + 2000`) con `try/finally` que restaura el valor previo.
- Esto es **esencial**: la primera versión con `this._deadline = 0` hacía `Date.now() > 0` siempre true e interrumpía el prelude → todo fallaba con "interrupted".

Compatibilidad: las opciones nuevas (`memoryLimitBytes`, `maxStackSizeBytes`, `interruptDeadlineMs`, `fetchImpl`) son opcionales con defaults. El spike TAREA5 no las pasa → usa `fetch` global y los mismos defaults → `npm run spike` sigue verde.

### Trade-off: un solo contexto QuickJS por request
- Todas las skills del mismo origin comparten dominio de confianza (mismo `allowedOrigin` para `fetchOrigin`) y se cargan en un único contexto QuickJS por request. El host se construye por request y se dispone al final (igual que el PoC).
- **Ventaja**: aislamiento entre requests (un request no ve las tools ni el estado de otro); `allowedOrigin` scoped exactamente al origin del request.
- **Costo**: redescubrimiento por request (fetch de llms.txt + tool.js + build del contexto QuickJS por request). Mitigado por: (a) cache de tool.js inmutable y llms.txt TTL 60s, (b) el módulo QuickJS asyncify se construye una sola vez y se reutiliza entre requests (`getQuickjs()` cachea el `newQuickJSAsyncWASMModuleFromVariant`); solo `newContext()` es por request.

### Worker-to-worker same-account (error 1042) — hallazgo crítico
- Un Worker que hace `fetch()` a otro Worker de la **misma cuenta Cloudflare** vía `workers.dev` falla con `error code: 1042`. El demo site y el gateway están en la misma cuenta (`091122c40cc6f8d0d421cbc90e2caca8`), así que el fetch de `/llms.txt` **y** el `fetchOrigin` de `/api/time` (server_time) fallaban en producción.
- Diagnóstico (endpoint temporal `/_debug`, ya removido): `example.com` → 200; `demo/llms.txt` y `demo/api/time` → 404 `error code: 1042`. Confirma que afecta a todo fetch al demo site, no a la red externa.
- **Fix**: service binding `DEMO` → `llmstxt-demo-site` en `wrangler-gateway.toml`. El gateway construye un `fetchImpl` (`makeFetchImpl`) que enruta el origin del demo por `env.DEMO.fetch(url)` (bypass de workers.dev) y los demás origins por `fetch` global. El mismo `fetchImpl` se inyecta en `AsyncToolHost` (nueva opción `fetchImpl`, default `fetch` global) para que `fetchOrigin` también use el binding → server_time funciona en producción.
- En Miniflare (e2e) no hay binding (`env.DEMO` undefined) → `fetchImpl` cae a `fetch` global (undici) → el e2e contra el demo site real funciona sin configurar el binding. Producción usa el binding. Mismo código, dos transportes.
- **Extensible**: para otros origins same-account, añadir otro `[[services]]` en `wrangler-gateway.toml` y mapearlo en `makeFetchImpl`.

## Archivos creados / modificados

**Creados:** `worker-gateway.mjs`, `llmstxt-parse.mjs`, `build-gateway.mjs`, `mf-gateway.mjs`, `wrangler-gateway.toml`, `dist-gateway/`, `TAREA7-REPORT.md`.
**Modificados:** `package.json` (script `gateway`), `host-async.mjs` (extensión compatible: hardening + `fetchImpl`), `.gitignore` (`dist-gateway/`).
**No tocados** (según regla): `host.mjs`, `worker.mjs`, `mcp-core.mjs`, `mcp-core-async.mjs`, `tools-inline.mjs`, `shim.mjs`, `build.mjs`, `build-spike.mjs`, `mf-test.mjs`, `mf-spike.mjs`, `worker-spike.mjs`, `wrangler.toml`, `demo-site/**`.

---

## Salidas reales

### `npm run gateway` — RUN 1

```
> toolhost-mcp@0.1.0 gateway
> node build-gateway.mjs && node mf-gateway.mjs

  dist-gateway\worker.js  116.1kb

Done in 13ms
build-gateway OK -> dist-gateway/worker.js + dist-gateway/quickjs-asyncify.wasm

[1] initialize -> {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{"listChanged":false}},"serverInfo":{"name":"toolhost-mcp-spike-async","version":"0.1.0"}}}
PASS initialize: HTTP 200
PASS initialize: viene result
[2] tools/list -> {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"sum_numbers","description":"Sum two numbers a and b.","inputSchema":{"type":"object","properties":{"a":{"type":"number"},"b":{"type":"number"}},"required":["a","b"]}},{"name":"server_time","description":"Return the current server time.","inputSchema":{"type":"object","properties":{}}}]}}
PASS tools/list: HTTP 200
PASS tools/list: tools es array
PASS tools/list: contiene "sum_numbers"
PASS tools/list: contiene "server_time"
PASS sum_numbers: inputSchema con property a
PASS server_time: inputSchema presente
[3] sum_numbers -> {"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"42"}],"structuredContent":42,"isError":false}}
PASS sum_numbers: HTTP 200
PASS sum_numbers: structuredContent === 42
[4] server_time -> {"jsonrpc":"2.0","id":4,"result":{"content":[{"type":"text","text":"{\"now\":\"2026-07-02T16:08:41.874Z\",\"epoch\":1783008521874}"}],"structuredContent":{"now":"2026-07-02T16:08:41.874Z","epoch":1783008521874},"isError":false}}
PASS server_time: HTTP 200
PASS server_time: structuredContent.epoch numerico
PASS server_time: isError==false
[5] evil origin -> {"jsonrpc":"2.0","id":null,"error":{"code":-32602,"message":"origin no permitido: https://example.com"}}
PASS origin no permitido: HTTP 403
[6] sin origin -> {"jsonrpc":"2.0","id":null,"error":{"code":-32602,"message":"falta parametro origin"}}
PASS sin origin: HTTP 403

TODOS LOS CHECKS VERDE
```

### `npm run gateway` — RUN 2

```
  dist-gateway\worker.js  116.1kb
Done in 13ms
build-gateway OK -> dist-gateway/worker.js + dist-gateway/quickjs-asyncify.wasm
[2] tools/list -> {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"sum_numbers","description":"Sum two numbers a and b.","inputSchema":{"type":"object","properties":{"a":{"type":"number"},"b":{"type":"number"}},"required":["a","b"]}},{"name":"server_time","description":"Return the current server time.","inputSchema":{"type":"object","properties":{}}}]}}
PASS tools/list: HTTP 200
PASS tools/list: tools es array
PASS tools/list: contiene "sum_numbers"
PASS tools/list: contiene "server_time"
PASS sum_numbers: inputSchema con property a
PASS server_time: inputSchema presente
[3] sum_numbers -> {"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"42"}],"structuredContent":42,"isError":false}}
PASS sum_numbers: HTTP 200
PASS sum_numbers: structuredContent === 42
[4] server_time -> {"jsonrpc":"2.0","id":4,"result":{"content":[{"type":"text","text":"{\"now\":\"2026-07-02T16:08:52.424Z\",\"epoch\":1783008532424}"}],"structuredContent":{"now":"2026-07-02T16:08:52.424Z","epoch":1783008532424},"isError":false}}
PASS server_time: HTTP 200
PASS server_time: structuredContent.epoch numerico
PASS server_time: isError==false
[5] evil origin -> {"jsonrpc":"2.0","id":null,"error":{"code":-32602,"message":"origin no permitido: https://example.com"}}
PASS origin no permitido: HTTP 403
[6] sin origin -> {"jsonrpc":"2.0","id":null,"error":{"code":-32602,"message":"falta parametro origin"}}
PASS sin origin: HTTP 403

TODOS LOS CHECKS VERDE
```

### `npm test` (regresión)

```
  dist\worker.js  429.5kb
Done in 25ms
build OK -> dist/worker.js + dist/quickjs.wasm
initialize   -> {"status":200,"text":"{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{\"tools\":{\"listChanged\":false}},\"serverInfo\":{\"name\":\"toolhost-mcp\",\"version\":\"0.1.0\"}}}"}
tools/list   -> {"status":200,"text":"{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"tools\":[{\"name\":\"create_payment\",...},{\"name\":\"refund_payment\",...}]}}"}
create_pay   -> {"status":200,"text":"{\"jsonrpc\":\"2.0\",\"id\":3,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"{\\\"ok\\\":true,\\\"paymentId\\\":\\\"pay_1001\\\",\\\"status\\\":\\\"succeeded\\\"}\"}],\"structuredContent\":{\"ok\":true,\"paymentId\":\"pay_1001\",\"status\":\"succeeded\"},\"isError\":false}}"}
```
Exit 0.

### `npm run spike` (regresión)

```
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
Exit 0.

### Deploy real

```
$ npx wrangler deploy -c wrangler-gateway.toml
 ⛅️ wrangler 4.106.0
────────────────────
Total Upload: 1126.46 KiB / gzip: 384.40 KiB
Worker Startup Time: 5 ms
Your Worker has access to the following bindings:
Binding                                                               Resource
env.DEMO (llmstxt-demo-site)                                          Worker
env.ALLOWED_ORIGINS ("https://llmstxt-demo-site.rckflr.work...")      Environment Variable

Uploaded llmstxt-gateway (6.20 sec)
Deployed llmstxt-gateway triggers (0.98 sec)
  https://llmstxt-gateway.rckflr.workers.dev
Current Version ID: 88e2ffaa-de13-481c-8e81-49cf250c1336
```

### Verificación en producción (curl)

```
=== GET / ===
llmstxt-gateway
Gateway llms.txt -> MCP (Streamable HTTP, JSON-RPC 2.0 por POST).
Uso: POST https://llmstxt-gateway.rckflr.workers.dev/mcp?origin=<url-encoded-origin>
El origin debe estar en la allowlist (ALLOWED_ORIGINS).
Metodos MCP: initialize | tools/list | tools/call

=== initialize ===
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{"listChanged":false}},"serverInfo":{"name":"toolhost-mcp-spike-async","version":"0.1.0"}}}
[HTTP 200]

=== tools/list ===
{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"sum_numbers","description":"Sum two numbers a and b.","inputSchema":{"type":"object","properties":{"a":{"type":"number"},"b":{"type":"number"}},"required":["a","b"]}},{"name":"server_time","description":"Return the current server time.","inputSchema":{"type":"object","properties":{}}}]}}
[HTTP 200]

=== tools/call sum_numbers {a:2,b:40} ===
{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"42"}],"structuredContent":42,"isError":false}}
[HTTP 200]

=== tools/call server_time ===
{"jsonrpc":"2.0","id":4,"result":{"content":[{"type":"text","text":"{\"now\":\"2026-07-02T16:08:27.353Z\",\"epoch\":1783008507353}"}],"structuredContent":{"now":"2026-07-02T16:08:27.353Z","epoch":1783008507353},"isError":false}}
[HTTP 200]

=== origin no permitido (example.com) ===
{"jsonrpc":"2.0","id":null,"error":{"code":-32602,"message":"origin no permitido: https://example.com"}}
[HTTP 403]

=== sin origin ===
{"jsonrpc":"2.0","id":null,"error":{"code":-32602,"message":"falta parametro origin"}}
[HTTP 403]
```

`server_time` devuelve `epoch` numérico real (`1783008507353`) que provino de `/api/time` del demo site **a través de `fetchOrigin` → service binding `DEMO`** (no del gateway directo), confirmando que la capability y el scoping de origin funcionan en producción.