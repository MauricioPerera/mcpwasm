// build-gateway.mjs
// Empaqueta worker-gateway.mjs -> dist-gateway/worker.js con esbuild.
// Igual que build-spike.mjs pero apuntando al entry del gateway.
//  - conditions=["workerd"]: selecciona emscripten-module.cloudflare.cjs del
//    paquete asyncify (instantiateWasm con el modulo pre-compilado).
//  - external ["*.wasm"]: los imports "./quickjs-asyncify.wasm" y
//    "./vendor-minimemory/minimemory_bg.wasm" quedan como import ESM plano y
//    Miniflare/wrangler los resuelven con la regla CompiledWasm.
//  - Copia el wasm asyncify a la raiz (para dev) y a dist-gateway/ (para Miniflare).
//  - TAREA22: copia el wasm de minimemory a dist-gateway/vendor-minimemory/
//    (el import en worker-gateway.mjs es relativo a la raiz; tras bundlear a
//    dist-gateway/worker.js el specifier se mantiene verbatim y se resuelve
//    relativo al bundle, asi que el wasm va a dist-gateway/vendor-minimemory/).

import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(root, "dist-gateway");
const wasmSrc = path.join(
  root,
  "node_modules",
  "@jitl",
  "quickjs-wasmfile-release-asyncify",
  "dist",
  "emscripten-module.wasm"
);
const rootWasm = path.join(root, "quickjs-asyncify.wasm");
const distWasm = path.join(distDir, "quickjs-asyncify.wasm");

// TAREA22: wasm de minimemory (mismo patron de copia que quickjs-asyncify.wasm).
const memWasmSrc = path.join(root, "vendor-minimemory", "minimemory_bg.wasm");
const distMemDir = path.join(distDir, "vendor-minimemory");
const distMemWasm = path.join(distMemDir, "minimemory_bg.wasm");

await mkdir(distDir, { recursive: true });
await mkdir(distMemDir, { recursive: true });

// 1) Asegura quickjs-asyncify.wasm en la raiz (lo que worker-gateway.mjs importa en dev).
await copyFile(wasmSrc, rootWasm);

// 2) Build con esbuild (mismo shape que build-spike.mjs).
await build({
  entryPoints: [path.join(root, "worker-gateway.mjs")],
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

// 3) Copia los .wasm junto al bundle para que Miniflare resuelva los imports.
//    quickjs-asyncify.wasm -> dist-gateway/ (import "./quickjs-asyncify.wasm").
//    minimemory_bg.wasm    -> dist-gateway/vendor-minimemory/ (import relativo).
await copyFile(rootWasm, distWasm);
await copyFile(memWasmSrc, distMemWasm);

console.log("build-gateway OK -> dist-gateway/worker.js + quickjs-asyncify.wasm + vendor-minimemory/minimemory_bg.wasm");