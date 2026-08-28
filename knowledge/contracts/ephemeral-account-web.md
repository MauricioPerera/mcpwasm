---
type: 'Task Contract'
title: 'ephemeral-account-web: cuenta temporal de Cloudflare desde el navegador'
description: 'Crea la cuenta temporal de Cloudflare desde el navegador: challenge, PoW con solve-pow-web y POST de creacion, con fetch inyectable y errores controlados.'
tags: ['provisioning', 'browser', 'cloudflare', 'studio-console', 'ephemeral']

task: ephemeral-account-web
intent: "Crear la cuenta temporal de Cloudflare desde el navegador de la consola, sin wrangler ni Node, usando fetch inyectable."
target: web/ephemeral-account-web.mjs
signature: "async function createAccountWeb(fetchImpl: (url: string, init?: object) => Promise<Response>, opts?: { apiBase?: string }): Promise<{ account: { id: string, name?: string, apiToken: string, expiresAt: string }, claim: { url: string, expiresAt: string } }>"
test_command: "node tests/test-ephemeral-account-web.mjs"
budget:
  cyclomatic_max: 10
  lines_max: 120
  params_max: 2
tests: "tests/test-ephemeral-account-web.mjs"
tests_sha256: "ce7eed7040af3098b285bbeed22c203d884aa6bb3ecee3d57331abcae3a09812"
touch_only: ['web/ephemeral-account-web.mjs']
deps_allowed: ['web/solve-pow-web.mjs']
forbids: ['subprocess', 'fs-write']
---
# Contract: ephemeral-account-web: cuenta temporal de Cloudflare desde el navegador

## Intent
Crear la cuenta temporal de Cloudflare desde el navegador de la consola, sin wrangler ni Node, usando fetch inyectable.

## Interface
```
async function createAccountWeb(fetchImpl: (url: string, init?: object) => Promise<Response>, opts?: { apiBase?: string }): Promise<{ account: { id: string, name?: string, apiToken: string, expiresAt: string }, claim: { url: string, expiresAt: string } }>
```

## Invariants
- los checkpoints enviados son la cadena sha256 (k+1 checkpoints, g pasos) de la seed decodificada base64url, verificable contra node:crypto
- acepta respuesta con wrapper .result o plana
- los errores HTTP se reportan con el status y el detalle en el mensaje
- el fetch NUNCA se llama al network real en tests: siempre el fetchImpl inyectado

## Examples
- createAccountWeb(fakeFetch,{apiBase:'https://x/v4'}) con challenge {challengeToken:'ctok-fake',seed,k:3,g:2} -> POST previews con solution.checkpoints == cadena sha256 de node:crypto
- respuesta plana sin .result tambien parsea
- challenge HTTP 500 -> throw 'challenge HTTP 500'

## Do / Don't
- DO: decodifica la seed del challenge desde base64url a bytes sin Buffer (atob o decodificador propio, estandar navegador)
- DO: resuelve el PoW con solve-pow-web y envia solution.checkpoints como base64 concatenado
- DO: POST /provisioning/previews con acceptTermsOfService:'yes' y challengeToken
- DO: parsea respuesta con wrapper .result o plana, y valida account(id,apiToken,expiresAt) + claim.url antes de devolver
- DON'T: no uses Buffer ni APIs de Node: solo TextEncoder/TextDecoder, atob/btoa o decodificacion manual
- DON'T: no toques el oraculo tests/test-ephemeral-account-web.mjs
- DON'T: no hagas fetch global: usa el fetchImpl recibido como parametro
- DON'T: no imprimas ni registres el apiToken

## Tests
(Los tests estan en `tests/test-ephemeral-account-web.mjs` — oraculo congelado, sellado por `tests_sha256`.)

## Constraints
- PARAR y reportar si necesitas conectarte a la red.
- PARAR y reportar si el `intent` resulta imposible de cumplir sin violar `touch_only` o `forbids`.
