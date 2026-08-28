---
type: 'Task Contract'
title: 'console-webmcp: registro WebMCP de las tools de la consola'
description: 'Registra las 4 tools del ciclo de vida del preview en navigator.modelContext (inyectado) y envuelve los resultados para el agente; los fallos de registro o de handler no revientan el resto.'
tags: ['studio-console', 'webmcp', 'browser']

task: console-webmcp
intent: "Exponer las tools de la consola al agente via navigator.modelContext (WebMCP) de forma robusta: esquemas, resultados serializados, sin excepciones sin atrapadar."
target: web/console-webmcp.mjs
signature: "async function registerConsoleWebMCP(mc: { registerTool: (def: object) => void }, tools: Record<string, (args: object) => Promise<object>>, opts?: { onLog?: (msg: string) => void }): Promise<{ registered: number, failed: Array<object> }>"
test_command: "node tests/test-console-webmcp.mjs"
budget:
  cyclomatic_max: 10
  lines_max: 110
  params_max: 3
tests: "tests/test-console-webmcp.mjs"
tests_sha256: "457ef3ed0344bf8e3df59d0b69beb71ff13ad8c103d1f42fca8ce1972fb0819f"
touch_only: ['web/console-webmcp.mjs']
deps_allowed: []
forbids: ['subprocess', 'fs-write']
---
# Contract: console-webmcp: registro WebMCP de las tools de la consola

## Intent
Exponer las tools de la consola al agente via navigator.modelContext (WebMCP) de forma robusta: esquemas, resultados serializados, sin excepciones sin atrapadar.

## Interface
```
async function registerConsoleWebMCP(mc: { registerTool: (def: object) => void }, tools: Record<string, (args: object) => Promise<object>>, opts?: { onLog?: (msg: string) => void }): Promise<{ registered: number, failed: Array<object> }>
```

## Invariants
- execute nunca lanza: siempre devuelve JSON serializado (handler que lanza -> {ok:false,error})
- los fallos de registerTool se acumulan en failed[] sin abortar las demas tools
- solo se registran tools cuyo handler sea funcion
- execute devuelve SIEMPRE content[0].type === 'text'

## Examples
- registerConsoleWebMCP(fakeMc, TOOLS, {onLog}) -> {registered:4} y 4 registroTool con name/description/inputSchema/execute
- execute({sid:'boom'}) de un handler que lanza -> content[0].text incluye '"ok":false'
- mc.registerTool que lanza en claim_preview -> registered:3 y failed:[{name:'claim_preview'}]

## Do / Don't
- DO: para cada tool en orden (create_preview, preview_status, claim_preview, discard_preview): mc.registerTool({ name, description, inputSchema, execute })
- DO: execute(input) devuelve { content: [{ type: 'text', text: JSON.stringify(resultado) }] }
- DO: si el handler lanza, execute devuelve JSON {ok:false, error:mensaje} sin reventar
- DO: reporta { registered, failed:[{name,error}] } y llama opts.onLog con eventos
- DON'T: no toques el oraculo tests/test-console-webmcp.mjs
- DON'T: no dependas del DOM: mc llega inyectado (en el navegador, navigator.modelContext)
- DON'T: no expongas el apiToken: las tools ya lo filtran, el puente no toca el resultado

## Tests
(Los tests estan en `tests/test-console-webmcp.mjs` — oraculo congelado, sellado por `tests_sha256`.)

## Constraints
- PARAR y reportar si necesitas conectarte a la red.
- PARAR y reportar si el `intent` resulta imposible de cumplir sin violar `touch_only` o `forbids`.
