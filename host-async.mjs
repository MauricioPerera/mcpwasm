// host-async.mjs
// AsyncToolHost: variante async de ToolHost (host.mjs) sobre la variante ASYNCIFY
// de quickjs-emscripten. Asyncify deja que un handler `async` con `await` sobre una
// capability async del host (p.ej. fetchOrigin) corra desde QuickJS que se ve
// sincrono, sin obligar al autor de la tool a manejar promesas QuickJS a mano.

import { newQuickJSAsyncWASMModuleFromVariant, newVariant } from "quickjs-emscripten-core";
import baseAsyncifyVariant from "@jitl/quickjs-wasmfile-release-asyncify";

// Prelude que corre DENTRO del sandbox antes de las tools. host.fetchOrigin es
// sincrona del lado del sandbox (puente asyncify __fetchOriginRaw) y async del host;
// las validaciones de opts las hace el host y lanzan dentro del sandbox si fallan.
const SANDBOX_PRELUDE_ASYNC = `
  globalThis.__tools = {};

  globalThis.registerTool = function (def) {
    if (!def || typeof def.name !== "string" || typeof def.handler !== "function") {
      throw new Error("registerTool: definicion invalida");
    }
    globalThis.__tools[def.name] = def;
  };

  globalThis.host = {
    fetchOrigin: function (path, opts) {
      const out = globalThis.__fetchOriginRaw(path, opts ? JSON.stringify(opts) : "");
      return JSON.parse(out);
    },
  };

  // Dispatcher async: espera el handler (que puede ser async).
  globalThis.__dispatch = async function (name, argsJson) {
    const t = globalThis.__tools[name];
    if (!t) throw new Error("tool no encontrada: " + name);
    const args = JSON.parse(argsJson);
    const result = await t.handler(args);
    return JSON.stringify(result === undefined ? null : result);
  };

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

// Limites del runtime QuickJS.
const DEFAULT_MEMORY_LIMIT_BYTES = 64 * 1024 * 1024; // 64 MB
const DEFAULT_MAX_STACK_SIZE_BYTES = 1024 * 1024; // 1 MB
const DEFAULT_INTERRUPT_DEADLINE_MS = 2000; // deadline wall-clock por callTool
// Gas DETERMINISTA: nº de invocaciones del interruptHandler por callTool. En
// Cloudflare Workers Date.now() se CONGELA durante ejecucion sincrona (mitigacion
// Spectre), asi que el deadline wall-clock NUNCA corta un while(true){}; este
// contador si, porque no depende del reloj. Calibrado: skills legitimas consumen
// ~0 invocaciones (asyncify suspende la pila durante el await, no se llama al
// handler); un compute pesado legitimo ~200; N=20000 = 100x margen. Un while(true){}
// vacio agota N en ~1s (Node) / ~4s (workerd), muy por debajo del limite de plataforma.
const DEFAULT_INTERRUPT_MAX_INVOCATIONS = 20000;
const DEFAULT_FETCH_TIMEOUT_MS = 10000; // timeout wall-clock por fetch de fetchOrigin

export class AsyncToolHost {
  // Opciones: quickjs (modulo asyncify ya construido; recomendado en Workers para
  // evitar top-level await), quickjsModule (WebAssembly.Module pre-compilado),
  // allowedOrigin (obligatorio; unico origin permitido para fetchOrigin),
  // memoryLimitBytes/maxStackSizeBytes/interruptDeadlineMs (<=0 desactiva solo el
  // deadline wall-clock; el gas determinista sigue activo),
  // interruptMaxInvocations (gas determinista; salva contra while(true){}
  // en Workers), fetchImpl (default global fetch; el gateway inyecta uno que enruta
  // origins same-account via service binding, bypass del error 1042 worker-to-worker),
  // fetchTimeoutMs (el gas acota CPU pero no esperas de red), extraCapabilities
  // (mapa nombre->async(argsJson)=>resultJson inyectado como host.<nombre>).
  constructor({ quickjs, quickjsModule, allowedOrigin, memoryLimitBytes, maxStackSizeBytes, interruptDeadlineMs, interruptMaxInvocations, fetchImpl, fetchTimeoutMs, extraCapabilities }) {
    if (typeof allowedOrigin !== "string" || !allowedOrigin) {
      throw new Error("AsyncToolHost requiere allowedOrigin");
    }
    this._quickjs = quickjs || null;
    this._quickjsModule = quickjsModule || null;
    this._allowedOrigin = allowedOrigin;
    this._fetchImpl = typeof fetchImpl === "function" ? fetchImpl : ((u, o) => fetch(u, o));
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
    // deadline lejos en el futuro: init()/listTools() corren codigo DE CONFIANZA y
    // NO deben interrumpirse. Solo loadToolSource y callTool (no confiables) lo activan.
    this._deadline = Number.MAX_SAFE_INTEGER;
    // _interruptActive arranca false; true al entrar a loadToolSource/callTool y se
    // restaura al salir. _interruptCount se resetea al inicio de cada uno.
    this._interruptCount = 0;
    this._interruptActive = false;
    this._vm = null;
  }

  // Construye (si hace falta) y cachea el modulo asyncify. En Workers el caller pasa
  // `quickjs` ya construido para evitar un top-level await.
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

    // newContext() crea su propio runtime => estos limites son por contexto
    // (host por request => runtime por request).
    try {
      vm.runtime.setMemoryLimit(this._memoryLimitBytes);
    } catch (e) {
      console.warn("[AsyncToolHost] setMemoryLimit no aplicado:", e && e.message);
    }
    try {
      vm.runtime.setMaxStackSize(this._maxStackSizeBytes);
    } catch (e) {
      console.warn("[AsyncToolHost] setMaxStackSize no aplicado:", e && e.message);
    }
    // El handler se instala SIEMPRE: el gas determinista no depende del reloj y
    // debe sobrevivir a interruptDeadlineMs <= 0. Antes ese valor desinstalaba el
    // handler completo y apagaba tambien el gas (acoplamiento accidental de los
    // dos mecanismos); ahora <=0 desactiva SOLO el deadline wall-clock.
    try {
      // Handler true => interrumpe. Dos mecanismos: (1) contador determinista,
      // independiente del reloj, salva contra while(true){} en Workers (reloj
      // congelado); (2) deadline wall-clock (si interruptDeadlineMs > 0), backstop
      // barato donde el reloj avanza.
      const host = this;
      vm.runtime.setInterruptHandler(() => {
        if (!host._interruptActive) return false;
        host._interruptCount = (host._interruptCount + 1) >>> 0;
        if (host._interruptCount > host._interruptMaxInvocations) return true;
        if (host._interruptDeadlineMs > 0 && Date.now() > host._deadline) return true;
        return false;
      });
    } catch (e) {
      console.warn("[AsyncToolHost] setInterruptHandler no aplicado:", e && e.message);
    }

    // Capability asyncified host.fetchOrigin(path, optsJson) -> string JSON
    // {status, body}. optsJson: {method?, body?, contentType?} ("" si no hay opts).
    // Reglas: method GET|POST (default GET); body string <=16KB; body con GET lanza;
    // content-type el unico header controlable (default application/json con body);
    // origin-scope estricto (path relativo o URL con exactamente allowedOrigin, si no
    // throw); respuesta truncada a 4KB. Los throws se propagan dentro del sandbox.
    const allowedOrigin = this._allowedOrigin;
    const fetchImpl = this._fetchImpl;
    const fetchTimeoutMs = this._fetchTimeoutMs;
    const MAX_BODY_BYTES = 16 * 1024;
    const cap = vm.newFunction("__fetchOriginRaw", async (pathH, optsH) => {
      const path = vm.getString(pathH);
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
      // body con GET no tiene sentido (y algunos proxies lo descartan): lanzar. Va
      // tras validar body para que un body invalido siga dando su mensaje especifico.
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
      // Timeout doble: AbortSignal.timeout (un fetch bien comportado aborta) + un
      // Promise.race con backstop que corta aun si el fetchImpl ignora el signal
      // (p.ej. un service binding que lo descarta). El timer usa setTimeout, que SI
      // avanza (el await cede al event loop) aunque Date.now este congelado.
      fetchOpts.signal = AbortSignal.timeout(fetchTimeoutMs);
      const TIMEOUT_TAG = "__fetchOriginTimeout__";
      // clearTimeout en finally: sin esto el backstop queda colgado hasta 10s en el
      // camino feliz (leak de timers). El corte por timeout se mantiene intacto.
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
      // Lectura por streaming con cap: resp.text() materializaba el body ENTERO
      // en memoria y recien despues se truncaba a 4KB — un origin sirviendo un
      // body gigante inflaba la memoria del host. Ahora se acumula por chunks y
      // se corta el stream al alcanzar el cap; nunca se materializa mas de
      // cap+chunk. La superficie hacia la tool no cambia (body <=4096 chars).
      const MAX_RESP_BYTES = 4096;
      let respBody = "";
      if (resp.body && typeof resp.body.getReader === "function") {
        const reader = resp.body.getReader();
        const decoder = new TextDecoder("utf-8");
        const parts = [];
        let received = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            received += value.length;
            parts.push(decoder.decode(value, { stream: true }));
            if (received >= MAX_RESP_BYTES) break; // suficiente para el truncado
          }
        } finally {
          try { await reader.cancel(); } catch { /* best-effort: libera el stream */ }
        }
        parts.push(decoder.decode()); // flush (borde multi-byte final)
        respBody = parts.join("");
        if (respBody.length > 4096) respBody = respBody.slice(0, 4096);
      } else {
        // Sin ReadableStream (impl de fetch exotica): fallback al camino previo.
        const text = await resp.text();
        respBody = text.length > 4096 ? text.slice(0, 4096) : text;
      }
      return vm.newString(JSON.stringify({ status: resp.status, body: respBody }));
    });
    vm.setProp(vm.global, "__fetchOriginRaw", cap);
    cap.dispose();

    // Capabilities extra: funcion asyncified (argsJson) => resultJson, misma mecanica
    // que __fetchOriginRaw. Las __<nombre>Raw se setean antes del prelude; los metodos
    // host.<nombre> se inyectan despues (el prelude base queda intacto).
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
          // resultJson debe ser string (contrato del puente); si no, serializar.
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

    // host.<nombre> reenvia TODOS los args posicionales (...args) como array JSON al
    // puente raw. Sin el rest, `host.<name>(a, b)` perdia `b` (el puente descartaba
    // args extra). `...args` es siempre array => sin guard de undefined.
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

  // Carga y ejecuta un tool.js (sincrono: se auto-registra). Codigo NO CONFIABLE
  // (viene del origin) => activa el interrupt para cortar bucles en el top-level.
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

  // MCP: tools/call (async). __dispatch devuelve una Promise QuickJS que
  // desenrollamos con getPromiseState + executePendingJobs, cediendo al event loop
  // para que asyncify reanude la pila wasm cuando el fetch del host resuelve.
  async callTool(name, args) {
    const vm = this._vm;
    // Activar el interrupt para ESTA llamada (handler no confiable).
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
    let st = vm.getPromiseState(res.value);
    let guard = 0;
    while (st.type === "pending" && guard++ < 1000) {
      vm.runtime.executePendingJobs(1);
      st = vm.getPromiseState(res.value);
      if (st.type === "pending") {
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
