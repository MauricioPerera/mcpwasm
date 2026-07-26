// check-publishers-fresh.mjs — ¿demo-site/worker.mjs y bookstore/worker.mjs
// corresponden a su fuente?
//
// Son los dos artefactos generados que quedaban sin cubrir despues de #47 (bundle
// web) y #48 (docs-site). Aqui es mas simple que en docs-site: estos builds solo
// leen content/ del repo, no bajan nada, asi que no hace falta ningun --no-fetch
// para que el resultado sea reproducible.
//
// El fallo que evita es el mismo de #45: alguien edita un tool.js o un SKILL.md y
// el worker versionado —que es lo que se despliega— sigue sirviendo lo anterior.
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TARGETS = [
  { site: "demo-site", files: ["demo-site/worker.mjs"] },
  { site: "bookstore", files: ["bookstore/worker.mjs"] },
];
const hash = (p) => (existsSync(join(ROOT, p)) ? createHash("sha256").update(readFileSync(join(ROOT, p))).digest("hex") : null);

let stale = [];
for (const { site, files } of TARGETS) {
  const before = Object.fromEntries(files.map((f) => [f, hash(f)]));
  execFileSync(process.execPath, [join(ROOT, site, "build.mjs")], { cwd: ROOT, stdio: "pipe" });
  for (const f of files) {
    const after = hash(f);
    const ok = before[f] === after;
    if (!ok) stale.push(f);
    console.log((ok ? "OK    " : "STALE ") + f +
      (ok ? "" : `  (commiteado ${String(before[f]).slice(0, 12)}… vs recien construido ${String(after).slice(0, 12)}…)`));
  }
}
if (stale.length) {
  console.error(
    "\nEstos artefactos NO corresponden a su fuente. Ya quedaron regenerados en el\n" +
    "working tree. Si cambio algun tool_sha256, hay que re-firmar la atestacion\n" +
    "antes de desplegar o el gateway excluira esa skill en enforcing (ver #43).\n" +
    "  git add " + stale.join(" ")
  );
  process.exit(1);
}
console.log("\nlos artefactos de demo-site y bookstore corresponden a su fuente");
