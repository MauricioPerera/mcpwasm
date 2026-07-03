// host-async.mjs
// AsyncToolHost: analogo async de ToolHost (host.mjs).
//
// Ruta tecnica: ASYNCIFY (paquete @jitl/quickjs-wasmfile-release-asyncify).
// El handler de la tool es `async` con `await` sobre capabilities async del
// host (p.ej. fetchOrigin real). Asyncify es el unico mecanismo que deja
// llamar a una funcion async del host desde codigo QuickJS que se ve sincrono,
// sin reescribir la tool como promesas manuales (alternativa executePendingJobs
// descartada: obligaria al autor de la tool a manejar promesas QuickJS a mano).

import { newQuickJSAsyncWASMModuleFromVariant, newVariant } from "quickjs-emscripten-core";
import baseAsyncifyVariant from "@jitl/quickjs-wasmfile-release-asyncify";

// Prelude que corre DENTRO del sandbox antes de las tools.
//  - host.fetchOrigin(path, opts?) -> JSON.parse(globalThis.__fetchOriginRaw(...)):
//    __fetchOriginRaw es la capability asyncified (desde QuickJS se ve SINCRONA;
//    asyncify suspende la pila wasm mientras el host hace el fetch real).
//  - opts: { method?: "GET"|"POST", body?: string, contentType?: string }.
//    Sin opts (o sin method) => GET (byte-identico al comportamiento previo).
//    Las validaciones las hace el host en __fetchOriginRaw; si fallan lanzan
//    DENTRO del sandbox.
//  - __dispatch es `async`: hace `await t.handler(args)` para soportar handlers async.
const SANDBOX_PRELUDE_ASYNC = `
  globalThis.__tools = {};

  globalThis.registerTool = function (def) {
    if (!def || typeof def.name !== "string" || typeof def.handler !== "function") {
      throw new Error("registerTool: definicion invalida");
    }
    globalThis.__tools[def.name] = def;
  };

  // 'host' es la superficie de capabilities. fetchOrigin es async del lado del host
  // pero sincrona del lado del sandbox (puente asyncify __fetchOriginRaw).
  // TAREA16: extension COMPATIBLE a POST. fetchOrigin(path, opts?) donde opts es
  //   { method?: "GET"|"POST", body?: string, contentType?: string }.
  //   Sin opts (o sin method) => GET (comportamiento anterior, byte-identico).
  //   Las validaciones (method, body, content-type) las hace el host en
  //   __fetchOriginRaw; si fallan lanzan dentro del sandbox.
  globalThis.host = {
    fetchOrigin: function (path, opts) {
      const out = globalThis.__fetchOriginRaw(path, opts ? JSON.stringify(opts) : "");
      return JSON.parse(out);
    },
  };

  // Dispatcher async: espera el handler (que puede ser async y usar await).
  globalThis.__dispatch = async function (name, argsJson) {
    const t = globalThis.__tools[name];
    if (!t) throw new Error("tool no encontrada: " + name);
    const args = JSON.parse(argsJson);
    const result = await t.handler(args);
    return JSON.stringify(result === undefined ? null : result);
  };

  // Listado de tools (schema) para tools/list de MCP. Sincrono.
  globalThis.__list = function () {
    return JSON.stringify(
      Object.values(globalThis.__tools).map(function (t) {
        return {
          name: t.name,
          description: t.description || "",
          inputSchema: t.inputSchema || { type: "object" },
        };
      })
    );
  };
`;

// --- Limites del runtime QuickJS ------------------------------------------------
//  - MEMORY_LIMIT_BYTES (64MB): tope de memoria. QuickJS lanza "memory limit
//    exceeded" y aborta la evaluacion (se propaga como error de la tool).
//  - MAX_STACK_SIZE_BYTES (1MB): pila de llamada. Evita recursion infinita
//    explosiva antes de que actue el interruptHandler.
//  - INTERRUPT_DEADLINE_MS (2s): deadline wall-clock por callTool. El
//    interruptHandler compara Date.now() contra this._deadline; si se excede,
//    devuelve true y QuickJS interrumpe el bucle en curso.
//    OJO: en Cloudflare Workers el reloj (Date.now) se CONGELA durante ejecucion
//    sincrona (mitigacion Spectre): dentro de un while(true){} Date.now() nunca
//    avanza y este check NUNCA corta. Por eso hay un segundo mecanismo
//    DETERMINISTA: presupuesto por conteo de invocaciones (ver abajo).
//  - INTERRUPT_MAX_INVOCATIONS: presupuesto DETERMINISTA por callTool/loadToolSource.
//    QuickJS llama al interruptHandler periodicamente mientras ejecuta bytecode;
//    llevamos un contador (this._interruptCount) que se resetea al inicio de cada
//    callTool/loadToolSource y devuelve true al superar N invocaciones. A
//    diferencia del deadline wall-clock, NO depende del reloj: cuenta cuantas
//    veces QuickJS invoco al handler. Una tool legitima que pasa la mayor parte
//    del tiempo en `await host.fetchOrigin` (asyncify suspende la pila => el
//    handler NO se llama durante la suspension) consume pocas invocaciones; un
//    while(true){} puro sincrono las consume rapido => interrumpe.
// APIs: vm.runtime.setMemoryLimit / setMaxStackSize / setInterruptHandler(cb);
//   cb: (runtime) => boolean | undefined | void  (true => interrumpe).
const DEFAULT_MEMORY_LIMIT_BYTES = 64 * 1024 * 1024; // 64 MB
const DEFAULT_MAX_STACK_SIZE_BYTES = 1024 * 1024; // 1 MB
const DEFAULT_INTERRUPT_DEADLINE_MS = 2000; // 2s por callTool (wall-clock; efectivo en Node/tests; congelado en Workers)
// Calibrado empiricamente: las skills legitimas reales consumen 0 invocaciones
// del interruptHandler por callTool (asyncify suspende la pila durante el await
// => el handler no se llama). Un proxy de compute pesado legitimo (1M de
// adiciones en un loop tight) consume ~200 invocaciones. N=20000 = 100x ese
// proxy, margen amplio sobre cualquier skill legitima real (~0). Un while(true){}
// vacio consume 20000 invocaciones en ~1s en Node y ~4s en workerd (WASM mas
// lento) => corte acotado muy por debajo del limite de plataforma (~40s).
const DEFAULT_INTERRUPT_MAX_INVOCATIONS = 20000;
// Timeout wall-clock por fetch de host.fetchOrigin (10s). AbortSignal.timeout
// soportado en workerd (API Web estandar, sin flag). El backstop Promise.race
// garantiza el corte aun si el fetchImpl ignora el signal (ver mas abajo).
const DEFAULT_FETCH_TIMEOUT_MS = 10000;

export class AsyncToolHost {
  // Opciones del constructor:
  //  - quickjs: QuickJSAsyncWASMModule ya construido (recomendado en Workers,
  //    reusa el modulo compilado). Si no se pasa, se construye uno nuevo (Node).
  //  - quickjsModule: WebAssembly.Module pre-compilado para la variante asyncify.
  //  - allowedOrigin: origin unico permitido para host.fetchOrigin. Obligatorio.
  //  - memoryLimitBytes (default 64MB): tope de memoria del runtime.
  //  - maxStackSizeBytes (default 1MB): pila de llamadas.
  //  - interruptDeadlineMs (default 2000): deadline wall-clock por callTool.
  //    <=0 desactiva el interruptHandler (solo queda el guard de bombeo).
  //  - interruptMaxInvocations (default 20000): presupuesto DETERMINISTA por
  //    invocaciones del interruptHandler. Salva contra while(true){} cuando el
  //    reloj esta congelado (Workers). Ver comentario en la constante.
  //  - fetchImpl (default global fetch): (url, opts) => Response usada por
  //    host.fetchOrigin. Permite inyectar un fetch que enrute origins de la
  //    misma cuenta Cloudflare via service binding (bypass del error 1042
  //    worker-to-worker por workers.dev).
  //  - fetchTimeoutMs (default 10000): timeout wall-clock por fetch. El gas
  //    determinista (interruptMaxInvocations) acota CPU pero NO esperas de red:
  //    un origin lento colgaria la invocacion aunque el handler no consuma
  //    invocaciones (asyncify suspende la pila durante el await). Doble mecanismo:
  //    AbortSignal.timeout en el signal del fetch (un fetch bien comportado
  //    aborta) MAS un Promise.race de backstop que garantiza el corte aun si el
  //    fetchImpl ignora el signal (p.ej. un binding que lo descarta). Al
  //    disparar aflora DENTRO del sandbox como error "fetchOrigin timeout"
  //    (throw -> excepcion del sandbox -> isError:true, NO crash del gateway).
  //  - extraCapabilities (default ninguna): mapa { nombre: async (argsJson) =>
  //    resultJson } que inyecta host.<nombre> con el MISMO puente raw-JSON que
  //    fetchOrigin (asyncify suspende la pila wasm mientras corre el async del
  //    host). El puente reenvia TODOS los args posicionales como un array JSON
  //    '[arg0, arg1, ...]'; la fn de la capability recibe ese array. Sin
  //    extraCapabilities el comportamiento es byte-identico al previo.
  constructor({ quickjs, quickjsModule, allowedOrigin, memoryLimitBytes, maxStackSizeBytes, interruptDeadlineMs, interruptMaxInvocations, fetchImpl, fetchTimeoutMs, extraCapabilities }) {
    if (typeof allowedOrigin !== "string" || !allowedOrigin) {
      throw new Error("AsyncToolHost requiere allowedOrigin");
    }
    this._quickjs = quickjs || null;
    this._quickjsModule = quickjsModule || null;
    this._allowedOrigin = allowedOrigin;
    this._fetchImpl = typeof fetchImpl === "function" ? fetchImpl : ((u, o) => fetch(u, o));
    // Capabilities extra inyectadas como host.<nombre> (puente raw-JSON
    // asyncified, mismo patron que __fetchOriginRaw). null/undefined => ninguna.
    this._extraCapabilities = extraCapabilities || null;
    this._fetchTimeoutMs =
      typeof fetchTimeoutMs === "number" && fetchTimeoutMs > 0 ? fetchTimeoutMs : DEFAULT_FETCH_TIMEOUT_MS;
    this._memoryLimitBytes =
      typeof memoryLimitBytes === "number" ? memoryLimitBytes : DEFAULT_MEMORY_LIMIT_BYTES;
    this._maxStackSizeBytes =
      typeof maxStackSizeBytes === "number" ? maxStackSizeBytes : DEFAULT_MAX_STACK_SIZE_BYTES;
    this._interruptDeadlineMs =
      typeof interruptDeadlineMs === "number" ? interruptDeadlineMs : DEFAULT_INTERRUPT_DEADLINE_MS;
    this._interruptMaxInvocations =
      typeof interruptMaxInvocations === "number" && interruptMaxInvocations > 0
        ? interruptMaxInvocations
        : DEFAULT_INTERRUPT_MAX_INVOCATIONS;
    // deadline inicia lejos en el futuro: init() (prelude) y listTools() (__list)
    // corren codigo DE CONFIANZA y NO deben interrumpirse. Solo loadToolSource
    // (tool.js no confiable) y callTool (handler no confiable) activan el interrupt.
    this._deadline = Number.MAX_SAFE_INTEGER;
    // Contador de invocaciones del interruptHandler y flag de activacion. El flag
    // arranca en false (init/listTools no interrumpen); se pone true al entrar a
    // loadToolSource/callTool y se restaura al salir. El contador se resetea a 0
    // al inicio de cada loadToolSource/callTool y NO se borra al salir (queda
    // disponible para calibration/observabilidad: host._interruptCount).
    this._interruptCount = 0;
    this._interruptActive = false;
    this._vm = null;
  }

  // Construye (si hace falta) y cachea el modulo asyncify. En Workers el caller
  // pasa `quickjs` ya construido para evitar un top-level await.
  async _ensureModule() {
    if (!this._quickjs) {
      const variant = newVariant(baseAsyncifyVariant, this._quickjsModule ? { wasmModule: this._quickjsModule } : {});
      this._quickjs = await newQuickJSAsyncWASMModuleFromVariant(variant);
    }
    return this._quickjs;
  }

  async init() {
    await this._ensureModule();
    const vm = this._quickjs.newContext();
    this._vm = vm;

    // --- Limites del runtime QuickJS ---------------------------------------
    // newContext() crea su propio runtime, asi que estos limites aplican solo
    // a este contexto (host por request => runtime por request).
    try {
      vm.runtime.setMemoryLimit(this._memoryLimitBytes);
    } catch (e) {
      // Si la API no existiera en la variante instalada, no bloqueamos: documentamos.
      console.warn("[AsyncToolHost] setMemoryLimit no aplicado:", e && e.message);
    }
    try {
      vm.runtime.setMaxStackSize(this._maxStackSizeBytes);
    } catch (e) {
      console.warn("[AsyncToolHost] setMaxStackSize no aplicado:", e && e.message);
    }
    if (this._interruptDeadlineMs > 0) {
      try {
        // El handler devuelve true para interrumpir. QuickJS lo llama
        // periodicamente mientras ejecuta bytecode; al devolver true, interrumpe
        // el bucle infinito en curso (lanza "interrupted" dentro del sandbox).
        // DOS mecanismos de corte:
        //  (1) Contador determinista: solo cuenta cuando _interruptActive (i.e.
        //      durante callTool/loadToolSource). Independiente del reloj => salva
        //      contra while(true){} en Workers donde Date.now esta congelado.
        //  (2) Deadline wall-clock: efectivo en Node/tests (el reloj avanza); en
        //      Workers suele estar congelado => (1) es quien salva. Se mantiene
        //      como backstop barato donde el reloj funcione.
        const host = this;
        vm.runtime.setInterruptHandler(() => {
          if (!host._interruptActive) return false;
          host._interruptCount = (host._interruptCount + 1) >>> 0;
          if (host._interruptCount > host._interruptMaxInvocations) return true;
          if (Date.now() > host._deadline) return true;
          return false;
        });
      } catch (e) {
        console.warn("[AsyncToolHost] setInterruptHandler no aplicado:", e && e.message);
      }
    }

    // Capability asyncified host.fetchOrigin. Desde QuickJS se llama como funcion
    // sincrona (__fetchOriginRaw(path, optsJson)); el cuerpo es async del host y
    // asyncify suspende la pila wasm mientras corre. Devuelve un string JSON
    // {status, body}. Si el origin no coincide con allowedOrigin -> throw (se
    // propaga como excepcion dentro del sandbox via {error}/QTS_Throw).
    //
    // Extension a POST: el segundo arg es un string JSON con opts
    // {method?, body?, contentType?} (siempre llega un string: "" cuando no hay
    // opts, por lo que vm.getString es seguro). Reglas:
    //  - method solo GET o POST (default GET). Otro -> throw DENTRO del sandbox.
    //  - body solo string, max 16384 bytes. Otro tipo o > 16KB -> throw.
    //  - content-type es el UNICO header controlable; default "application/json"
    //    cuando hay body. Sin body => sin header content-type (puro GET).
    //  - origin-scope NO cambia: path relativo o URL con exactamente el origin
    //    permitido. Cualquier otro origin -> throw "origin no permitido".
    //  - Truncado de respuesta a 4KB se mantiene.
    // fetchOrigin(path) (sin opts) sigue identico: method=GET, sin body, sin
    // headers -> fetchImpl(url) igual que antes.
    const allowedOrigin = this._allowedOrigin;
    const fetchImpl = this._fetchImpl;
    const fetchTimeoutMs = this._fetchTimeoutMs;
    const MAX_BODY_BYTES = 16 * 1024;
    const cap = vm.newFunction("__fetchOriginRaw", async (pathH, optsH) => {
      const path = vm.getString(pathH);
      // opts siempre es un string (prelude envia "" si no hay opts).
      const optsRaw = vm.getString(optsH);
      let opts = {};
      if (optsRaw) {
        try { opts = JSON.parse(optsRaw); } catch { opts = {}; }
      }
      const method = (opts && typeof opts.method === "string" ? opts.method : "GET").toUpperCase();
      if (method !== "GET" && method !== "POST") {
        throw new Error("method no permitido: " + method);
      }
      let body = undefined;
      if (opts && opts.body !== undefined && opts.body !== null) {
        if (typeof opts.body !== "string") {
          throw new Error("body debe ser string");
        }
        if (opts.body.length > MAX_BODY_BYTES) {
          throw new Error("body excede 16KB");
        }
        body = opts.body;
      }
      // body con GET no tiene sentido y ademas algunos runtimes/proxies lo
      // rechazan o descartan silenciosamente. Si method resuelve a GET y hay
      // body (ya validado como string <=16KB arriba) -> throw DENTRO del
      // sandbox. Se hace tras validar body para que un body invalido siga
      // lanzando su mensaje especifico.
      if (method === "GET" && body !== undefined) {
        throw new Error("body no permitido con GET");
      }
      let contentType = opts && typeof opts.contentType === "string" ? opts.contentType : null;
      if (body !== undefined && !contentType) {
        contentType = "application/json";
      }
      let url;
      if (/^https?:\/\//i.test(path)) {
        url = new URL(path);
      } else {
        url = new URL(path, allowedOrigin);
      }
      if (url.origin !== allowedOrigin) {
        throw new Error("origin no permitido: " + url.origin);
      }
      const fetchOpts = { method };
      if (body !== undefined) {
        fetchOpts.body = body;
        fetchOpts.headers = { "content-type": contentType };
      }
      // Timeout wall-clock por fetch. Doble mecanismo:
      //  (1) AbortSignal.timeout(fetchTimeoutMs) en fetchOpts.signal: un fetch
      //      bien comportado (global undici / workerd) aborta la conexion al
      //      vencer, liberando recursos.
      //  (2) Promise.race contra un timer de backstop: garantiza el corte aun si
      //      el fetchImpl ignora el signal (p.ej. un service binding que descarta
      //      signal, ver makeFetchImpl en worker-gateway.mjs) o si nunca resuelve.
      //      El timer NO usa Date.now (congelado en Workers durante ejecucion
      //      sincrona): setTimeout dispara en tiempo real del event loop, que SI
      //      avanza porque el await cede.
      // Al disparar (signal abort o backstop) se lanza "fetchOrigin timeout"
      // DENTRO del sandbox -> isError:true, no crash del gateway.
      fetchOpts.signal = AbortSignal.timeout(fetchTimeoutMs);
      const TIMEOUT_TAG = "__fetchOriginTimeout__";
      // Capturamos el id del timer del backstop para hacerle clearTimeout al
      // resolver/rechazar el fetch. Sin esto, en el camino feliz (fetch resuelve
      // rapido) el setTimeout queda colgado hasta fetchTimeoutMs (10s por
      // llamada a fetchOrigin) -> leak menor de timers. Se limpia en finally
      // del Promise.race (corre tanto en resolve como en throw). El timeout
      // queda intacto: si el fetch no resuelve y vence el timer, el backstop
      // sigue lanzando TIMEOUT_TAG -> "fetchOrigin timeout".
      let timerId;
      const timeoutP = new Promise((_, reject) => {
        timerId = setTimeout(() => reject(new Error(TIMEOUT_TAG)), fetchTimeoutMs);
      });
      let resp;
      try {
        resp = await Promise.race([fetchImpl(url.href, fetchOpts), timeoutP]);
      } catch (e) {
        const msg = String((e && e.message) || e);
        if (msg === TIMEOUT_TAG ||
            (fetchOpts.signal && fetchOpts.signal.aborted) ||
            /timeout|aborted|abort/i.test(msg)) {
          throw new Error("fetchOrigin timeout");
        }
        throw e;
      } finally {
        clearTimeout(timerId);
      }
      const text = await resp.text();
      const respBody = text.length > 4096 ? text.slice(0, 4096) : text;
      return vm.newString(JSON.stringify({ status: resp.status, body: respBody }));
    });
    vm.setProp(vm.global, "__fetchOriginRaw", cap);
    cap.dispose();

    // Capabilities extra (extraCapabilities). Misma mecanica que __fetchOriginRaw:
    // funcion asyncified (argsJson: string) => resultJson: string. asyncify
    // suspende la pila wasm del sandbox mientras corre el async del host. Las
    // __<nombre>Raw se setean ANTES del prelude; los metodos host.<nombre> que
    // las invocan se inyectan DESPUES del prelude (el prelude base queda intacto
    // => sin extraCapabilities el comportamiento es byte-identico al previo).
    const extraCaps = this._extraCapabilities;
    if (extraCaps) {
      for (const name of Object.keys(extraCaps)) {
        const fn = extraCaps[name];
        if (typeof fn !== "function") {
          throw new Error("extraCapabilities: '" + name + "' no es funcion");
        }
        const rawName = "__" + name + "Raw";
        const ecap = vm.newFunction(rawName, async (argsH) => {
          const argsJson = vm.getString(argsH);
          const resultJson = await fn(argsJson);
          // resultJson debe ser string (puente raw-JSON); si la fn devuelve un
          // objeto/otro, lo serializamos para no romper el contrato del puente.
          return vm.newString(
            typeof resultJson === "string" ? resultJson : JSON.stringify(resultJson === undefined ? null : resultJson)
          );
        });
        vm.setProp(vm.global, rawName, ecap);
        ecap.dispose();
      }
    }

    const pre = vm.evalCode(SANDBOX_PRELUDE_ASYNC);
    if (pre.error) {
      const msg = vm.dump(pre.error);
      pre.error.dispose();
      throw new Error("fallo el prelude del sandbox async: " + JSON.stringify(msg));
    }
    pre.value.dispose();

    // Inyecta host.<nombre> para cada capability extra. El prelude base ya
    // definio globalThis.host = { fetchOrigin }; aqui solo agregamos metodos.
    // El wrapper reenvia TODOS los args posicionales (rest ...args) como un array
    // JSON al puente raw, en vez de solo el primer arg. Sin esto una llamada
    // `host.<name>(a, b)` perdia `b` (el puente descartaba args extra). Ahora
    // envia '["a",b]' y el lado host desempaqueta el array. `...args` es siempre
    // un array (posiblemente vacio) => no hace falta guard `args === undefined`.
    if (extraCaps) {
      const extraHostSrc = Object.keys(extraCaps)
        .map(function (name) {
          return (
            "globalThis.host." + name + " = function (...args) {" +
            " return JSON.parse(globalThis.__" + name + "Raw(JSON.stringify(args)));" +
            "};"
          );
        })
        .join("\n");
      const ex = vm.evalCode(extraHostSrc);
      if (ex.error) {
        const msg = vm.dump(ex.error);
        ex.error.dispose();
        throw new Error("fallo al inyectar extraCapabilities: " + JSON.stringify(msg));
      }
      ex.value.dispose();
    }
  }

  // Carga el texto de un tool.js y lo ejecuta dentro del sandbox (sincrono: registro).
  // tool.js es codigo NO CONFIABLE (viene del origin): activamos el deadline del
  // interruptHandler para cortar bucles infinitos en el top-level del registro.
  loadToolSource(sourceText) {
    const vm = this._vm;
    const prevDeadline = this._deadline;
    const prevActive = this._interruptActive;
    this._deadline = Date.now() + this._interruptDeadlineMs;
    this._interruptCount = 0;
    this._interruptActive = true;
    try {
      const res = vm.evalCode(sourceText);
      if (res.error) {
        const msg = vm.dump(res.error);
        res.error.dispose();
        throw new Error("fallo al cargar tool.js: " + JSON.stringify(msg));
      }
      res.value.dispose();
    } finally {
      this._interruptActive = prevActive;
      this._deadline = prevDeadline;
    }
  }

  // MCP: tools/list (sincrono).
  listTools() {
    const vm = this._vm;
    const fn = vm.getProp(vm.global, "__list");
    const res = vm.callFunction(fn, vm.undefined);
    fn.dispose();
    if (res.error) {
      const msg = vm.dump(res.error);
      res.error.dispose();
      throw new Error("listTools fallo: " + JSON.stringify(msg));
    }
    const json = vm.getString(res.value);
    res.value.dispose();
    return JSON.parse(json);
  }

  // MCP: tools/call (ASINCRONO). El handler de la tool puede ser async y usar await.
  // evalCodeAsync evalua __dispatch(...) que devuelve una Promise QuickJS; la
  // desenrollamos con getPromiseState + executePendingJobs (bombeando jobs y
  // cediendo al event loop para que asyncify reanude la pila wasm cuando el fetch
  // del host resuelve).
  async callTool(name, args) {
    const vm = this._vm;
    // Activar el interrupt para ESTA llamada (handler no confiable): resetear el
    // contador determinista y armar el deadline wall-clock. El interruptHandler
    // corta bucles infinitos por whichever mecanismo dispare primero.
    const prevDeadline = this._deadline;
    const prevActive = this._interruptActive;
    this._deadline = Date.now() + this._interruptDeadlineMs;
    this._interruptCount = 0;
    this._interruptActive = true;
    try {
      return await this._callToolInner(name, args);
    } finally {
      this._interruptActive = prevActive;
      this._deadline = prevDeadline;
    }
  }

  async _callToolInner(name, args) {
    const vm = this._vm;
    const code =
      "__dispatch(" +
      JSON.stringify(name) +
      ", " +
      JSON.stringify(JSON.stringify(args ?? {})) +
      ")";
    const res = await vm.evalCodeAsync(code);
    if (res.error) {
      const dumped = vm.dump(res.error);
      res.error.dispose();
      const message =
        dumped && typeof dumped === "object" && dumped.message
          ? dumped.message
          : typeof dumped === "string"
          ? dumped
          : JSON.stringify(dumped);
      throw new Error(message);
    }
    // res.value es el handle de la Promise QuickJS devuelta por __dispatch (async).
    let st = vm.getPromiseState(res.value);
    let guard = 0;
    while (st.type === "pending" && guard++ < 1000) {
      vm.runtime.executePendingJobs(1);
      st = vm.getPromiseState(res.value);
      if (st.type === "pending") {
        // Ceder al event loop para que el fetch del host (async) resuelva y
        // asyncify reanude la pila wasm.
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    if (st.type === "rejected") {
      const dumped = vm.dump(st.error);
      st.error.dispose();
      res.value.dispose();
      const message =
        dumped && typeof dumped === "object" && dumped.message
          ? dumped.message
          : typeof dumped === "string"
          ? dumped
          : JSON.stringify(dumped);
      throw new Error(message);
    }
    if (st.type !== "fulfilled") {
      res.value.dispose();
      throw new Error("tool: la promesa no se resolvio (timeout de bombeo)");
    }
    const json = vm.getString(st.value);
    st.value.dispose();
    res.value.dispose();
    return JSON.parse(json);
  }

  dispose() {
    if (this._vm) this._vm.dispose();
  }
}