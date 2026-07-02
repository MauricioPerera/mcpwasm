# TAREA1-REPORT — toolhost-mcp end-to-end

## Resultado

`node mf-test.mjs` termina con **exit 0**. Las 3 RPC (initialize, tools/list, tools/call create_payment)
devuelven **status 200** con JSON-RPC conteniendo **`"result"`** (sin `"error"`). `create_payment`
devuelve `paymentId: "pay_1001"`. Corrido dos veces seguidas, sin flakiness (salidas idénticas).

## Decisiones tomadas

### 1. package.json (`type: module`)
devDependencies: `esbuild`, `miniflare`, `quickjs-emscripten`, `quickjs-emscripten-core`,
`@jitl/quickjs-wasmfile-release-sync`. Versiones instaladas efectivas:

- esbuild `0.25.12`
- miniflare `3.20250718.3` (tag `legacy` = v3; ver trade-off abajo)
- quickjs-emscripten / -core / @jitl/wasmfile-release-sync `0.32.0`

Scripts: `build` -> `node build.mjs`; `test` -> `node build.mjs && node mf-test.mjs`
(el build corre siempre antes del test).

### 2. npm install
Sin conflictos de peer deps. **No** hizo falta `--legacy-peer-deps`. Instalación limpia
(34 paquetes, 12s).

### 3. El .wasm de QuickJS
**Opción elegida: copiar el `.wasm` al raíz y también a `dist/`.**
El `.wasm` vive en `node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm`
(503 KB). `build.mjs` lo copia a `D:\Repo\mcpwasm\quickjs.wasm` (lo que `worker.mjs` importa en
desarrollo) y a `dist/quickjs.wasm` (lo que Miniflare resuelve en runtime).

No se ajustó el import de `worker.mjs`: queda `import QUICKJS_WASM from "./quickjs.wasm"`.
esbuild lo deja como import externo (ver punto 4) y Miniflare lo sirve como `CompiledWasm`
→ `WebAssembly.Module` ya compilado, que `newVariant(baseVariant, { wasmModule })` inyecta vía
`instantiateWasm`. Así se evita `fetch`+compile de bytes (prohibido en Workers:
"Wasm code generation disallowed by embedder").

### 4. Build con esbuild (`build.mjs`)
- `entry`: `worker.mjs` → `dist/worker.js`
- `format: esm`, `platform: browser`, `target: es2022`, `bundle: true`
- **`conditions: ["workerd"]`**: clave. El export `"./emscripten-module"` del paquete `@jitl`
  tiene condiciones `iife`, `workerd`, `browser`, `import`, `require`, `default` (en ese orden).
  Al activar `workerd`, esbuild selecciona `emscripten-module.cloudflare.cjs` — la variante
  purpose-built para workerd (usa `instantiateWasm` con el módulo pre-compilado en vez de
  `fetch`+`instantiateStreaming`). Sin `workerd`, caería a `import`/`browser` (loader de Node/browser
  que rompe en Workers).
- **`external: ["*.wasm"]`**: el `import "./quickjs.wasm"` se preserva textual en el bundle; Miniflare
  lo resuelve con la regla `CompiledWasm` ya declarada en `mf-test.mjs` y entrega un `WebAssembly.Module`.
- Post-build: `copyFile` del wasm a `dist/quickjs.wasm` para que el import relativo resuelva.

`dist/` queda autocontenido: `worker.js` (430 KB) + `quickjs.wasm` (503 KB).

### 5. Cambio mínimo en `mf-test.mjs` (necesario, documentado)
El `scriptPath` original usaba `new URL("./dist/worker.js", import.meta.url).pathname`, que en
Windows produce `"/D:/Repo/mcpwasm/dist/worker.js"`. Miniflare lo trata como relativo al cwd y
prefija la unidad → `D:\D:\Repo\mcpwasm\dist\worker.js` → `ENOENT`.

Cambio mínimo: `fileURLToPath(new URL("./dist/worker.js", import.meta.url))` (devuelve la ruta
nativa correcta `D:\Repo\mcpwasm\dist\worker.js`). Se agregó `import { fileURLToPath } from "node:url"`.
**No se tocó `worker.mjs` ni ningún otro archivo protegido.**

## Trade-offs

- **miniflare v3 (legacy) vs v4 (latest).** `mf-test.mjs` usa la API v3 (`new Miniflare({scriptPath, modules, modulesRules, dispatchFetch})`. v4 cambió la API (sin `scriptPath`/`dispatchFetch` directo en ese shape). Para no reescribir `mf-test.mjs` más allá del mínimo, se fijó miniflare a `^3.20250718.0` (tag `legacy`). Funciona para el PoC; si se quiere v4, `mf-test.mjs` tendría que migrarse (fuera del scope de TAREA1).
- **`conditions: ["workerd"]` dependiente del paquete @jitl.** Si @jitl reordena las condiciones del `exports` o renombra `workerd`, el build podría dejar de seleccionar la variante cloudflare. Es robusto hoy (0.32.0); se valida con `grep emscripten-module.cloudflare.cjs` en el bundle.
- **`.wasm` copiado vs import ajustado al path del paquete.** Se copió (no se apuntó el import a `node_modules/...`) porque: (a) cumple lo que pidió la tarea, (b) deja `dist/` autocontenido y portable, (c) evita acoplar el bundle a la layout de `node_modules` del paquete (que puede cambiar entre versiones).
- **`external: ["*.wasm"]`** requiere que el consumidor del bundle (Miniflare/worker) tenga una regla `CompiledWasm`. `mf-test.mjs` ya la declara; `wrangler.toml` no la declara explícitamente pero wrangler la infiere para imports `.wasm` con `nodejs_compat`. Para deploy real conviene confirmar la regla en `wrangler.toml` (fuera de scope).

## Salidas reales de `node mf-test.mjs` (dos corridas)

### Corrida 1 (EXIT_1=0)
```
initialize   -> {"status":200,"text":"{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{\"tools\":{\"listChanged\":false}},\"serverInfo\":{\"name\":\"toolhost-mcp\",\"version\":\"0.1.0\"}}}"}
tools/list   -> {"status":200,"text":"{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"tools\":[{\"name\":\"create_payment\",\"description\":\"Crea un pago usando la logica interna de la plataforma\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"amount\":{\"type\":\"number\",\"description\":\"Monto en centavos\"},\"currency\":{\"type\":\"string\",\"description\":\"Moneda ISO, ej: usd\"}},\"required\":[\"amount\",\"currency\"]}},{\"name\":\"refund_payment\",\"description\":\"Reembolsa un pago existente\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"paymentId\":{\"type\":\"string\"}},\"required\":[\"paymentId\"]}}]}}"}
create_pay   -> {"status":200,"text":"{\"jsonrpc\":\"2.0\",\"id\":3,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"{\\\"ok\\\":true,\\\"paymentId\\\":\\\"pay_1001\\\",\\\"status\\\":\\\"succeeded\\\"}\"}],\"structuredContent\":{\"ok\":true,\"paymentId\":\"pay_1001\",\"status\":\"succeeded\"},\"isError\":false}}"}
```

### Corrida 2 (EXIT_2=0)
```
initialize   -> {"status":200,"text":"{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{\"tools\":{\"listChanged\":false}},\"serverInfo\":{\"name\":\"toolhost-mcp\",\"version\":\"0.1.0\"}}}"}
tools/list   -> {"status":200,"text":"{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"tools\":[{\"name\":\"create_payment\",\"description\":\"Crea un pago usando la logica interna de la plataforma\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"amount\":{\"type\":\"number\",\"description\":\"Monto en centavos\"},\"currency\":{\"type\":\"string\",\"description\":\"Moneda ISO, ej: usd\"}},\"required\":[\"amount\",\"currency\"]}},{\"name\":\"refund_payment\",\"description\":\"Reembolsa un pago existente\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"paymentId\":{\"type\":\"string\"}},\"required\":[\"paymentId\"]}}]}}"}
create_pay   -> {"status":200,"text":"{\"jsonrpc\":\"2.0\",\"id\":3,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"{\\\"ok\\\":true,\\\"paymentId\\\":\\\"pay_1001\\\",\\\"status\\\":\\\"succeeded\\\"}\"}],\"structuredContent\":{\"ok\":true,\"paymentId\":\"pay_1001\",\"status\":\"succeeded\"},\"isError\":false}}"}
```

Ambas corridas: idénticas, exit 0, sin flakiness.