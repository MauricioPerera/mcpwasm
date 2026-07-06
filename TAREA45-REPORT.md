# TAREA45 — REPORT

## Objetivo

El sitio GitHub Pages raíz del usuario (`D:\Repo\mauricioperera.github.io`, ya
vivo en https://mauricioperera.github.io/ con `.nojekyll`) publica **una** skill
ejecutable estática llamada `site_facts` según el formato llms-txt-skills de
mcpwasm. Se crearon SOLO 5 archivos nuevos; no se tocó ningún `.adoc` ni archivo
existente del sitio, ni nada más de mcpwasm. Sin commit ni push.

## Archivos creados (todos en `D:\Repo\mauricioperera.github.io`)

1. `llms.txt` (raíz) — título del sitio + sección `## Skills` con la entrada
   ejecutable de `site_facts` (ruta al SKILL.md + comentario
   `<!-- skill: {"version":"1.0.0","tool":"...","tool_sha256":"..."} -->`).
2. `facts.json` — JSON estático con datos del sitio.
3. `skills/site_facts/tool.js` — `registerTool({ name:"site_facts", ... })`,
   `inputSchema` sin argumentos, handler async que hace
   `host.fetchOrigin("/facts.json")`, parsea y devuelve el objeto; manejo de
   error con throw y mensaje claro (prefijo `site_facts:`).
4. `skills/site_facts/SKILL.md` — doc breve en inglés (qué hace, input, output,
   errores).
5. `.well-known/agent-skills/attestations.json` — array vacío `[]` (JSON válido;
   el PM atesta después).

## Definición de hecho — salidas REALES

### 1) Parseo con `llmstxt-parse.mjs` sobre `llms.txt`

Comando (ESM con `pathToFileURL`, necesario en Windows):
```
node --input-type=module -e "import {pathToFileURL} from 'node:url'; \
const m=await import(pathToFileURL('D:/Repo/mcpwsm/mcpwasm/llmstxt-parse.mjs').href); \
const fs=await import('node:fs'); const t=fs.readFileSync('llms.txt','utf8'); \
console.log(JSON.stringify(m.parseLlmsTxt(t),null,2));"
```
Salida real:
```json
{
  "skills": [
    {
      "name": "site_facts",
      "description": "Return static facts about this site (owner, topics, skill count) from /facts.json.",
      "toolPath": "/skills/site_facts/tool.js",
      "sha256": "1d0c9925f6d93cbc137137e656c443b504936afe0001de55181a6f20154523b7",
      "version": "1.0.0"
    }
  ],
  "memory": null
}
```
→ 1 skill ejecutable `site_facts` con `tool` y `tool_sha256`. Parse OK al primer
intento.

### 2) sha256 del `tool.js` servido == declarado en `llms.txt`

Tres valores coincidentes (declarado en llms.txt, bytes del archivo en disco,
bytes servidos vía HTTP):
```
DECLARED (llms.txt) = 1d0c9925f6d93cbc137137e656c443b504936afe0001de55181a6f20154523b7
FILE     (disk)      = 1d0c9925f6d93cbc137137e656c443b504936afe0001de55181a6f20154523b7
SERVED   (http)      = 1d0c9925f6d93cbc137137e656c443b504936afe0001de55181a6f20154523b7
FILE==DECLARED : true
SERVED==DECLARED: true
```
(`tool.js` es ASCII puro, así que el hash sobre bytes == hash sobre texto UTF-8
decodificado que usa el lint; archivo de 924 bytes.)

### 3) Lint local (server en background + `validate-publisher --mode off`)

Server estático local montado con `node http.createServer` sirviendo el directorio
raíz, puerto libre asignado: **49255**. Comando del lint (sin pipes):
```
node D:\Repo\mcpwsm\mcpwasm\scripts\validate-publisher.mjs http://127.0.0.1:49255 --mode off
```
Salida real:
```
origin: http://127.0.0.1:49255
mode:   off  | revisores registrados: 1
+------------+--------+-------------+---------------------------
| skill      |   hash | attestation | razon
+------------+--------+-------------+---------------------------
| site_facts |     OK | -           | sha256 OK
+------------+--------+-------------+---------------------------
snapshot: ausente (sin linea skills-memory)
resumen: 1 skills | hash 1 OK / 0 FAIL | attestation -- (modo off) | snapshot ausente
veredicto: PASS
```
Exit code verificado con `echo "EXIT=$?"` → **EXIT=0**.

Server matado: el proceso se detuvo con `TaskStop` sobre la tarea background que
ejecutaba el server; verificación posterior:
```
netstat -ano | grep 49255 | grep -i listen   ->   (sin salida)
NO_LISTENER_PORT_FREE
```
→ el listener del puerto 49255 ya no existe; el server está muerto. Ningún
proceso del server queda vivo (los `node.exe` restantes en `tasklist` son
procesos preexistentes del harness/MCP, no el server de esta tarea — el suyo
era el único bound a 49255 y ya cerró).

### 4) `git status --porcelain`

`git -C D:\Repo\mauricioperera.github.io status --porcelain --untracked-files=all`:
```
?? .well-known/agent-skills/attestations.json
?? facts.json
?? llms.txt
?? skills/site_facts/SKILL.md
?? skills/site_facts/tool.js
```
→ SOLO los 5 archivos nuevos. `EXIT=0`.

(Nota: sin `--untracked-files=all`, git colapsa `.well-known/` y `skills/` en una
entrada de directorio cada uno, mostrando 4 líneas en lugar de 5; con `-uall` se
ven los 5 archivos exactos.)

## TRADE-OFFS

- **Server estático de verificación**: se usó un mini `http.createServer` en
  Node (sin dependencias) que sirve archivos del directorio raíz con
  `content-length` y `content-type` correctos, para reproducir lo que serviría
  GitHub Pages. Sirve bytes crudos (`Buffer`) por lo que el hash servido == hash
  en disco. El primer intento devolvió 403 por un guard de path con mezcla de
  slashes (`/` vs `\` en Windows); se corrigió con `path.resolve` y se reinició
  — segundo intento PASS.
- **Import ESM en Windows**: `llmstxt-parse.mjs` es ESM; importarlo por ruta
  absoluta `D:\...` falla (`ERR_UNSUPPORTED_ESM_URL_SCHEME`). Se usó
  `pathToFileURL(...).href`, que es la forma correcta y portable.
- **ASCII puro en `tool.js`**: para garantizar que el sha256 sobre bytes ==
  sha256 sobre texto UTF-8 decodificado (que es lo que computa el lint), el
  `tool.js` se escribió sin caracteres no-ASCII. Sin ambigüedad de encoding.
- **`attestations.json` = `[]`**: el PM atesta después; en `--mode off` el lint
  no verifica atestaciones, sólo hashes (PASS). En modo `enforcing` fallaría
  por `unattested` (esperado y documentado: no es un fallo de este trabajo).
- No se hizo commit ni push en ningún repo (por instrucción).

---

## Apendice del PM: integracion y dogfood de ONBOARDING.md (2026-07-06)

Pasos ejecutados siguiendo ONBOARDING.md tal como esta escrito:
1. Lint local del publisher (dev, --mode off): PASS.
2. Publicacion del sitio (push a MauricioPerera.github.io, Pages vivo en ~30 s; /.well-known/ servido OK).
3. Atestacion: `node scripts/attest.mjs sign https://mauricioperera.github.io site_facts 2027-07-06` con clave NUEVA `human:mauricio-2` (la clave original no estaba en esta maquina; rotacion ADITIVA: entrada nueva en REVIEWERS, las 9 atestaciones previas siguen validas). Attestation publicada en el sitio.
4. Alta: ALLOWED_ORIGINS += https://mauricioperera.github.io y REVIEWERS += human:mauricio-2 en wrangler-gateway.toml + `wrangler deploy`.
5. Lint enforcing contra el origin vivo: PASS exit 0 (1 attested).
6. Verificacion e2e en prod via gateway: tools/list -> site_facts `[attestation: attested]`, X-Gw-Attestations `1attested`; tools/call -> structuredContent correcto desde /facts.json por el camino de fetch EXTERNO (primer origin sin service binding en produccion).

Desviaciones/hallazgos respecto al doc:
- El gateway solo soporta origins RAIZ (`canonicalOrigin` = `new URL(s).origin`): GitHub Pages de proyecto (subpath) NO puede ser publisher. Anotado como limitacion a documentar en ONBOARDING.md (pendiente colateral).
- El flujo real exige DOS publicaciones del publisher (contenido primero, attestation despues, porque el reviewer firma contra el llms.txt vivo). ONBOARDING.md lo describe correcto de forma implicita; podria hacerse explicito (pendiente colateral menor).
