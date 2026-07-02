// Verificacion LOCAL del snapshot de PRODUCCION (7c): descarga
// /skills-index.snapshot de produccion, lo importa en WasmOkfIndex (vendor) y
// hace 2 busquedas:
//   "tool_sha256 integrity verification" -> hits relevantes (top hit)
//   "receta de paella"                   -> 0 hits o scores claramente peores
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initSync, WasmOkfIndex } from "../vendor-minimemory/minimemory.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const base = process.argv[2];
if (!base) {
  console.error("uso: node verify-snapshot.mjs <https://url-de-produccion>");
  process.exit(1);
}

initSync({ module: readFileSync(join(__dirname, "..", "vendor-minimemory", "minimemory_bg.wasm")) });

const res = await fetch(base + "/skills-index.snapshot");
const snapText = await res.text();
console.log("downloaded /skills-index.snapshot:", snapText.length, "bytes");

const idx = new WasmOkfIndex();
const count = idx.import_snapshot(snapText);
console.log("imported concepts/chunks:", count);

const q1 = "tool_sha256 integrity verification";
const h1 = JSON.parse(idx.search(q1, 5, null));
console.log(`\nquery "${q1}" -> ${h1.length} hits`);
h1.slice(0, 3).forEach((h, i) =>
  console.log(`  [${i}] score=${h.score} title="${h.title}"\n      text="${(h.snippet || "").slice(0, 160)}"`)
);
if (h1.length === 0) {
  console.error("FAIL: se esperaban hits relevantes para la query tecnica");
  process.exit(1);
}
console.log("TOP HIT:", JSON.stringify({
  text: (h1[0].snippet || "").slice(0, 200),
  score: h1[0].score,
  title: h1[0].title,
  concept_id: h1[0].concept_id,
}));

const q2 = "receta de paella";
const h2 = JSON.parse(idx.search(q2, 5, null));
console.log(`\nquery "${q2}" -> ${h2.length} hits`);
h2.forEach((h) => console.log(`  score=${h.score} title="${h.title}"`));

const top1 = Math.abs(h1[0].score);
const worst2 = h2.length ? Math.abs(h2[0].score) : 0;
const ok2 = h2.length === 0 || top1 > worst2 * 2;
console.log(`\nrelevantes |score|=${top1.toFixed(2)} vs paella |score|=${worst2.toFixed(2)} -> ${ok2 ? "OK (paella 0 hits o claramente peor)" : "INCONCLUSO"}`);

console.log("\nOVERALL: OK");
process.exit(ok2 ? 0 : 1);