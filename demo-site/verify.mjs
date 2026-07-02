// Verificacion post-deploy: descarga /llms.txt de PRODUCCION, extrae los sha256
// declarados, descarga cada tool.js, calcula sha256 y compara. Imprime OK/FAIL.
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

const re = /<!-- skill: (\{.*?\}) -->/g;
let m;
const skills = [];
while ((m = re.exec(llmsTxt)) !== null) {
  skills.push(JSON.parse(m[1]));
}

let allOk = true;
for (const s of skills) {
  const name = s.tool.split("/")[2];
  const toolRes = await fetch(base + s.tool);
  const toolText = await toolRes.text();
  const actual = createHash("sha256").update(toolText, "utf8").digest("hex");
  const ok = actual === s.tool_sha256;
  if (!ok) allOk = false;
  console.log(`\n=== ${s.tool} ===`);
  console.log("declared sha256:", s.tool_sha256);
  console.log("actual   sha256:", actual);
  console.log("match:", ok ? "OK" : "FAIL");
}

console.log("\nOVERALL:", allOk ? "OK" : "FAIL");
process.exit(allOk ? 0 : 1);