// Build: lee content/*.tool.js + *.SKILL.md, calcula sha256 sobre los bytes UTF-8
// exactos, y genera worker.mjs (con el contenido incrustado via JSON.stringify,
// byte-exacto) y wrangler.toml. Los sha256 declarados en /llms.txt coinciden con
// el contenido servido porque el worker sirve el MISMO string sobre el que se
// hasheo.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const contentDir = join(__dirname, "content");

const read = (name) => readFileSync(join(contentDir, name), "utf8");
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

const sumTool = read("sum_numbers.tool.js");
const serverTool = read("server_time.tool.js");
const sumSkill = read("sum_numbers.SKILL.md");
const serverSkill = read("server_time.SKILL.md");

const sumHash = sha256(sumTool);
const serverHash = sha256(serverTool);

// Attestaciones (ext-skill-attestations v0.2). Array JSON publicado en
// /.well-known/agent-skills/attestations.json. Firmado fuera de linea con
// scripts/attest.mjs (clave privada en .attester-key.json, gitignored). Si no
// existe el archivo -> array vacio (0 atestaciones; skills listadas pero
// unattested).
const attestationsRaw = existsSync(join(contentDir, "attestations.json"))
  ? readFileSync(join(contentDir, "attestations.json"), "utf8")
  : "[]";
const attestations = JSON.parse(attestationsRaw);
console.log("attestations:", attestations.length, "entrada(s)");

const llmsTxt =
  `# llms-txt-skills demo site\n\n` +
  `> Demo site publishing executable skills per the llms-txt-skills standard with a provisional extension for executable skills.\n\n` +
  `## Skills\n\n` +
  `- [sum_numbers](/skills/sum_numbers/SKILL.md): Sum two numbers a and b. <!-- skill: {"version":"1.0.0","tool":"/skills/sum_numbers/tool.js","tool_sha256":"${sumHash}"} -->\n` +
  `- [server_time](/skills/server_time/SKILL.md): Return the current server time. <!-- skill: {"version":"1.0.0","tool":"/skills/server_time/tool.js","tool_sha256":"${serverHash}"} -->\n`;

const worker =
  `// AUTOGENERADO por build.mjs. No editar a mano.\n` +
  `const SUM_TOOL_JS = ${JSON.stringify(sumTool)};\n` +
  `const SERVER_TOOL_JS = ${JSON.stringify(serverTool)};\n` +
  `const SUM_SKILL_MD = ${JSON.stringify(sumSkill)};\n` +
  `const SERVER_SKILL_MD = ${JSON.stringify(serverSkill)};\n` +
  `const LLMS_TXT = ${JSON.stringify(llmsTxt)};\n` +
  `const ATTESTATIONS = ${JSON.stringify(attestations)};\n\n` +
  `export default {\n` +
  `  async fetch(request) {\n` +
  `    const url = new URL(request.url);\n` +
  `    const path = url.pathname;\n\n` +
  `    if (path === "/llms.txt") {\n` +
  `      return new Response(LLMS_TXT, { headers: { "content-type": "text/plain; charset=utf-8" } });\n` +
  `    }\n` +
  `    if (path === "/api/time") {\n` +
  `      const now = new Date();\n` +
  `      const body = JSON.stringify({ now: now.toISOString(), epoch: now.getTime() });\n` +
  `      return new Response(body, { headers: { "content-type": "application/json; charset=utf-8" } });\n` +
  `    }\n` +
  `    if (path === "/skills/sum_numbers/SKILL.md") {\n` +
  `      return new Response(SUM_SKILL_MD, { headers: { "content-type": "text/markdown; charset=utf-8" } });\n` +
  `    }\n` +
  `    if (path === "/skills/server_time/SKILL.md") {\n` +
  `      return new Response(SERVER_SKILL_MD, { headers: { "content-type": "text/markdown; charset=utf-8" } });\n` +
  `    }\n` +
  `    if (path === "/skills/sum_numbers/tool.js") {\n` +
  `      return new Response(SUM_TOOL_JS, { headers: { "content-type": "application/javascript; charset=utf-8" } });\n` +
  `    }\n` +
  `    if (path === "/skills/server_time/tool.js") {\n` +
  `      return new Response(SERVER_TOOL_JS, { headers: { "content-type": "application/javascript; charset=utf-8" } });\n` +
  `    }\n` +
  `    if (path === "/.well-known/agent-skills/attestations.json") {\n` +
  `      return new Response(JSON.stringify(ATTESTATIONS), { headers: { "content-type": "application/json; charset=utf-8" } });\n` +
  `    }\n` +
  `    return new Response("Not Found", { status: 404 });\n` +
  `  }\n` +
  `};\n`;

writeFileSync(join(__dirname, "worker.mjs"), worker, "utf8");

const wrangler =
  `name = "llmstxt-demo-site"\n` +
  `main = "worker.mjs"\n` +
  `compatibility_date = "2026-06-01"\n` +
  `account_id = "091122c40cc6f8d0d421cbc90e2caca8"\n`;
writeFileSync(join(__dirname, "wrangler.toml"), wrangler, "utf8");

console.log("sum_numbers sha256:", sumHash);
console.log("server_time sha256:", serverHash);
console.log("Generated: worker.mjs, wrangler.toml");