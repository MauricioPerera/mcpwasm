---
type: 'Task Contract'
title: 'console-tools: tools del agente para la consola del studio'
description: 'Capa de tools de la consola en el navegador: crea/reusa previews efimeros, consulta estado con el claim de la plataforma, inicia el claim con paylink y descarta la sesion, con store inyectado.'
tags: ['studio-console', 'webmcp', 'browser', 'provisioning']

task: console-tools
intent: "Exponer a cualquier agente (WebMCP/MCP en el navegador) las cuatro operations del ciclo de vida del preview efimero, manteniendo el apiToken solo en el store local de la consola."
target: web/console-tools.mjs
signature: "function makeConsoleTools(deps: { platformOrigin?: string, apiBase?: string, fetchImpl?: (url: string, init?: object) => Promise<Response>, store: { get: (sid: string) => object | null, set: (sid: string, session: object) => void, remove: (sid: string) => void } }): { create_preview: (args: object) => Promise<object>, preview_status: (args: object) => Promise<object>, claim_preview: (args: object) => Promise<object>, discard_preview: (args: object) => Promise<object> }"
test_command: "node tests/test-console-tools.mjs"
budget:
  cyclomatic_max: 10
  lines_max: 140
  params_max: 1
tests: "tests/test-console-tools.mjs"
tests_sha256: "dc697e07d2c80a438a56f6143ab4881d7b0d9dd91b62e2132bf10befcf032efa"
touch_only: ['web/console-tools.mjs']
deps_allowed: ['web/deploy-preview-web.mjs']
forbids: ['subprocess', 'fs-write']
---
# Contract: console-tools: tools del agente para la consola del studio

## Intent
Exponer a cualquier agente (WebMCP/MCP en el navegador) las cuatro operations del ciclo de vida del preview efimero, manteniendo el apiToken solo en el store local de la consola.

## Interface
```
function makeConsoleTools(deps: { platformOrigin?: string, apiBase?: string, fetchImpl?: (url: string, init?: object) => Promise<Response>, store: { get: (sid: string) => object | null, set: (sid: string, session: object) => void, remove: (sid: string) => void } }): { create_preview: (args: object) => Promise<object>, preview_status: (args: object) => Promise<object>, claim_preview: (args: object) => Promise<object>, discard_preview: (args: object) => Promise<object> }
```

## Invariants
- NINGUNA tool devuelve el apiToken: vive solo en el store
- reuse con sid existente no repite challenge/PoW ni crea cuenta nueva
- claim_preview absolutiza payment_url con platformOrigin
- discard usa el token del store local y no deja sesion; si no hay sesion, ok:false sin throw

## Examples
- tools.create_preview({files, main}) -> {ok, sid, previewUrl, claimUrl...} y JSON.stringify(resultado) no contiene el apiToken
- tools.create_preview({files, main, sid}) con sesion guardada -> redeploy SIN nuevo challenge
- tools.discard_preview({sid}) -> DELETE del script con Bearer local + store sin la sesion

## Do / Don't
- DO: create_preview({files, main, sid?}): usa deployPreviewWeb; si el store ya tiene el sid, reusa la cuenta guardada (sin nuevo PoW ni creacion)
- DO: guarda en el store {account, scriptName, previewUrl, claimUrl, expiresAt, claimExpiresAt, savedAt} - el apiToken SOLO ahi
- DO: devuelve al agente {ok, sid, scriptName, previewUrl, claimUrl, expiresAt, accountName, registered} SIN apiToken
- DO: preview_status: sesion local + GET {platformOrigin}/preview?sid= (claimed, expirest extendido); claim_preview: POST /preview/claim {sid, email} con payment_url absolutizado; discard_preview: DELETE del script con Bearer del token local + POST /preview/discard + remove del store
- DON'T: no expongas el apiToken en el resultado de ninguna tool
- DON'T: no toques el oraculo tests/test-console-tools.mjs
- DON'T: no uses localStorage directamente: el store llega inyectado (get/set/remove)
- DON'T: no uses Buffer ni Node APIs

## Tests
(Los tests estan en `tests/test-console-tools.mjs` — oraculo congelado, sellado por `tests_sha256`.)

## Constraints
- PARAR y reportar si necesitas conectarte a la red.
- PARAR y reportar si el `intent` resulta imposible de cumplir sin violar `touch_only` o `forbids`.
