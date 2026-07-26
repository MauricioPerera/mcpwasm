// check-docs-site-fresh.mjs — ¿docs-site/worker.mjs corresponde a su fuente?
//
// worker.mjs es un artefacto generado y versionado: embebe los tool.js, los
// SKILL.md, el llms.txt con sus hashes y el snapshot. Se regenera a mano, asi que
// puede quedarse atras de content/ sin que nada se ponga rojo — que es justo lo
// que paso en #45: get_doc.tool.js cambio en #39 y el artefacto siguio sirviendo
// el anterior durante tres PRs.
//
// Corre el build con --no-fetch: sin red, reusando los docs ya vendorizados, asi
// el resultado depende SOLO del repo. Con fetch, este check se pondria rojo cada
// vez que alguien editara la spec upstream, que no es deriva del artefacto.
// Contrapartida honesta: no detecta que los docs vendorizados esten viejos
// respecto de upstream. Eso es re-vendorizar, una decision, no una regresion.
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["docs-site/worker.mjs", "docs-site/skills-index.snapshot", "docs-site/doc-sources.json"];
const hash = (p) => (existsSync(join(ROOT, p)) ? createHash("sha256").update(readFileSync(join(ROOT, p))).digest("hex") : null);

const before = Object.fromEntries(FILES.map((f) => [f, hash(f)]));
execFileSync(process.execPath, [join(ROOT, "docs-site", "build.mjs"), "--no-fetch"], { cwd: ROOT, stdio: "pipe" });
const after = Object.fromEntries(FILES.map((f) => [f, hash(f)]));

const stale = FILES.filter((f) => before[f] !== after[f]);
for (const f of FILES) {
  console.log((before[f] === after[f] ? "OK    " : "STALE ") + f +
    (before[f] === after[f] ? "" : `  (commiteado ${String(before[f]).slice(0, 12)}… vs recien construido ${String(after[f]).slice(0, 12)}…)`));
}
if (stale.length) {
  console.error(
    "\nEl artefacto del docs-site NO corresponde a su fuente.\n" +
    "Ya quedo regenerado en el working tree. Ojo: si cambio algun tool_sha256,\n" +
    "hay que re-firmar la atestacion antes de desplegar o el gateway excluira esa\n" +
    "skill en modo enforcing (ver #43).\n" +
    "  git add " + stale.join(" ")
  );
  process.exit(1);
}
console.log("\nel artefacto del docs-site corresponde a su fuente");
