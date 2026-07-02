# TAREA9 — Contexto por skill + cache de descubrimiento en el isolate

Gateway llms.txt→MCP (`worker-gateway.mjs`). Dos mejoras manteniendo TODO el
comportamiento observable actual (mismo e2e verde):

1. **Contexto por skill**: cada skill se carga en su PROPIO contexto QuickJS.
2. **Cache de descubrimiento en el isolate**: Map a nivel de módulo
   `origin -> { skills, rejected, expiresAt }` con TTL 60s y máx 16 origins,
   que salta fetch de llms.txt + tool.js + verificación sha256 en requests
   calientes del mismo isolate.

## Decisiones y trade-offs

### Contexto por skill — `PerSkillHost` (en `worker-gateway.mjs`)
- `mcp-core-async.mjs` (intocable) llama `host.listTools()` y `host.callTool(name, args)`.
  Se introduce `PerSkillHost` en `worker-gateway.mjs` (clase nueva, no se toca
  `host-async.mjs` ni `mcp-core-async.mjs`) que crea **un `AsyncToolHost` por
  skill**, cada uno con su `newContext()` ⇒ runtime propio ⇒ `__tools`/globals
  propios. `listTools()` agrega los schemas de todos los contextos (en orden de
  carga); `callTool(name, args)` enruta al contexto de la skill.
- El hardening por contexto se hereda de `AsyncToolHost` sin cambios
  (64MB / 1MB / 2s aplicados en cada `init()`).
- **Limitación asyncify (una suspensión async a la vez por módulo)**: las
  llamadas ya son secuenciales por request. `PerSkillHost.init()` crea los
  contextos uno por uno (await). `callTool` ejecuta un solo contexto por
  request. No se introduce concurrencia entre contextos ⇒ no hay dos
  suspensiones asyncify simultáneas. Módulo asyncify compartido (cacheado a
  nivel isolate vía `getQuickjs()`); solo `newContext()` es por skill por
  request.
- **Dispose de TODOS los contextes** en `finally` del handler (try/finally);
  además `PerSkillHost.dispose()` es best-effort por contexto (try/catch cada
  uno) para que un dispose fallido no bloquee el resto.
- Trade-off: 1 contexto → N contextes por request sube el cómputo de creación
  (un `newContext()` + prelude + registro por skill). Aceptable: a cambio da
  aislamiento tool↔tool real (una skill no puede ver ni pisar `__tools` de
  otra). Para origins con muchas skills el coste crece lineal; el cache de
  descubrimiento (mejora 2) compensa saltándose el fetch+verify.

### Cache de descubrimiento en el isolate — capa 1
- Map a nivel de módulo `isolateCache: Map<origin, { skills, rejected, expiresAt }>`
  con TTL 60s y máx 16 origins. Eviction FIFO (primera clave en orden de
  inserción del `Map` cuando se llena). Los contextos QuickJS **no** se
  cachean (se crean por request); lo cacheado es **texto** (`code` verificado
  + metadata). La verificación sha256 se hace al poblar la entrada; el código
  cacheado es inmutable por hash ⇒ no se re-verifica en hit.
- Estructura cacheada: `skills: [{ name, description, inputSchema, code, sha256 }]`.
  `inputSchema` queda `undefined` al poblar (se extrae del contexto QuickJS en
  runtime, **mismo comportamiento observable que antes** — no se usan schemas
  cacheados para responder `tools/list`, siempre se cargan los contextos por
  request y se extraen vía `__list`). Cumple la firma `inputSchema?` (opcional).
  `description` es la del parser (enlace del llms.txt), disponible sin ejecutar.
- `caches.default` (tool.js inmutable por sha; llms.txt TTL 60s) se mantiene
  como **capa 2**: en miss del isolate se sigue usando para dedup interna.
- `discoverSkills` devuelve `{ skills, rejected, discovery }` con `discovery
  ∈ {"hit","miss"}`. El handler lo expone como header `X-Gw-Discovery` en
  **todas** las respuestas JSON (valor `"none"` antes de descubrimiento, p.ej.
  errores de validación 403/400; `"miss"` si el descubrimiento falló o fue
  poblado ahora; `"hit"` en cache hit del isolate). Solo observabilidad; no
  filtra nada sensible.
- **Por-isolate, no global**: en producción Cloudflare puede servir dos
  requests seguidos desde isolates distintos ⇒ ambos `miss`. Cuando caen en
  el mismo isolate, el segundo es `hit`. La ráfaga de 8 requests en producción
  lo muestra (miss/hit/mezcla). En Miniflare (un solo isolate) el patrón es
  determinista: 1er request `miss`, resto `hit`.

### Test de aislamiento (carga local, sin red) — `mf-gateway.mjs` bloque [a]
- Construye `AsyncToolHost` directamente en el test con un módulo asyncify
  compartido (`newQuickJSAsyncWASMModuleFromVariant(newVariant(baseAsyncifyVariant, {}))`),
  sin Miniflare ni red. Dos tools (A=`a_probe`, B=`b_target`) cada una en su
  propio `AsyncToolHost`/contexto.
- Verifica: (i) `listTools()` de A solo lista `a_probe` (no `b_target`);
  (ii) `hostA.callTool("b_target", …)` lanza "tool no encontrada"; (iii) el
  handler de A devuelve `Object.keys(globalThis.__tools)` = `["a_probe"]` y,
  tras inyectar `__tools["b_target"]`, solo ve `["a_probe","b_target"]` en SU
  contexto (el `b_target` inyectado NO es el de B); (iv) B queda intacta tras
  las acciones de A: `hostB.callTool("b_target",{x:21})` sigue devolviendo
  `{doubled:42}` (no el hackeo).

## Archivos tocados
- `worker-gateway.mjs` (cache isolate + `PerSkillHost` + header
  `X-Gw-Discovery` + `discoverSkills` con `discovery`).
- `mf-gateway.mjs` (checks `[a]` aislamiento + checks `[b]` cache vía header).
- No se tocaron `host-async.mjs`, `mcp-core-async.mjs`, `llmstxt-parse.mjs`,
  `README.md`, `TAREA8-REPORT.md`, `package.json` ni ningún otro archivo.

## Salidas reales

### Baseline (antes de tocar nada) — `npm run gateway`
```
> toolhost-mcp@0.1.0 gateway
> node build-gateway.mjs && node mf-gateway.mjs


  dist-gateway\worker.js  116.1kb

Done in 12ms
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
[4] server_time -> {"jsonrpc":"2.0","id":4,"result":{"content":[{"type":"text","text":"{\"now\":\"2026-07-02T16:20:04.267Z\",\"epoch\":1783009204267}"}],"structuredContent":{"now":"2026-07-02T16:20:04.267Z","epoch":1783009204267},"isError":false}}
PASS server_time: HTTP 200
PASS server_time: structuredContent.epoch numerico
PASS server_time: isError==false
[5] evil origin -> {"jsonrpc":"2.0","id":null,"error":{"code":-32602,"message":"origin no permitido: https://example.com"}}
PASS origin no permitido: HTTP 403
[6] sin origin -> {"jsonrpc":"2.0","id":null,"error":{"code":-32602,"message":"falta parametro origin"}}
PASS sin origin: HTTP 403

TODOS LOS CHECKS VERDE
```

### `npm run gateway` (con TAREA9) — corrida 1 — EXIT 0
```
> toolhost-mcp@0.1.0 gateway
> node build-gateway.mjs && node mf-gateway.mjs


  dist-gateway\worker.js  118.6kb

Done in 13ms
build-gateway OK -> dist-gateway/worker.js + dist-gateway/quickjs-asyncify.wasm

[1] initialize -> {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{"listChanged":false}},"serverInfo":{"name":"toolhost-mcp-spike-async","version":"0.1.0"}}}
PASS initialize: HTTP 200
PASS initialize: viene result
PASS cache: 1er request (initialize) X-Gw-Discovery=miss
[2] tools/list -> {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"sum_numbers","description":"Sum two numbers a and b.","inputSchema":{"type":"object","properties":{"a":{"type":"number"},"b":{"type":"number"}},"required":["a","b"]}},{"name":"server_time","description":"Return the current server time.","inputSchema":{"type":"object","properties":{}}}]}}
PASS tools/list: HTTP 200
PASS tools/list: tools es array
PASS cache: 2do request (tools/list) X-Gw-Discovery=hit
PASS tools/list: contiene "sum_numbers"
PASS tools/list: contiene "server_time"
PASS sum_numbers: inputSchema con property a
PASS server_time: inputSchema presente
[3] sum_numbers -> {"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"42"}],"structuredContent":42,"isError":false}}
PASS sum_numbers: HTTP 200
PASS sum_numbers: structuredContent === 42
PASS cache: 3er request (sum_numbers) X-Gw-Discovery=hit
[4] server_time -> {"jsonrpc":"2.0","id":4,"result":{"content":[{"type":"text","text":"{\"now\":\"2026-07-02T16:24:00.900Z\",\"epoch\":1783009440900}"}],"structuredContent":{"now":"2026-07-02T16:24:00.900Z","epoch":1783009440900},"isError":false}}
PASS server_time: HTTP 200
PASS server_time: structuredContent.epoch numerico
PASS server_time: isError==false
[5] evil origin -> {"jsonrpc":"2.0","id":null,"error":{"code":-32602,"message":"origin no permitido: https://example.com"}}
PASS origin no permitido: HTTP 403
[6] sin origin -> {"jsonrpc":"2.0","id":null,"error":{"code":-32602,"message":"falta parametro origin"}}
PASS sin origin: HTTP 403

[a] aislamiento (carga local, sin red):
PASS aislamiento: host A solo lista a_probe (no b_target)
PASS aislamiento: A no puede llamar a b_target (tool no encontrada)
PASS aislamiento: A ve solo su __tools (y el poke agrega SOLO en su contexto)
PASS aislamiento: B intacta tras acciones de A (doubled=42, no hackeada)

TODOS LOS CHECKS VERDE
```

### `npm run gateway` — corrida 2 — EXIT 0
```
PASS initialize: HTTP 200
PASS initialize: viene result
PASS cache: 1er request (initialize) X-Gw-Discovery=miss
PASS tools/list: HTTP 200
PASS tools/list: tools es array
PASS cache: 2do request (tools/list) X-Gw-Discovery=hit
PASS tools/list: contiene "sum_numbers"
PASS tools/list: contiene "server_time"
PASS sum_numbers: inputSchema con property a
PASS server_time: inputSchema presente
PASS sum_numbers: HTTP 200
PASS sum_numbers: structuredContent === 42
PASS cache: 3er request (sum_numbers) X-Gw-Discovery=hit
PASS server_time: HTTP 200
PASS server_time: structuredContent.epoch numerico
PASS server_time: isError==false
PASS origin no permitido: HTTP 403
PASS sin origin: HTTP 403
PASS aislamiento: host A solo lista a_probe (no b_target)
PASS aislamiento: A no puede llamar a b_target (tool no encontrada)
PASS aislamiento: A ve solo su __tools (y el poke agrega SOLO en su contexto)
PASS aislamiento: B intacta tras acciones de A (doubled=42, no hackeada)
TODOS LOS CHECKS VERDE
EXIT=0
```

### Regresión `npm run spike` — EXIT 0
```
> toolhost-mcp@0.1.0 spike
> node build-spike.mjs && node mf-spike.mjs


  dist-spike\worker.js  110.5kb

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

### Regresión `npm test` — EXIT 0
```
> toolhost-mcp@0.1.0 test
> node build.mjs && node mf-test.mjs


  dist\worker.js  429.5kb

Done in 23ms
build OK -> dist/worker.js + dist/quickjs.wasm
initialize   -> {"status":200,"text":"{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{\"tools\":{\"listChanged\":false}},\"serverInfo\":{\"name\":\"toolhost-mcp\",\"version\":\"0.1.0\"}}}"}
tools/list   -> {"status":200,"text":"{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"tools\":[{\"name\":\"create_payment\",...}]}}"}
create_pay   -> {"status":200,"text":"...\"structuredContent\":{\"ok\":true,\"paymentId\":\"pay_1001\",\"status\":\"succeeded\"}..."}
EXIT=0
```

### Redeploy — `npx wrangler deploy -c wrangler-gateway.toml`
```
 ⛅️ wrangler 4.106.0
────────────────────
Total Upload: 1129.05 KiB / gzip: 384.99 KiB
Worker Startup Time: 7 ms
Your Worker has access to the following bindings:
Binding                                                               Resource
env.DEMO (llmstxt-demo-site)                                          Worker
env.ALLOWED_ORIGINS ("https://llmstxt-demo-site.rckflr.workers...")      Environment Variable

Uploaded llmstxt-gateway (5.24 sec)
Deployed llmstxt-gateway triggers (0.79 sec)
  https://llmstxt-gateway.rckflr.workers.dev
Current Version ID: d8fc9cb2-2ba8-48f8-b0ef-87f402deb587
```

### Verificación en producción — curl

`tools/list` (dos requests seguidos, headers `X-Gw-Discovery`):
```
=== tools/list (req 1, miss) ===
x-gw-discovery: miss
{"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"sum_numbers","description":"Sum two numbers a and b.","inputSchema":{"type":"object","properties":{"a":{"type":"number"},"b":{"type":"number"}},"required":["a","b"]}},{"name":"server_time","description":"Return the current server time.","inputSchema":{"type":"object","properties":{}}}]}}
=== tools/list (req 2, hit) ===
x-gw-discovery: hit
{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"sum_numbers",...},{"name":"server_time",...}]}}
```

Ráfaga de 8 requests (los isolates en producción se reparten; miss→hit se
observa cuando dos caen en el mismo isolate, req 1→2):
```
req 1: x-gw-discovery: miss
req 2: x-gw-discovery: hit
req 3: x-gw-discovery: miss
req 4: x-gw-discovery: miss
req 5: x-gw-discovery: hit
req 6: x-gw-discovery: hit
req 7: x-gw-discovery: miss
req 8: x-gw-discovery: hit
```

`tools/list` trae las 2 skills (sum_numbers, server_time). ✓

`sum_numbers {a:2,b:40}` → 42:
```
{"jsonrpc":"2.0","id":10,"result":{"content":[{"type":"text","text":"42"}],"structuredContent":42,"isError":false}}
```

`server_time` → epoch numérico:
```
{"jsonrpc":"2.0","id":11,"result":{"content":[{"type":"text","text":"{\"now\":\"2026-07-02T16:26:25.084Z\",\"epoch\":1783009585084}"}],"structuredContent":{"now":"2026-07-02T16:26:25.084Z","epoch":1783009585084},"isError":false}}
```

Origin no permitido → 403:
```
HTTP 403
{"jsonrpc":"2.0","id":null,"error":{"code":-32602,"message":"origin no permitido: https://example.com"}}
```

## Definición de hecho
- [x] `npm run gateway` exit 0 DOS veces con los checks nuevos.
- [x] Regresión `npm run spike` exit 0 y `npm test` exit 0.
- [x] Redeploy `npx wrangler deploy -c wrangler-gateway.toml`.
- [x] Verificación en producción: tools/list (2 skills), sum_numbers=42,
      server_time con epoch, origin no permitido 403, header
      `X-Gw-Discovery` mostrando miss→hit en dos requests seguidos.