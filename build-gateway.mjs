// build-gateway.mjs
// Empaqueta worker-gateway.mjs -> dist-gateway/worker.js con esbuild.
// Igual que build-spike.mjs pero apuntando al entry del gateway.
//  - conditions=["workerd"]: selecciona emscripten-module.cloudflare.cjs del
//    paquete asyncify (instantiateWasm con el modulo pre-compilado).
//  - external ["*.wasm"]: los imports "./quickjs-asyncify.wasm" y
//    "./minimemory_bg.wasm" quedan como import ESM plano y Miniflare/wrangler
//    los resuelven con la regla CompiledWasm.
//  - Copia el wasm asyncify a la raiz (para dev) y a dist-gateway/ (para Miniflare).
//  - TAREA22/TAREA24: copia el wasm de minimemory (desde el paquete npm
//    @rckflr/minimemory) a dist-gateway/minimemory_bg.wasm (el import en
//    worker-gateway.mjs es "./minimemory_bg.wasm"; tras bundlear a
//    dist-gateway/worker.js el specifier se mantiene verbatim y se resuelve
//    relativo al bundle, asi que el wasm va a dist-gateway/minimemory_bg.wasm).

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

// TAREA22/TAREA24: wasm de minimemory desde el paquete npm. Mismo patron de copia
// que quickjs-asyncify.wasm: a la raiz (lo que worker-gateway.mjs importa cuando
// wrangler bundlea desde la raiz para deploy) y a dist-gateway/ (para Miniflare).
const memWasmSrc = path.join(root, "node_modules", "@rckflr", "minimemory", "minimemory_bg.wasm");
const rootMemWasm = path.join(root, "minimemory_bg.wasm");
const distMemWasm = path.join(distDir, "minimemory_bg.wasm");

await mkdir(distDir, { recursive: true });

// 1) Asegura quickjs-asyncify.wasm en la raiz (lo que worker-gateway.mjs importa en dev).
await copyFile(wasmSrc, rootWasm);
//    Idem minimemory_bg.wasm en la raiz (import "./minimemory_bg.wasm" resuelto por
//    wrangler al bundlear worker-gateway.mjs para deploy).
await copyFile(memWasmSrc, rootMemWasm);

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
//    minimemory_bg.wasm    -> dist-gateway/minimemory_bg.wasm (import relativo).
await copyFile(rootWasm, distWasm);
await copyFile(memWasmSrc, distMemWasm);

console.log("build-gateway OK -> dist-gateway/worker.js + quickjs-asyncify.wasm + minimemory_bg.wasm");