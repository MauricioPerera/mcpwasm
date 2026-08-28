---
type: 'Task Contract'
title: 'solve-pow-web: solver de PoW puro-JS portable a navegador'
description: 'Resuelve el challenge de PoW del provisioning de Cloudflare en la pestana: sha256 puro-JS, cadena de checkpoints y codificacion base64.'
tags: ['pow', 'browser', 'provisioning', 'studio-console']

task: solve-pow-web
intent: "Proveer el solver de PoW de provisioning de Cloudflare como modulo puro-JS ejecutable en el navegador de la consola del studio."
target: web/solve-pow-web.mjs
signature: "function sha256Web(msg: string): Uint8Array; function solvePowWeb(seed: string, k: number, g: number): Uint8Array[]; function encodeCheckpointsWeb(checkpoints: Uint8Array[]): string"
test_command: "node tests/test-solve-pow-web.mjs"
budget:
  lines_max: 120
tests: "tests/test-solve-pow-web.mjs"
tests_sha256: "bd6e528f470b0fb59ab4cdf1c1a80b40070c8e03b245d995d6b8f4e580b3a497"
touch_only: ['web/solve-pow-web.mjs']
deps_allowed: []
forbids: ['network', 'subprocess', 'fs-write']
---
# Contract: solve-pow-web: solver de PoW puro-JS portable a navegador

## Intent
Proveer el solver de PoW de provisioning de Cloudflare como modulo puro-JS ejecutable en el navegador de la consola del studio.

## Interface
```
function sha256Web(msg: string): Uint8Array; function solvePowWeb(seed: string, k: number, g: number): Uint8Array[]; function encodeCheckpointsWeb(checkpoints: Uint8Array[]): string
```

## Invariants
- sha256Web coincide byte a byte con node:crypto para cualquier string UTF-8
- solvePowWeb(seed,k,g) devuelve exactamente k+1 checkpoints y es determinista
- el output es portable: corre identico en Node 24 y en un navegador moderno (solo JS estandar)

## Examples
- sha256Web('abc') -> bytes de node:crypto createHash('sha256').update('abc')
- solvePowWeb('unit-seed-2026', 5, 3) -> 6 checkpoints identicos a la cadena sha256 de node:crypto
- encodeCheckpointsWeb(cps) -> Buffer.concat(ref).toString('base64')

## Do / Don't
- DO: sha256 puro-JS con tablas H/K de raices de primos (mismo algoritmo que worker-ephemeral.mjs)
- DO: cadena de k+1 checkpoints con g pasos de sha256 entre cada uno, empezando por sha256(seed)
- DO: encodeCheckpointsWeb = base64 de la concatenacion de checkpoints en orden
- DO: funciones puras exportadas, sin I/O, sin globals del navegador ni de Node
- DON'T: no uses node:crypto ni WebCrypto async: el solver es sincrono y puro JS
- DON'T: no toques el oraculo tests/test-solve-pow-web.mjs
- DON'T: no dependas de fetch, window, document ni process
- DON'T: no cambies el formato de salida (Array de Uint8Array y base64 concatenado)

## Tests
(Los tests estan en `tests/test-solve-pow-web.mjs` — oraculo congelado, sellado por `tests_sha256`.)

## Constraints
- PARAR y reportar si necesitas conectarte a la red.
- PARAR y reportar si el `intent` resulta imposible de cumplir sin violar `touch_only` o `forbids`.
