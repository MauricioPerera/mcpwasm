# TAREA3-REPORT — Migración miniflare v3 → v4

## Versión final de miniflare

```
toolhost-mcp@0.1.0 D:\Repo\mcpwasm
`-- miniflare@4.20260630.0
```

- `package.json`: `"miniflare": "^4.20260630.0"` (antes `^3.20250718.0`).
- `package-lock.json`: regenerado por `npm install --save-dev miniflare@^4` (14 paquetes añadidos, 14 eliminados, 7 cambiados).

## Cambios en mf-test.mjs

**Ninguno.** El archivo es byte-idéntico al baseline.

### Por qué no hubo que tocarlo

Verifiqué contra los tipos reales del paquete instalado (`node_modules/miniflare/dist/src/index.d.ts`), no de memoria:

1. **Opciones de módulos.** `CoreOptionsSchema` en v4 acepta exactamente la misma rama legacy que usaba v3:
   - `scriptPath: string`
   - `modules: boolean` (con `true`)
   - `modulesRules: { type: "ESModule" | ... | "CompiledWasm" | ...; include: string[]; fallthrough?: boolean }[]`
   - `modulesRoot?: string`

   El shape alternativo `modules: [{ type, path, contents? }, ...]` (array de módulos explícitos) también existe en v4 como segunda rama del `ZodUnion`, pero NO es obligatorio usarlo. La forma `scriptPath` + `modulesRules` del PoC sigue soportada y se resuelve igual: `dist/worker.js` entra como `ESModule` (regla `**/*.js`) y `dist/quickjs.wasm` como `CompiledWasm` (regla `**/*.wasm`), exactamente la regla `CompiledWasm` que exige el import `./quickjs.wasm` del bundle → `WebAssembly.Module` precompilado.

2. **`dispatchFetch`.** En v4 sigue siendo miembro público de la clase `Miniflare` con la misma firma:
   ```ts
   type DispatchFetch = (input: RequestInfo, init?: RequestInit<...>) => Promise<Response>;
   ```
   Luego `mf.dispatchFetch("http://localhost/mcp", { method, headers, body })` + `await res.text()` + `res.status` sigue funcionando sin cambios. No hizo falta migrar a `getWorker()` + `fetch` del worker.

3. **`fileURLToPath`.** Se mantiene (no se tocó). Siguiendo la lección previa, se evita `new URL(...).pathname` (que produce `/D:/...` y rompe en Windows). `fileURLToPath(new URL("./dist/worker.js", import.meta.url))` devuelve la ruta nativa correcta en ambas versiones.

4. **`compatibilityDate` / `compatibilityFlags` / `dispose()`.** Idénticos en v4.

**Trade-off / decisión:** El mínimo cambio que preserva el comportamiento observable es cero. Forzar una reescritura al shape idiomático v4 (`modules: [{ type: "ESModule", path: ... }, { type: "CompiledWasm", path: ... }]`) habría sido un cambio cosmético fuera del alcance (“cambio mínimo”), sin ganancia observable y con riesgo de alterar la resolución del `.wasm`. Se dejó el working tree de mf-test.mjs intacto a propósito.

### Trade-offs

- **A favor:** cero riesgo de regresión en el oráculo e2e; el PoC queda pinzado a la LTS v4 (`^4.20260630.0`).
- **En contra (menor):** mf-test.mjs usa la rama “legacy” de las opciones de módulos (`scriptPath` + `modulesRules`) en vez de la rama “explícita” (`modules: [...]`) que v4 promueve como idiomática. Sigue soportada, pero si v5 la retira, ahí sí habría que migrar. No aplica hoy.

## `npm ls miniflare`

```
toolhost-mcp@0.1.0 D:\Repo\mcpwasm
`-- miniflare@4.20260630.0
```

## Salida 1 de `npm test`

```
> toolhost-mcp@0.1.0 test
> node build.mjs && node mf-test.mjs


  dist\worker.js  429.5kb

Done in 26ms
build OK -> dist/worker.js + dist/quickjs.wasm
initialize   -> {"status":200,"text":"{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{\"tools\":{\"listChanged\":false}},\"serverInfo\":{\"name\":\"toolhost-mcp\",\"version\":\"0.1.0\"}}}"}
tools/list   -> {"status":200,"text":"{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"tools\":[{\"name\":\"create_payment\",\"description\":\"Crea un pago usando la logica interna de la plataforma\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"amount\":{\"type\":\"number\",\"description\":\"Monto en centavos\"},\"currency\":{\"type\":\"string\",\"description\":\"Moneda ISO, ej: usd\"}},\"required\":[\"amount\",\"currency\"]}},{\"name\":\"refund_payment\",\"description\":\"Reembolsa un pago existente\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"paymentId\":{\"type\":\"string\"}},\"required\":[\"paymentId\"]}}]}}"}
create_pay   -> {"status":200,"text":"{\"jsonrpc\":\"2.0\",\"id\":3,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"{\\\"ok\\\":true,\\\"paymentId\\\":\\\"pay_1001\\\",\\\"status\\\":\\\"succeeded\\\"}\"}],\"structuredContent\":{\"ok\":true,\"paymentId\":\"pay_1001\",\"status\":\"succeeded\"},\"isError\":false}}"}
```

## Salida 2 de `npm test`

```
> toolhost-mcp@0.1.0 test
> node build.mjs && node mf-test.mjs


  dist\worker.js  429.5kb

Done in 27ms
build OK -> dist/worker.js + dist/quickjs.wasm
initialize   -> {"status":200,"text":"{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{\"tools\":{\"listChanged\":false}},\"serverInfo\":{\"name\":\"toolhost-mcp\",\"version\":\"0.1.0\"}}}"}
tools/list   -> {"status":200,"text":"{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"tools\":[{\"name\":\"create_payment\",\"description\":\"Crea un pago usando la logica interna de la plataforma\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"amount\":{\"type\":\"number\",\"description\":\"Monto en centavos\"},\"currency\":{\"type\":\"string\",\"description\":\"Moneda ISO, ej: usd\"}},\"required\":[\"amount\",\"currency\"]}},{\"name\":\"refund_payment\",\"description\":\"Reembolsa un pago existente\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"paymentId\":{\"type\":\"string\"}},\"required\":[\"paymentId\"]}}]}}"}
create_pay   -> {"status":200,"text":"{\"jsonrpc\":\"2.0\",\"id\":3,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"{\\\"ok\\\":true,\\\"paymentId\\\":\\\"pay_1001\\\",\\\"status\\\":\\\"succeeded\\\"}\"}],\"structuredContent\":{\"ok\":true,\"paymentId\":\"pay_1001\",\"status\":\"succeeded\"},\"isError\":false}}"}
```

Ambas salidas son idénticas salvo el tempo de esbuild (`Done in 26ms` vs `27ms`), sin valor semántico. Las 3 respuestas (initialize, tools/list, create_pay) salen con `status:200` y `result`; `create_pay` devuelve `paymentId: "pay_1001"`. Definición de hecho cumplida.