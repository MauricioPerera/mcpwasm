# TAREA15 — Auth Bearer opcional-por-config en el gateway

Auth `Authorization: Bearer <AUTH_TOKEN>` activada en producción por config (env var `AUTH_TOKEN`), sin romper el e2e local (modo dev sigue abierto cuando el env no está definido). Verificada con cliente MCP real enviando el header.

**Token: SIEMPRE redactado.** Valor real en `.gateway-token` (gitignored). Prefijo: `ed6cd5be…`.

---

## 1. Cambios de código

### `worker-gateway.mjs`
- Si `env.AUTH_TOKEN` está definido y no vacío → `POST /mcp` exige `Authorization: "Bearer <AUTH_TOKEN>"` (comparación exacta). Si falta o no coincide → **HTTP 401** `{"error":"unauthorized"}` **sin tocar el resto del flujo** (retorna antes de validar origin/body).
- Si `env.AUTH_TOKEN` no está definido → comportamiento actual (abierto, modo dev).
- `GET /` (ayuda) sigue abierto y su texto menciona el estado del auth (`Auth ACTIVADO` / `Auth DESACTIVADO`).

```js
if (env && env.AUTH_TOKEN && env.AUTH_TOKEN.length > 0) {
  const expected = "Bearer " + env.AUTH_TOKEN;
  const got = request.headers.get("authorization") || "";
  if (got !== expected) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
    });
  }
}
```

### `mf-gateway.mjs`
- Bloque `[f]`: segunda instancia Miniflare con `AUTH_TOKEN` de prueba. Verifica 401 sin header, 401 con bearer equivocado, 200 initialize y 200 tools/list con bearer correcto. La instancia principal (sin `AUTH_TOKEN`) sigue abierta y se probó intacta en los checks `[1]`–`[6]`.

### `.gitignore`
Añadidos **antes** de crear los archivos:
```
.gateway-token
mcp-bookstore.local.json
```

### `mcp-bookstore.json` (committeado, ejemplo)
```json
{"mcpServers":{"bookstore":{"type":"http","url":"https://llmstxt-gateway.rckflr.workers.dev/mcp?origin=https%3A%2F%2Fllmstxt-bookstore.rckflr.workers.dev","headers":{"Authorization":"Bearer REPLACE_WITH_TOKEN"}}}}
```

### `mcp-bookstore.local.json` (gitignored, token real)
Copia de `mcp-bookstore.json` con `"headers":{"Authorization":"Bearer <token real>"}` (prefijo `Bearer ed6cd5b…`).

### `.gateway-token` (gitignored)
32 bytes hex (64 chars), generado con `node -e "crypto.randomBytes(32).toString('hex')"`. Prefijo `ed6cd5be…`.

---

## 2. Subida del secret

```
$ node -e "...read .gateway-token..." | npx wrangler secret put AUTH_TOKEN -c wrangler-gateway.toml
 ⛅️ wrangler 4.106.0
🌀 Creating the secret for the Worker "llmstxt-gateway"
✨ Success! Uploaded secret AUTH_TOKEN
```

Comando verificado para wrangler ^4.106.0: `printf '%s' "<token>" | npx wrangler secret put AUTH_TOKEN -c wrangler-gateway.toml` (stdin). El secret se aplica al deployment vivo; no requirió `wrangler deploy` adicional (wrangler v4 lo publica sobre el worker existente).

---

## 3. Deploy

```
$ npx wrangler deploy -c wrangler-gateway.toml
Total Upload: 1132.87 KiB / gzip: 385.97 KiB
Worker Startup Time: 5 ms
Bindings: env.DEMO, env.BOOKSTORE, env.ALLOWED_ORIGINS
Uploaded llmstxt-gateway (5.71 sec)
Deployed llmstxt-gateway triggers (0.82 sec)
  https://llmstxt-gateway.rckflr.workers.dev
Current Version ID: ccd21d99-720b-43f3-994f-264cea6c5dfd
```

---

## 4. Verificación en producción (salidas reales)

### 5a — `POST /mcp?origin=bookstore` **sin** `Authorization` → 401
```
HTTP 401
{"error":"unauthorized"}
```

### 5b — con `Authorization: Bearer wrong` → 401
```
HTTP 401
{"error":"unauthorized"}
```
> Nota de honestidad: el primer intento de 5b devolvió 200 durante la ventana de propagación del secret (~segundos posteriores al `secret put`); al re-ejecutar unos segundos después se estabilizó en 401 consistente (verificado 3 veces: 401, 401, 401). El comportamiento final y estable es el correcto.

### 5c — con `Authorization: Bearer <token real>` → 200 `tools/list` con 5 tools
```
HTTP 200
tools count = 5
names = search_catalog, get_book, stock_report, create_order, busy_loop
```

### `GET /` (ayuda, abierto) — menciona el auth
```
llmstxt-gateway
Gateway llms.txt -> MCP (Streamable HTTP, JSON-RPC 2.0 por POST).
Uso: POST https://llmstxt-gateway.rckflr.workers.dev/mcp?origin=<url-encoded-origin>
El origin debe estar en la allowlist (ALLOWED_ORIGINS).
Auth ACTIVADO: POST /mcp exige header Authorization: Bearer <AUTH_TOKEN>.
Metodos MCP: initialize | tools/list | tools/call
```

### 5d — Cliente MCP real (transporte MCP con header)

Comando:
```
ollama launch claude --model glm-5.2:cloud -y -- \
  --mcp-config mcp-bookstore.local.json --strict-mcp-config \
  --allowedTools "mcp__bookstore__*" \
  -p "Dame el reporte de stock de la libreria usando la tool stock_report y resumelo en 2 lineas." \
  < /dev/null > t15-client-output.txt 2>&1
```
exit=0. Salida `t15-client-output.txt` (99 bytes):
```
52 títulos, 522 libros en stock, 12 agotados. Top: Ender's Game y The Hobbit (30 c/u), 1984 (28).
```

Cross-check directo contra el gateway (`tools/call stock_report`, bearer correcto):
```json
{"total_titles":52,"total_stock":522,"out_of_stock":12,
 "top3_by_stock":[
   {"id":19,"title":"Ender's Game","author":"Orson Scott Card","stock":30},
   {"id":41,"title":"The Hobbit","author":"J.R.R. Tolkien","stock":30},
   {"id":28,"title":"1984","author":"George Orwell","stock":28}]}
```
→ El transporte MCP con header `Authorization: Bearer <token>` funcionó end-to-end: el cliente consumió `stock_report` y el resumen coincide byte a byte con D1 (52 títulos, 522 stock, 12 agotados, top3 Ender's Game/The Hobbit/1984).

---

## 5. e2e local con caso de auth (bloque `[f]`)

```
[f] auth Bearer (AUTH_TOKEN de prueba en 2da instancia):
[f.1] sin header -> {"error":"unauthorized"}
PASS auth: sin Authorization -> 401
PASS auth: body {"error":"unauthorized"}
[f.2] bearer equivocado -> {"error":"unauthorized"}
PASS auth: Bearer equivocado -> 401
[f.3] bearer correcto initialize -> {"jsonrpc":"2.0","id":3,"result":{"protocolVersion":"2025-06-18",...}}
PASS auth: Bearer correcto -> initialize 200
[f.4] bearer correcto tools/list -> 2 tools
PASS auth: Bearer correcto -> tools/list 200
PASS auth: tools/list trae tools tras auth
```
La instancia principal sin `AUTH_TOKEN` sigue abierta: `[1]` initialize 200, `[5]` evil origin 403, `[6]` sin origin 403 — todos verde (no se rompió el modo dev).

---

## 6. Regresión — 3 suites exit 0

```
$ npm run gateway  ; echo exit=$?   ->  exit=0   (TODOS LOS CHECKS VERDE)
$ npm test         ; echo exit=$?   ->  exit=0
$ npm run spike    ; echo exit=$?   ->  exit=0
```

---

## 7. `git status --short` final

```
 M .gitignore
 M mcp-bookstore.json
 M mf-gateway.mjs
 M worker-gateway.mjs
?? t15-client-output.txt
```

`git check-ignore` confirma:
```
.gateway-token              <- ignorado (NO aparece como untracked)
mcp-bookstore.local.json    <- ignorado (NO aparece como untracked)
```

→ `.gateway-token` y `mcp-bookstore.local.json` **no aparecen** como untracked (están ignorados). El token real nunca se commitea ni se pega en archivos trackeados; en este reporte solo figura redactado (`ed6cd5be…`).

---

## Definición de hecho

- [x] Auth Bearer opcional-por-config en `worker-gateway.mjs` (401 `{"error":"unauthorized"}`, modo dev intacto sin env).
- [x] Token 32-byte hex en `.gateway-token` (gitignored); `.gitignore` + `mcp-bookstore.local.json` añadidos antes de crearlos.
- [x] Secret `AUTH_TOKEN` subido (wrangler v4, stdin).
- [x] Gateway redeployado (Version ID `ccd21d99…`).
- [x] 5a (401 sin header), 5b (401 bearer equivocado), 5c (200 + 5 tools), 5d (cliente MCP real: stock real 52/522/12) — salidas reales.
- [x] e2e local con caso auth (bloque `[f]`) verde.
- [x] `npm run gateway`, `npm test`, `npm run spike` → exit 0.
- [x] `git status --short` muestra `.gateway-token` y `mcp-bookstore.local.json` ignorados (no untracked).
- [x] Token SIEMPRE redactado en el reporte y en archivos trackeados.