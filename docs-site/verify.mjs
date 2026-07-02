// Verificacion post-deploy (7b): descarga /llms.txt de PRODUCCION, extrae los
// tool_sha256 declarados y la linea skills-memory (snapshot_sha256), descarga
// cada tool.js y el snapshot, recalcula sha256 y compara con lo declarado.
import { createHash } from "node:crypto";

const base = process.argv[2];
if (!base) {
  console.error("uso: node verify.mjs <https://url-de-produccion>");
  process.exit(1);
}

const txtRes = await fetch(base + "/llms.txt");
const llmsTxt = await txtRes.text();
console.log("=== /llms.txt ===");
console.log(llmsTxt);

// skills-memory line (snapshot)
const memMatch = llmsTxt.match(/<!-- skills-memory: (\{.*?\}) -->/);
let snapshotDeclared = null;
if (memMatch) {
  const mem = JSON.parse(memMatch[1]);
  snapshotDeclared = mem.snapshot_sha256;
  console.log("\n=== skills-memory ===");
  console.log("snapshot:", mem.snapshot, "format:", mem.format);
  console.log("declared snapshot_sha256:", snapshotDeclared);
} else {
  console.error("\nNO se encontro la linea skills-memory en /llms.txt");
  process.exit(1);
}

// skill lines
const re = /<!-- skill: (\{.*?\}) -->/g;
let m;
const skills = [];
while ((m = re.exec(llmsTxt)) !== null) skills.push(JSON.parse(m[1]));

let allOk = true;

for (const s of skills) {
  const toolRes = await fetch(base + s.tool);
  const toolText = await toolRes.text();
  const actual = createHash("sha256").update(toolText, "utf8").digest("hex");
  const ok = actual === s.tool_sha256;
  if (!ok) allOk = false;
  console.log(`\n=== ${s.tool} ===`);
  console.log("declared tool_sha256:", s.tool_sha256);
  console.log("actual   tool_sha256:", actual);
  console.log("match:", ok ? "OK" : "MISMATCH");
}

// snapshot
const snapRes = await fetch(base + "/skills-index.snapshot");
const snapText = await snapRes.text();
const snapActual = createHash("sha256").update(snapText, "utf8").digest("hex");
const snapOk = snapActual === snapshotDeclared;
if (!snapOk) allOk = false;
console.log("\n=== /skills-index.snapshot ===");
console.log("declared snapshot_sha256:", snapshotDeclared);
console.log("actual   snapshot_sha256:", snapActual);
console.log("match:", snapOk ? "OK" : "MISMATCH");
console.log("snapshot bytes:", snapText.length);

console.log("\nOVERALL:", allOk ? "OK" : "UNEXPECTED");
process.exit(allOk ? 0 : 1);