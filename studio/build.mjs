// build.mjs — Empaqueta la plataforma llmstxt-studio -> worker.mjs (autogenerado).
// Igual que demo-site/build.mjs: los tool_sha256/sha256 se calculan del contenido
// real y el llms.txt/worker quedan sin posibilidad de drift.
// El backend (/preview*) viene de ../worker-ephemeral.mjs (handlers exportados).

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const contentDir = join(__dirname, "content");
const read = (f) => readFileSync(join(contentDir, f), "utf8");

const SKILLS = ["create_preview", "preview_status", "discard_preview", "claim_preview"];

const CLAIM = { price: 19, days: 30 };

const skills = {};
for (const name of SKILLS) {
  const tool = read(`${name}.tool.js`);
  const skillMd = read(`${name}.SKILL.md`);
  skills[name] = {
    tool,
    skillMd,
    hash: createHash("sha256").update(Buffer.from(tool, "utf8")).digest("hex"),
    skillHash: createHash("sha256").update(Buffer.from(skillMd, "utf8")).digest("hex"),
  };
}

// --- llms.txt (formato v0.4: sha256 de receta + tool + tool_sha256) ----------
const llmsTxt =
  `# llmstxt-studio\n\n` +
  `> Forge web apps with your agent: deploy to a throwaway Cloudflare account (60-minute TTL), claim it to keep it, or let it die. No signup, no credentials — the agent builds, this platform provisions.\n\n` +
  `## Skills\n\n` +
  SKILLS.map((name) => {
    const titles = {
      create_preview: "Deploy a small web app to a throwaway Cloudflare account (60-min TTL). Returns previewUrl + claimUrl for the human.",
      preview_status: "Check a preview session: remaining lifetime, previewUrl, claimUrl, claim deadline and claimed state.",
      discard_preview: "Delete a deploy preview now instead of waiting for the TTL.",
      claim_preview: `Keep a deploy beyond its TTL: starts the claim ($${CLAIM.price} for ${CLAIM.days} days, paylink for the HUMAN). After payment the deploy survives ${CLAIM.days} days. Free to call.`,
    };
    return `- [${name}](/skills/${name}/SKILL.md): ${titles[name]} <!-- skill: {"version":"1.0.0","sha256":"${skills[name].skillHash}","tool":"/skills/${name}/tool.js","tool_sha256":"${skills[name].hash}"} -->\n`;
  }).join("");

// --- landing -----------------------------------------------------------------
const docLinks = SKILLS.map(
  (name) => `      <li><code>${name}</code> — <a href="/skills/${name}/SKILL.md">SKILL.md</a> · <a href="/skills/${name}/tool.js">tool.js</a></li>`
).join("\n");
const landing =
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n` +
  `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
  `<title>llmstxt-studio — forge apps with your agent</title>\n` +
  `<style>body{font-family:system-ui,sans-serif;max-width:52rem;margin:2rem auto;padding:0 1rem;line-height:1.55;color:#14181f;background:#fafbfc}code{background:#eef1f4;padding:.1rem .35rem;border-radius:4px;font-size:.92em}a{color:#0b62a4}h1{border-bottom:2px solid #e4e8ec;padding-bottom:.4rem}.step{display:flex;gap:.7rem;margin:.6rem 0}.n{background:#0b62a4;color:#fff;border-radius:50%;width:1.6rem;height:1.6rem;display:flex;align-items:center;justify-content:center;flex:none;font-weight:700}pre{background:#14181f;color:#d7e2ec;padding:.8rem 1rem;border-radius:8px;overflow-x:auto}footer{margin-top:2.5rem;color:#66707b;font-size:.9rem;border-top:1px solid #e4e8ec;padding-top:1rem}</style>\n` +
  `</head>\n<body>\n` +
  `<h1>llmstxt-studio</h1>\n` +
  `<p>Build a web app <em>with your agent</em>, deploy it to a <strong>throwaway Cloudflare account</strong> in seconds, then claim it to keep it — or let it die in 60 minutes. No signup. No credentials. The agent never touches a real account.</p>\n` +
  `<div class="step"><div class="n">1</div><div>Point your MCP client at this origin (or run <code>npx -y @rckflr/mcpwasm https://llmstxt-studio.rckflr.workers.dev</code> locally) and discover the skills below.</div></div>\n` +
  `<div class="step"><div class="n">2</div><div>Tell your agent what to build. It writes the code and calls <code>create_preview</code>.</div></div>\n` +
  `<div class="step"><div class="n">3</div><div>You get a <strong>live public URL</strong> immediately and a <strong>claim link</strong>: open it within 60 minutes to move the app to your own Cloudflare account — or do nothing and it self-destructs.</div></div>\n` +
  `<p><a class="cta" href="/console">Open the browser console →</a> — the "Modelar of web apps": your agent builds, the console provisions, all in the browser.</p>\n` +
  `<h2>Keep it (claim)</h2>\n<p>Loved what your agent built? <code>claim_preview</code> starts the claim: you pay the paylink (<strong>$${CLAIM.price} — keep it ${CLAIM.days} days, simulated for now</strong>) and the deploy is marked as yours with an extended TTL. The native Cloudflare account claim (export to your own account) stays free via the preview's <code>claimUrl</code>.</p>\n` +
  `<h2>Skills</h2>\n<ul>\n${docLinks}\n  </ul>\n` +
  `<h2>Consume over MCP</h2>\n<pre>POST https://llmstxt-gateway.rckflr.workers.dev/mcp?origin=${encodeURIComponent("https://llmstxt-studio.rckflr.workers.dev")}</pre>\n` +
  `<footer>Powered by <a href="https://github.com/MauricioPerera/mcpwasm">mcpwasm</a> — static MCP with a sandboxed runtime. Generated by studio/build.mjs; do not edit the worker by hand.</footer>\n</body>\n</html>`;

// --- consola del navegador (el "Modelar de las apps web") --------------------
// La consola importa los modulos de provisioning web (web/*.mjs) como ES
// modules servidos desde el mismo origin: /console/<name>.mjs.
const CONSOLE_MODULES = [
  "solve-pow-web.mjs",
  "ephemeral-account-web.mjs",
  "deploy-app-web.mjs",
  "deploy-preview-web.mjs",
  "console-tools.mjs",
];
const consoleModuleSources = {};
for (const name of CONSOLE_MODULES) {
  const src = readFileSync(join(__dirname, "..", "web", name), "utf8");
  consoleModuleSources[name] = src;
}
const consoleMain = read("console-main.mjs");
const consoleHtml = read("console.html");

// --- worker autogenerado ------------------------------------------------------
const toolConstants = SKILLS.map(
  (name) => `const ${name.toUpperCase()}_TOOL_JS = ${JSON.stringify(skills[name].tool)};\n` +
    `const ${name.toUpperCase()}_SKILL_MD = ${JSON.stringify(skills[name].skillMd)};`
).join("\n");

const skillRoutes = SKILLS.map(
  (name) =>
    `    if (path === "/skills/${name}/tool.js") { return new Response(${name.toUpperCase()}_TOOL_JS, { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" } }); }\n` +
    `    if (path === "/skills/${name}/SKILL.md") { return new Response(${name.toUpperCase()}_SKILL_MD, { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" } }); }`
).join("\n");

const moduleConstants = CONSOLE_MODULES.map(
  (name) => `const CONSOLE_MODULE_${name.replace(/[^a-z]/g, "_").toUpperCase()} = ${JSON.stringify(consoleModuleSources[name])};`
).join("\n") + `\nconst CONSOLE_MAIN = ${JSON.stringify(consoleMain)};\nconst CONSOLE_HTML = ${JSON.stringify(consoleHtml)};`;

const consoleRoutes = CONSOLE_MODULES.map((name) => {
  const cid = `CONSOLE_MODULE_${name.replace(/[^a-z0-9]/gi, "_").toUpperCase()}`;
  return `    if (path === "/console/${name}") { return new Response(${cid}, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" } }); }`;
}).join("\n") +
`\n    if (path === "/console/console-main.mjs") { return new Response(CONSOLE_MAIN, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" } }); }\n` +
`    if (path === "/console" || path === "/console/index.html") {\n` +
`      return new Response(CONSOLE_HTML, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });\n` +
`    }`;

const worker =
  `// AUTOGENERADO por studio/build.mjs. No editar a mano.\n` +
  `import { ephemeral } from "../worker-ephemeral.mjs";\n\n` +
  `${toolConstants}\n\n` +
  `${moduleConstants}\n\n` +
  `const LLMS_TXT = ${JSON.stringify(llmsTxt)};\n` +
  `const LANDING_HTML = ${JSON.stringify(landing)};\n\n` +
  `const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };\n` +
  `const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });\n\n` +
  `export default {\n` +
  `  async fetch(request, env, ctx) {\n` +
  `    const url = new URL(request.url);\n` +
  `    const path = url.pathname;\n\n` +
  `    if (path === "/" || path === "/index.html") {\n` +
  `      return new Response(LANDING_HTML, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });\n` +
  `    }\n` +
  `    if (path === "/llms.txt") {\n` +
  `      return new Response(LLMS_TXT, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });\n` +
  `    }\n\n` +
  `// consola del studio: la pagina donde el agente del usuario crea y despliega\n` +
  `${consoleRoutes}\n\n` +
  `// backend de previews (misma cuenta de Cloudflare, KV de sesiones):\n` +
  `    if (path === "/preview" || path.startsWith("/preview/")) {\n` +
  `      try {\n` +
  `        if (request.method === "DELETE") return await ephemeral.handleDelete(request, env);\n` +
  `        return await ephemeral.handlePreview(request, env);\n` +
  `      } catch (e) {\n` +
  `        return json({ error: "error interno: " + (e && e.message ? e.message : String(e)) }, 500);\n` +
  `      }\n` +
  `    }\n\n` +
  `// claim comercial: pagina del paylink + confirmacion del pago (simulado)\n` +
  `    const claimPageMatch = path.match(/^\\/claim\\/([0-9a-fA-F-]+)$/);\n` +
  `    if (claimPageMatch && request.method === "GET") {\n` +
  `      return await ephemeral.handleClaimPage(request, env, claimPageMatch[1], url.searchParams.get("pt") || "");\n` +
  `    }\n` +
  `    const claimApiMatch = path.match(/^\\/api\\/claim\\/([0-9a-fA-F-]+)$/);\n` +
  `    if (claimApiMatch && request.method === "POST") {\n` +
  `      return await ephemeral.handleClaimConfirm(request, env, claimApiMatch[1]);\n` +
  `    }\n\n` +
  `${skillRoutes}\n\n` +
  `    return json({ error: "Not Found", path }, 404);\n` +
  `  }\n` +
  `};\n`;

writeFileSync(join(__dirname, "worker.mjs"), worker, "utf8");

console.log("Generated: studio/worker.mjs");
for (const name of SKILLS) console.log(`  ${name}: tool_sha256=${skills[name].hash}`);