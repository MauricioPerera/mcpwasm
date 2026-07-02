// build-gateway.mjs
// Empaqueta worker-gateway.mjs -> dist-gateway/worker.js con esbuild.
// Igual que build-spike.mjs pero apuntando al entry del gateway.
//  - conditions=["workerd"]: selecciona emscripten-module.cloudflare.cjs del
//    paquete asyncify (instantiateWasm con el modulo pre-compilado).
//  - external ["*.wasm"]: el import "./quickjs-asyncify.wasm" queda como import
//    ESM plano y Miniflare/wrangler lo resuelven con la regla CompiledWasm.
//  - Copia el wasm asyncify a la raiz (para dev) y a dist-gateway/ (para Miniflare).

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

await mkdir(distDir, { recursive: true });

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

// 3) Copia el .wasm junto al bundle para que Miniflare resuelva el import.
await copyFile(rootWasm, distWasm);

console.log("build-gateway OK -> dist-gateway/worker.js + dist-gateway/quickjs-asyncify.wasm");