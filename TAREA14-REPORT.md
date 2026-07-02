# TAREA14 — Fix conformidad MCP structuredContent (spec 2025-06-18)

## BUG

En `tools/call` devolvíamos `structuredContent: result` tal cual. La spec MCP
(2025-06-18) define `structuredContent` como **OBJETO** (record). Cuando la tool
devuelve un **array** (`search_catalog`) o un **primitivo** (`sum_numbers` → 42),
el SDK del cliente lo rechaza con zod `invalid_type` ("expected record") y la tool
queda inutilizable para clientes conformes, aunque curl la vea "bien".

## FIX

Misma lógica en `mcp-core.mjs` y `mcp-core-async.mjs`: helper `wrapStructuredContent`.

```js
function wrapStructuredContent(result) {
  if (result !== null && typeof result === "object" && !Array.isArray(result)) {
    return result;              // objeto plano no-null no-array -> tal cual
  }
  return { result };            // array, número, string, boolean, null -> envuelto
}
```

- `structuredContent = wrapStructuredContent(result)`
- `content[0].text` sigue siendo `JSON.stringify(result)` **ORIGINAL sin envolver**
- `isError` igual que antes

## 1. Suites locales (exit 0 los tres)

### `npm test`
```
build OK -> dist/worker.js + dist/quickjs.wasm
initialize   -> ...200...
tools/list   -> ...create_payment, refund_payment...
create_pay   -> ..."structuredContent":{"ok":true,"paymentId":"pay_1001","status":"succeeded"}...
```
Objeto plano → sin envolver (conforme). **Exit 0.**

### `npm run spike`
```
fetch_home -> ..."structuredContent":{"status":200,"firstLine":"toolhost-mcp server"}...
PASS fetch_home: structuredContent.status==200
PASS fetch_home: firstLine no vacia
PASS fetch_home: isError==false
PASS fetch_evil: isError==true
PASS fetch_evil: mensaje contiene "origin"
TODOS LOS CHECKS VERDE
```
**Exit 0.**

### `npm run gateway`
```
[3] sum_numbers -> ..."structuredContent":{"result":42}...
PASS sum_numbers: structuredContent.result === 42 (envuelto)
PASS sum_numbers: structuredContent es objeto no-array
PASS sum_numbers: content[0].text es el JSON original sin envolver ("42")
[4] server_time -> ..."structuredContent":{"now":"...","epoch":1783017796527}...
PASS server_time: structuredContent.epoch numerico
...
[c] conformidad structuredContent (array + primitivo envueltos):
list_things -> {"result":[{"id":1,"title":"Dune"},{"id":2,"title":"Dune Messiah"}]}
PASS conformidad: structuredContent es objeto no-array (no array crudo)
PASS conformidad: structuredContent.result es el array de libros
PASS conformidad: content[0].text es el array original sin envolver
answer -> {"result":42}
PASS conformidad: primitivo envuelto en objeto
PASS conformidad: primitivo -> structuredContent.result === 42
PASS conformidad: primitivo content[0].text sin envolver
TODOS LOS CHECKS VERDE
```
**Exit 0.** (check nuevo (c) de conformidad añadido a mf-gateway.mjs: tools locales
que devuelven array y primitivo vía `handleMcpMessageAsync` → structuredContent es
objeto no-array con `.result` array / 42; content text original sin envolver.)

## 2. Deploys

### PoC (wrangler.toml raíz) — `npx wrangler deploy`
```
Uploaded toolhost-mcp (5.42 sec)
Deployed toolhost-mcp triggers (1.40 sec)
  https://toolhost-mcp.rckflr.workers.dev
Current Version ID: 3951faa8-f14b-46f4-aabe-dc488af08702
```

### Gateway — `npx wrangler deploy -c wrangler-gateway.toml`
```
Uploaded llmstxt-gateway (5.16 sec)
Deployed llmstxt-gateway triggers (1.76 sec)
  https://llmstxt-gateway.rckflr.workers.dev
Current Version ID: 4d0bafca-53ec-4584-a0ec-856c6eca5bdf
```
(bookstore NO cambia.)

## 3. Curl directo al gateway — shape nuevo

### `sum_numbers` (demo-site) → `structuredContent.result == 42`
```
$ curl -s -X POST "https://llmstxt-gateway.rckflr.workers.dev/mcp?origin=https%3A%2F%2Fllmstxt-demo-site.rckflr.workers.dev" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"sum_numbers","arguments":{"a":2,"b":40}}}'
{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"42"}],"structuredContent":{"result":42},"isError":false}}
```

### `search_catalog` (bookstore) → `structuredContent.result` es **array**
```
$ curl -s -X POST "https://llmstxt-gateway.rckflr.workers.dev/mcp?origin=https%3A%2F%2Fllmstxt-bookstore.rckflr.workers.dev" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"search_catalog","arguments":{"genre":"science-fiction","max_price":15}}}'
{"jsonrpc":"2.0","id":7,"result":{
  "content":[{"type":"text","text":"[{\"id\":2,\"title\":\"Dune Messiah\",...},{\"id\":5,\"title\":\"Foundation\",...},...]"}],
  "structuredContent":{"result":[
    {"id":2,"title":"Dune Messiah","author":"Frank Herbert","genre":"science-fiction","price":14,"stock":5},
    {"id":5,"title":"Foundation","author":"Isaac Asimov","genre":"science-fiction","price":12.99,"stock":20},
    ...10 libros...
  ]},
  "isError":false}}
```
- `structuredContent` = **objeto no-array** ✅
- `structuredContent.result` = **array de 10 libros** ✅
- `content[0].text` = array original sin envolver ✅

## 4. Re-prueba cliente MCP real (6a–6c)

Lanzado:
```
ollama launch claude --model glm-5.2:cloud -y -- \
  --mcp-config mcp-bookstore.json --strict-mcp-config \
  --allowedTools "mcp__bookstore__*" -p "Busca en el catalogo..." \
  < /dev/null > t14-client-output.txt 2>&1
EXIT=0
```

### 6a) `t14-client-output.txt` — recomendación concreta, SIN avisos de tool rota
```
## Recomendación: *Foundation*

| Campo | Valor |
|---|---|
| **Título** | Foundation |
| **Autor** | Isaac Asimov |
| **Precio** | $12.99 |
| **Stock** | 20 unidades |

Disponible (stock 20, >0), dentro del presupuesto (<$15), género science-fiction.

Otros candidatos disponibles del mismo filtro por si prefieres algo más barato:
*I, Robot* (Asimov, $9.99, stock 25) o *Count Zero* (Gibson, $10.50, stock 6).
Descartados por agotado: *Second Foundation* y *Mona Lisa Overdrive* (stock 0).
```
Sin `invalid_type`, sin "tool rota", sin avisos de conformidad. Recomendación
concreta con título, autor, precio y stock.

### 6b) Transcript del cliente (el .jsonl más reciente con tool_use MCP real)
Archivo: `C:/Users/Administrador/.claude/projects/D--Repo-mcpwasm/ccd520df-553c-44b2-8cb1-d2dcef20e89d.jsonl`
(mtime 2026-07-02 12:45 -0600, corresponde a esta corrida).

`tool_use` search_catalog (recortado):
```
{"type":"tool_use","id":"call_2renhrht","name":"mcp__bookstore__search_catalog",
 "input":{"q":"","genre":"science-fiction","max_price":15}}
```
`tool_result` (recortado, content del SDK):
```
tool_use_id: call_2renhrht
content: {"result":[
  {"id":2,"title":"Dune Messiah","author":"Frank Herbert","genre":"science-fiction","price":14,"stock":5},
  {"id":5,"title":"Foundation","author":"Isaac Asimov","genre":"science-fiction","price":12.99,"stock":20},
  {"id":6,"title":"Foundation and Empire",...,"stock":8},
  {"id":7,"title":"Second Foundation",...,"stock":0},
  {"id":8,"title":"I, Robot",...,"stock":25},
  {"id":9,"title":"Neuromancer",...,"stock":14},
  {"id":10,"title":"Count Zero",...},
  ...
]}
```
- `search_catalog` **DEVOLVIÓ libros** al cliente (array dentro de `result`).
- **Sin `invalid_type`**, sin "expected record". El SDK aceptó el objeto.
- grep de `invalid_type` / `expected record` en el transcript: **0 ocurrencias**.
  (3 matches de la palabra `structuredContent`, ninguna como error zod.)
- Otros tool_use del cliente: `get_book {id:5}` (Foundation) y `stock_report {}`.

### 6c) Contraste verdad-terreno
```
$ curl -s "https://llmstxt-bookstore.rckflr.workers.dev/api/search?genre=science-fiction&max_price=15"
[{"id":2,"title":"Dune Messiah","author":"Frank Herbert","genre":"science-fiction","price":14,"stock":5},
 {"id":5,"title":"Foundation","author":"Isaac Asimov","genre":"science-fiction","price":12.99,"stock":20},
 {"id":6,...},...,{"id":15,"title":"The Left Hand of Darkness","author":"Ursula K. Le Guin","price":13.25,"stock":11}]
```
Libro recomendado por el cliente = **Foundation, Isaac Asimov, $12.99, stock 20**.
Existe en la API directa con esos mismos datos (id 5) y **stock > 0**. ✅
Coincide con lo que `search_catalog` devolvió al cliente vía el gateway.

## Archivos tocados

- `mcp-core.mjs` — helper `wrapStructuredContent` + uso en tools/call
- `mcp-core-async.mjs` — idem
- `mf-gateway.mjs` — aserción `sum_numbers` actualizada a `.result===42`; nuevo
  bloque `(c)` de conformidad (array + primitivo envueltos); import
  `handleMcpMessageAsync`
- `mf-spike.mjs` — sin cambios (sus tools devuelven objetos; shape intacto)
- `mf-test.mjs` — sin cambios (no asserts sobre structuredContent)
- `t14-client-output.txt` — salida del cliente real
- `TAREA14-REPORT.md` — este reporte

## Definición de hecho

- [x] 3 suites exit 0
- [x] 2 deploys (PoC + gateway)
- [x] curl directo al gateway muestra shape nuevo (search_catalog →
      structuredContent.result array; sum_numbers → structuredContent.result==42)
- [x] evidencia 6a (recomendación concreta, sin tool rota)
- [x] evidencia 6b (transcript: search_catalog devolvió libros, sin invalid_type)
- [x] evidencia 6c (curl directo confirma Foundation $12.99 stock 20)