// build-memspike.mjs
// Empaqueta worker-memspike.mjs -> dist-memspike/worker.js con esbuild. Patron
// de build-spike.mjs (conditions workerd, external *.wasm) + extras TAREA20:
//  - external ["*.wasm", "*.snapshot"]: el import del .wasm (QuickJS asyncify y
//    minimemory) queda como import ESM plano y Miniflare lo resuelve via
//    CompiledWasm -> WebAssembly.Module; el import del snapshot (texto) queda
//    plano y Miniflare lo resuelve via regla Text -> string.
//  - define EXPECTED_SNAPSHOT_SHA_DEFAULT: constante horneada con el sha256 real
//    del snapshot (leido de mem-snapshot-sha.json). El worker la usa como valor
//    por defecto de integridad; env.EXPECTED_SNAPSHOT_SHA override (test negativo).
//  - Copia AMBOS wasm (quickjs-asyncify + minimemory_bg) y el snapshot a
//    dist-memspike/ junto al bundle para que Miniflare resuelva los imports.

import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(root, "dist-memspike");

const quickjsWasmSrc = path.join(
  root,
  "node_modules",
  "@jitl",
  "quickjs-wasmfile-release-asyncify",
  "dist",
  "emscripten-module.wasm"
);
const memWasmSrc = path.join(root, "node_modules", "@rckflr", "minimemory", "minimemory_bg.wasm");
const snapshotSrc = path.join(root, "mem-docs.snapshot");
const shaJson = JSON.parse(readFileSync(path.join(root, "mem-snapshot-sha.json"), "utf8"));
const expectedSha = shaJson.sha256;

await mkdir(distDir, { recursive: true });

// 1) Build con esbuild.
await build({
  entryPoints: [path.join(root, "worker-memspike.mjs")],
  outfile: path.join(distDir, "worker.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  conditions: ["workerd"],
  external: ["*.wasm", "*.snapshot"],
  define: {
    EXPECTED_SNAPSHOT_SHA_DEFAULT: JSON.stringify(expectedSha),
  },
  sourcemap: false,
  logLevel: "info",
});

// 2) Copiar ambos wasm + snapshot junto al bundle. El import del wasm minimemory
//    queda como ./minimemory_bg.wasm (external preserva el specifier; TAREA24:
//    wrapper JS bundleado desde el paquete npm) => lo copiamos a
//    dist-memspike/minimemory_bg.wasm para que Miniflare lo resuelva. QuickJS
//    wasm y snapshot van a la raiz del dist.
await copyFile(quickjsWasmSrc, path.join(distDir, "quickjs-asyncify.wasm"));
await copyFile(memWasmSrc, path.join(distDir, "minimemory_bg.wasm"));
await copyFile(snapshotSrc, path.join(distDir, "mem-docs.snapshot"));

console.log("build-memspike OK -> dist-memspike/worker.js + 2 wasm + mem-docs.snapshot");
console.log("  EXPECTED_SNAPSHOT_SHA_DEFAULT =", expectedSha);