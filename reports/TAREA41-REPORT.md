# TAREA41 — README al día con T40 (cache L2 del descubrimiento)

## Qué se hizo

T40 aterrizó en `worker-gateway.mjs`: cache **L2 del resultado** de descubrimiento
en `caches.default` (cross-isolate, per-colo), además del cache L1 per-isolate de
T9. El README (inglés) estaba desactualizado: el bullet "DoS is bounded, not
impossible" en `## Security model (honest)` describía la forma vieja (L1 only,
header `hit|miss`, `llms.txt`/`tool.js` sueltos en la Cache API).

1. **Reescrito SOLO ese bullet** (~líneas 424-432): descubrimiento cacheado en dos
   capas — layer 1 per-isolate (60 s) y layer 2 = resultado post-verificación
   completo en la Cache API per-colo (60 s), observable via
   `X-Gw-Discovery: hit|l2|miss`. La key de layer 2 lleva un config fingerprint
   (attestation mode + reviewer registry + UTC date) => cambiar la config nunca
   sirve veredictos stale. Lo cacheado es post-verificación (bytes ya
   hash-verificados al poblar L2) dentro del mismo trust domain de la cuenta.
   Cold path amortizado más, pero sigue sin ser cero.
2. **Alineación de otras secciones**: grep de `discovery|per isolate|per-isolate|
   Cache API|cold path|llms.txt|tool.js` sobre README. Las únicas menciones de
   discovery fuera del bullet son:
   - línea 88-89 (Architecture, "downloads llms.txt...verifies SHA-256") — flujo
     conceptual, sin mencionar cache. No toca.
   - línea 376-378 ("discovery is single-flighted per origin") — single-flight
     sigue cierto (T19, intacto en T40). No toca.
   - línea 511-512 ("single-flight discovery per origin") y 529 ("A cold discovery
     miss costs ~250–400 ms") — siguen siendo ciertas. No toca.
   - **Cero menciones con la forma vieja del cache fuera del bullet reescrito.**
     Documentado; no se tocó nada más.
3. **Snapshot regenerado** (`node build-memsnapshot.mjs`) tras editar README, luego
   `npm run memspike` → exit 0. Snapshot **byte-identical** (mismo sha256
   `7dddeb89...`): válido, documentado abajo con la salida.

Archivos tocados: `README.md`, `mem-docs.snapshot` y `mem-snapshot-sha.json`
(regeneración; byte-identical => sin cambio en git), `TAREA41-REPORT.md` (nuevo).
No se tocó código, `.github/` ni `wrangler-*.toml`.

## Verificación contra `worker-gateway.mjs` (no afirmar nada que contradiga el código)

- `X-Gw-Discovery: "miss"|"hit"|"l2"|"none"` (línea 782). El bullet documenta
  `hit|l2|miss` (el subconjunto relevante al *estado del cache de descubrimiento*,
  como pide la tarea). `"none"` es pre-descubrimiento (auth fail / parse error
  antes de correr discovery; líneas 1128/1141/1152/1163/1185) — no es un estado de
  cache de descubrimiento, omitirlo no contradice el código. TRADE-OFF documentado
  abajo.
- L2 = resultado post-verificación, key `gw:disc:${origin}:${fingerprint}`,
  TTL 60 s (líneas 158-165, 542, 707). `serializeDiscL2` (425) guarda skills
  (con `code` ya verificado por sha256) + rejected + snapshotText + verdicts;
  comentario explícito línea 422-423: "code (tool.js) ya está verificado por
  sha256 al poblar => el L2 cachea contenido post-verificación; no se re-verifica
  al hidratar (igual que la capa 1)". Coincide con el bullet.
- Fingerprint = `sha256 hex` de `JSON.stringify({mode, reviewers, date UTC})`,
  rawMode/rawReviewers crudos de env (líneas 284-298). Cambio de
  ATTESTATION_MODE, REVIEWERS o día UTC => key distinta => cero veredictos stale.
  Coincide con el bullet.
- Hidrata capa 1 saltando fetch+crypto en `l2` hit (líneas 544-555);
  `parseDiscL2` defensivo: malformado => null => miss, el L2 nunca tumba un
  request (líneas 436-441, 556). Cache API `caches.default` = per-colo edge cache.

## Salidas reales del HECHO (exit codes con `echo $?`, sin pipes)

### HECHO 1 — `grep -n "hit|miss" README.md || echo ELIMINADO`
```
$ grep -n "hit|miss" README.md || echo ELIMINADO
ELIMINADO
```
Salida: `ELIMINADO` (la forma vieja del header ya no aparece).

### HECHO 2a — `grep -n "hit|l2|miss" README.md`
```
$ grep -n "hit|l2|miss" README.md
429:  `X-Gw-Discovery: hit|l2|miss` response header — `hit` served from layer 1,
```
Hit en Security model.

### HECHO 2b — `grep -in "fingerprint" README.md`
```
$ grep -in "fingerprint" README.md
431:  The layer 2 key carries a config fingerprint (attestation mode + reviewer
```
Hit.

### HECHO 3 — regenerar snapshot + memspike
```
$ node build-memsnapshot.mjs; echo "exit=$?"
conceptos: 20, chunks insertados: 20, idx.len: 20
probe 'sandbox capability quickjs' hits: 4 mcpwasm — Static MCP
snapshot: mem-docs.snapshot (8551 bytes)
sha256:   7dddeb8992ccda24e91f6f6b8e4c59fae88d0435ec41b438fdff0b4e7c82fd34
meta:     mem-snapshot-sha.json
exit=0

$ npm run memspike; echo "exit=$?"
... (build-memsnapshot + build-memspike + mf-memspike) ...
sha256:   7dddeb8992ccda24e91f6f6b8e4c59fae88d0435ec41b438fdff0b4e7c82fd34
EXPECTED_SNAPSHOT_SHA_DEFAULT = 7dddeb8992ccda24e91f6f6b8e4c59fae88d0435ec41b438fdff0b4e7c82fd34
... PASS 6a/6b/6c, INSTANCIA 1: TODOS LOS CHECKS VERDE ...
... PASS 6d (sha mismatch controlado), INSTANCIA 2: TODOS LOS CHECKS VERDE ...
exit=0
```
Snapshot byte-identical (mismo sha256 antes/después de editar README) — válido.
`npm run memspike` → exit 0.

### HECHO 4 — `npm run gateway:offline` (sanity)
```
$ npm run gateway:offline; echo "exit=$?"
... build-gateway OK ...
... T9 cache (miss->hit), T22 docs, T26, T28 auth, T37 client identity,
    T38 rate limiting, T40 cache L2 (miss/l2/hit/fingerprint invalida),
    T35 hermeticidad ...
TODOS LOS CHECKS VERDE
exit=0
```
exit 0.

### HECHO 5 — cero español en README
```
$ grep -n "suites verdes\|despliegue\|capa " README.md || echo SIN_MENCIONES
SIN_MENCIONES
```

### HECHO 6 — `git status --porcelain`
```
$ git status --porcelain
 M README.md
```
Solo `README.md` modificado. `mem-docs.snapshot` y `mem-snapshot-sha.json`
regenerados byte-identical => sin cambio en git (permitido: "snapshots solo si
cambiaron"). `TAREA41-REPORT.md` es nuevo (untracked, no aparece en `--porcelain`
hasta `git add`).

## Trade-offs

- **`"none"` omitido del bullet.** El código define cuatro valores
  (`miss|hit|l2|none`); el bullet documenta tres (`hit|l2|miss`) como pide la
  tarea (HECHO 2). `"none"` es el estado pre-descubrimiento (la respuesta se arma
  antes de que discovery corra: auth 401, parse error, etc.) — no describe un
  estado del cache de descubrimiento, así que omitirlo no contradice el código ni
  confunde al lector del bullet. La observabilidad completa del cuarto valor vive
  en el código y los reports T40, no en el README de security model.
- **"trust domain of the account"** en el bullet: `caches.default` es el edge
  cache per-colo del Worker gateway (mismo cuenta/Worker); frase consistente con
  el modelo de service bindings same-account que ya documenta el README.

## No commit / no push / no deploy

Según las reglas: no se hizo commit, push ni deploy. Lo hace el PM.