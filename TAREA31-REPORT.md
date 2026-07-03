# TAREA31 — Refactor de comentarios (hot path legible, audit trail intacto)

Refactor de comentarios puro en `host-async.mjs` y `worker-gateway.mjs`. **Cero
cambio de logica**: ninguna linea de codigo ejecutable ni ningun string literal
se modifico. Solo se tocaron lineas de comentario y whitespace/lineas en blanco.

## Lineas antes/despues

| Archivo            | Antes | Despues | Delta | Reduction |
|--------------------|------:|--------:|------:|----------:|
| host-async.mjs     |   561 |     530 |   -31 |     -5.5% |
| worker-gateway.mjs  |  1005 |     996 |    -9 |     -0.9% |
| **Total**          | 1566  |   1526  |   -40 |    -2.6%  |

La reduccion es intencionalmente modesta: la densidad de comentarios en estos
dos archivos es mayoritariamente **"por que" tecnico** (restricciones del
runtime, gotchas), no narracion. Las reglas del PM priorizan conservar ante la
duda ("mejor pasarse de conservador que borrar un por que valioso"). Se
borro/compacto solo lo que era narracion historica o re-expuesta en otra
seccion.

## Evidencia: el codigo ejecutable NO cambio

### 1. `node --check` (sintaxis valida)

```
node --check host-async.mjs      -> CHECK OK
node --check worker-gateway.mjs  -> CHECK OK
```

### 2. Las 4 suites verdes (exit 0)

| Suite         | Exit |
|---------------|------|
| npm test      | 0    |
| npm run spike | 0    |
| npm run memspike | 0 |
| npm run gateway | 0  |

Cada una termina con `TODOS LOS CHECKS VERDE` (o su equivalente) y `EXIT=0`. La
salida de negocio es identica (el bundle esbuild strippea comentarios, asi que
`dist` es equivalente; ademas los tests corren contra el gateway real).

### 3. Diff sin comentarios + whitespace VACIO (metodo robusto)

Metodo: para cada archivo, se normalizan version original (`git show HEAD:<file>`)
y nueva con **esbuild** `transform({ legalComments:"none",
minifyWhitespace:true, minifyIdentifiers:false, minifySyntax:false })`. Esta
configuracion **elimina TODO comentario** (incluidos los leading-comments del
cuerpo de clase que `legalComments:none` solo no quita), **preserva los
identificadores** (sin renombre, para que no haya ruido de minify) y colapsa
whitespace. El resultado es el codigo ejecutable + literales string, sin
comentarios ni formato. Comparar los dos: si son byte-identicos, el codigo
ejecutable y los strings no cambiaron.

> Nota sobre el metodo: esbuild con `legalComments:"none"` a secas NO remueve
> los leading-comments del cuerpo de una clase; por eso se añade
> `minifyWhitespace:true`. Se descarto el `minify:true` completo porque renombra
> identificadores y produce ruido que ocultaria diferencias reales. Con
> `minifyIdentifiers:false` los nombres quedan intactos y el diff es
> determinista y significativo.

```
diff <orig-stripped> <new-stripped> host-async.mjs      -> (vacio)  code+strings IDENTICAL
diff <orig-stripped> <new-stripped> worker-gateway.mjs  -> (vacio)  code+strings IDENTICAL
```

Esto atrapa tambien cambios a literales string (p.ej. comentarios dentro de
template literals como `SANDBOX_PRELUDE_ASYNC`): cualquier toque alli habria
flotado como diferencia. Confirmado: **ni una linea de codigo ni un string
literal cambiaron.**

Adicional: `git status --short` muestra unicamente ` M host-async.mjs` y
` M worker-gateway.mjs` (ningun otro archivo tocado; ningun commit; ningun
deploy).

## Que se BORRO / COMPACTO

- Prefijos de tarea (`TAREA7`, `TAREA9`, `TAREA12`, `TAREA16`, `TAREA17`,
  `TAREA19`, `TAREA20`, `TAREA22`, `TAREA24`, `TAREA25`, `TAREA26`, `TAREA28`)
  y referencias a numeros de tarea, eliminados del cuerpo de los comentarios.
- Narracion historica "antes hacia X, ahora hace Y" y justificaciones de
  compatibilidad con spikes viejos, recortadas a lo esencial.
- Restatement: parrafos del header que se re-exponian verbatim en las secciones
  detalladas (cache de descubrimiento, discovery hit/miss), compactados.
- JSDoc de opciones del constructor de `AsyncToolHost`: compactado a **una
  linea por opcion** (default + restriccion), sin borrarlo entero.
- Comentarios que solo repetian lo que el codigo dice literalmente.

## "Por que" tecnicos CONSERVADOS (audit trail critico intacto)

Estos quedan, reformulados sin el tag de tarea pero con el contenido tecnico
intacto:

**host-async.mjs**
1. **Ruta asyncify vs promesas+executePendingJobs** — por que se usa ASYNCIFY
   (unica forma de llamar async del host desde QuickJS sincrono, manteniendo la
   ergonomia `await`).
2. **Date.now() congelado en Workers (Spectre)** — el reloj no avanza durante
   ejecucion sincrona; por eso el gas es por conteo de invocaciones del
   interruptHandler y no wall-clock.
3. **Presupuesto determinista INTERRUPT_MAX_INVOCATIONS** — cuenta invocaciones
   (no reloj); calibrado ~100x sobre la skill legitima mas pesada y muy por
   debajo del limite de plataforma; asyncify suspende la pila durante el await
   => las skills legitimas consumen ~0 invocaciones.
4. **Deadline inicia lejos + flag _interruptActive** — init()/listTools() corren
   codigo de confianza y no deben interrumpirse.
5. **Doble mecanismo del timeout de fetchOrigin** — AbortSignal.timeout en el
   signal (fetch bien comportado aborta) + Promise.race backstop (garantiza el
   corte aun si el fetchImpl ignora el signal, p.ej. un service binding que lo
   descarta). El timer del backstop NO usa Date.now (congelado): usa setTimeout
   del event loop, que avanza porque el await cede.
6. **clearTimeout del timer del backstop (gotcha de leak)** — sin el clearTimeout
   en finally, el setTimeout queda colgado hasta fetchTimeoutMs en el camino
   feliz => leak de timers. Se limpia en finally del Promise.race.
7. **Reglas de la extension a POST de fetchOrigin** — method solo GET/POST,
   body string <=16KB, content-type unico header controlable, body con GET
   rechazado (runtimes lo descartan), origin-scope inmutable, truncado a 4KB.
   (Este bloque vive dentro del template-literal `SANDBOX_PRELUDE_ASYNC` y se
   dejo **verbatim**: tocarlo cambiaria un string literal y romperia la
   verificacion diff-vacio.)
8. **extraCapabilities: puente reenvia TODOS los args posicionales** — sin esto
   `host.<name>(a, b)` perdia `b`; `...args` siempre es array => no hace falta
   guard `args === undefined`. Sin extraCapabilities, byte-identico al previo.
9. **Bombeo de Promise QuickJS + ceder al event loop** — por que `setTimeout(0)`
   en el loop de `executePendingJobs` (asyncify reanuda la pila wasm cuando el
   fetch del host resuelve).

**worker-gateway.mjs**
10. **Error 1042 worker-to-worker misma cuenta** — por que los origins same-account
    se enrutan por service binding (bypass workers.dev) y el mismo fetchImpl se
    inyecta en AsyncToolHost.
11. **Mutex withModuleLock (asyncify: una suspension async por modulo)** —
    requests concurrentes del mismo isolate intercalarian suspensiones y
    corromperian el modulo cacheado; serializa toda ejecucion wasm en cola FIFO.
    Gotcha: el lock se suelta siempre (cola reiniciada en resolve y reject) => un
    fallo no envenena el mutex. Gotcha: las esperas en cola NO cuentan contra el
    fetchTimeoutMs de otros requests (se arma dentro de la ejecucion propia).
12. **Single-flight del descubrimiento** — miss concurrentes del mismo origin
    esperan la misma promesa (un solo fetch de llms.txt+tool.js por estampida);
    entrada borrada al settle => un fallo no envenena el cache.
13. **getMem: no envenenar la promesa** — si initMem falla, se resetea para
    reintentar en el siguiente request.
14. **snapshot/tool.js verificado por sha256 ANTES de cargar/inyectar** — la
    verificacion se hace al poblar el cache; lo cacheado es inmutable por hash =>
    no se re-verifica en hit; no se cachea contenido corrupto. Snapshot
    corrupto/no-verificado => snapshotText null => la capability memorySearch NO
    se inyecta => la skill que la use falla controlado (isError:true), no crash.
15. **Cache-bust `?_gw=<ts>` en fetchText** — bypassa el edge cache de
    Cloudflare para origins externos (sin Cache-Control, Cloudflare cachea
    .txt/.js por heuristica y podria servir un 404 stale); el sha se computa
    sobre el body, no la URL, asi que el bust no afecta la verificacion; las
    Cache API keys usan la URL limpia.
16. **Service binding: quitar AbortSignal del init** — algunas impl de binding no
    lo soportan; el worker destino es trivial, resuelve en ms.
17. **Attestations: semantica de precedencia INVALID DOMINA** — attester no
    registrado ignorado; firma que falla contra clave REGISTRADA => invalid
    (domina sobre otras validas); valid > expired > unattested. 404 del archivo =
    null (sin atestaciones, NO error de descubrimiento). Modo off no fetchea.
18. **Ed25519 via WebCrypto** — importKey "raw" 32 bytes + verify {name:"Ed25519"},
    sondeado en workerd; publica y firma en base64 (spec v0.2).
19. **canonicalOrigin** — new URL().origin ya da lowercase, sin :443 default, sin
    slash (otra origin => atestacion no replayable).
20. **timingSafeEqualStr (double HMAC)** — comparacion tiempo-aprox-constante
    para el Bearer; clave efimera por llamada, HMAC-SHA256 de ambos valores,
    XOR de los dos digests de 32 bytes sin short-circuit => neutraliza contenido
    y longitud.
21. **PerSkillHost: un contexto QuickJS por skill + ejecucion secuencial** —
    aislamiento tool<->tool (newContext propio => runtime propio); respeta la
    limitacion asyncify (una suspension async a la vez por modulo); dispose de
    todos los contextos en finally.
22. **202 para notification** — `response === null` => 202 sin body (headers con
    discovery/attestations).

## Conclusion

Hot path mas legible (menos narracion de tareas y re-expuesta), audit trail
tecnico intacto (los 22 "por que" arriba siguen en el codigo), cero cambio de
comportamiento (node --check OK, 4 suites exit 0, diff sin comentarios vacio).
No se commitio ni se deployo (los comentarios no cambian el runtime; el codigo
ejecutable es identico).