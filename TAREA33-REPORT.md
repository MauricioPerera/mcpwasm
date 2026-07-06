# TAREA33 — Workflow de GitHub Actions para las 4 suites

## Qué se creó

- `.github/workflows/ci.yml` — workflow de CI nuevo.
- `TAREA33-REPORT.md` — este reporte.

No se tocó ningún otro archivo del repo (ni código, ni suites, ni `package.json`).

### Resumen del workflow

- **Trigger:** `push` a `main` y `pull_request` a `main`.
- **Job único** en `ubuntu-latest` con `timeout-minutes: 15`.
- `actions/checkout@v4`.
- `actions/setup-node@v4` con `node-version: 20` y `cache: npm`.
- `npm ci`.
- 4 steps separados (uno por suite, para diagnóstico claro):
  1. `npm test`
  2. `npm run spike`
  3. `npm run gateway`
  4. `npm run memspike`
- Nombres de steps sin `:` adicionales sin comillas (usan guiones/espacios, YAML válido).

El job falla si cualquiera de los 4 steps falla (comportamiento por defecto de Actions: un step con exit ≠ 0 falla el job).

---

## Discrepancia detectada y resuelta

El contexto decía "node_modules ya está instalado localmente". **No era así**: `node_modules/` no existía (`ls node_modules` → "No such file or directory"). La primera ejecución de `npm test` falló con `ERR_MODULE_NOT_FOUND: Cannot find package 'esbuild'`.

Esto NO fue causado por mi cambio (mi cambio es solo el YAML). Como `node_modules/` está gitignored y el workflow mismo ejecuta `npm ci` como primer paso, se ejecutó `npm ci` localmente para poder verificar las suites. Resultado:

```
added 44 packages, and audited 45 packages in 31s
6 packages are looking for funding
found 0 vulnerabilities
EXIT_CODE=0
```

Esto no modificó ningún archivo del repo (gitignored).

---

## Definición de hecho — salidas reales

### 1. YAML válido

Comando:
```
npx --yes js-yaml .github/workflows/ci.yml; echo "EXIT_CODE=$?"
```

Salida (objeto parseado + exit code):
```json
{
  "name": "CI",
  "on": {
    "push": { "branches": ["main"] },
    "pull_request": { "branches": ["main"] }
  },
  "jobs": {
    "test": {
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 15,
      "steps": [
        { "uses": "actions/checkout@v4" },
        { "uses": "actions/setup-node@v4", "with": { "node-version": 20, "cache": "npm" } },
        { "run": "npm ci" },
        { "name": "Run unit tests", "run": "npm test" },
        { "name": "Run spike suite", "run": "npm run spike" },
        { "name": "Run gateway suite", "run": "npm run gateway" },
        { "name": "Run memspike suite", "run": "npm run memspike" }
      ]
    }
  }
}
EXIT_CODE=0
```

**Exit code: 0** → YAML válido.

### 2. Las 4 suites corren verdes localmente (sin pipe, exit code verificado)

Cada comando se ejecutó tal cual (`npm test`, etc.) sin pipe, con `echo "EXIT_CODE=$?"` inmediatamente después.

#### `npm test` → EXIT_CODE=0
Tramo final:
```
build OK -> dist/worker.js + dist/quickjs.wasm
initialize   -> {"status":200,"text":"{\"jsonrpc\":\"2.0\",\"id\":1,...\"serverInfo\":{\"name\":\"toolhost-mcp\",\"version\":\"0.1.0\"}}}"}
tools/list   -> {"status":200,"text":"...\"tools\":[{\"name\":\"create_payment\",...},{\"name\":\"refund_payment\",...}]}}"}
create_pay   -> {"status":200,"text":"...\"paymentId\":\"pay_1001\",\"status\":\"succeeded\"...\"isError\":false}}"}
EXIT_CODE=0
```

#### `npm run spike` → EXIT_CODE=0
Tramo final:
```
PASS fetch_evil: isError==true
PASS fetch_evil: mensaje contiene "origin"

TODOS LOS CHECKS VERDE
EXIT_CODE=0
```

#### `npm run gateway` → EXIT_CODE=0
Tramo final:
```
PASS att.404: tools/list HTTP 200 (404 del archivo NO es error)
PASS att.404: 4 skills cargadas (404 -> todo unattested, cargan igual)
PASS att.404: todas las tools [attestation: unattested]
PASS att.404: header X-Gw-Attestations = 0attested,0expired,0invalid,4unattested

TODOS LOS CHECKS VERDE
EXIT_CODE=0
```
(Corrió contra los workers de producción: demo-site, bookstore, docs-site — red OK.)

#### `npm run memspike` → EXIT_CODE=0
Tramo final:
```
PASS 6d: HTTP 200 (no crash/500)
PASS 6d: isError:true (error controlado)
PASS 6d: mensaje menciona integridad/sha mismatch

INSTANCIA 2: TODOS LOS CHECKS VERDE
EXIT_CODE=0
```

### 3. `git status --porcelain` muestra solo los 2 archivos nuevos permitidos

Nota: al ejecutar `npm run memspike`, la suite regeneró `mem-snapshot-sha.json` (archivo tracked). El `git diff` estaba **vacío** (solo warning de normalización LF→CRLF); el contenido era idéntico, git solo marcaba modificación por normalización de finales de línea. Se restauró con `git checkout -- mem-snapshot-sha.json` (no es uno de los archivos permitidos; restaurarlo devuelve el repo al estado committed byte-idéntico).

Salida final de `git status --porcelain`:
```
?? .github/
?? TAREA33-REPORT.md
```

`?? .github/` corresponde al nuevo `.github/workflows/ci.yml` (único archivo bajo ese dir). Junto con `TAREA33-REPORT.md` son exactamente los 2 archivos nuevos permitidos. Ningún archivo tracked fue modificado.

---

## Trade-offs

- **`npm ci` local:** el contexto indicaba `node_modules` instalado, pero no lo estaba. Se ejecutó `npm ci` (gitignored, sin tocar archivos del repo, mismo paso que usa el workflow) para poder verificar las suites. Sin esto la definición de hecho punto 2 era imposible.
- **Restauración de `mem-snapshot-sha.json`:** la suite memspike lo regenera con LF; git en Windows marca modificación por normalización CRLF aunque el contenido sea idéntico. Se restauró a la versión committed para dejar el estado del repo limpio (solo los 2 archivos nuevos). El archivo en disco vuelve a ser byte-idéntico al committed.
- **4 steps separados vs 1 step combinado:** se eligieron 4 steps independientes (uno por suite) tal como se pidió, para diagnóstico claro en CI (si una suite falla, se ve cuál sin re-leer logs).
- **No se configuró `continue-on-error`:** cualquier suite que falle rompe el job (comportamiento requerido).