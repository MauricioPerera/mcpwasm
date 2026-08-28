# relay — pasarela de provisioning para la consola del studio

Cloudflare **rechaza** crear cuentas temporales (`POST /client/v4/provisioning/previews`)
cuando la petición llega desde un Worker de Cloudflare: responde 403 código
**1017 `worker_subrequest_blocked`** (verificado en producción; el challenge y
las demás rutas SÍ pasan). Por eso el relay corre **fuera de Cloudflare**.

Consola (navegador) → `https://<relay>.deno.dev/client/v4/...` → api.cloudflare.com

## Qué es

- `rules.mjs` — **reglas puras** (contrato KDD `relay-rules`, oráculo Node 17/17):
  whitelist cerrada de las 6 rutas del ciclo de vida del preview
  (challenge, create, PUT script, GET subdomain, enable, DELETE script) y la
  decisión CORS/PNA. Deno y Node cargan el MISMO módulo.
- `deno/main.ts` — proxy sin estado: transmite método/authorization/body sin
  tocar nada, no guarda datos, no loguea tokens.

## Desplegar (uno de estos dos)

**Opción uno-clic** (sin token): abre

```
https://dash.deno.com/new?url=https://raw.githubusercontent.com/MauricioPerera/mcpwasm/main/relay/deno/main.ts
```

acepta, y Deno Deploy crea el proyecto y te da la URL `xxx.deno.dev`.

**Opción con token** (para deployar desde local):

```bash
export DENO_DEPLOY_TOKEN=<token>
npx deployctl deploy --project=mcpwasm-relay relay/deno/main.ts
```

## Conectar al studio

Con la URL del relay (`xxx.deno.dev`):

```bash
RELAY_ORIGIN=https://xxx.deno.dev node studio/build.mjs   # inyecta <meta name="console-relay">
npx wrangler deploy --config studio/wrangler.toml
# verificación en vivo:
node scripts/live-browser-e2e.mjs   # e2e de navegador real (usa RELAY_BASE para el relay remoto)
```

Sin `RELAY_ORIGIN`, la consola cae al proxy `/console/cf/*` del worker — que
sirve para todo MENOS crear la cuenta (1017).

## Desarrollo local

```bash
CF_RELAY_ALLOW_ANY_ORIGIN=1 deno run -A relay/deno/main.ts   # :8000
node tests/test-relay-rules.mjs                              # reglas 17/17
node scripts/live-console-e2e.mjs                            # e2e con relay local (CONSOLE_API_BASE)
node scripts/live-browser-e2e.mjs                            # consola real en Chromium
```