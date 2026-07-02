# TAREA25 — ext-skill-attestations v0.2 (modo ADVISORY) en mcpwasm

Spec `ext-skill-attestations v0.2` implementada end-to-end en modo **advisory**.
Atestaciones Ed25519 reales firmadas por un revisor humano, publicadas por
docs-site en `/.well-known/agent-skills/attestations.json`, verificadas por el
gateway con WebCrypto, veredicto expuesto a consumidores (descripción de tool +
header `X-Gw-Attestations`). Sin tocar `host-async.mjs`, `mcp-core*.mjs`,
`llmstxt-parse.mjs`, `bookstore/**`, `demo-site/**`, `README.md`.

> **NUNCA** la clave privada ni el token en este report. Solo la pública.

---

## 1. Herramienta de firma — `scripts/attest.mjs`

Node-puro (sin deps). Dos subcomandos:

- `keygen` — genera par Ed25519 con `node:crypto.generateKeyPairSync`, escribe
  `.attester-key.json` `{attester, public_key (raw 32 bytes base64), private_jwk}`
  y **solo imprime la pública**. Añadido a `.gitignore` **antes** de crearlo.
- `sign <origin> <skill> <valid_until>` — lee `.attester-key.json`, hace
  `GET <canon>/llms.txt`, extrae el `tool_sha256` declarado para la skill
  (`/^-\s+\[([^\]]+)\]\([^)]*\):\s*.*?<!--\s*skill:\s*(\{.*\})\s*-->/`),
  arma el payload canónico, firma con Ed25519 y emite el JSON de atestación.

Payload canónico firmado (UTF-8, `\n`-separado):

```
<origin_canon>\n<skill>\n<tool_sha256>\n<signed_on>\n<valid_until>
```

`origin_canon = new URL(s).origin` (lowercase, sin puerto default, sin slash).
Atttester id: `human:mauricio`.

### Salida de keygen (SOLO la pública)

```
attester: human:mauricio
public_key: YghuJivYSVI458jIjwXEKDLmQaG6X4Itn1VzBXa/ikw=
```

(`.attester-key.json` queda en disco, gitignored, **no** trackeado — ver §6.)

---

## 2. Atestaciones reales emitidas

Firmadas contra el `llms.txt` desplegado de
`https://llmstxt-docs.rckflr.workers.dev` (2 de 3 skills; `list_docs`
dejada intencionalmente sin atestar para tener el mix attested/unattested).

`valid_until = 2027-07-02`, `signed_on = 2026-07-02`, `attester = human:mauricio`.

| skill        | tool_sha256 (declarado en llms.txt)                          |
|--------------|--------------------------------------------------------------|
| search_spec  | 95301993d9e1b8881e489734914ca7e7ceea3f4220c162f14206238c3ecdbbee |
| get_doc      | 7cff29b54d5fdecb3c203c749475e9bae1955d3f5c397df4fb2ee9ac5a4eecd0 |
| list_docs    | 17d6175805386a0829012ab088c72ca98058255564a47230903c697432666735 (NO atestada) |

Los `tool_sha256` coinciden con los `content/*.tool.js` servidos (bytes
inalterados por el rebuild), por lo que las atestaciones siguen siendo válidas
tras el redeploy de docs-site.

Array guardado en `docs-site/content/attestations.json` y servido por
`docs-site/worker.mjs` (y regenerado por `docs-site/build.mjs`) desde
`/.well-known/agent-skills/attestations.json` con
`content-type: application/json`.

### curl de attestations.json en producción

```
$ curl -s https://llmstxt-docs.rckflr.workers.dev/.well-known/agent-skills/attestations.json
[{"origin":"https://llmstxt-docs.rckflr.workers.dev","skill":"search_spec","tool_sha256":"95301993d9e1b8881e489734914ca7e7ceea3f4220c162f14206238c3ecdbbee","attester":"human:mauricio","signed_on":"2026-07-02","valid_until":"2027-07-02","signature":"ohpC1s+7keIF/BYUmGTwIwWSxLrH0OVc5zIvfwYl2tyrYh8r/o/dfvmAld/tZmBgJyXPMbKMfy4qoZfPO7ueDA=="},
{"origin":"https://llmstxt-docs.rckflr.workers.dev","skill":"get_doc","tool_sha256":"7cff29b54d5fdecb3c203c749475e9bae1955d3f5c397df4fb2ee9ac5a4eecd0","attester":"human:mauricio","signed_on":"2026-07-02","valid_until":"2027-07-02","signature":"WvlhjJAfQGBYZte4XQDD+C3OpGcyJIoiBPNsNs+vjbDoi0/7jwUhw4NrPfvXRJkYu4mTzWA6dMWTzPzdxvI2CA=="}]
```

---

## 3. Gateway — `worker-gateway.mjs` + `wrangler-gateway.toml`

Nuevas vars: `REVIEWERS` (JSON, literal string TOML) y `ATTESTATION_MODE`
(`"advisory"`, también `"enforcing"` / `"off"`).

`wrangler-gateway.toml`:

```toml
REVIEWERS = '{"human:mauricio":{"public_key":"YghuJivYSVI458jIjwXEKDLmQaG6X4Itn1VzBXa/ikw=","registered_at":"2026-07-02"}}'
ATTESTATION_MODE = "advisory"
```

### Helpers añadidos al gateway

- `attestationMode(env)` — `"off"` si unset; sino el valor literal.
- `parseReviewers(env)` — `{attester: {public_key, registered_at}}` o `{}`.
- `canonicalOrigin(s)`, `todayUtcStr()`, `b64ToBytes(s)`.
- `verifyEd25519(pubB64, sigB64, data)` — `crypto.subtle.importKey("raw", 32bytes, {name:"Ed25519"}, false, ["verify"])` + `crypto.subtle.verify("Ed25519", key, sig, data)`; try/catch → `false`. (Patrón confirmado por el probe WebCrypto, ver §7.)
- `fetchAttestations(origin, fetchImpl)` — 404 → `null` (sin error, todas unattested); no-200/no-array → `null`.
- `verdictForSkill(skill, origin, attestations, reviewers, today)` — matching por `origin+skill+tool_sha256`; attester no registrado → ignorado; sig falla → `invalid`; válida + en ventana → `attested`; válida + `today > valid_until` → `expired`. Precedencia **INVALID > attested > expired > unattested**.
- `computeVerdicts(skills, origin, attestations, reviewers)` → `{verdicts, counts}`.
- `attestHeaderStr(counts)` → `"Naattested,Nexpired,Ninvalid,Nunattested"`.

### Discovery

`fetchAttestations` se corre en el mismo fetchImpl/timeout del discovery de skills
(caché aislada, 60s TTL, single-flight), junto con `computeVerdicts`. 404 del
archivo = `null` = todas unattested, **no** es error.

### Exposición

- **Advisory**: append `" [attestation: <verdict>]"` a cada descripción de tool
  en `tools/list`; header `X-Gw-Attestations: <counts>`. No excluye nada.
- **Enforcing**: excluye las no-attested (igual que un hash mismatch).
- **Off**: comportamiento previo intacto (no se fetchea attestations.json).

`X-Gw-attestations` se adjunta a la respuesta 200 y a las 202/500.

---

## 4. Tests — `mf-gateway.mjs` (bloque T25, fetchImpl fake local + service binding DOCS)

Casos con un llms.txt fake de 4 skills (`attested_skill`, `invalid_skill`,
`expired_skill`, `unattested_skill`), `tool.js` con sha coincidente, y un
attestations.json firmado con un par Ed25519 generado en el test (`node:crypto`),
registrado en `REVIEWERS` dentro de los bindings de Miniflare.

Resultado local (verde):

```
[T25] attestations (service binding DOCS fake, node:crypto):
[T25.adv] tools/list -> attested_skill= attested] invalid_skill= invalid] expired_skill= expired] unattested_skill= unattested]
PASS att.adv: tools/list HTTP 200
PASS att.adv: 4 skills cargadas (advisory no excluye)
PASS att.adv: attested_skill -> [attestation: attested]
PASS att.adv: invalid_skill -> [attestation: invalid] (corrupt domina)
PASS att.adv: expired_skill -> [attestation: expired]
PASS att.adv: unattested_skill -> [attestation: unattested]
[T25.adv] X-Gw-Attestations -> 1attested,1expired,1invalid,1unattested
PASS att.adv: header X-Gw-Attestations presente
PASS att.adv: header con conteos 1attested,1expired,1invalid,1unattested
PASS att.adv: attester desconocido (sig corrupta) ignorado -> attested_skill sigue attested (no invalid)
PASS att.adv: tools/call attested_skill ejecuta y devuelve {name:attested_skill}
[T25.enf] tools/list -> ["attested_skill"] header= 1attested,1expired,1invalid,1unattested
PASS att.enf: tools/list HTTP 200
PASS att.enf: SOLO attested_skill cargada (invalid/expired/unattested excluidas)
PASS att.enf: la unica tool cargada etiquetada [attestation: attested]
PASS att.enf: header X-Gw-Attestations con conteos completos (1attested,...,1unattested)
PASS att.enf: tools/call unattested_skill HTTP 200 (no crash)
PASS att.enf: unattested_skill excluida -> call responde error (no encontrada)
[T25.404] tools/list -> 4 tools, header= 0attested,0expired,0invalid,4unattested
PASS att.404: tools/list HTTP 200 (404 del archivo NO es error)
PASS att.404: 4 skills cargadas (404 -> todo unattested, cargan igual)
PASS att.404: todas las tools [attestation: unattested]
PASS att.404: header X-Gw-Attestations = 0attested,0expired,0invalid,4unattested

TODOS LOS CHECKS VERDE
```

Cobertura: attested (firma válida real), invalid (firma corrupta de registrado
**domina** sobre otra válida → INVALID), expired (valid_until pasado), unattested
(sin entrada), attester desconocido (ignorado — sig corrupta de `human:unknown`
no invalida `attested_skill`), 404 del archivo (todo unattested sin error),
enforcing excluye no-attested. Los checks e2e existentes siguen verdes (la
instancia `mf` principal no lleva vars de atestación → modo `off` → byte-identical).

---

## 5. Redeploys + verificación en producción

### Deploys

- docs-site: `Uploaded llmstxt-docs` → `https://llmstxt-docs.rckflr.workers.dev`, Version ID `cbf1966d-46e7-4346-aabe-e1a2a3443bc2`.
- gateway: bindings `REVIEWERS` + `ATTESTATION_MODE ("advisory")` visibles; `Uploaded llmstxt-gateway` → `https://llmstxt-gateway.rckflr.workers.dev`, Version ID `a2f44af3-c8bc-42fd-8282-4014ab7893d2`.

(`wrangler deploy`, no `wrangler dev`.)

### Producción (tras 65s de TTL del caché de discovery)

**origin=docs** — `tools/list`:

```
HTTP/1.1 200 OK
x-gw-attestations: 2attested,0expired,0invalid,1unattested
x-gw-discovery: miss

result.tools:
  search_spec ... [attestation: attested]
  get_doc     ... [attestation: attested]
  list_docs   ... [attestation: unattested]
```

**origin=bookstore** — `tools/list` (sin attestations.json → todas unattested, cargan):

```
x-gw-attestations: 0attested,0expired,0invalid,5unattested
todas las 5 tools con [attestation: unattested], HTTP 200
```

**origin=docs** — `tools/call search_spec {q:"tool_sha256 integrity",k:3}`:

```
isError:false, hits: [
  {title:"rfc-skills-in-llms-txt: 8. Open Questions", score:-6.30...},
  {title:"ext-skill-attestations: 1. Motivation", ...},
  {title:"ext-executable-skills: 2.4 Origin memory: search snapshots", ...}
]
```

→ Confirmado: docs expone search_spec/get_doc attested + list_docs unattested,
header presente; bookstore todo unattested y funcional; search_spec devuelve hits.

---

## 6. Suites — las 4 exit 0

```
npm test   -> exit 0
npm run spike    -> exit 0
npm run gateway  -> exit 0
npm run memspike -> exit 0
```

### `git status` final

```
 M .gitignore
 M docs-site/build.mjs
 M docs-site/worker.mjs
 M mf-gateway.mjs
 M worker-gateway.mjs
 M wrangler-gateway.toml
?? docs-site/content/attestations.json
?? scripts/
```

`.attester-key.json` **NO** aparece → gitignored y no trackeado (confirmado con
`git check-ignore -v .attester-key.json` → `.gitignore:11:.attester-key.json`).
Tampoco aparece `probe-ed25519.mjs` (borrado, ver §7).

---

## 7. Riesgo WebCrypto (despejado y documentado)

`probe-ed25519.mjs` confirmó en workerd (`compatibility_date 2026-06-01` +
`nodejs_compat`) que `crypto.subtle.importKey("raw", <32 bytes>, {name:"Ed25519"}, false, ["verify"])`
+ `crypto.subtle.verify("Ed25519", key, sig, data)` funciona:

```
{"webcrypto":{"importOk":true,"verify":true},"nodecrypto":{"jwkOk":true,"verify":true}}
```

El gateway usa ese patrón exacto. `probe-ed25519.mjs` fue **borrado** al terminar
(hallazgo documentado acá). No quedó ningúna sonda en el repo.

---

## Archivos creados / tocados

Creados: `scripts/attest.mjs`, `docs-site/content/attestations.json`,
`TAREA25-REPORT.md`, `.attester-key.json` (gitignored, no trackeado).

Tocados (solo los permitidos): `worker-gateway.mjs`, `wrangler-gateway.toml`,
`mf-gateway.mjs`, `docs-site/worker.mjs`, `docs-site/build.mjs`, `.gitignore`.

No se tocaron: `host-async.mjs`, `mcp-core*.mjs`, `llmstxt-parse.mjs`,
`bookstore/**`, `demo-site/**`, `README.md`. No se hicieron commits git.