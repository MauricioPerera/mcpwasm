# TAREA44 — Gobernanza de onboarding de publishers de terceros

## Lo hecho

- **`ONBOARDING.md`** (nuevo, inglés, tono sobrio/honesto del README) con 6
  secciones: Requirements, Request, Review & attestation, Activation,
  Operation, Revocation.
- **`README.md`**: una sola mención, al cierre de la sección "Skill
  attestations (advisory)", enlazando `ONBOARDING.md` como el proceso para
  publishers de terceros.
- **Snapshot regenerado**: `node build-memsnapshot.mjs` (exit 0) + `npm run
  memspike` (exit 0). Resultado **byte-idéntico**: `mem-docs.snapshot` y
  `mem-snapshot-sha.json` sin cambios vs HEAD (`git diff --stat HEAD` vacío).
- No se tocó `scripts/`, código, `.github/`, ni `wrangler-*.toml`.

## Verificación contra el código (regla de aborto)

Cada afirmación de `ONBOARDING.md` se cotejó con `worker-gateway.mjs` antes de
escribirla. Ninguna contradijo el código:

- `ALLOWED_ORIGINS` allowlist cerrada — `allowedOrigins(env)` (líneas 898–904),
  check en línea 1243.
- Service bindings solo para workers de la misma cuenta (error 1042); resto por
  `fetch` global — `makeFetchImpl` (líneas 230–262), bindings `DEMO`/`BOOKSTORE`
  /`DOCS` y `return fetch(url, opts)` en línea 260.
- `ATTESTATION_MODE` `enforcing` excluye skills no `attested` —
  `attestationMode` (339–342) y filtrado enforcing (1309–1316).
- `REVIEWERS` es el registro contra el que se verifican firmas —
  `parseReviewers` (344–353); attester no registrado se ignora (458–459).
- `valid_until`: `today > valid_until` → `expired` (468–470); en enforcing,
  `expired`/`unattested`/`invalid` se excluyen, solo `attested` carga
  (477–480 + 1309–1316). Re-atestar tras cambio de `tool.js` porque la firma
  cubre el `tool_sha256` (payload línea 461).
- Caps de tamaño: `DEFAULT_SIZE_CAPS` llms 256 KB / tool 1 MB / attestations
  256 KB / snapshot 4 MB, env-configurables (161–166, 178–181).
- Cache discovery 60 s en 2 capas + fingerprint de config (modo + REVIEWERS +
  fecha UTC) que invalida L2 al instante — `LLMS_TTL_MS=60_000` (155),
  `discFingerprint` (372–386).

`scripts/validate-publisher.mjs` es del dev paralelo (no existe aún en el
árbol; `scripts/` solo contiene `attest.mjs`). El lint `node scripts/
validate-publisher.mjs <origin>` se documenta por instrucción explícita de la
tarea; no contradice el código del gateway.

## Salidas reales del HECHO (exit codes sin pipes)

### HECHO 1 — secciones de ONBOARDING.md
```
$ grep -n "^## " ONBOARDING.md
13:## Requirements
41:## Request
53:## Review & attestation
71:## Activation
84:## Operation
106:## Revocation
exit=0
```
6 secciones.

### HECHO 2 — lint y política explícita
```
$ grep -n "validate-publisher" ONBOARDING.md
35:  node scripts/validate-publisher.mjs <origin>
exit=0

$ grep -n "human:mauricio" ONBOARDING.md
64:**Current policy, stated explicitly:** only `human:mauricio` attests third-party
68:third-party skill is `attested` only when signed by `human:mauricio` with a
exit=0
```

### HECHO 3 — mención única en README
```
$ grep -n "ONBOARDING" README.md
256:Third-party publishers (sites you do not control): see [`ONBOARDING.md`](./ONBOARDING.md)
exit=0
```
Exactamente 1 hit.

### HECHO 4 — build-memsnapshot + memspike
```
$ node build-memsnapshot.mjs
conceptos: 20, chunks insertados: 20, idx.len: 20
probe 'sandbox capability quickjs' hits: 4 mcpwasm — Static MCP
snapshot: mem-docs.snapshot (8551 bytes)
sha256:   7dddeb8992ccda24e91f6f6b8e4c59fae88d0435ec41b438fdff0b4e7c82fd34
meta:     mem-snapshot-sha.json
exit=0

$ npm run memspike
... (build-memsnapshot + build-memspike + mf-memspike)
PASS tools/list: search_docs + echo presentes
PASS 6a: ... (5 sub-checks)
PASS 6b: ... (2 sub-checks)
PASS 6c: ... (2 sub-checks)
INSTANCIA 1: TODOS LOS CHECKS VERDE
PASS 6d: ... (4 sub-checks)
INSTANCIA 2: TODOS LOS CHECKS VERDE
exit=0
```

### HECHO 5 — cero español en ONBOARDING/README
```
$ grep -n "suites verdes\|despliegue\|tercero " ONBOARDING.md README.md || echo SIN_MENCIONES
SIN_MENCIONES
exit=0
```

### HECHO 6 — git status --porcelain
```
$ git status --porcelain
 M README.md
 M package.json
?? ONBOARDING.md
?? TAREA43-REPORT.md
?? scripts/validate-publisher.mjs
exit=0
```
Míos: `README.md` (M) y `ONBOARDING.md` (??). `mem-docs.snapshot` y
`mem-snapshot-sha.json` **no aparecen** (byte-idénticos a HEAD). Ajenos (no
tocados ni reportados como propios): `package.json` y
`scripts/validate-publisher.mjs` (dev paralelo), `TAREA43-REPORT.md` (otra
tarea). Al crear este reporte, `TAREA44-REPORT.md` se suma como `??`.

## Trade-offs

- **Snapshot byte-idéntico.** La regeneración no cambió `mem-docs.snapshot` ni
  `mem-snapshot-sha.json` pese a editar `README.md`. Causa verificada en
  `build-memsnapshot.mjs`: el parser mapea secciones → párrafos con un **cap de
  20 conceptos** en orden de aparición (líneas 64–71). La sección "Skill
  attestations (advisory)" va tarde en el README, y mi párrafo de enlace cae al
  final de esa sección, **después** de que el cap ya se llenó — queda fuera del
  índice. El snapshot ya commiteado incluye exactamente los mismos 20 conceptos;
  `memspike` verde confirma consistencia. Byte-idéntico es resultado válido y
  documentado.
- **Lint documentado sin el archivo presente.** `scripts/validate-publisher.mjs`
  aún no existe en el árbol (lo construye el dev paralelo). Se documenta el
  comando exacto por instrucción de la tarea; cuando el archivo se agregue, el
  comando ya será el correcto. No es una afirmación sobre el código del gateway.
- **No se commitea ni pushea** (por regla). Los cambios quedan en el árbol de
  trabajo para que el usuario los revise.