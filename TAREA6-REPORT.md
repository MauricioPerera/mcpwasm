# TAREA6-REPORT — llmstxt-demo-site

Worker estático publicador de skills ejecutables (estándar llms-txt-skills + extensión
provisional). Desplegado en producción en la cuenta `091122c40cc6f8d0d421cbc90e2caca8`.

## URL pública

**https://llmstxt-demo-site.rckflr.workers.dev**

## Decisiones de diseño

- **Sin dependencias.** `demo-site/worker.mjs` solo emite `Response` estáticas. No se tocó
  `package.json`; wrangler se invoca vía `npx` (ya instalado como devDependency del repo).
- **Byte-exactitud de los sha256.** El `build.mjs` lee `demo-site/content/*.tool.js`,
  calcula `sha256` sobre sus bytes UTF-8 e incrusta el contenido en `worker.mjs` con
  `JSON.stringify` (que produce un literal JS cuyo valor runtime es byte-idéntico al
  original). El worker sirve ese mismo string; los bytes servidos == los bytes hasheados,
  por construction. Los hashes se generan en build (node), **no en runtime**.
- **Skill pura vs async.** `sum_numbers` usa handler sincrónico (`return a+b`).
  `server_time` usa `handler: async function` con `await host.fetchOrigin("/api/time")` y
  `JSON.parse(r.body)`, tal como define el PM.
- **Formato /llms.txt.** Título, resumen (`>`), sección `## Skills`, y cada skill en una
  línea con el comentario HTML `<!-- skill: {version,tool,sha256} -->` (extensión
  provisional).
- **Generación.** `demo-site/build.mjs` produce `demo-site/worker.mjs` y
  `demo-site/wrangler.toml`. Archivo generado marcado `AUTOGENERADO`; no editar a mano.

## Archivos creados (todos bajo `demo-site/`)

```
demo-site/
  content/
    sum_numbers.tool.js
    server_time.tool.js
    sum_numbers.SKILL.md
    server_time.SKILL.md
  build.mjs        # genera worker.mjs + wrangler.toml con hashes fijos
  verify.mjs       # post-deploy: descarga tool.js, calcula sha256, compara
  worker.mjs       # AUTOGENERADO
  wrangler.toml    # AUTOGENERADO
```

## (1) Deploy

```
$ npx wrangler deploy -c demo-site/wrangler.toml
 ⛅️ wrangler 4.106.0
────────────────────
Total Upload: 3.24 KiB / gzip: 1.26 KiB
Uploaded llmstxt-demo-site (1.49 sec)
Deployed llmstxt-demo-site triggers (1.02 sec)
  https://llmstxt-demo-site.rckflr.workers.dev
Current Version ID: 07953e4a-24b5-4357-a63f-224c6143f746
```

## (2) curl /llms.txt

```
$ curl -s https://llmstxt-demo-site.rckflr.workers.dev/llms.txt
# llms-txt-skills demo site

> Demo site publishing executable skills per the llms-txt-skills standard with a provisional extension for executable skills.

## Skills

- [sum_numbers](/skills/sum_numbers/SKILL.md): Sum two numbers a and b. <!-- skill: {"version":"1.0.0","tool":"/skills/sum_numbers/tool.js","sha256":"58daf86111bf7278446eb7e0e8c6384713b50cdb6fa97ac039e23846d723dc3e"} -->
- [server_time](/skills/server_time/SKILL.md): Return the current server time. <!-- skill: {"version":"1.0.0","tool":"/skills/server_time/tool.js","sha256":"5b9255eca41a95cc0cf38322dc973062133e1ce1e757da8cab8fdeb16ec934f5"} -->
```

## (3) curl de ambos tool.js

```
$ curl -s https://llmstxt-demo-site.rckflr.workers.dev/skills/sum_numbers/tool.js
registerTool({
  name: "sum_numbers",
  description: "Sum two numbers a and b.",
  inputSchema: {
    type: "object",
    properties: {
      a: { type: "number" },
      b: { type: "number" }
    },
    required: ["a", "b"]
  },
  handler(args) {
    return Number(args.a) + Number(args.b);
  }
});
```

```
$ curl -s https://llmstxt-demo-site.rckflr.workers.dev/skills/server_time/tool.js
registerTool({
  name: "server_time",
  description: "Return the current server time.",
  inputSchema: {
    type: "object",
    properties: {}
  },
  handler: async function (args) {
    const r = await host.fetchOrigin("/api/time");
    return JSON.parse(r.body);
  }
});
```

## (4) curl /api/time

```
$ curl -s https://llmstxt-demo-site.rckflr.workers.dev/api/time
{"now":"2026-07-02T15:53:26.976Z","epoch":1783007606976}
```

## (5) Verificación de hashes (descarga tool.js de producción, calcula sha256, compara)

```
$ node demo-site/verify.mjs https://llmstxt-demo-site.rckflr.workers.dev
=== /llms.txt ===
# llms-txt-skills demo site
...
- [sum_numbers](/skills/sum_numbers/SKILL.md): Sum two numbers a and b. <!-- skill: {"version":"1.0.0","tool":"/skills/sum_numbers/tool.js","sha256":"58daf86111bf7278446eb7e0e8c6384713b50cdb6fa97ac039e23846d723dc3e"} -->
- [server_time](/skills/server_time/SKILL.md): Return the current server time. <!-- skill: {"version":"1.0.0","tool":"/skills/server_time/tool.js","sha256":"5b9255eca41a95cc0cf38322dc973062133e1ce1e757da8cab8fdeb16ec934f5"} -->

=== /skills/sum_numbers/tool.js ===
declared sha256: 58daf86111bf7278446eb7e0e8c6384713b50cdb6fa97ac039e23846d723dc3e
actual   sha256: 58daf86111bf7278446eb7e0e8c6384713b50cdb6fa97ac039e23846d723dc3e
match: OK

=== /skills/server_time/tool.js ===
declared sha256: 5b9255eca41a95cc0cf38322dc973062133e1ce1e757da8cab8fdeb16ec934f5
actual   sha256: 5b9255eca41a95cc0cf38322dc973062133e1ce1e757da8cab8fdeb16ec934f5
match: OK

OVERALL: OK
```

## Notas

- El primer `curl` a `/skills/server_time/tool.js` y `/api/time` devolvió errores
  Cloudflare transitorios (1104/1042), típicos de propagación post-deploy. En el
  reintento inmediato ambos sirvieron correctamente. No es un bug del worker: las dos
  rutas son `Response` estáticas idénticas en estructura a `sum_numbers/tool.js`, que
  sirvió bien desde el primer intento.
- No se hicieron commits git. No se tocaron archivos fuera de `demo-site/` salvo este
  reporte. No se usó `wrangler dev` ni `wrangler login` (sesión OAuth ya activa).