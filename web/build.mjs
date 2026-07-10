// build.mjs — genera el bundle del runtime web + copia los .wasm a docs/demo/.
// Uso: node web/build.mjs   (esbuild via npx, sin dependencia permanente)
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = join(ROOT, "docs", "demo");
mkdirSync(OUT, { recursive: true });

const isWin = process.platform === "win32";
execFileSync(isWin ? "npx.cmd" : "npx", [
  "-y", "esbuild", join(HERE, "entry-demo.mjs"),
  "--bundle", "--format=esm", "--platform=browser",
  `--outfile=${join(OUT, "mcpwasm-web.js")}`,
], { stdio: "inherit", shell: isWin, cwd: ROOT });

copyFileSync(
  join(ROOT, "node_modules", "@jitl", "quickjs-wasmfile-release-asyncify", "dist", "emscripten-module.wasm"),
  join(OUT, "emscripten-module.wasm"),
);
copyFileSync(
  join(ROOT, "node_modules", "@rckflr", "minimemory", "minimemory_bg.wasm"),
  join(OUT, "minimemory_bg.wasm"),
);
console.log("web build -> docs/demo/{mcpwasm-web.js, emscripten-module.wasm, minimemory_bg.wasm}");
