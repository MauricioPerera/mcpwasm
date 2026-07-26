// build.mjs — genera el bundle del runtime web + copia los .wasm a docs/demo/.
// Uso: node web/build.mjs
//
// Usa la API de esbuild del devDependency PINNEADO (^0.25.0), no `npx -y esbuild`.
// Con npx cada corrida se bajaba la ultima version publicada, asi que el bundle
// dependia del dia en que se ejecutara: dos personas obtenian bytes distintos del
// mismo fuente. Eso hacia imposible comprobar si el artefacto commiteado esta al
// dia (que es lo que ahora hace `npm run check:bundle` en CI), y de paso metia
// una descarga de red en cada build. Mismo patron que build-gateway.mjs.
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = join(ROOT, "docs", "demo");
mkdirSync(OUT, { recursive: true });

await build({
  entryPoints: [join(HERE, "entry-demo.mjs")],
  outfile: join(OUT, "mcpwasm-web.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  logLevel: "info",
});

copyFileSync(
  join(ROOT, "node_modules", "@jitl", "quickjs-wasmfile-release-asyncify", "dist", "emscripten-module.wasm"),
  join(OUT, "emscripten-module.wasm"),
);
copyFileSync(
  join(ROOT, "node_modules", "@rckflr", "minimemory", "minimemory_bg.wasm"),
  join(OUT, "minimemory_bg.wasm"),
);
console.log("web build -> docs/demo/{mcpwasm-web.js, emscripten-module.wasm, minimemory_bg.wasm}");
