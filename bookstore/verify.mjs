// Verificacion post-deploy: descarga /llms.txt de PRODUCCION, extrae los
// tool_sha256 declarados, descarga cada tool.js, calcula sha256 y compara.
// Las 4 skills con hash correcto deben dar OK; corrupt_skill debe dar MISMATCH
// (esperado, es el fixture de exclusion del gateway).
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
  // corrupt_skill se espera MISMATCH (fixture intencional)
  const expected = name === "corrupt_skill" ? "MISMATCH (expected fixture)" : "OK";
  const realOk = name === "corrupt_skill" ? !ok : ok;
  if (!realOk) allOk = false;
  console.log(`\n=== ${s.tool} ===`);
  console.log("declared tool_sha256:", s.tool_sha256);
  console.log("actual   tool_sha256:", actual);
  console.log("match:", ok ? "OK" : "MISMATCH", "->", expected);
}

console.log("\nOVERALL:", allOk ? "OK (4 legit OK, corrupt_skill MISMATCH)" : "UNEXPECTED");
process.exit(allOk ? 0 : 1);