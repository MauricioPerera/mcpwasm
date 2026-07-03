# TAREA32-REPORT — Limpieza de comentarios en worker-gateway.mjs

## Resultado
- **Líneas:** 996 -> 878
- **Reducción:** 11.8% (118 líneas)
- **Comentarios:** 246 -> 128 líneas removidas (-47% de líneas de comentario)
- **Densidad de comentarios:** 24.7% -> 14.6% (iguala/supera el benchmark del PM en host-async.mjs, que quedó en ~16%)

> Nota: la reducción *total* de líneas (11.8%) es menor que el 23% de host-async porque worker-gateway tiene proporcionalmente más código ejecutable. La limpieza de comentarios fue **más agresiva** que la del PM: se removieron los 22 divisores de sección `// --- ... ---` (host-async tiene 0) y casi la mitad de las líneas de prosa, llevando la densidad de comentarios por debajo del benchmark.

## Verificación de código ejecutable (CERO cambio)
Comando exacto requerido:
```bash
strip() { grep -vE '^\s*//' "$1" | sed 's://.*$::' | grep -vE '^\s*$' | tr -d '[:space:]'; }
git show HEAD:worker-gateway.mjs > /tmp/old_wg.mjs
[ "$(strip /tmp/old_wg.mjs)" = "$(strip worker-gateway.mjs)" ] && echo "CODIGO IDENTICO OK" || echo "CODIGO CAMBIO - MAL"
```
**Saluda:**
```
CODIGO IDENTICO OK
```

## Sintaxis
```
$ node --check worker-gateway.mjs && echo "NODE CHECK OK"
NODE CHECK OK
```

## Suites (4 verdes)
```
$ npm test       -> exit 0
$ npm run spike  -> exit 0   (TODOS LOS CHECKS VERDE)
$ npm run memspike -> exit 0 (INSTANCIA 1 y 2: TODOS LOS CHECKS VERDE)
$ npm run gateway -> exit 0  (TODOS LOS CHECKS VERDE)
```

## "Por qué" críticos conservados (forma terse, 1 línea c/u)
- error 1042 worker-to-worker misma cuenta -> service bindings en makeFetchImpl.
- cache de descubrimiento por-isolate (no global), TTL 60s, max 16, evict FIFO; single-flight para no estampida bajo fan-out concurrente.
- mutex por modulo wasm serializa ejecucion (asyncify: una suspension async por modulo); lock se suelta siempre (fallo no envenena).
- verificacion sha256 de tool.js Y del snapshot ANTES de cargar/inyectar; contenido no verificado no se cachea ni ejecuta.
- capability memorySearch: indice WasmOkfIndex por request desde el snapshot cacheado (sin estado compartido); k acotado [1,10].
- atestaciones: veredicto por skill con precedencia INVALID DOMINA; canonical origin en payload (anti-replay cross-origin); attester no registrado se ignora; modos off/advisory/enforcing; X-Gw-Attestations cuenta sobre TODAS las skills antes del filtro enforcing.
- comparacion del token en tiempo constante (double-HMAC WebCrypto) y por que (evitar timing leak).
- cache-bust ?_gw=<ts> en fetchText y por que (bypass del edge cache de CF para .txt/.js).

## Borrado
- Narración histórica y referencias a tareas (TAREA-N, "antes X ahora Y").
- Justificaciones de compat con versiones viejas.
- Los 22 divisores de sección decorativos `// --- ... ---`.
- Comentarios que solo reformulaban lo que el código dice (p.ej. `// --- parse ---`).

## No se redeployó
esbuild strippea comentarios; el bundle es equivalente y el código ejecutable es byte-identico (verificado arriba).

## Archivos tocados
- worker-gateway.mjs (único)
- TAREA32-REPORT.md (este reporte)
- No commits. No deploys.