# TAREA4 — Deploy a producción (Cloudflare Workers)

## Cambios

### `wrangler.toml`
Se agregaron dos bloques al archivo mínimo original:

```toml
name = "toolhost-mcp"
main = "worker.mjs"
compatibility_date = "2026-06-01"
compatibility_flags = ["nodejs_compat"]

# Cuenta Mauricio.perera@gmail.com (fija la cuenta para modo no-interactivo).
account_id = "091122c40cc6f8d0d421cbc90e2caca8"

# Regla de modulo para que el import "./quickjs.wasm" se trate como
# WebAssembly.Module pre-compilado (CompiledWasm) en el build de wrangler.
[[rules]]
type = "CompiledWasm"
globs = ["**/*.wasm"]
fallthrough = false
```

- `account_id` fija la cuenta (hay 2 en el token OAuth; sin esto wrangler en modo no-interactivo falla pidiendo elegir).
- `[[rules]]` `CompiledWasm` para `**/*.wasm`: wrangler bundlea `worker.mjs` directamente (no usa `dist/`), y el `import "./quickjs.wasm"` debe resolverse como `WebAssembly.Module` pre-compilado (no como bytes a compilar en runtime, lo cual Workers prohíbe). `fallthrough = false` silencia el warning de regla duplicada con el default.

### `package.json` / `package-lock.json`
Agregado `wrangler` como **devDependency** (decisión: pinar versión para reproducibilidad en vez de depender de `npx wrangler@4` flotante).

```diff
   "devDependencies": {
+    "wrangler": "^4.106.0",
     "@jitl/quickjs-wasmfile-release-sync": "^0.32.0",
     ...
   }
```

## Versión de wrangler
**4.106.0** (`npx wrangler --version` → `4.106.0`).

## URL pública
```
https://toolhost-mcp.rckflr.workers.dev
```
Endpoint MCP: `POST https://toolhost-mcp.rckflr.workers.dev/mcp`

## Salida real del dry-run
```
$ npx wrangler deploy --dry-run --outdir dist-wrangler
 ⛅️ wrangler 4.106.0
────────────────────
Total Upload: 942.53 KiB / gzip: 318.22 KiB
No bindings found.
--dry-run: exiting now.
```
Verificado que el bundle (`dist-wrangler/worker.js`) seleccionó la variante cloudflare del paquete `@jitl`:
```
$ grep -o "emscripten-module\.[a-z]*" dist-wrangler/worker.js | sort -u
emscripten-module.cloudflare
emscripten-module.wasm
$ grep -c "instantiateWasm\|wasmModule" dist-wrangler/worker.js
31
```
Es decir, el condition `workerd` (aplicado automáticamente por el bundler de wrangler) eligió `emscripten-module.cloudflare.cjs`, que usa `instantiateWasm` con el módulo pre-compilado en vez de fetch+compile de bytes. El `.wasm` quedó embebido como módulo (`dist-wrangler/02028007bab4b877246b6f1ce18122e5-quickjs.wasm`, 503134 bytes). `quickjs.wasm` ya existía en la raíz (generado por `build.mjs`), no hizo falta regenerarlo.

## Salida real del deploy
```
$ npx wrangler deploy
 ⛅️ wrangler 4.106.0
────────────────────
Total Upload: 942.53 KiB / gzip: 318.22 KiB
Worker Startup Time: 7 ms
Uploaded toolhost-mcp (4.78 sec)
Deployed toolhost-mcp triggers (0.88 sec)
  https://toolhost-mcp.rckflr.workers.dev
Current Version ID: 9b2f4cb9-dd53-4803-9c58-3a67545099fd
```

## Verificación REAL contra producción (3 curl)

### 1) initialize — HTTP 200
```
$ curl -s -X POST "https://toolhost-mcp.rckflr.workers.dev/mcp" -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}' -w "\n[HTTP %{http_code}]\n"

{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{"listChanged":false}},"serverInfo":{"name":"toolhost-mcp","version":"0.1.0"}}}
[HTTP 200]
```

### 2) tools/list — HTTP 200
```
$ curl -s -X POST "https://toolhost-mcp.rckflr.workers.dev/mcp" -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' -w "\n[HTTP %{http_code}]\n"

{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"create_payment","description":"Crea un pago usando la logica interna de la plataforma","inputSchema":{"type":"object","properties":{"amount":{"type":"number","description":"Monto en centavos"},"currency":{"type":"string","description":"Moneda ISO, ej: usd"}},"required":["amount","currency"]}},{"name":"refund_payment","description":"Reembolsa un pago existente","inputSchema":{"type":"object","properties":{"paymentId":{"type":"string"}},"required":["paymentId"]}}]}}
[HTTP 200]
```

### 3) tools/call create_payment (amount 4200, currency usd) — HTTP 200
```
$ curl -s -X POST "https://toolhost-mcp.rckflr.workers.dev/mcp" -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"create_payment","arguments":{"amount":4200,"currency":"usd"}}}' -w "\n[HTTP %{http_code}]\n"

{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"{\"ok\":true,\"paymentId\":\"pay_1001\",\"status\":\"succeeded\"}"}],"structuredContent":{"ok":true,"paymentId":"pay_1001","status":"succeeded"},"isError":false}}
[HTTP 200]
```

`paymentId` presente: **`pay_1001`**.

## Nota sobre el primer intento
Los 3 POST inmediatamente posteriores al deploy devolvieron `error code: 1042` (HTTP 404). Fue un **transient de propagación/cold-start** (el GET ya respondía 200; el primer POST necesita instanciar QuickJS-wasm). Reintentados segundos después, los 3 devolvieron 200 con `result`. No hubo cambio de código entre ambos intentos.

## Archivos tocados
- `wrangler.toml` (agregado `account_id` + `[[rules]]`)
- `package.json` / `package-lock.json` (agregado `wrangler` devDep)
- `node_modules/` (vía `npm install -D wrangler@4`)
- `dist-wrangler/` (temporal del dry-run) — **eliminado** al terminar.

NO se tocaron `worker.mjs`, `host.mjs`, `mcp-core.mjs`, `internal-logic.mjs`, `tools-inline.mjs`, `shim.mjs`, `build.mjs`, `mf-test.mjs`, `dist/`. No se hicieron commits git. No se configuraron secrets (`STRIPE_SECRET` usa el fallback demo del PoC).

## Trade-offs
- **Pin de wrangler como devDep** (`^4.106.0`) en vez de `npx wrangler@4` flotante: versión reproducible, a costa de 9 paquetes extra en `node_modules`.
- **`fallthrough = false`** en la regla `CompiledWasm`: silencia el warning pero implica que la regla default de wrangler para `*.wasm?module` queda sobrescrita. Aceptable: el worker solo importa `./quickjs.wasm` (sin `?module`).
- **`main = "worker.mjs"` directo** (sin pasar por `dist/`): wrangler re-bundlea con esbuild aplicando el condition `workerd` automáticamente; eso replica lo que hace `build.mjs` para Miniflare. El e2e local (`mf-test.mjs`) sigue usando `dist/worker.js` y se mantiene verde independientemente.
- **Sin `workers_dev` explícito**: wrangler lo habilita por defecto si hay sesión OAuth, por eso el subdominio `*.workers.dev` se publicó sin config extra.