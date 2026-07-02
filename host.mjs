// host.mjs
// Host embebible tipo "php-wasm para tools MCP".
// El dueño de la plataforma embebe esto en SU backend, carga archivos tool.js,
// y cada tool corre aislada en QuickJS-wasm. La unica via de la tool hacia la
// logica interna es la capability puente que el host inyecta.
//
// getQuickJS se importa de forma lazy solo si no se provee un modulo pre-construido,
// asi el bundle para Cloudflare Workers no arrastra el cargador de wasm por archivo.

// Prelude que se ejecuta DENTRO del sandbox antes de la tool.
// Define la API que el autor de la tool usa: registerTool(...) y host.callInternal(...).
// Todo lo que cruza el borde del sandbox son strings JSON (barato, local, sin red).
const SANDBOX_PRELUDE = `
  globalThis.__tools = {};

  globalThis.registerTool = function (def) {
    if (!def || typeof def.name !== "string" || typeof def.handler !== "function") {
      throw new Error("registerTool: definicion invalida");
    }
    globalThis.__tools[def.name] = def;
  };

  // 'host' es la superficie de capabilities. Hoy solo callInternal.
  // Por dentro serializa a JSON y cruza el borde via la funcion inyectada por el host.
  globalThis.host = {
    callInternal: function (name, args) {
      const out = globalThis.__callInternalRaw(name, JSON.stringify(args ?? {}));
      return JSON.parse(out);
    },
  };

  // Dispatcher usado por el host para invocar una tool por nombre.
  globalThis.__dispatch = function (name, argsJson) {
    const t = globalThis.__tools[name];
    if (!t) throw new Error("tool no encontrada: " + name);
    const args = JSON.parse(argsJson);
    const result = t.handler(args);
    return JSON.stringify(result === undefined ? null : result);
  };

  // Listado de tools (schema) para tools/list de MCP.
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

export class ToolHost {
  constructor({ callInternal, quickjs }) {
    if (typeof callInternal !== "function") {
      throw new Error("ToolHost requiere una capability callInternal");
    }
    this._callInternal = callInternal;
    this._QuickJS = quickjs || null; // modulo pre-construido (Workers) u obtenido en init (Node)
    this._vm = null;
  }

  async init() {
    if (!this._QuickJS) {
      const { getQuickJS } = await import("quickjs-emscripten");
      this._QuickJS = await getQuickJS();
    }
    const vm = this._QuickJS.newContext();
    this._vm = vm;

    // Inyectamos la funcion puente. Recibe (name, argsJson) como strings,
    // llama a la logica interna del host, y devuelve el resultado como string JSON.
    const bridge = vm.newFunction("__callInternalRaw", (nameH, argsJsonH) => {
      const name = vm.getString(nameH);
      const argsJson = vm.getString(argsJsonH);
      try {
        const result = this._callInternal(name, JSON.parse(argsJson));
        return vm.newString(JSON.stringify(result === undefined ? null : result));
      } catch (err) {
        // Devolver { error: handle } le dice al VM que LANCE esa excepcion dentro del sandbox.
        const msg = String(err && err.message ? err.message : err);
        const errH = typeof vm.newError === "function" ? vm.newError(msg) : vm.newString(msg);
        return { error: errH };
      }
    });
    vm.setProp(vm.global, "__callInternalRaw", bridge);
    bridge.dispose();

    const pre = vm.evalCode(SANDBOX_PRELUDE);
    if (pre.error) {
      const msg = vm.dump(pre.error);
      pre.error.dispose();
      throw new Error("fallo el prelude del sandbox: " + JSON.stringify(msg));
    }
    pre.value.dispose();
  }

  // Carga el texto de un tool.js (por ejemplo traido desde R2/KV) y lo ejecuta
  // dentro del sandbox. La tool se auto-registra via registerTool(...).
  loadToolSource(sourceText) {
    const vm = this._vm;
    const res = vm.evalCode(sourceText);
    if (res.error) {
      const msg = vm.dump(res.error);
      res.error.dispose();
      throw new Error("fallo al cargar tool.js: " + JSON.stringify(msg));
    }
    res.value.dispose();
  }

  // MCP: tools/list
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

  // MCP: tools/call
  callTool(name, args) {
    const vm = this._vm;
    const fn = vm.getProp(vm.global, "__dispatch");
    const nameH = vm.newString(name);
    const argsH = vm.newString(JSON.stringify(args ?? {}));
    const res = vm.callFunction(fn, vm.undefined, nameH, argsH);
    fn.dispose();
    nameH.dispose();
    argsH.dispose();
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
    const json = vm.getString(res.value);
    res.value.dispose();
    return JSON.parse(json);
  }

  dispose() {
    if (this._vm) this._vm.dispose();
  }
}
