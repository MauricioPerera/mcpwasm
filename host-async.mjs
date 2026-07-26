// host-async.mjs
// AsyncToolHost: variante async de ToolHost (host.mjs) sobre la variante ASYNCIFY
// de quickjs-emscripten. Asyncify deja que un handler `async` con `await` sobre una
// capability async del host (p.ej. fetchOrigin) corra desde QuickJS que se ve
// sincrono, sin obligar al autor de la tool a manejar promesas QuickJS a mano.

import { newQuickJSAsyncWASMModuleFromVariant, newVariant } from "quickjs-emscripten-core";
import baseAsyncifyVariant from "@jitl/quickjs-wasmfile-release-asyncify";
import { canonicalBase, resolveFromBase, isUnderBase, basePath } from "./origin-scope.mjs";

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
// Cap del cuerpo de respuesta que cruza al sandbox, en BYTES. Configurable por
// host (maxResponseBytes), como el resto de los limites.
const DEFAULT_MAX_RESPONSE_BYTES = 4096;

export class AsyncToolHost {
  // Opciones: quickjs (modulo asyncify ya construido; recomendado en Workers para
  // evitar top-level await), quickjsModule (WebAssembly.Module pre-compilado),
  // allowedOrigin (obligatorio; unico origin permitido para fetchOrigin),
  // memoryLimitBytes/maxStackSizeBytes/interruptDeadlineMs (<=0 desactiva solo el
  // deadline wall-clock; el gas determinista sigue activo),
  // interruptMaxInvocations (gas determinista; salva contra while(true){}
  // en Workers), fetchImpl (default global fetch; el gateway inyecta uno que enruta
  // origins same-account via service binding, bypass del error 1042 worker-to-worker),
  // fetchTimeoutMs (el gas acota CPU pero no esperas de red), maxResponseBytes
  // (cap EN BYTES del cuerpo que ve la tool; default 4096), extraCapabilities
  // (mapa nombre->async(argsJson)=>resultJson inyectado como host.<nombre>).
  constructor({ quickjs, quickjsModule, allowedOrigin, memoryLimitBytes, maxStackSizeBytes, interruptDeadlineMs, interruptMaxInvocations, fetchImpl, fetchTimeoutMs, maxResponseBytes, extraCapabilities }) {
    if (typeof allowedOrigin !== "string" || !allowedOrigin) {
      throw new Error("AsyncToolHost requiere allowedOrigin");
    }
    // allowedOrigin puede traer path (publicador tipo GitHub Pages de proyecto,
    // https://user.github.io/REPO). Se canonicaliza una vez; sin path el scope
    // equivale al chequeo por origin de siempre.
    const canonAllowed = canonicalBase(allowedOrigin);
    if (canonAllowed === null) {
      throw new Error("AsyncToolHost: allowedOrigin invalido: " + allowedOrigin);
    }
    allowedOrigin = canonAllowed;
    this._quickjs = quickjs || null;
    this._quickjsModule = quickjsModule || null;
    this._allowedOrigin = allowedOrigin;
    this._fetchImpl = typeof fetchImpl === "function" ? fetchImpl : ((u, o) => fetch(u, o));
    this._extraCapabilities = extraCapabilities || null;
    this._fetchTimeoutMs =
      typeof fetchTimeoutMs === "number" && fetchTimeoutMs > 0 ? fetchTimeoutMs : DEFAULT_FETCH_TIMEOUT_MS;
    this._maxResponseBytes =
      typeof maxResponseBytes === "number" && maxResponseBytes > 0 ? Math.floor(maxResponseBytes) : DEFAULT_MAX_RESPONSE_BYTES;
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
    // Contabilidad del presupuesto de EJECUCION (ver el interrupt handler):
    // _execStart marca el inicio del segmento en curso, _execAccum acumula los
    // cerrados. Las suspensiones asyncify cierran un segmento y abren otro al
    // reanudar, asi que la espera queda fuera del presupuesto.
    this._execStart = 0;
    this._execAccum = 0;
    // Que mecanismo disparo la ultima interrupcion ("gas" | "deadline"): un
    // "interrupted" a secas no distinguia un bucle infinito de un presupuesto
    // agotado, y ambos llegan al cliente como isError:true.
    this._interruptReason = null;
    this._vm = null;
  }

  // Cierran/reabren el segmento de ejecucion. Los llama un puente alrededor del
  // await que suspende la pila del sandbox. Fuera de callTool/loadToolSource
  // (_interruptActive false) no hay nada que contabilizar.
  _suspendExec() {
    if (this._interruptActive) this._execAccum += Date.now() - this._execStart;
  }
  _resumeExec() {
    if (this._interruptActive) this._execStart = Date.now();
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
      // congelado); (2) presupuesto wall-clock (si interruptDeadlineMs > 0).
      //
      // El presupuesto mide TIEMPO DE EJECUCION, no tiempo de pared: el rato que
      // la pila pasa SUSPENDIDA esperando una capability del host (fetchOrigin,
      // memorySearch) no cuenta. Antes si contaba, porque el deadline se fijaba
      // una sola vez al entrar a callTool: un origin mas lento que el presupuesto
      // dejaba a la tool sin margen y la primera invocacion del handler tras
      // reanudar la mataba -- con el MISMO mensaje "interrupted" que produce el
      // corte anti-while(true), asi que un publicador lento se diagnosticaba como
      // una tool en bucle infinito. Medido: con un fetch de 3s bastaban ~5000
      // iteraciones posteriores para morir, mientras el mismo computo sin fetch
      // previo pasaba de sobra.
      //
      // Se acumula el tiempo de cada SEGMENTO de ejecucion (_execAccum) mas el
      // segmento en curso (desde _execStart): el presupuesto total de EJECUCION
      // sigue acotado; lo que ya no acota es la espera de red, que tiene su
      // propio limite por fetch (fetchTimeoutMs).
      const host = this;
      vm.runtime.setInterruptHandler(() => {
        if (!host._interruptActive) return false;
        host._interruptCount = (host._interruptCount + 1) >>> 0;
        if (host._interruptCount > host._interruptMaxInvocations) {
          host._interruptReason = "gas";
          return true;
        }
        if (host._interruptDeadlineMs > 0 &&
            host._execAccum + (Date.now() - host._execStart) > host._interruptDeadlineMs) {
          host._interruptReason = "deadline";
          return true;
        }
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
    const maxResponseBytes = this._maxResponseBytes;
    const MAX_BODY_BYTES = 16 * 1024;
    const self = this;
    const cap = vm.newFunction("__fetchOriginRaw", async (pathH, optsH) => {
      // La pila del sandbox queda suspendida durante todo este handler: su
      // duracion NO debe consumir el presupuesto de ejecucion de la tool.
      self._suspendExec();
      try {
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
      // Scope: mismo origin Y, si el publicador vive bajo un path (sitio de
      // proyecto), dentro de ese path. Sin path el chequeo es el de siempre.
      let url;
      if (/^https?:\/\//i.test(path)) {
        url = new URL(path);
      } else {
        url = new URL(resolveFromBase(allowedOrigin, path));
      }
      if (url.origin !== new URL(allowedOrigin).origin) {
        throw new Error("origin no permitido: " + url.origin);
      }
      if (!isUnderBase(allowedOrigin, url.href)) {
        // Mismo host, fuera del subpath del publicador: en un host compartido
        // (user.github.io con varios proyectos) esto seria salirse a otro
        // proyecto. Mensaje propio para no confundirlo con el cross-origin.
        throw new Error("fuera del scope del publicador (" + basePath(allowedOrigin) + "): " + url.pathname);
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
      // Lectura por streaming con cap. Antes: se acumulaba hasta MAX_RESP_BYTES
      // *bytes* y despues se cortaba el string decodificado a 4096 *caracteres*,
      // asi que el cap real dependia de la codificacion (ASCII 4 KB, acentos
      // 8 KB, CJK 12 KB) y para contenido entre 4096 bytes y 4096 chars el corte
      // dependia de como troceara el fetch. Ahora el cap se aplica en BYTES, que
      // es lo que el nombre de la constante siempre dijo y lo unico que protege
      // memoria de verdad.
      //
      // Y sobre todo: el truncado era INVISIBLE. La tool recibia {status, body}
      // sin forma de distinguir "la respuesta termino" de "la corte yo", asi que
      // un JSON de mas de 4 KB llegaba partido y reventaba en JSON.parse con un
      // error que parece del publicador. Ahora se devuelven `truncated` y `bytes`
      // (leidos), mas `contentLength` cuando el origin declara el header: sin el,
      // una tool que quiera informar el tamaño real del recurso solo puede medir
      // lo truncado y mentir.
      const maxRespBytes = maxResponseBytes;
      let respBody = "";
      let truncated = false;
      let received = 0;
      // Number(null) es 0, no NaN: sin este chequeo explicito una respuesta
      // chunked (sin header) reportaba contentLength 0, que una tool leeria como
      // "el recurso esta vacio". Ausente debe ser null: "no se sabe".
      const clRaw = resp.headers.get("content-length");
      const clNum = clRaw === null ? NaN : Number(clRaw);
      const contentLength = Number.isFinite(clNum) && clNum >= 0 ? clNum : null;
      if (resp.body && typeof resp.body.getReader === "function") {
        const reader = resp.body.getReader();
        const chunks = [];
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            if (received >= maxRespBytes) break; // suficiente para el cap
          }
        } finally {
          try { await reader.cancel(); } catch { /* best-effort: libera el stream */ }
        }
        let all = new Uint8Array(received);
        let off = 0;
        for (const c of chunks) { all.set(c, off); off += c.length; }
        if (received > maxRespBytes) {
          truncated = true;
          all = all.subarray(0, maxRespBytes);
        }
        respBody = new TextDecoder("utf-8").decode(all);
        // Un corte a mitad de secuencia UTF-8 deja un U+FFFD final espurio: se
        // quita para no inventar un caracter que el origin no envio.
        if (truncated && respBody.charCodeAt(respBody.length - 1) === 0xfffd) {
          respBody = respBody.slice(0, -1);
        }
      } else {
        // Sin ReadableStream (impl de fetch exotica): fallback al camino previo.
        const text = await resp.text();
        const bytes = new TextEncoder().encode(text);
        received = bytes.length;
        if (bytes.length > maxRespBytes) {
          truncated = true;
          respBody = new TextDecoder("utf-8").decode(bytes.subarray(0, maxRespBytes));
          if (respBody.charCodeAt(respBody.length - 1) === 0xfffd) respBody = respBody.slice(0, -1);
        } else {
          respBody = text;
        }
      }
      return vm.newString(JSON.stringify({ status: resp.status, body: respBody, truncated, bytes: received, contentLength }));
      } finally {
        self._resumeExec();
      }
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
          self._suspendExec(); // misma regla que fetchOrigin: la espera no cuenta
          let resultJson;
          try {
            resultJson = await fn(argsJson);
          } finally {
            self._resumeExec();
          }
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
    this._deadline = Date.now() + this._interruptDeadlineMs; // legado: ya no se consulta
    this._interruptCount = 0;
    this._execAccum = 0;
    this._execStart = Date.now();
    this._interruptReason = null;
    this._interruptActive = true;
    try {
      const res = vm.evalCode(sourceText);
      if (res.error) {
        const msg = vm.dump(res.error);
        res.error.dispose();
        throw new Error(this._qualifyInterrupt("fallo al cargar tool.js: " + JSON.stringify(msg)));
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
    this._deadline = Date.now() + this._interruptDeadlineMs; // legado: ya no se consulta
    this._interruptCount = 0;
    this._execAccum = 0;
    this._execStart = Date.now();
    this._interruptReason = null;
    this._interruptActive = true;
    try {
      return await this._callToolInner(name, args);
    } finally {
      this._interruptActive = prevActive;
      this._deadline = prevDeadline;
    }
  }

  // QuickJS lanza "interrupted" sin decir CUAL de los dos mecanismos corto. Con
  // _interruptReason se cualifica el mensaje, que es lo que finalmente ve el
  // cliente MCP como isError:true. Sin esto, "gas agotado por un bucle infinito"
  // y "presupuesto de ejecucion agotado" son el mismo texto.
  _qualifyInterrupt(message) {
    if (!/interrupted/i.test(String(message || ""))) return message;
    if (this._interruptReason === "gas") {
      return message + " (gas agotado: " + this._interruptMaxInvocations +
        " invocaciones del interrupt handler; tipico de un bucle sin fin)";
    }
    if (this._interruptReason === "deadline") {
      return message + " (presupuesto de EJECUCION agotado: " + this._interruptDeadlineMs +
        "ms de CPU en el sandbox; la espera de fetchOrigin no cuenta)";
    }
    return message;
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
      throw new Error(this._qualifyInterrupt(message));
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
      throw new Error(this._qualifyInterrupt(message));
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
