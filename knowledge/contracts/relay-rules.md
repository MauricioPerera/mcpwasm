---
type: 'Task Contract'
title: 'relay-rules: whitelist de rutas y CORS del relay de provisioning'
description: 'Reglas puras del relay de provisioning: whitelist de metodo+ruta (el ciclo de la consola sobre la cuenta temporal) y respuesta CORS/PNA solo para origins permitidos.'
tags: ['relay', 'provisioning', 'browser', 'security']

task: relay-rules
intent: "Centralizar que puede hacer el relay y a quien responde CORS, como modulo puro compartido por Deno y los tests de Node."
target: relay/rules.mjs
signature: "function allowedRoute(method: string, path: string): boolean + function corsHeaders(origin: string | null, allowAnyOrigin: boolean): Record<string, string> + export const RELAY_ORIGIN: string"
test_command: "node tests/test-relay-rules.mjs"
budget:
  cyclomatic_max: 8
  lines_max: 70
  params_max: 2
tests: "tests/test-relay-rules.mjs"
tests_sha256: "1cd1973b9c65dcd2083163822230dc343a410b268c932d19215fd4088f127ee0"
touch_only: ['relay/rules.mjs']
deps_allowed: []
forbids: ['subprocess', 'fs-write']
---
# Contract: relay-rules: whitelist de rutas y CORS del relay de provisioning

## Intent
Centralizar que puede hacer el relay y a quien responde CORS, como modulo puro compartido por Deno y los tests de Node.

## Interface
```
function allowedRoute(method: string, path: string): boolean + function corsHeaders(origin: string | null, allowAnyOrigin: boolean): Record<string, string> + export const RELAY_ORIGIN: string
```

## Invariants
- sin ACAO para origins no permitidos salvo allowAnyOrigin=true (solo tests/dev)
- las rutas se evaluan exactas sobre el pathname crudo (sin decodificar)
- DELETE solo aplica a scripts, nunca a cuentas

## Examples
- allowedRoute('POST', '/client/v4/provisioning/previews/challenge') -> true
- allowedRoute('GET', '/client/v4/zones') -> false
- corsHeaders('https://evil.test', false) no tiene access-control-allow-origin

## Do / Don't
- DO: allowedRoute(method, path): true SOLO para POST /client/v4/provisioning/previews(/challenge)?, PUT /client/v4/accounts/:id/workers/scripts/:name, GET /client/v4/accounts/:id/workers/subdomain, POST ...<script>/subdomain y DELETE <script>
- DO: corsHeaders(origin, allowAnyOrigin): devuelve headers de preflight (methods/headers/cache-control/vary) y ACAO solo si el origin esta permitido o allowAnyOrigin
- DO: incluye access-control-allow-private-network: true cuando hay ACAO (preflight PNA desde la consola https)
- DON'T: no hagas IO ni fetch: este modulo solo decide, main.ts ejecuta
- DON'T: no toque el oraculo tests/test-relay-rules.mjs
- DON'T: no aceptes rutas con trailing slash ni path traversal

## Tests
(Los tests estan en `tests/test-relay-rules.mjs` — oraculo congelado, sellado por `tests_sha256`.)

## Constraints
- PARAR y reportar si necesitas conectarte a la red.
- PARAR y reportar si el `intent` resulta imposible de cumplir sin violar `touch_only` o `forbids`.
