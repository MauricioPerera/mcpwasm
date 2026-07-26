// check-bundle-fresh.mjs — ¿el artefacto commiteado corresponde a la fuente actual?
//
// docs/demo/ se sirve por GitHub Pages directo desde el repo, asi que el bundle
// versionado ES lo que ejecuta la gente. Al regenerarse a mano, se quedo cinco
// arreglos atras sin que nada se pusiera rojo (#34): test:web ejercita el modulo
// FUENTE y test:bundle el artefacto, pero ninguno detecta que el artefacto sea
// viejo mientras siga funcionando para lo que esos tests miran.
//
// Esto lo reconstruye y compara byte a byte. Es posible porque web/build.mjs usa
// el esbuild PINNEADO del devDependency: con `npx -y esbuild` la salida dependia
// de la version publicada ese dia y no habia nada estable contra que comparar.
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["docs/demo/mcpwasm-web.js", "docs/demo/emscripten-module.wasm", "docs/demo/minimemory_bg.wasm"];
const hash = (p) => (existsSync(join(ROOT, p)) ? createHash("sha256").update(readFileSync(join(ROOT, p))).digest("hex") : null);

const before = Object.fromEntries(FILES.map((f) => [f, hash(f)]));
execFileSync(process.execPath, [join(ROOT, "web", "build.mjs")], { cwd: ROOT, stdio: "pipe" });
const after = Object.fromEntries(FILES.map((f) => [f, hash(f)]));

const stale = FILES.filter((f) => before[f] !== after[f]);
for (const f of FILES) {
  console.log((before[f] === after[f] ? "OK    " : "STALE ") + f +
    (before[f] === after[f] ? "" : `  (commiteado ${String(before[f]).slice(0, 12)}… vs recien construido ${String(after[f]).slice(0, 12)}…)`));
}
if (stale.length) {
  console.error(
    "\nEl artefacto commiteado NO corresponde a la fuente actual.\n" +
    "Los archivos de arriba ya quedaron regenerados en el working tree: revisalos y commitealos.\n" +
    "  git add " + stale.join(" ")
  );
  process.exit(1);
}
console.log("\nel bundle publicado corresponde a la fuente");
