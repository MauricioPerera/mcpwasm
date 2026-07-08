# TAREA43 — Linter de publishers para onboarding

Herramienta `node scripts/validate-publisher.mjs <origin> [--mode off|advisory|enforcing] [--reviewers <ruta-json>]` que valida un origin publisher de llms-txt-skills end-to-end: parsea `/llms.txt` (parser reutilizado de `llmstxt-parse.mjs`, no duplicado), verifica `sha256` de cada `tool.js` contra el declarado (cap 1 MB), verifica firmas Ed25519 de `attestations.json` contra el registry de revisores (cap 256 KB; ausente → todas unattested), y verifica `snapshot_sha256` si hay línea `skills-memory` (cap 4 MB). Sin dependencias nuevas (fetch + `crypto.subtle` nativos de Node 22).

## Archivos tocados (solo los 3 permitidos)

- `scripts/validate-publisher.mjs` (nuevo) — la herramienta.
- `package.json` — agregado `"validate-publisher": "node scripts/validate-publisher.mjs"` en `scripts`.
- `TAREA43-REPORT.md` (nuevo) — este reporte.

NO se tocaron `README.md`, `ONBOARDING.md`, `worker-gateway.mjs`, `mf-gateway.mjs`, `host-async.mjs`, `.github/`.

## Verificacion de viabilidad previa (regla 1)

- **Payload canonico de atestacion**: verificado contra `scripts/attest.mjs` (lineas 119-123) y `worker-gateway.mjs` `verdictForSkill` (lineas 460-463). Coinciden exactamente: `origin + "\n" + skill + "\n" + tool_sha256 + "\n" + signed_on + "\n" + valid_until`, con `origin` canonizado (`new URL(s).origin`), `tool_sha256` hex minusculas. NO hubo que abortar.
- **Origines de produccion**: los 3 responden (curl previo). Sin outage.
- **Caps**: copiados literal de `DEFAULT_SIZE_CAPS` del gateway (T42): llms 256 KB, tool 1 MB, attestations 256 KB, snapshot 4 MB.
- **Verificacion Ed25519**: espejo del `verifyEd25519` del gateway — `importKey("raw", <32 bytes>, "Ed25519")` + `verify`. Node 22 soporta Ed25519 en `crypto.subtle` nativamente.
- **Precedencia de veredicto**: invalid > attested > expired > unattested (espejo del gateway, INVALID DOMINA).

## Dependencia documentada: registry de revisores

`--reviewers <ruta>` espera un JSON con el formato exacto del `REVIEWERS` del gateway: `{attester: {public_key: <base64 raw 32 bytes>, registered_at: "YYYY-MM-DD"}}`. Si no se pasa, se extrae `REVIEWERS` de `wrangler-gateway.toml` local — el formato es un literal TOML de una linea (comillas simples):

```
REVIEWERS = '{"human:mauricio":{"public_key":"...","registered_at":"..."}}'
```

Match simple (`/^REVIEWERS\s*=\s*'(.*)'\s*$/m`) + `JSON.parse` del grupo 1. Si no se pasa `--reviewers` y no existe `wrangler-gateway.toml` en el cwd, la herramienta aborta con exit 2. Solo se leen claves PUBLICAS (el registry no tiene privadas).

## Salidas REALES del DEFINICION DE HECHO (exit codes con `echo $?`, sin pipes)

### 1. demo-site (enforcing default) → 2/2 attested, exit 0

```
$ node scripts/validate-publisher.mjs https://llmstxt-demo-site.rckflr.workers.dev
origin: https://llmstxt-demo-site.rckflr.workers.dev
mode:   enforcing  | revisores registrados: 1
+-------------+--------+-------------+---------------------------
| skill       |   hash | attestation | razon
+-------------+--------+-------------+---------------------------
| sum_numbers |     OK | attested    | sha256 OK | firma valida en ventana
| server_time |     OK | attested    | sha256 OK | firma valida en ventana
+-------------+--------+-------------+---------------------------
snapshot: ausente (sin linea skills-memory)
resumen: 2 skills | hash 2 OK / 0 FAIL | attestation 2 attested, 0 expired, 0 invalid, 0 unattested | snapshot ausente
veredicto: PASS
$ echo $?
0
```

### 2. docs-site → 3/3 attested + snapshot verificado, exit 0

```
$ node scripts/validate-publisher.mjs https://llmstxt-docs.rckflr.workers.dev
origin: https://llmstxt-docs.rckflr.workers.dev
mode:   enforcing  | revisores registrados: 1
+-------------+--------+-------------+---------------------------
| skill       |   hash | attestation | razon
+-------------+--------+-------------+---------------------------
| search_spec |     OK | attested    | sha256 OK | firma valida en ventana
| get_doc     |     OK | attested    | sha256 OK | firma valida en ventana
| list_docs   |     OK | attested    | sha256 OK | firma valida en ventana
+-------------+--------+-------------+---------------------------
snapshot: OK (snapshot_sha256 OK)
resumen: 3 skills | hash 3 OK / 0 FAIL | attestation 3 attested, 0 expired, 0 invalid, 0 unattested | snapshot OK
veredicto: PASS
$ echo $?
0
```

### 3. bookstore enforcing → 4 attested, corrupt_skill FAIL hash, busy_loop FAIL unattested, exit 1

```
$ node scripts/validate-publisher.mjs https://llmstxt-bookstore.rckflr.workers.dev
origin: https://llmstxt-bookstore.rckflr.workers.dev
mode:   enforcing  | revisores registrados: 1
+----------------+--------+-------------+---------------------------
| skill          |   hash | attestation | razon
+----------------+--------+-------------+---------------------------
| search_catalog |     OK | attested    | sha256 OK | firma valida en ventana
| get_book       |     OK | attested    | sha256 OK | firma valida en ventana
| stock_report   |     OK | attested    | sha256 OK | firma valida en ventana
| create_order   |     OK | attested    | sha256 OK | firma valida en ventana
| corrupt_skill  |   FAIL | unattested  | sha256 mismatch (declarado 000000000000…, obtenido 63103f6e4873…) | ninguna atestacion coincide (origin+skill+sha)
| busy_loop      |     OK | unattested  | sha256 OK | ninguna atestacion coincide (origin+skill+sha)
+----------------+--------+-------------+---------------------------
snapshot: ausente (sin linea skills-memory)
resumen: 6 skills | hash 5 OK / 1 FAIL | attestation 4 attested, 0 expired, 0 invalid, 2 unattested | snapshot ausente
veredicto: FAIL
  - corrupt_skill: hash FAIL (sha256 mismatch (declarado 000000000000…, obtenido 63103f6e4873…))
  - corrupt_skill: attestation unattested (ninguna atestacion coincide (origin+skill+sha))
  - busy_loop: attestation unattested (ninguna atestacion coincide (origin+skill+sha))
$ echo $?
1
```

Los fixtures negativos FALLAN como se requiere: `corrupt_skill` por hash mismatch (sha declarado de 64 ceros ≠ real), `busy_loop` por unattested. Eso valida el lint.

### 4. bookstore advisory → busy_loop degrada a warning, corrupt_skill sigue FAIL, exit 1

```
$ node scripts/validate-publisher.mjs https://llmstxt-bookstore.rckflr.workers.dev --mode advisory
origin: https://llmstxt-bookstore.rckflr.workers.dev
mode:   advisory  | revisores registrados: 1
+----------------+--------+-------------+---------------------------
| skill          |   hash | attestation | razon
+----------------+--------+-------------+---------------------------
| search_catalog |     OK | attested    | sha256 OK | firma valida en ventana
| get_book       |     OK | attested    | sha256 OK | firma valida en ventana
| stock_report   |     OK | attested    | sha256 OK | firma valida en ventana
| create_order   |     OK | attested    | sha256 OK | firma valida en ventana
| corrupt_skill  |   FAIL | unattested  | sha256 mismatch (declarado 000000000000…, obtenido 63103f6e4873…) | ninguna atestacion coincide (origin+skill+sha)
| busy_loop      |     OK | unattested  | sha256 OK | ninguna atestacion coincide (origin+skill+sha)
+----------------+--------+-------------+---------------------------
snapshot: ausente (sin linea skills-memory)
resumen: 6 skills | hash 5 OK / 1 FAIL | attestation 4 attested, 0 expired, 0 invalid, 2 unattested | snapshot ausente
veredicto: FAIL
  - corrupt_skill: hash FAIL (sha256 mismatch (declarado 000000000000…, obtenido 63103f6e4873…))
$ echo $?
1
```

En advisory `busy_loop` (unattested) ya NO aparece en la lista de fails — degrada a warning. `corrupt_skill` sigue FAIL por hash mismatch (siempre FAIL en cualquier modo). Exit 1 por el hash.

### 5. git status --porcelain → mis 3 archivos permitidos (+ trabajo del dev paralelo)

```
$ git status --porcelain
 M README.md
 M package.json
?? ONBOARDING.md
?? TAREA43-REPORT.md
?? scripts/validate-publisher.mjs
```

`README.md` (modificado) y `ONBOARDING.md` (nuevo, sin trackear) son trabajo del **dev paralelo** que la tarea explicitamente me prohibe tocar — no los genere ni los modifique. Mis 3 archivos permitidos si estan: `M package.json`, `?? TAREA43-REPORT.md`, `?? scripts/validate-publisher.mjs`. El snapshot de git al inicio de la sesion estaba clean; esos 2 archivos extra aparecieron por el dev paralelo durante la sesion (es el comportamiento esperado segun el contexto).

## Semantica de exit code

| modo | hash mismatch | unattested | expired | invalid | snapshot mismatch/fetch-fail |
|------|---------------|-----------|---------|---------|------------------------------|
| enforcing (default) | FAIL | FAIL | FAIL | FAIL | FAIL |
| advisory | FAIL | warning | warning | FAIL | FAIL |
| off | FAIL | n/a (no fetchea) | n/a | n/a | FAIL |

`off` NO fetchea/verifica attestations pero SIGUE verificando `tool.js` (hash + cap 1 MB) y snapshot (es un hash check, independiente del modo de atestacion — espejo del gateway, donde el snapshot se descubre siempre que haya `skills-memory` sin importar `ATTESTATION_MODE`). Snapshot siempre se verifica en todos los modos.

Exit 0 solo si la columna "FAIL" no tiene ninguna entrada para el modo activo.

## TRADE-OFFS

1. **`--reviewers` fallback a `wrangler-gateway.toml`**: el match es un regex simple sobre la linea `REVIEWERS = '...'`. Si el toml cambia de formato (p.ej. comillas dobles, multilinea, o el JSON se mueve a un secret/`vars` externo), el fallback se rompe y la herramienta aborta con exit 2. Mitigacion: `--reviewers <ruta>` es el escape explicito y no depende del toml. Es el trade-off pedido por la especificacion ("un match simple alcanza").

2. **`invalid` SI falla en advisory**: la especificacion solo dice explicitamente "unattested/expired son warning" y "hash mismatch siempre FAIL". No menciona `invalid` (firma que falla contra clave REGISTRADA). Decision: `invalid` falla tambien en advisory (no es unattested ni expired). Razon: una firma rota de un revisor registrado es un problema real del publisher, no una simple ausencia. Si se prefiere que `invalid` tambien sea warning en advisory, es un cambio de 1 linea en el bloque `mode === "advisory"` (agregar `|| r.verdict === "invalid"` a la exclusion). No afecta a ningun test del HECHO (los fixtures negativos son hash-mismatch y unattested, no invalid).

3. **Snapshot se verifica en `--mode off`**: `off` se interpreta como "saltar atestaciones", no "saltar todo". El snapshot es un hash check independiente (espejo del gateway). Si se quisiera que `off` sea literalmente "solo tool.js", habria que gatear el bloque de snapshot detras de `mode !== "off"`. No hay test del HECHO para `off`, asi que queda a juicio; la opcion tomada (verificar snapshot siempre) es mas conservadora y consistente con el gateway.

4. **Cache-bust `?_gw=<ts>`**: como el gateway, se añade un cache-bust a todos los fetches para evitar edge cache stale en origins workers.dev (sin `Cache-Control` CF podria cachear). El `sha256` es sobre el body, asi que el bust no afecta la verificacion. `Date.now()` se usa solo aqui (Node, no Workflow script).

5. **Timeout 8s vs 5s del gateway**: el gateway usa `FETCH_TIMEOUT_MS = 5000` (entorno caliente de worker). El linter corre en Node local contra origins remotos; se holgo a 8s para tolerar latencia de red desde la maquina del operador. No cambia la semantica.

6. **No reutiliza el `fetchText` del gateway**: `worker-gateway.mjs` no exporta sus helpers (es un worker). Se reimplemento `fetchText` (precheck Content-Length + streaming defensivo) y `verifyEd25519` como espejos. Es codigo duplicado en espiritu, pero el parser (`parseLlmsTxt`) SI se reutiliza por import. Duplicar `fetchText`/`verifyEd25519` era inevitable sin refactor del worker a modulo compartido (fuera del alcance de T43, que prohibe tocar `worker-gateway.mjs`).

7. **`busy_loop` en bookstore tiene hash OK**: es un fixture de infinite-loop (test de interrup del gateway), NO de hash. Su sha declarado coincide con el tool real. Por eso pasa el hash pero falla por unattested (no esta en `attestations.json`). Es el comportamiento correcto: el linter no ejecuta la skill, solo verifica hash + atestacion.