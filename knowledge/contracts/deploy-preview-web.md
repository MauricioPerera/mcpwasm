---
type: 'Task Contract'
title: 'deploy-preview-web: orquestador create+deploy+register en el navegador'
description: 'Orquestador del navegador: crea la cuenta temporal, despliega el app y registra el deploy en la plataforma con solo metadatos (sin apiToken).'
tags: ['provisioning', 'browser', 'orchestration', 'studio-console']

task: deploy-preview-web
intent: "Orquestar desde el navegador: cuenta temporal + deploy + registro en la plataforma para la tool create_preview de la consola del studio."
target: web/deploy-preview-web.mjs
signature: "async function deployPreviewWeb(fetchImpl: (url: string, init?: object) => Promise<Response>, opts: { platformOrigin?: string, apiBase?: string, files: Array<{ name: string, content: string }>, main: string, sid?: string, account?: object }): Promise<object>"
test_command: "node tests/test-deploy-preview-web.mjs"
budget:
  cyclomatic_max: 10
  lines_max: 110
  params_max: 2
tests: "tests/test-deploy-preview-web.mjs"
tests_sha256: "79fc4f2814a74603782ab212464cfb2bc54f374dca361bfca1fe16eb36324e9d"
touch_only: ['web/deploy-preview-web.mjs']
deps_allowed: ['web/ephemeral-account-web.mjs', 'web/deploy-app-web.mjs']
forbids: ['subprocess', 'fs-write']
---
# Contract: deploy-preview-web: orquestador create+deploy+register en el navegador

## Intent
Orquestar desde el navegador: cuenta temporal + deploy + registro en la plataforma para la tool create_preview de la consola del studio.

## Interface
```
async function deployPreviewWeb(fetchImpl: (url: string, init?: object) => Promise<Response>, opts: { platformOrigin?: string, apiBase?: string, files: Array<{ name: string, content: string }>, main: string, sid?: string, account?: object }): Promise<object>
```

## Invariants
- el apiToken vive SOLO en el resultado local (store de la consola): nunca en el registro de la plataforma ni en la URL
- reuse con opts.sid/opts.account no paga PoW ni crea cuenta
- scriptName siempre 'mcpwasm-preview-' + sid.slice(0,8)
- el registro a la plataforma es best effort (best-effort: fallo -> registered:false sin throw)

## Examples
- flujo nuevo: 6 llamadas (challenge, create, PUT, subdomain, enable, register) y out.previewUrl == https://mcpwasm-preview-<sid8>.<sub>.workers.dev
- register body: {sid, scriptName, previewUrl, claimUrl, expiresAt, claimExpiresAt} sin 'TOK-9'
- fallos: registro 500 -> resultado ok con registered:false

## Do / Don't
- DO: sid = opts.sid || crypto.randomUUID(); scriptName = 'mcpwasm-preview-' + sid.slice(0,8)
- DO: si opts.account existe: reusar esa cuenta SIN challenge ni creacion (claimUrl desde account.claimUrl)
- DO: si no: createAccountWeb -> account + claim; registrar via POST {platformOrigin}/preview/register con sid, scriptName, previewUrl, claimUrl, expiresAt, claimExpiresAt - SIN apiToken
- DO: deployAppWeb con la account; devolver {ok, sid, scriptName, account, claim, previewUrl, claimUrl, expiresAt, registered}
- DON'T: no toques el oraculo tests/test-deploy-preview-web.mjs
- DON'T: no pongas el apiToken en el body del registro ni en el resultado visible al agente
- DON'T: no rompas el flujo si la plataforma esta caida: registered:false y deployment ok
- DON'T: no uses Buffer ni Node APIs

## Tests
(Los tests estan en `tests/test-deploy-preview-web.mjs` — oraculo congelado, sellado por `tests_sha256`.)

## Constraints
- PARAR y reportar si necesitas conectarte a la red.
- PARAR y reportar si el `intent` resulta imposible de cumplir sin violar `touch_only` o `forbids`.
