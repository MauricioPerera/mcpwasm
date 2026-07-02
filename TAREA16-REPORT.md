# TAREA16 — Skills de ESCRITURA end-to-end (POST capability + create_order)

## RESUMEN

- ✅ Capability `host.fetchOrigin(path, opts?)` extendida a POST en `host-async.mjs`
  (compatible hacia atrás: `fetchOrigin(path)` sigue siendo GET idéntico).
- ✅ Tests locales de la capability (POST/PUT/origin) — todos verde.
- ✅ Bookstore: tabla `orders` creada en D1 remoto, endpoint `POST /api/order` +
  `GET /api/order/<id>` funcionando (verificado directo, paths de error 409).
- ✅ Skill `create_order` + `SKILL.md` generados; `build.mjs` regenera `worker.mjs`
  con 6 skills y hash nuevo.
- ✅ Ambos deploys OK.
- ✅ 5a `tools/list` vía gateway → 5 tools (create_order presente, corrupt_skill excluida).
- ✅ Regresión: `npm test`, `npm run spike`, `npm run gateway` → exit 0.
- ❌ **5b–5e BLOQUEADAS** — el POST de `create_order` no llega al bookstore como
  POST a través del gateway. Causa raíz abajo.

---

## 1. host-async.mjs — extensión COMPATIBLE de la capability

`host.fetchOrigin(path, opts?)` donde `opts = {method?, body?, contentType?}`.

- `method` solo `GET` (default) o `POST`; otro → throw dentro del sandbox.
- `body` solo `string`, máx 16KB; otro tipo o >16KB → throw.
- `content-type` es el único header controlable; default `application/json` si hay body.
- origin-scope sin cambios: path relativo o URL con exactamente el origin permitido;
  otro origin → throw `"origin no permitido"`.
- Respuesta truncada a 4KB (igual que antes).
- `fetchOrigin(path)` sin opts → GET puro, sin body, sin headers (byte-identico al
  comportamiento anterior).

Prelude (`globalThis.host.fetchOrigin`) pasa `opts` como string JSON al puente
asyncify `__fetchOriginRaw(path, optsJson)`. La validación de method/body/content-type
vive en el host (dentro de `newFunction`), así los throws se propagan como excepciones
del sandbox vía el mecanismo `{error}`/QTS_Throw ya existente.

## 2. Tests locales nuevos (mf-gateway.mjs, bloque `[d]`)

Salida real de `npm run gateway`:

```
[d] capability POST (fetchImpl fake inyectado):
[d.a] POST capturado -> {"url":"https://test.local/api/order","opts":{"method":"POST","body":"{\"book_id\":1,\"qty\":2}","headers":{"content-type":"application/json"}}}
PASS POST: responde 200
PASS POST: method llega como POST
PASS POST: body llega byte-identico
PASS POST: content-type default application/json cuando hay body
PASS GET: method default GET (compat)
PASS GET: sin body (compat)
PASS GET: sin headers (compat)
PASS PUT: throw 'method no permitido' dentro del sandbox
PASS POST a otro origin: throw 'origin no permitido'
```

Cobertura pedida:
- (a) POST con body llega con method y body correctos + content-type default → PASS.
- (b) method PUT → throw `method no permitido` → PASS.
- (c) POST a otro origin → throw `origin no permitido` → PASS.

## 3. Bookstore — escritura real

### 3a. Migration D1 (nueva, no toca `schema.sql`)

Archivo: `bookstore/migration-orders.sql`

```sql
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL,
  qty INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
```

Aplicada con `npx wrangler d1 execute bookstore-db --remote -c bookstore/wrangler.toml
--file bookstore/migration-orders.sql`:

```
"changed_db": true, "num_tables": 2, "rows_written": 4, "total_attempts": 1
```

(2 tablas ahora: `books` + `orders`.)

### 3b. Endpoint POST /api/order + GET /api/order/<id>

Añadidos al template de `build.mjs` y regenerados en `worker.mjs`.

- `POST /api/order` body `{book_id, qty}`: valida book existe y `stock >= qty`
  (si no, 409 JSON con motivo). En transacción D1 (`env.DB.batch`): INSERT en
  `orders` + `UPDATE books SET stock = stock - qty WHERE id=? AND stock>=?`.
  Devuelve `{order_id, book_id, qty, remaining_stock}`.
- `GET /api/order/<id>` devuelve la orden (404 si no existe).

Verificación directa al bookstore desplegado (paths de error, sin escritura):

```
--- nonexistent book ---
{"error":"book not found","book_id":99999}   HTTP 409
--- insufficient stock ---
{"error":"insufficient stock","requested":99999,"available":12}   HTTP 409
--- GET order 1 (none yet) ---
{"error":"Not Found","id":1}   HTTP 404
```

### 3c. Skill create_order

Archivos: `bookstore/content/create_order.tool.js` + `create_order.SKILL.md`.

- `inputSchema`: `{book_id: number (req), qty: number (req, >=1)}`.
- Handler async valida args, hace
  `host.fetchOrigin("/api/order", {method:"POST", body: JSON.stringify({book_id, qty})})`.
- status 409 → devuelve `{ok:false, status:409, ...motivo}` sin throw.
- status >=400 otro → `{ok:false, status, error}`.
- status 2xx → `{ok:true, ...parsed}`.

`build.mjs`: `legit` ahora incluye `create_order`; `llms.txt` regenerada con 6
skills (4 legítimas + 2 fixtures) y hash declarado de `create_order`:

```
create_order: real=a7dbdf120c6bff98e3cfd601e784bcf591c1a897559e902046c2ca88f650b3f1 declared=a7dbdf120c6bff98e3cfd601e784bcf591c1a897559e902046c2ca88f650b3f1
```

## 4. Redeploys

- Bookstore: `npx wrangler deploy -c bookstore/wrangler.toml`
  → `Deployed llmstxt-bookstore ... https://llmstxt-bookstore.rckflr.workers.dev`
  Version ID: `912e1ef4-926b-4b05-a6c7-b83bf3dc19bd`
- Gateway: `npx wrangler deploy -c wrangler-gateway.toml`
  → `Deployed llmstxt-gateway ... https://llmstxt-gateway.rckflr.workers.dev`
  Version ID: `e85a812e-b9bc-4648-b4da-3d89dad539b2`

## 5. VERIFICACIÓN EN PRODUCCIÓN

### 5a. tools/list (origin=bookstore) — ✅

```
POST /mcp?origin=https%3A%2F%2Fllmstxt-bookstore.rckflr.workers.dev
{"jsonrpc":"2.0","id":1,"method":"tools/list"}
→ HTTP 200, tools: [search_catalog, get_book, stock_report, create_order, busy_loop]
```

5 tools (las 4 legítimas + busy_loop). `corrupt_skill` excluida (hash declarado
incorrecto detectado por el gateway). ✅

### 5b. create_order vía gateway — ❌ BLOQUEADO

```
--- get_book 1 (via gateway) ---
{"id":1,"title":"Dune",...,"stock":12}   HTTP 200   → stock anotado: 12

--- create_order {book_id:1, qty:2} (via gateway) ---
{"ok":false,"status":404,"error":"{\"error\":\"Not Found\",\"path\":\"/api/order\"}"}
```

**El POST no llegó al bookstore como POST.** La respuesta `{"error":"Not
Found","path":"/api/order"}` es el 404 genérico del bookstore, que solo se dispara
cuando `request.method !== "POST"` (la ruta `POST /api/order` existe y responde
409/200 en los tests directos de 3b). Es decir, la request llegó como **GET
/api/order**.

### 5c/5d/5e — ❌ no ejecutables

Dependen de 5b (la escritura vía gateway). Sin POST al bookstore, no hay orden que
decrementar ni filas que mostrar.

`SELECT * FROM orders ORDER BY id DESC LIMIT 3` en D1 remoto:

```
"results": []
```

La tabla existe pero está vacía: ninguna escritura vía gateway aterrizó en D1.

## 6. Regresión

```
npm test        → exit 0
npm run spike   → exit 0   (TODOS LOS CHECKS VERDE)
npm run gateway → exit 0   (TODOS LOS CHECKS VERDE)
```

## CAUSA RAÍZ DEL BLOQUEO

`worker-gateway.mjs:139`, en `makeFetchImpl`:

```js
const binding = bindings[origin];
if (binding) {
  // Service binding: el host del URL se ignora, pathname+query pasan al
  // worker destino. No pasamos AbortSignal ...
  return binding.fetch(url);   // ← NO reenvía opts (method/body/headers)
}
return fetch(url, opts);
```

Para origins de la misma cuenta (demo-site, bookstore) el gateway enruta por
**service binding** y llama `binding.fetch(url)` pasando solo el URL string → la
request al worker destino es siempre **GET**, sin body. Los `opts` que ahora el
sandbox construye (`{method:"POST", body, headers}`) se descartan.

El bookstore está en la misma cuenta de Cloudflare, así que `fetch` global por
`workers.dev` da error 1042 (worker-to-worker misma cuenta) — por eso existe el
binding. No hay ruta alternativa al bookstore que pase `opts` sin tocar
`worker-gateway.mjs` o `wrangler-gateway.toml`, ambos prohibidos por el enunciado.

### Fix propuesto (1 línea, requiere autorización para editar `worker-gateway.mjs`)

```js
return binding.fetch(new Request(url, opts));   // reenvía method/body/headers al binding
```

`Service binding.fetch` acepta un `Request`; construirlo con `opts` reenvía
`method`, `body` y `content-type`. Con ese cambio, `create_order` llegaría como
POST al bookstore y 5b–5e deberían completarse. **No aplicado**: el enunciado
prohíbe tocar `worker-gateway.mjs` y no se obtuvo autorización para exceptuarlo.

## ESTADO

- Hasta 5a + regresión: completado y verificado en producción.
- 5b–5e: **BLOQUEADO** por `worker-gateway.mjs:139` (no reenvía `opts` al service
  binding). Requiere autorización para el edit de 1 línea arriba.

---

# Continuación 16b — fix del reenvío del init en makeFetchImpl

Autorizado el cambio mínimo en `worker-gateway.mjs`. Aplicado, redeployado y
verificado end-to-end en producción. La escritura vía gateway (POST) ya llega al
bookstore como POST y aterriza en D1.

## Fix aplicado (`worker-gateway.mjs`, rama binding de `makeFetchImpl`)

```js
const binding = bindings[origin];
if (binding) {
  // Service binding: el host del URL se ignora, pathname+query pasan al
  // worker destino. Reenviamos el init (method, body, headers) para que
  // POST/PUT lleguen al worker destino; sin init el binding degrada a GET.
  // Quitamos AbortSignal: algunas impl de binding no lo soportan y el
  // worker destino es trivial, resuelve en ms.
  const init = { ...opts };
  if (init && init.signal) delete init.signal;
  return binding.fetch(url, init);
}
return fetch(url, opts);
```

Cambio mínimo: antes `binding.fetch(url)` (GET siempre); ahora `binding.fetch(url,
init)` reenviando `method`/`body`/`headers`, quitando `AbortSignal` (algunas impl
de binding no lo soportan). La rama `fetch(url, opts)` (origin sin binding) ya
reenviaba `opts` — sin cambios.

## Redeploy gateway

```
npx wrangler deploy -c wrangler-gateway.toml
Uploaded llmstxt-gateway (7.33 sec)
Deployed llmstxt-gateway triggers (1.06 sec)
  https://llmstxt-gateway.rckflr.workers.dev
Current Version ID: b886ee14-6bc8-4c93-aa06-0cedc25e20f8
```

## Verificación en producción (salidas REALES vía gateway)

Endpoint: `POST https://llmstxt-gateway.rckflr.workers.dev/mcp?origin=<bookstore>`.

```
[init] initialize -> HTTP 200 discovery: miss

[a] get_book id=1 -> structuredContent {"id":1,"title":"Dune","author":"Frank Herbert","genre":"science-fiction","price":18.5,"stock":12}
[a] stock anotado: 12

[b] create_order {book_id:1, qty:2} -> structuredContent {"ok":true,"order_id":1,"book_id":1,"qty":2,"remaining_stock":10}
[b] order_id: 1  remaining_stock: 10  ok: true

[c] get_book id=1 (después) -> structuredContent {...,"stock":10}
[c] stock ahora: 10        (12 -> 10, decrementado en 2)

[d] create_order {book_id:1, qty:99999} -> structuredContent {"ok":false,"status":409,"error":"insufficient stock","requested":99999,"available":10}
[d] ok:false status:409  controlado por stock insuficiente

[e] create_order {book_id:99999, qty:1} -> structuredContent {"ok":false,"status":409,"error":"book not found","book_id":99999}
[e] ok:false status:409  controlado (libro inexistente)

[g1] stock_report -> HTTP 200 discovery: hit   structuredContent tipo: object
[g2] search_catalog {genre:"science-fiction",max_price:15} -> HTTP 200  libros encontrados: 10  ejemplo: {"id":2,"title":"Dune Messiah",...,"price":14,"stock":5}
[g3] sum_numbers (demo-site) -> structuredContent {"result":42}
```

- a→b→c: `create_order` vía gateway decrementó stock de 12 a 10 (remaining_stock
  = 12−2 = 10), confirmado por `get_book` posterior. **El POST ya llega como POST.**
- d: 409 controlado por stock insuficiente (no escribe, no decrementa).
- e: 409 controlado por libro inexistente.
- g1/g2/g3: los GET siguen funcionando (el reenvío del init no rompió `stock_report`
  ni `search_catalog`), y `sum_numbers` en `origin=demo-site` → `{result:42}`.

## SELECT directo a D1 (orders reales)

```
npx wrangler d1 execute bookstore-db --remote -c bookstore/wrangler.toml \
  --command "SELECT * FROM orders ORDER BY id DESC LIMIT 3"
```

```json
{
  "results": [
    { "id": 1, "book_id": 1, "qty": 2, "created_at": "2026-07-02T19:07:49.441Z" }
  ],
  "success": true
}
```

La orden `id=1` (book_id=1, qty=2) aterrizó en D1. La tabla `orders` ya NO está
vacía: la escritura vía gateway alcanzó la base de datos.

## Regresión local

```
npm run gateway -> TODOS LOS CHECKS VERDE  (exit 0)
```

Nuevo bloque `[e]` en `mf-gateway.mjs`: check con `fetchImpl` fake + fake binding
que cubre la rama binding de `makeFetchImpl` (la capa del gateway, complemento
del bloque `[d]` que cubre host→fetchImpl). Verifica:

```
[e.a] binding.fetch llamado -> {"url":"https://book.local/api/order","init":{"method":"POST","body":"{...}","headers":{"content-type":"application/json"}}}
PASS binding: POST routed al binding (no al fetch global)
PASS binding: method llega como POST al binding (no degrada a GET)
PASS binding: body llega byte-identico al binding
PASS binding: content-type llega al binding
PASS binding: respuesta del binding retorna al caller
PASS binding: GET tambien reenvia init (method GET)
PASS binding: GET sin body
PASS binding: AbortSignal se quita antes de pasar al binding
PASS binding: signal quitada pero method/body preservados
PASS global: origin sin binding NO toca al binding
PASS global: origin sin binding reenvia opts al fetch global (POST)
```

## Estado final 16b

- ✅ Fix mínimo aplicado en `worker-gateway.mjs` (rama binding reenvía `init`).
- ✅ Gateway redeployado (Version ID `b886ee14-...`).
- ✅ 5b–5e completadas en producción: escritura vía gateway decrementa stock,
  aterriza en D1, paths de error 409 controlados.
- ✅ Sanidad GET: `stock_report`, `search_catalog` y `sum_numbers` (demo) OK.
- ✅ Regresión `npm run gateway` exit 0 con nuevo check `[e]` del reenvío del init.
- Archivos tocados: `worker-gateway.mjs` (fix), `mf-gateway.mjs` (check `[e]`),
  `TAREA16-REPORT.md` (esta sección). Script de verificación temporal eliminado.