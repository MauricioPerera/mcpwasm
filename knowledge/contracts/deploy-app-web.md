---
type: 'Task Contract'
title: 'deploy-app-web: deploy multipart a la cuenta temporal desde el navegador'
description: 'Despliega los archivos del app en la cuenta temporal de Cloudflare desde el navegador: PUT multipart del script, subdomain y enable, con fetch inyectable.'
tags: ['provisioning', 'browser', 'cloudflare', 'studio-console', 'deploy']

task: deploy-app-web
intent: "Desplegar los archivos del app en la cuenta temporal de Cloudflare desde el navegador de la consola, sin wrangler ni Node."
target: web/deploy-app-web.mjs
signature: "async function deployAppWeb(fetchImpl: (url: string, init?: object) => Promise<Response>, opts: { apiBase?: string, accountId: string, apiToken: string, scriptName: string, files: Array<{ name: string, content: string }>, main: string, compatibilityDate?: string, compatibilityFlags?: string[] }): Promise<{ deployed: boolean, subdomain: string | null, previewUrl: string | null }>"
test_command: "node tests/test-deploy-app-web.mjs"
budget:
  cyclomatic_max: 10
  lines_max: 100
  params_max: 2
tests: "tests/test-deploy-app-web.mjs"
tests_sha256: "ab4e5947dc577b682c6a5a2359f7e87bc203522f0f3ee34da0907e25c55dd7ca"
touch_only: ['web/deploy-app-web.mjs']
deps_allowed: []
forbids: ['subprocess', 'fs-write']
---
# Contract: deploy-app-web: deploy multipart a la cuenta temporal desde el navegador

## Intent
Desplegar los archivos del app en la cuenta temporal de Cloudflare desde el navegador de la consola, sin wrangler ni Node.

## Interface
```
async function deployAppWeb(fetchImpl: (url: string, init?: object) => Promise<Response>, opts: { apiBase?: string, accountId: string, apiToken: string, scriptName: string, files: Array<{ name: string, content: string }>, main: string, compatibilityDate?: string, compatibilityFlags?: string[] }): Promise<{ deployed: boolean, subdomain: string | null, previewUrl: string | null }>
```

## Invariants
- los archivos viajan intactos en el multipart
- los .wasm van con application/wasm y el resto application/javascript+module
- si el subdomain es null, previewUrl es null y deployed sigue siendo true (deploy sin URL publica)
- los errores HTTP se reportan con el status en el mensaje

## Examples
- deployAppWeb(fake,{apiBase,accountId,apiToken,scriptName,files,main:'app.js'}) -> 3 requests (PUT, GET subdomain, POST enable) y previewUrl https://<script>.<sub>.workers.dev
- files [{name:'engine.wasm',content}] viaja con type application/wasm
- PUT HTTP 403 -> throw con el status en el mensaje

## Do / Don't
- DO: PUT {apiBase}/accounts/:id/workers/scripts/:name con Authorization Bearer y body FormData
- DO: metadata JSON con main_module y rules CompiledWasm (fallthrough false), compatibility_date default 2024-01-01
- DO: cada file como Blob con type application/wasm para .wasm y application/javascript+module para el resto
- DO: GET subdomain -> result.subdomain; POST scripts/:name/subdomain con {enabled:true}; previewUrl = https://<script>.<subdomain>.workers.dev
- DON'T: no uses Buffer ni APIs de Node: FormData y Blob estandar
- DON'T: no toques el oraculo tests/test-deploy-app-web.mjs
- DON'T: no hagas fetch global: usa el fetchImpl recibido
- DON'T: no registres el apiToken en logs

## Tests
(Los tests estan en `tests/test-deploy-app-web.mjs` — oraculo congelado, sellado por `tests_sha256`.)

## Constraints
- PARAR y reportar si necesitas conectarte a la red.
- PARAR y reportar si el `intent` resulta imposible de cumplir sin violar `touch_only` o `forbids`.
