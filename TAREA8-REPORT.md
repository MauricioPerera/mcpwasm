# TAREA8-REPORT — README + evidencia de comandos

Objetivo: crear `README.md` (raíz, inglés, repo público) y verificar que todos
los comandos del quick start funcionan, con evidencia recortada. Solo se crearon
`README.md` y este reporte. No se tocaron otros archivos (otro dev está sobre
`worker-gateway.mjs`, `mf-gateway.mjs`, `host-async.mjs`).

## 1. `npm test` (sync PoC, worker.mjs)

```
> toolhost-mcp@0.1.0 test
> node build.mjs && node mf-test.mjs

  dist\worker.js  429.5kb
Done in 23ms
build OK -> dist/worker.js + dist/quickjs.wasm
initialize   -> {"status":200,"text":"{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{\"tools\":{\"listChanged\":false}},\"serverInfo\":{\"name\":\"toolhost-mcp\",\"version\":\"0.1.0\"}}}"}
tools/list   -> {"status":200,"text":"{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"tools\":[{\"name\":\"create_payment\",...},{\"name\":\"refund_payment\",...}]}}"}
create_pay   -> {"status":200,"text":"{\"jsonrpc\":\"2.0\",\"id\":3,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"{\\\"ok\\\":true,\\\"paymentId\\\":\\\"pay_1001\\\",\\\"status\\\":\\\"succeeded\\\"}\"}],\"structuredContent\":{\"ok\":true,\"paymentId\":\"pay_1001\",\"status\":\"succeeded\"},\"isError\":false}}"}
```

Verde. initialize, tools/list y tools/call (create_payment) responden 200 con
el secreto fuera del sandbox (la tool solo ve `paymentId`/`status`).

## 2. `npm run spike` (async spike, worker-spike.mjs)

```
> toolhost-mcp@0.1.0 spike
> node build-spike.mjs && node mf-spike.mjs

  dist-spike\worker.js  110.5kb
Done in 30ms
build-spike OK -> dist-spike/worker.js + dist-spike/quickjs-asyncify.wasm

list -> {"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"fetch_home",...},{"name":"fetch_evil",...}]}}
fetch_home -> {"...","structuredContent":{"status":200,"firstLine":"toolhost-mcp server"},"isError":false}
PASS fetch_home: HTTP 200
PASS fetch_home: structuredContent.status==200
PASS fetch_home: firstLine no vacia
PASS fetch_home: isError==false
fetch_evil  -> {"...","content":[{"type":"text","text":"Error en la tool: origin no permitido: https://example.com"}],"isError":true}
PASS fetch_evil: isError==true
PASS fetch_evil: mensaje contiene "origin"

TODOS LOS CHECKS VERDE
```

Verde. fetch_home trae datos reales del origin permitido; fetch_evil es
rechazado DENTRO del sandbox con "origin no permitido".

## 3. `npm run gateway`

NO ejecutado por regla (otro dev está tocando `worker-gateway.mjs` /
`mf-gateway.mjs` / `host-async.mjs`). Documentado tal cual en `package.json`:

```
"gateway": "node build-gateway.mjs && node mf-gateway.mjs"
```

Es decir: build del worker-gateway con esbuild (`build-gateway.mjs`) y e2e
Miniflare v4 (`mf-gateway.mjs`) contra el demo site real
(`https://llmstxt-demo-site.rckflr.workers.dev`).

## 4. curl contra el gateway desplegado (producción)

Endpoint: `https://llmstxt-gateway.rckflr.workers.dev/mcp?origin=<demo>`.
origin URL-encoded.

### tools/list

```bash
curl -s -X POST \
  "https://llmstxt-gateway.rckflr.workers.dev/mcp?origin=https%3A%2F%2Fllmstxt-demo-site.rckflr.workers.dev" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

```json
{"jsonrpc":"2.0","id":1,"result":{"tools":[
  {"name":"sum_numbers","description":"Sum two numbers a and b.","inputSchema":{"type":"object","properties":{"a":{"type":"number"},"b":{"type":"number"}},"required":["a","b"]}},
  {"name":"server_time","description":"Return the current server time.","inputSchema":{"type":"object","properties":{}}}
]}}
```

### tools/call sum_numbers {a:2, b:40}

```bash
curl -s -X POST \
  "https://llmstxt-gateway.rckflr.workers.dev/mcp?origin=https%3A%2F%2Fllmstxt-demo-site.rckflr.workers.dev" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"sum_numbers","arguments":{"a":2,"b":40}}}'
```

```json
{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"42"}],"structuredContent":42,"isError":false}}
```

### tools/call server_time {} (async, host.fetchOrigin("/api/time"))

```bash
curl -s -X POST \
  "https://llmstxt-gateway.rckflr.workers.dev/mcp?origin=https%3A%2F%2Fllmstxt-demo-site.rckflr.workers.dev" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"server_time","arguments":{}}}'
```

```json
{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"{\"now\":\"2026-07-02T16:20:37.854Z\",\"epoch\":1783009237854}"}],"structuredContent":{"now":"2026-07-02T16:20:37.854Z","epoch":1783009237854},"isError":false}}
```

El gateway descubrió `llms.txt`, verificó sha256 de cada `tool.js`, cargó las
skills en el sandbox y sirvió MCP. `server_time` demuestra la capability
`host.fetchOrigin` scoped al origin permitido (devuelve el JSON de `/api/time`
del demo site).

## 5. Verificación de URLs del README

`curl -s -o /dev/null -w "%{http_code}"`:

```
200  https://toolhost-mcp.rckflr.workers.dev
404  https://llmstxt-demo-site.rckflr.workers.dev        (root: por diseño, solo sirve rutas específicas)
200  https://llmstxt-demo-site.rckflr.workers.dev/llms.txt
200  https://llmstxt-gateway.rckflr.workers.dev
200  https://github.com/MauricioPerera/llms-txt-skills
```

El 404 en la raíz del demo site es el comportamiento esperado del worker (solo
sirve `/llms.txt`, `/api/time`, `/skills/...`). En el README el demo se cita
como `/llms.txt`, no como raíz. El resto de URLs responden 200.

## 6. Definición de hecho

- [x] `README.md` creado en la raíz, en inglés, cubriendo los 7 puntos pedidos.
- [x] `npm test` ejecutado → verde (evidencia §1).
- [x] `npm run spike` ejecutado → verde (evidencia §2).
- [x] `npm run gateway` documentado tal cual en `package.json`, NO ejecutado (evidencia §3).
- [x] curl real contra el gateway desplegado → respuestas reales (evidencia §4).
- [x] Todas las URLs del README verificadas (evidencia §5).
- [x] No se tocaron archivos fuera de `README.md` y `TAREA8-REPORT.md`.
- [x] No se hicieron commits git.