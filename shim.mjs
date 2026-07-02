// shim.mjs
// El loader de Emscripten de QuickJS intenta leer location.href / self.location
// para resolver rutas. workerd no expone eso, y falla al iniciar el wasm.
// Este shim se importa PRIMERO (los imports ESM corren en orden), asi el objeto
// existe antes de que el variant intente leerlo.
if (typeof globalThis.self === "undefined") {
  globalThis.self = globalThis;
}
if (typeof globalThis.location === "undefined") {
  globalThis.location = { href: "https://toolhost-mcp.workers.dev/" };
}
