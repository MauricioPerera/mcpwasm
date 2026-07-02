// host-async.mjs
// AsyncToolHost: analogo async de ToolHost (host.mjs) para el spike TAREA5.
//
// Diferencias clave vs ToolHost (sincrono):
//  - Usa la variante ASYNCIFY de quickjs-emscripten (newQuickJSAsyncWASMModuleFromVariant),
//    que permite que codigo sincrono DENTRO del sandbox espere funciones async del host
//    (asyncify suspende/reanuda la pila wasm).
//  - callTool es ASYNC: el handler de la tool puede ser async y usar `await` sobre una
//    capability async del host (host.fetchOrigin).
//  - Inyecta la capability host.fetchOrigin(path): hace fetch HTTP real RESTRINGIDO a un
//    unico origin permitido. Cualquier URL/origin distinto -> throw "origin no permitido"
//    que se propaga como excepcion DENTRO del sandbox.
//
// Ruta tecnica: ASYNCIFY (paquete @jitl/quickjs-wasmfile-release-asyncify).
// Por que: el handler debe ser `async` con `await` y la capability debe hacer fetch real
// (async). Asyncify es el unico mecanismo que deja llamar a una funcion async del host
// desde codigo QuickJS que se ve sincrono, sin reescribir la tool como promesas manuales.
// La alternativa promesas+executePendingJobs requeriria que el autor de la tool maneje
// promesas QuickJS a mano; descartada para mantener la ergonomia `await` pedida.

import { newQuickJSAsyncWASMModuleFromVariant, newVariant } from "quickjs-emscripten-core";
import baseAsyncifyVariant from "@jitl/quickjs-wasmfile-release-asyncify";

// Prelude que corre DENTRO del sandbox antes de las tools. Igual al sincrono salvo:
//  - host.fetchOrigin(path) -> JSON.parse(globalThis.__fetchOriginRaw(path))
//    __fetchOriginRaw es la capability asyncified: desde QuickJS se ve SINCRONA
//    (asyncify suspende la pila wasm mientras el host hace el fetch real).
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
  globalThis.host = {
    fetchOrigin: function (path) {
      const out = globalThis.__fetchOriginRaw(path);
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

// --- Hardening (TAREA7 gateway): limites del runtime QuickJS ------------------
// Valores por defecto aplicados a TODO AsyncToolHost (incluido el spike TAREA5,
// que sigue verde porque sus tools son triviales y rapidas).
//  - MEMORY_LIMIT_BYTES: tope de memoria del runtime (64MB). Cubre tools que
//    acumulan strings/arrays enormes; QuickJS lanza "memory limit exceeded" y
//    aborta la evaluacion (se propaga como error de la tool).
//  - MAX_STACK_SIZE_BYTES: pila de llamada (1MB). Evita recursion infinita
//    explosiva antes de que actue el interruptHandler.
//  - INTERRUPT_DEADLINE_MS: deadline wall-clock por callTool (2s). El
//    interruptHandler compara Date.now() contra this._deadline; si se excede,
//    devuelve true y QuickJS interrumpe el bucle infinito en curso.
// APIs usadas (verificadas en node_modules/quickjs-emscripten-core/dist/index.d.ts):
//   vm.runtime.setMemoryLimit(bytes)   -> QuickJSRuntime#setMemoryLimit
//   vm.runtime.setMaxStackSize(bytes)  -> QuickJSRuntime#setMaxStackSize
//   vm.runtime.setInterruptHandler(cb) -> QuickJSRuntime#setInterruptHandler
//   cb: (runtime) => boolean | undefined | void  (true => interrumpe)
const DEFAULT_MEMORY_LIMIT_BYTES = 64 * 1024 * 1024; // 64 MB
const DEFAULT_MAX_STACK_SIZE_BYTES = 1024 * 1024; // 1 MB
const DEFAULT_INTERRUPT_DEADLINE_MS = 2000; // 2s por callTool

export class AsyncToolHost {
  // Opciones:
  //  - quickjs: modulo QuickJSAsyncWASMModule ya construido (recomendado en Workers,
  //    para reusar el modulo compilado). Si no se pasa, se construye uno nuevo (Node).
  //  - quickjsModule: WebAssembly.Module pre-compilado para construir la variante asyncify.
  //  - allowedOrigin: origin unico permitido para host.fetchOrigin. Obligatorio.
  //  - memoryLimitBytes (opcional, default 64MB): tope de memoria del runtime.
  //  - maxStackSizeBytes (opcional, default 1MB): pila de llamadas.
  //  - interruptDeadlineMs (opcional, default 2000): deadline wall-clock por callTool.
  //    Poner <=0 desactiva el interruptHandler (solo queda el guard de bombeo).
  //  - fetchImpl (opcional, default global fetch): funcion (url, opts) => Response
  //    usada por la capability host.fetchOrigin. Permite al gateway (TAREA7)
  //    inyectar un fetch que enrute origins de la misma cuenta Cloudflare via
  //    service binding (bypass del error 1042 worker-to-worker por workers.dev).
  //    El spike no lo pasa => usa fetch global => sigue verde.
  constructor({ quickjs, quickjsModule, allowedOrigin, memoryLimitBytes, maxStackSizeBytes, interruptDeadlineMs, fetchImpl }) {
    if (typeof allowedOrigin !== "string" || !allowedOrigin) {
      throw new Error("AsyncToolHost requiere allowedOrigin");
    }
    this._quickjs = quickjs || null;
    this._quickjsModule = quickjsModule || null;
    this._allowedOrigin = allowedOrigin;
    this._fetchImpl = typeof fetchImpl === "function" ? fetchImpl : ((u, o) => fetch(u, o));
    this._memoryLimitBytes =
      typeof memoryLimitBytes === "number" ? memoryLimitBytes : DEFAULT_MEMORY_LIMIT_BYTES;
    this._maxStackSizeBytes =
      typeof maxStackSizeBytes === "number" ? maxStackSizeBytes : DEFAULT_MAX_STACK_SIZE_BYTES;
    this._interruptDeadlineMs =
      typeof interruptDeadlineMs === "number" ? interruptDeadlineMs : DEFAULT_INTERRUPT_DEADLINE_MS;
    // deadline inicia lejos en el futuro: init() (prelude) y listTools() (__list)
    // corren codigo DE CONFIANZA y NO deben interrumpirse. Solo loadToolSource
    // (tool.js no confiable) y callTool (handler no confiable) activan el deadline.
    this._deadline = Number.MAX_SAFE_INTEGER;
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

    // --- Hardening: limites del runtime QuickJS (TAREA7 gateway) -------------
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
        // El handler devuelve true cuando Date.now() > deadline. QuickJS lo
        // llama regularmente mientras ejecuta; al devolver true, interrumpe el
        // bucle infinito en curso (lanza "interrupted" dentro del sandbox).
        const host = this;
        vm.runtime.setInterruptHandler(() => {
          return Date.now() > host._deadline;
        });
      } catch (e) {
        console.warn("[AsyncToolHost] setInterruptHandler no aplicado:", e && e.message);
      }
    }

    // Capability asyncified host.fetchOrigin. Desde QuickJS se llama como funcion
    // sincrona (__fetchOriginRaw(path)); el cuerpo es async del host y asyncify
    // suspende la pila wasm mientras corre. Devuelve un string JSON {status, body}.
    // Si el origin no coincide con allowedOrigin -> throw (se propaga como
    // excepcion dentro del sandbox via el mecanismo {error}/QTS_Throw de newFunction).
    const allowedOrigin = this._allowedOrigin;
    const fetchImpl = this._fetchImpl;
    const cap = vm.newFunction("__fetchOriginRaw", async (pathH) => {
      const path = vm.getString(pathH);
      let url;
      if (/^https?:\/\//i.test(path)) {
        url = new URL(path);
      } else {
        url = new URL(path, allowedOrigin);
      }
      if (url.origin !== allowedOrigin) {
        throw new Error("origin no permitido: " + url.origin);
      }
      const resp = await fetchImpl(url.href);
      const text = await resp.text();
      const body = text.length > 4096 ? text.slice(0, 4096) : text;
      return vm.newString(JSON.stringify({ status: resp.status, body }));
    });
    vm.setProp(vm.global, "__fetchOriginRaw", cap);
    cap.dispose();

    const pre = vm.evalCode(SANDBOX_PRELUDE_ASYNC);
    if (pre.error) {
      const msg = vm.dump(pre.error);
      pre.error.dispose();
      throw new Error("fallo el prelude del sandbox async: " + JSON.stringify(msg));
    }
    pre.value.dispose();
  }

  // Carga el texto de un tool.js y lo ejecuta dentro del sandbox (sincrono: registro).
  // tool.js es codigo NO CONFIABLE (viene del origin): activamos el deadline del
  // interruptHandler para cortar bucles infinitos en el top-level del registro.
  loadToolSource(sourceText) {
    const vm = this._vm;
    const prev = this._deadline;
    this._deadline = Date.now() + this._interruptDeadlineMs;
    try {
      const res = vm.evalCode(sourceText);
      if (res.error) {
        const msg = vm.dump(res.error);
        res.error.dispose();
        throw new Error("fallo al cargar tool.js: " + JSON.stringify(msg));
      }
      res.value.dispose();
    } finally {
      this._deadline = prev;
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
    // Activar el deadline wall-clock para ESTA llamada (handler no confiable).
    // El interruptHandler compara contra this._deadline y corta bucles infinitos.
    const prev = this._deadline;
    this._deadline = Date.now() + this._interruptDeadlineMs;
    try {
      return await this._callToolInner(name, args);
    } finally {
      this._deadline = prev;
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