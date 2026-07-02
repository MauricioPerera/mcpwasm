// build.mjs
// Empaqueta worker.mjs -> dist/worker.js con esbuild para que Miniflare lo cargue.
// - format=esm, platform=browser (entorno Workers).
// - conditions=["workerd"] para que esbuild seleccione la variante cloudflare del
//   paquete @jitl (export "./emscripten-module" condition "workerd" ->
//   emscripten-module.cloudflare.cjs), que usa instantiateWasm con el modulo
//   pre-compilado en vez de fetch+compile de bytes (prohibido en Workers).
// - external ["*.wasm"]: el import "./quickjs.wasm" queda como import ESM plano
//   y Miniflare lo resuelve con la regla CompiledWasm -> WebAssembly.Module.
// - Copia quickjs.wasm a dist/ para que el import relativo resuelva.

import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(root, "dist");
const wasmSrc = path.join(
  root,
  "node_modules",
  "@jitl",
  "quickjs-wasmfile-release-sync",
  "dist",
  "emscripten-module.wasm"
);
const rootWasm = path.join(root, "quickjs.wasm");
const distWasm = path.join(distDir, "quickjs.wasm");

await mkdir(distDir, { recursive: true });

// 1) Aseguramos quickjs.wasm en la raiz (lo que worker.mjs importa en desarrollo).
await copyFile(wasmSrc, rootWasm);

// 2) Build con esbuild.
await build({
  entryPoints: [path.join(root, "worker.mjs")],
  outfile: path.join(distDir, "worker.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  conditions: ["workerd"],
  external: ["*.wasm"],
  sourcemap: false,
  logLevel: "info",
});

// 3) Copiamos el .wasm junto al bundle para que Miniflare resuelva el import.
await copyFile(rootWasm, distWasm);

console.log("build OK -> dist/worker.js + dist/quickjs.wasm");