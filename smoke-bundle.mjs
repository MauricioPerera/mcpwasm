// smoke del BUNDLE ya construido (docs/demo/mcpwasm-web.js), no del modulo fuente:
// es el artefacto que sirve GitHub Pages, y hasta ahora nada lo ejercitaba.
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { connectStaticSkills } from "./docs/demo/mcpwasm-web.js";

const _require = createRequire(import.meta.url);
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
let bad = 0;
const check = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) bad++; };

// tool.js con CRLF y hash de los bytes EXACTOS: el bundle viejo lo rechazaba.
const CRLF_TOOL = ['registerTool({', '  name: "crlf",', '  description: "d",',
  '  inputSchema: { type: "object" },', '  handler() { return "crlf-ok"; }', '});'].join("\r\n");
const LF_TOOL = 'registerTool({ name: "lf", description: "d", inputSchema: { type: "object" }, handler() { return "lf-ok"; } });';
const LLMS = "# fake\n\n## Skills\n\n" +
  `- [crlf](/c.md): C. <!-- skill: ${JSON.stringify({ version: "1.0.0", tool: "/c.js", tool_sha256: sha(CRLF_TOOL) })} -->\n` +
  `- [lf](/l.md): L. <!-- skill: ${JSON.stringify({ version: "1.0.0", tool: "/l.js", tool_sha256: sha(LF_TOOL) })} -->\n`;

const server = createServer((req, res) => {
  const routes = { "/llms.txt": [LLMS, "text/plain"], "/c.js": [CRLF_TOOL, "application/javascript"], "/l.js": [LF_TOOL, "application/javascript"] };
  const hit = routes[new URL(req.url, "http://x").pathname];
  if (!hit) { res.writeHead(404); res.end("nf"); return; }
  res.writeHead(200, { "content-type": hit[1] });
  res.end(hit[0]);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const pkgJson = _require.resolve("@jitl/quickjs-wasmfile-release-asyncify/package.json");
const quickjsWasm = readFileSync(new URL("dist/emscripten-module.wasm", `file://${pkgJson.replace(/\\/g, "/")}`));
try {
  const skills = await connectStaticSkills(ORIGIN, { quickjsWasm });
  const names = skills.tools.map((t) => t.name);
  check(names.includes("lf"), "bundle: skill LF verifica (no regresion)");
  check(names.includes("crlf"), "bundle: skill CRLF con hash de bytes exactos verifica (#20 en el artefacto)");
  check((await skills.callTool("crlf", {})) === "crlf-ok", "bundle: la skill CRLF ejecuta en el sandbox del navegador");
  skills.dispose();
} catch (e) {
  console.log("FAIL bundle: " + e.message); bad++;
} finally { server.close(); }
console.log(bad === 0 ? "\nBUNDLE OK" : `\n${bad} ROJO(S)`);
process.exit(bad ? 1 : 0);
