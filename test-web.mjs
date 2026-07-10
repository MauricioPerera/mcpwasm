// test-web.mjs — smoke del runtime WEB (web/mcpwasm-web.mjs) corriendo en Node.
//
// El modulo es agnostico de entorno (fetch + crypto.subtle + WebAssembly, todos
// presentes en Node 20+), asi que CI puede ejercitar EXACTAMENTE el mismo codigo
// que corre en el navegador. Publisher fake hermetico en localhost (mismo patron
// que test-local.mjs) — sin red externa.

import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { connectStaticSkills } from "./web/mcpwasm-web.mjs";

const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const _require = createRequire(import.meta.url);

const SUM_TOOL = `registerTool({
  name: "sum_numbers",
  description: "Sum two numbers a and b.",
  inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] },
  handler(args) { return Number(args.a) + Number(args.b); }
});`;
const CORRUPT_TOOL = `registerTool({ name: "corrupt", description: "x", inputSchema: { type: "object" }, handler() { return 1; } });`;
const SUM_SKILL_MD = "---\nname: sum_numbers\n---\n\n# sum_numbers\n\nAlways pass BOTH a and b.\n";

// snapshot BM25 real para la memoria scoped
import { initSync as memInit, WasmOkfIndex } from "@rckflr/minimemory";
memInit({ module: readFileSync(_require.resolve("@rckflr/minimemory/minimemory_bg.wasm")) });
const idx = WasmOkfIndex.with_chunk_size(800, 50);
idx.ingest_concept("returns", "---\ntype: docs\ntitle: Returns\n---\nCustomers can return any product within thirty days for a full refund.");
const SNAPSHOT = idx.export_snapshot();

const SEARCH_TOOL = `registerTool({
  name: "search_mem",
  description: "BM25 search.",
  inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
  handler: async function (args) { return await host.memorySearch(args.q, 5); }
});`;

const LLMS = "# fake\n\n" +
  `<!-- skills-memory: ${JSON.stringify({ snapshot: "/mem.snapshot", snapshot_sha256: sha(SNAPSHOT), format: "minimemory-okf-v1", scope: "alpha" })} -->\n\n` +
  "## Skills\n\n" +
  `- [sum_numbers](/skills/sum/SKILL.md): Sum. <!-- skill: ${JSON.stringify({ version: "1.0.0", sha256: sha(SUM_SKILL_MD), tool: "/skills/sum/tool.js", tool_sha256: sha(SUM_TOOL) })} -->\n` +
  `- [search_mem](/skills/search/SKILL.md): Search. <!-- skill: ${JSON.stringify({ version: "1.0.0", tool: "/skills/search/tool.js", tool_sha256: sha(SEARCH_TOOL), scope: "alpha" })} -->\n` +
  `- [corrupt](/skills/corrupt/SKILL.md): Broken hash. <!-- skill: ${JSON.stringify({ version: "1.0.0", tool: "/skills/corrupt/tool.js", tool_sha256: "0".repeat(64) })} -->\n`;

const server = createServer((req, res) => {
  const routes = {
    "/llms.txt": [LLMS, "text/plain"],
    "/skills/sum/tool.js": [SUM_TOOL, "application/javascript"],
    "/skills/sum/SKILL.md": [SUM_SKILL_MD, "text/markdown"],
    "/skills/search/tool.js": [SEARCH_TOOL, "application/javascript"],
    "/skills/corrupt/tool.js": [CORRUPT_TOOL, "application/javascript"],
    "/mem.snapshot": [SNAPSHOT, "application/json"],
  };
  const hit = routes[new URL(req.url, "http://x").pathname];
  if (!hit) { res.writeHead(404); res.end("nf"); return; }
  res.writeHead(200, { "content-type": hit[1] });
  res.end(hit[0]);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
const check = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failures++; };

try {
  // exports del paquete no expone el .wasm: resolver relativo a su package.json
  const pkgJson = _require.resolve("@jitl/quickjs-wasmfile-release-asyncify/package.json");
  const quickjsWasm = readFileSync(new URL("dist/emscripten-module.wasm", `file://${pkgJson.replace(/\\/g, "/")}`));
  const logs = [];
  const skills = await connectStaticSkills(ORIGIN, {
    quickjsWasm,
    minimemoryWasm: readFileSync(_require.resolve("@rckflr/minimemory/minimemory_bg.wasm")),
    minimemoryInit: () => WasmOkfIndex, // ya inicializado arriba (initSync es global por modulo)
    onLog: (l) => logs.push(l),
  });

  const names = skills.tools.map((t) => t.name);
  check(names.includes("sum_numbers") && names.includes("alpha__search_mem"),
    "web: tools verificadas con scope publico (sum_numbers, alpha__search_mem)");
  check(!names.includes("corrupt") && skills.rejected.some((r) => r.name === "corrupt"),
    "web: hash roto -> skill rechazada con diagnostico");

  const sum = await skills.callTool("sum_numbers", { a: 20, b: 22 });
  check(sum === 42, "web: tool sandboxeada ejecuta (sum -> 42)");

  const hits = await skills.callTool("alpha__search_mem", { q: "refund thirty days" });
  check(hits && Array.isArray(hits.hits) && hits.hits.length > 0 && /return|refund/i.test(hits.hits[0].text),
    "web: memoria scoped verificada responde (alpha__search_mem)");

  check(skills.recipes.sum_numbers && /Always pass BOTH/.test(skills.recipes.sum_numbers),
    "web: receta SKILL.md verificada expuesta");
  check(logs.some((l) => /tool_sha256 mismatch/.test(l)),
    "web: el log registra el mismatch del hash roto");

  let threw = false;
  try { await skills.callTool("nope", {}); } catch { threw = true; }
  check(threw, "web: tool inexistente -> error controlado");

  skills.dispose();
} catch (e) {
  console.error("ERROR en test-web:", e && e.stack ? e.stack : e);
  failures++;
} finally {
  server.close();
}

console.log(failures === 0 ? "\nTODOS LOS CHECKS VERDE" : `\n${failures} CHECK(S) ROJO(S)`);
process.exit(failures ? 1 : 0);
