# TAREA13-REPORT — consumo por un agente MCP real

> **Nota de procedencia (backfill).** Este reporte se reconstruyó a partir de la
> evidencia real ya commiteada de la tarea (commit `937a6c2`, 2026-07-02). El
> dev de T13 se interrumpió a mitad de sesión, por lo que en su momento se
> verificó y commiteó la evidencia directamente (`t13-client-output.txt`,
> `mcp-bookstore.json` y el transcript del cliente) en lugar de escribir este
> archivo. Se backfillea aquí (T-doc) para completar la serie de reportes; no
> hay trabajo nuevo — solo se documenta lo que ya ocurrió y quedó en el repo.

## Objetivo

Demostrar que un cliente MCP **genérico y sin modificar** puede descubrir y usar
las skills del gateway con solo la URL del servidor MCP — sin código específico
del catálogo. Es la prueba de la tesis "Static MCP": un sitio estático publica
`llms.txt` con skills ejecutables y cualquier agente MCP las consume.

## Montaje

Config MCP del cliente (`mcp-bookstore.json`, el token real se sustituye en la
copia local `.local.json` gitignored):

```json
{"mcpServers":{"bookstore":{"type":"http","url":"https://llmstxt-gateway.rckflr.workers.dev/mcp?origin=https%3A%2F%2Fllmstxt-bookstore.rckflr.workers.dev","headers":{"Authorization":"Bearer <TOKEN>"}}}}
```

Cliente: instancia headless de `claude` (GLM) lanzada con `--mcp-config
mcp-bookstore.json --strict-mcp-config --allowedTools "mcp__bookstore__*"` y el
prompt en lenguaje natural: *"busca libros de ciencia ficción por debajo de $15,
revisa el stock, y recomiéndame uno que esté disponible; usa las tools del
servidor MCP bookstore para todo, no inventes datos."*

## Resultado

Recomendación del agente (`t13-client-output.txt`):

```
Ender's Game — Orson Scott Card
Género: science-fiction | Precio: $10 (< $15) | Stock: 30 ✅ disponible
```

### Verdad-terreno (contraste contra D1)

`GET https://llmstxt-bookstore.rckflr.workers.dev/api/book/19` →
`{"id":19,"title":"Ender's Game","author":"Orson Scott Card","genre":"science-fiction","price":10,"stock":30}`.
Datos exactos, cumple los filtros (science-fiction, < $15, stock > 0). El agente
no inventó nada.

### Evidencia de tool calls reales (transcript del cliente)

El `.jsonl` de la sesión del cliente muestra las `tools/call` reales con sus
argumentos — el agente ejecutó las skills, no improvisó:

```
mcp__bookstore__search_catalog  {"q":"","genre":"science-fiction","max_price":15}
mcp__bookstore__stock_report    {}
mcp__bookstore__search_catalog  {"genre":"science-fiction","max_price":15,"q":"science fiction"}
mcp__bookstore__get_book        {"id":19}
```

## HALLAZGO (el bug que esta prueba cazó)

`search_catalog` falló en el cliente con `invalid_type` de zod: el gateway
devolvía un **array** como `structuredContent`, pero la spec MCP exige que sea
un **objeto**. Curl lo veía "bien"; un cliente MCP conforme lo rechazaba, dejando
la tool inutilizable. El agente lo sorteó pivotando a `stock_report` (top3 por
stock) + `get_book` para confirmar los datos — de ahí que la recomendación sea
correcta pese al fallo de `search_catalog`.

Este hallazgo motivó **T14**: envolver arrays/primitivos en `{ result: <valor> }`
en `mcp-core.mjs` / `mcp-core-async.mjs` (ver `TAREA14-REPORT.md`). Tras T14 se
re-corrió la prueba del cliente y `search_catalog` entregó datos sin
`invalid_type`.

## Veredicto

Cadena end-to-end demostrada: sitio estático (`llms.txt` + skills) → gateway
(descubre, verifica hash, sandboxea) → agente MCP sin modificar. Y la prueba
cumplió su función doble: validó lo que funciona y cazó un bug de conformidad
(structuredContent) que ninguna verificación por curl habría mostrado.
