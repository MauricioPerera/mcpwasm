# TAREA23 — Review upstream de la spec: 2 cambios de implementacion

## Cambios pedidos

1. **POSICION**: la linea `skills-memory` debe ir ANTES de la seccion `## Skills`
   en llms.txt (algunos parsers conformes pliegan lineas sueltas tras la lista
   dentro del ultimo skill).
2. **CHECK DEFENSIVO**: `search_spec.tool.js` debe verificar
   `typeof host.memorySearch === "function"` antes de llamarla y, si falta,
   devolver `{ok:false, error:"memory capability unavailable"}` en vez de
   lanzar TypeError. Cambiar el tool.js cambia su `tool_sha256`; el build
   regenera llms.txt con los hashes consistentes.

## Archivos tocados

- `docs-site/build.mjs` — emite la linea `skills-memory` ANTES del heading
  `## Skills` (antes iba tras la lista de skills).
- `docs-site/content/search_spec.tool.js` — check defensivo sobre
  `host.memorySearch` antes de invocarla; si no es funcion devuelve
  `{ok:false, error:"memory capability unavailable"}`.
- `docs-site/` artefactos regenerados por el build: `worker.mjs`,
  `wrangler.toml`, `skills-index.snapshot`, `doc-sources.json`.

## Gateway (`llmstxt-parse.mjs`) — NO tocado

`parseLlmsTxt` itera todas las lineas del archivo y matchea `MEMORY_RE` en
cualquier posicion (toma la primera valida). Es **position-independent**: la
linea se encuentra igual antes o despues de `## Skills`. No requirio ajuste ni
redeploy del gateway.

## Deploy

- docs-site: `npx wrangler deploy -c docs-site/wrangler.toml` ->
  https://llmstxt-docs.rckflr.workers.dev (Version 9bf223e8-...)
- gateway: NO redeployado (sin cambios).

## Hashes declarados (regenerados, consistentes con lo servido)

- search_spec tool_sha256: `95301993d9e1b8881e489734914ca7e7ceea3f4220c162f14206238c3ecdbbee` (nuevo)
- get_doc tool_sha256:        `7cff29b54d5fdecb3c203c749475e9bae1955d3f5c397df4fb2ee9ac5a4eecd0`
- list_docs tool_sha256:      `17d6175805386a0829012ab088c72ca98058255564a47230903c697432666735`
- snapshot_sha256:            `caad4c4bbf9fa9d1a4d1ea445b37d6b762beb74b972502045a4c44385f80e03f`

## Verificacion (salidas reales)

### a. curl https://llmstxt-docs.rckflr.workers.dev/llms.txt

La linea `skills-memory` aparece ANTES de `## Skills`; las 3 skills siguen
listadas:

```
# llmstxt-docs

> Publisher of the llms-txt-skills standard documents. ...

<!-- skills-memory: {"snapshot":"/skills-index.snapshot","snapshot_sha256":"caad4c4b...80e03f","format":"minimemory-okf-v1"} -->

## Skills

- [search_spec](/skills/search_spec/SKILL.md): BM25 search ... <!-- skill: {"version":"1.0.0","tool":"/skills/search_spec/tool.js","tool_sha256":"95301993...dbbee"} -->
- [get_doc](/skills/get_doc/SKILL.md): Fetch one of the 4 ... <!-- skill: {...,"tool_sha256":"7cff29b5...eecd0"} -->
- [list_docs](/skills/list_docs/SKILL.md): List the 4 ... <!-- skill: {...,"tool_sha256":"17d61758...66735"} -->
```

### b. verify.mjs contra produccion -> OVERALL: OK

```
=== /skills/search_spec/tool.js ===  match: OK  (95301993...dbbee)
=== /skills/get_doc/tool.js ===       match: OK  (7cff29b5...eecd0)
=== /skills/list_docs/tool.js ===     match: OK  (17d61758...66735)
=== /skills-index.snapshot ===        match: OK  (caad4c4b...80e03f)
OVERALL: OK
```
3 tool_sha256 OK (incluido el nuevo de search_spec) + snapshot_sha256 OK.

### c. Gateway en produccion (Bearer), tras TTL de descubrimiento (70s)

`POST https://llmstxt-gateway.rckflr.workers.dev/mcp?origin=...docs-site`
`tools/call search_spec {"q":"tool_sha256 integrity"}` -> HTTP 200,
`isError:false`, **5 hits no vacios** (top: "rfc-skills-in-llms-txt: 8. Open
Questions", score -6.45). La nueva posicion parsea bien y la capability
`host.memorySearch` sigue inyectandose.

### d. npm run gateway -> exit 0

`node build-gateway.mjs && node mf-gateway.mjs` -> `TODOS LOS CHECKS VERDE`,
`GATEWAY_EXIT=0`. Incluye T22.b (search_spec "tool_sha256 integrity
verification" -> hits no vacios contra el docs-site real) y T22.f (snapshot
corrupto -> skill listada, memorySearch no inyectada, fail controlado
isError:true — coherente con el nuevo check defensivo del tool).

## Resultado

LISTO. Los 2 cambios aplicados, docs-site redeployado, gateway sin cambios
(parser position-independent), las 4 verificaciones (a-d) en verde desde
produccion y e2e local.