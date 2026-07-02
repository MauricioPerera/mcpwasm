# TAREA10 — Rename clave `sha256` → `tool_sha256` en el comentario JSON de /llms.txt

## Contexto / spec

El RFC core de llms-txt-skills reserva `sha256` para el hash del `SKILL.md`. Para
evitar colisión, la clave del hash del artefacto `tool.js` en el comentario JSON
de la línea de skill ejecutable se renombra a `tool_sha256`. Es un draft sin
adopters: sin fallback legacy. Los VALORES de los hashes no cambian (los
`tool.js` no se tocan).

Formato nuevo:
```
- [<name>](/skills/<name>/SKILL.md): <desc>. <!-- skill: {"version":"1.0.0","tool":"/skills/<name>/tool.js","tool_sha256":"<hex>"} -->
```

## Cambios

### `demo-site/build.mjs`
- Lneas 29-30: la clave del comentario JSON pasa de `"sha256"` a `"tool_sha256"`.
  `createHash("sha256")` (lnea 15) NO se toca: es el identificador del algoritmo
  crypto de Node, no la clave del JSON.

### `llmstxt-parse.mjs`
- Comentario de cabecera (lnea 5): `"sha256":"<hex>"` → `"tool_sha256":"<hex>"`.
- `typeof meta.sha256` → `typeof meta.tool_sha256` (lnea 34).
- `sha256: meta.sha256` → `sha256: meta.tool_sha256` (lnea 42). El nombre del
  campo EXPORTADO se mantiene como `sha256` (es nombre interno, no la clave
  del JSON, y worker-gateway.mjs lo consume como `s.sha256`); solo cambia de
  dnde se lee en el JSON parseado.

### `demo-site/verify.mjs`
- `s.sha256` → `s.tool_sha256` (lneas 29 y 32): el verificador post-deploy lee
  la clave nueva del JSON del comentario. `createHash("sha256")` (lnea 28)
  queda: algoritmo.

### `worker-gateway.mjs`
- Sin cambios. Revisado: consume el campo `s.sha256` exportado por el parser
  (valor del hash, inalterado) y lo usa en cache key `gw:tool:${url}#${s.sha256}`
  y en mensajes de rechazo (`sha256 fallo`, `sha256 mismatch`). Ninguno
  referencia la CLAVE del JSON, solo el valor o el concepto/algoritmo SHA-256.
  `crypto.subtle.digest("SHA-256", ...)` (lnea 158) es el algoritmo: queda.

### `mf-gateway.mjs`
- Sin cambios. `grep sha256` no devuelve matches. El e2e le pega al demo site
  real (redeployado), as que ejercita el parseo de `tool_sha256` end-to-end.

### `README.md`
- Lnea 105: `` `sha256` (hex SHA-256 of the `tool.js` bytes)`` → `` `tool_sha256` ``.
- Lnea 108: ejemplo de la lnea → `"tool_sha256":"..."`.
- Lnea 117: `` `sha256` is verified against `` → `` `tool_sha256` is verified against ``.
- Lnea 199: `` the `sha256` declared in `llms.txt` `` → `` the `tool_sha256` declared in `llms.txt` ``.
- Menciones a SHA-256 como algoritmo (`SHA-256 content addressing`, `verifies SHA-256`,
  `content-addressed by SHA-256`) se mantienen. Diagrama ASCII (lnea 49,
  `verifies sha256 per skill`) intacto: `sha256` ah es concepto de verificacin,
  no la clave del JSON, y cambiarla rompera el ancho del box.
- Seccin Development notes (lnea 262+) intacta por indicacin.

## Verificacin local (regresin)

### `npm test` (exit 0)
```
> toolhost-mcp@0.1.0 test
> node build.mjs && node mf-test.mjs

  dist\worker.js  429.5kb
Done in 24ms
build OK -> dist/worker.js + dist/quickjs.wasm
initialize   -> {"status":200,"text":"{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{\"tools\":{\"listChanged\":false}},\"serverInfo\":{\"name\":\"toolhost-mcp\",\"version\":\"0.1.0\"}}}"}
tools/list   -> {"status":200,"text":"{\"jsonrpc\":\"2.0\",\"id\":2,...\"create_payment\"...\"refund_payment\"...}"}
create_pay   -> {"status":200,...\"structuredContent\":{\"ok\":true,\"paymentId\":\"pay_1001\",\"status\":\"succeeded\"},\"isError\":false}}
```

### `npm run spike` (exit 0)
```
> toolhost-mcp@0.1.0 spike
> node build-spike.mjs && node mf-spike.mjs

  dist-spike\worker.js  110.5kb
Done in 13ms
build-spike OK -> dist-spike/worker.js + dist-spike/quickjs-asyncify.wasm
list -> {..."fetch_home"..."fetch_evil"...}
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

## Redeploy

### demo-site
```
npx wrangler deploy -c demo-site/wrangler.toml
⛅️ wrangler 4.106.0
Total Upload: 3.25 KiB / gzip: 1.27 KiB
Uploaded llmstxt-demo-site (2.40 sec)
Deployed llmstxt-demo-site triggers (1.59 sec)
  https://llmstxt-demo-site.rckflr.workers.dev
Current Version ID: 8f90847f-1b81-4642-b11e-6a87c49a99ff
```

### gateway
```
npx wrangler deploy -c wrangler-gateway.toml
⛅️ wrangler 4.106.0
Total Upload: 1129.06 KiB / gzip: 384.99 KiB
Worker Startup Time: 9 ms
env.DEMO (llmstxt-demo-site)                                          Worker
env.ALLOWED_ORIGINS ("https://llmstxt-demo-site.rckflr.work...")      Environment Variable
Uploaded llmstxt-gateway (10.01 sec)
Deployed llmstxt-gateway triggers (1.24 sec)
  https://llmstxt-gateway.rckflr.workers.dev
Current Version ID: 22e2017a-5428-4236-a8f3-5474ff545446
```

## `npm run gateway` (e2e contra demo site real) — DOS VECES, exit 0 ambas

### 1ra corrida
```
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
[4] server_time -> {"jsonrpc":"2.0","id":4,"result":{"content":[{"type":"text","text":"{\"now\":\"2026-07-02T16:40:17.661Z\",\"epoch\":1783010417661}"}],"structuredContent":{"now":"2026-07-02T16:40:17.661Z","epoch":1783010417661},"isError":false}}
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

### 2da corrida
```
build-gateway OK -> dist-gateway/worker.js + dist-gateway/quickjs-asyncify.wasm
[1] initialize -> {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{"listChanged":false}},"serverInfo":{"name":"toolhost-mcp-spike-async","version":"0.1.0"}}}
PASS initialize: HTTP 200
PASS initialize: viene result
PASS cache: 1er request (initialize) X-Gw-Discovery=miss
[2] tools/list -> {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"sum_numbers",...},{"name":"server_time",...}]}}
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
[4] server_time -> {"jsonrpc":"2.0","id":4,"result":{"content":[{"type":"text","text":"{\"now\":\"2026-07-02T16:40:28.493Z\",\"epoch\":1783010428493}"}],"structuredContent":{"now":"2026-07-02T16:40:28.493Z","epoch":1783010428493},"isError":false}}
PASS server_time: HTTP 200
PASS server_time: structuredContent.epoch numerico
PASS server_time: isError==false
[5] evil origin -> {..."origin no permitido: https://example.com"}
PASS origin no permitido: HTTP 403
[6] sin origin -> {..."falta parametro origin"}
PASS sin origin: HTTP 403
[a] aislamiento: ... 4 PASS
TODOS LOS CHECKS VERDE
```

## Verificacin en produccin (curl)

### `/llms.txt` del demo site (muestra `tool_sha256`)
```
$ curl -s https://llmstxt-demo-site.rckflr.workers.dev/llms.txt
# llms-txt-skills demo site

> Demo site publishing executable skills per the llms-txt-skills standard with a provisional extension for executable skills.

## Skills

- [sum_numbers](/skills/sum_numbers/SKILL.md): Sum two numbers a and b. <!-- skill: {"version":"1.0.0","tool":"/skills/sum_numbers/tool.js","tool_sha256":"58daf86111bf7278446eb7e0e8c6384713b50cdb6fa97ac039e23846d723dc3e"} -->
- [server_time](/skills/server_time/SKILL.md): Return the current server time. <!-- skill: {"version":"1.0.0","tool":"/skills/server_time/tool.js","tool_sha256":"5b9255eca41a95cc0cf38322dc973062133e1ce1e757da8cab8fdeb16ec934f5"} -->
```

### `tools/list` del gateway (las 2 skills)
```
$ curl -s -X POST "https://llmstxt-gateway.rckflr.workers.dev/mcp?origin=https%3A%2F%2Fllmstxt-demo-site.rckflr.workers.dev" -H "content-type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
{"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"sum_numbers","description":"Sum two numbers a and b.","inputSchema":{"type":"object","properties":{"a":{"type":"number"},"b":{"type":"number"}},"required":["a","b"]}},{"name":"server_time","description":"Return the current server time.","inputSchema":{"type":"object","properties":{}}}]}}
```

### `sum_numbers(2,40)` = 42
```
$ curl -s -X POST "https://llmstxt-gateway.rckflr.workers.dev/mcp?origin=https%3A%2F%2Fllmstxt-demo-site.rckflr.workers.dev" -H "content-type: application/json" -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"sum_numbers","arguments":{"a":2,"b":40}}}'
{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"42"}],"structuredContent":42,"isError":false}}
```

### `server_time` con epoch
```
$ curl -s -X POST "https://llmstxt-gateway.rckflr.workers.dev/mcp?origin=https%3A%2F%2Fllmstxt-demo-site.rckflr.workers.dev" -H "content-type: application/json" -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"server_time","arguments":{}}}'
{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"{\"now\":\"2026-07-02T16:40:50.405Z\",\"epoch\":1783010450405}"}],"structuredContent":{"now":"2026-07-02T16:40:50.405Z","epoch":1783010450405},"isError":false}}
```

## Grep clave vieja

```
$ grep -rn '"sha256"' demo-site/ llmstxt-parse.mjs worker-gateway.mjs mf-gateway.mjs README.md
demo-site/build.mjs:15:const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
demo-site/verify.mjs:28:  const actual = createHash("sha256").update(toolText, "utf8").digest("hex");
exit=0
```

### Trade-off (honesto)
El grep NO devuelve vaco: quedan dos matches. Ambos son `createHash("sha256")`
el identificador del algoritmo crypto de Node (`node:crypto`), NO la clave del
comentario JSON. Renombrar ese string a `tool_sha256` rompe la crypto
(`createHash` exige el nombre canónico del algoritmo). La indicacin explcita
fue que las menciones de SHA-256 como algoritmo se quedan. La clave del JSON
`"sha256"` fue eliminada del 100% del cdigo activo (build, parser, verify,
README, worker-gateway, mf-gateway): cero ocurrencias restantes de la clave.
Los dos nicos `"sha256"` que sobreviven son el nombre del algoritmo y son
intocables por diseo.

## Definicin de hecho

1. `npm run gateway` exit 0 DOS veces (contra demo site redeployado): OK.
2. `npm test` exit 0, `npm run spike` exit 0: OK.
3. Produccion: /llms.txt con `tool_sha256`, tools/list 2 skills, sum_numbers=42,
   server_time con epoch: OK.
4. Grep `"sha256"`: la CLAVE vieja no queda; solo resta el algoritmo
   `createHash("sha256")` (intocable). Ver trade-off arriba.