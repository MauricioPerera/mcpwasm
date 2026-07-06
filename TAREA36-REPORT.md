# TAREA36 — CI hermético + prod-integration no bloqueante

## Qué se hizo

**(A) `.github/workflows/ci.yml`** reestructurado en dos jobs:

1. `hermetic` (gate, bloqueante): checkout → setup-node Node 22 con `cache: npm` → `npm ci` → 4 steps
   separados: `npm test`, `npm run spike`, `npm run memspike`, `npm run gateway:offline`.
   `timeout-minutes: 15`.
2. `prod-integration` (no bloqueante): mismo setup → 1 step `npm run gateway`.
   `continue-on-error: true` a nivel job y `timeout-minutes: 15`. Propósito: detectar drift
   entre los fakes y producción sin que un outage ajeno pinte rojo el gate.

Nombres de steps sin `:` (sin comillas): `Run unit tests`, `Run spike suite`,
`Run memspike suite`, `Run gateway suite (offline)`, `Run gateway suite (online)`.

**(B) README.md `## CI`** reescrito en inglés, tono sobrio. Describe los dos jobs, corrige la
afirmación falsa heredada (la frase "The gateway and memspike suites reach the deployed
production workers" ya no existe): el único comando que toca producción es la suite online del
job `prod-integration`; el job `hermetic` no necesita red más allá de `npm`; la hermeticidad del
modo offline la garantiza un interceptor de fetch saliente (la suite falla si algo intenta salir
a red). También se actualizó la entrada del layout-table de `ci.yml` (línea 430) para reflejar
los dos jobs.

**(C) Snapshot regenerado** con `node build-memsnapshot.mjs` tras editar el README.

## DEFINICIÓN DE HECHO — salidas reales

### HECHO 1 — YAML parse
```
$ npx --yes js-yaml .github/workflows/ci.yml > /dev/null 2>&1; echo $?
EXIT_YAML=0
```
Parse OK. Nombres de steps sin `:` extra sin comillas.

### HECHO 2 — 4 suites del job hermético, verdes localmente
```
$ npm test; echo $?
EXIT_TEST=0

$ npm run spike; echo $?
EXIT_SPIKE=0

$ npm run memspike; echo $?
EXIT_MEMSPIKE=0

$ npm run gateway:offline; echo $?
EXIT_GATEWAY_OFFLINE=0
```
(`memspike` corrido DESPUÉS de regenerar el snapshot.) Las cuatro terminan con
`TODOS LOS CHECKS VERDE` / checks verdes y exit 0.

### HECHO 3 — suite online (job prod-integration), verde
```
$ npm run gateway; echo $?
EXIT_GATEWAY_ONLINE=0
```
Termina con `TODOS LOS CHECKS VERDE`, exit 0. Producción respondió (no hubo outage).

### HECHO 4 — regeneración del snapshot
```
$ node build-memsnapshot.mjs; echo $?
conceptos: 20, chunks insertados: 20, idx.len: 20
probe 'sandbox capability quickjs' hits: 4 mcpwasm — Static MCP
snapshot: mem-docs.snapshot (8551 bytes)
sha256:   7dddeb8992ccda24e91f6f6b8e4c59fae88d0435ec41b438fdff0b4e7c82fd34
meta:     mem-snapshot-sha.json
EXIT=0
```
Sha nuevo: `7dddeb8992ccda24e91f6f6b8e4c59fae88d0435ec41b438fdff0b4e7c82fd34`.

### HECHO 5 — greps del README
```
$ grep -n "memspike" README.md
111:- `worker-memspike.mjs` — memory spike: the docs-site origin published and
113:  snapshot), exercised by `mf-memspike.mjs`.
265:npm run memspike # build the memory snapshot + memspike worker, then e2e Miniflare against the docs-site origin (host.memorySearch / BM25)
270:memspike` does the same for the memory capability: `build-memsnapshot.mjs` →
271:`build-memspike.mjs` → `mf-memspike.mjs`.
413:| `worker-memspike.mjs` | Memory spike: docs-site origin served through the gateway with `host.memorySearch` over a BM25 snapshot. |
418:| `build-memspike.mjs` / `build-memsnapshot.mjs` | esbuild bundler for the memspike worker, and the snapshot builder for the docs-site BM25 snapshot. |
419:| `mf-test.mjs` / `mf-spike.mjs` / `mf-gateway.mjs` / `mf-memspike.mjs` | e2e tests with Miniflare v4 against the built workers (PoC, spike, gateway, memspike). |
439:`npm run spike`, `npm run memspike`, `npm run gateway:offline` — each
441:itself: `test`, `spike`, and `memspike` are fully local, and `gateway:offline`
500:`npm run gateway` (gateway against the live demo site) / `npm run memspike`
```
Ya NO se afirma que memspike usa red: la línea 441 dice explícitamente
`test, spike, and memspike are fully local`. La frase heredada "gateway and memspike suites
reach the deployed production workers" fue eliminada.

```
$ grep -in "prod-integration\|hermetic" README.md
430:| `.github/workflows/ci.yml` | GitHub Actions CI: two jobs (`hermetic` gate + `prod-integration` non-blocking) on push and pull_request to `main`. |
438:The `hermetic` job is the gate. It runs the four local suites — `npm test`,
442:is the hermetic mode of the gateway suite (T35), where the production workers
444:the gateway uses. Hermeticity is enforced by an outbound fetch interceptor:
448:The `prod-integration` job runs `npm run gateway`, the online gateway suite
```
Hits en la sección CI y en el layout.

```
$ grep -n "suites verdes\|despliegue" README.md || echo SIN_MENCIONES
SIN_MENCIONES
```
Cero español.

### HECHO 6 — git status --porcelain
```
$ git status --porcelain
 M .github/workflows/ci.yml
 M README.md
 M TAREA36-REPORT.md
```

## Nota obligatoria: los archivos snapshot NO aparecen en git status

El enunciado listaba 5 archivos permitidos esperando que la regeneración del snapshot
modificara `mem-docs.snapshot` y `mem-snapshot-sha.json`. En la práctica **no los modificó**:
el sha regenerado `7dddeb89…` es **idéntico al que ya está committeado en HEAD**
(verificado con `git show HEAD:mem-snapshot-sha.json`). Las dos secciones del README que se
editaron (la narrativa `## CI` y la entrada del layout-table de `ci.yml`) **no forman parte del
corpus de conceptos BM25** que `build-memsnapshot.mjs` trocea (20 conceptos / 20 chunks,
inalterados), por lo que la salida del builder es byte-identica a la committeada y git no marca
diff. Los 3 archivos que aparecen en `git status` están todos dentro del conjunto permitido;
ningún archivo fuera del permitido fue tocado. Los artefactos de build (`dist/`, `dist-spike/`,
`dist-gateway/`, `dist-memspike/`) están gitignored y no aparecen.

## TRADE-OFFS

- **`prod-integration` con `continue-on-error: true`**: detecta drift fakes↔producción pero NO
  bloquea el merge. Costo: una regresión real en la integración con producción (p.ej. el gateway
  online roto por un cambio nuestro) no frenaría el gate — sólo se vería como warning amarillo.
  Aceptado por diseño (el enunciado lo pide así) para que un outage ajeno no bloccione trabajo;
  el gate real es el job `hermético`, que cubre toda la lógica del gateway vía fakes.

- **Dos jobs duplican setup (`checkout` + `setup-node` + `npm ci`)**: NO se compartió vía
  `needs`/artifacts ni reuses workflow, porque `prod-integration` es no-bloqueante y debe poder
  correr independientemente de `hermetic` (y viceversa). Costo: ~doble tiempo de install en CI.
  Justificado por la independencia de los jobs.

- **`npm ci` corre en ambos jobs**: el job `hermético` no necesita `npm run gateway` (online);
  el job `prod-integration` no necesita las 3 suites locales. Se prefirió mantener cada job
  autocontenido y simple (un comando por step) sobre optimizar reusando el install. Costo: tiempo
  de CI mayor; beneficio: claridad y aislamiento de fallos.

- **Snapshot sin cambio funcional**: la edición del README no alteró el BM25 snapshot. Se
  regeneró igual (cumpliendo el HECHO 4) y se verificó byte-identidad con HEAD; no se forzó un
  cambio artificial en el corpus. Si el PM prefiere que el snapshot refleje la nueva narrativa
  de CI, habría que incorporar esa sección al corpus de conceptos en `build-memsnapshot.mjs`
  (fuera del alcance de T36).

## Reglas respetadas
- Ningún proceso en foreground que no terminara solo (todas las suites terminan solas).
- No se tocó nada fuera del repo.
- No se hizo commit ni push (lo hace el PM).
- Archivos tocados: solo `.github/workflows/ci.yml`, `README.md`, `TAREA36-REPORT.md`
  (los dos snapshot se regeneraron pero quedaron byte-identicos a HEAD, sin diff).