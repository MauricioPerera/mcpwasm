// Build del publisher "llmstxt-docs".
//
// 1) Descarga (fetch) los markdown RAW del repo llms-txt-skills (rama master, y
//    la rama ext-skill-attestations para el doc que aun no esta en master) + el
//    README.md local de mcpwasm, y los guarda en content/docs/<name>.md.
// 2) Ingiere los 4 docs como conceptos OKF en WasmOkfIndex (parrafos de prosa
//    por seccion, type docs, title "<doc>: <seccion>", chunk_size 800/50),
//    exporta skills-index.snapshot y calcula su sha256.
// 3) Lee los tool.js + SKILL.md de las 3 skills, calcula tool_sha256.
// 4) Genera /llms.txt: seccion ## Skills normal + UNA linea a nivel origin
//    (tras Skills) con skills-memory {snapshot, snapshot_sha256, format}.
// 5) Genera worker.mjs (contenido incrustado byte-exacto via JSON.stringify) y
//    wrangler.toml. Los tool_sha256 y snapshot_sha256 declarados en /llms.txt
//    coinciden con el contenido servido porque el worker sirve el MISMO string
//    sobre el que se hasheo.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { initSync, WasmOkfIndex } from "@rckflr/minimemory";

const require = createRequire(import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));
const contentDir = join(__dirname, "content");
const docsDir = join(contentDir, "docs");
mkdirSync(docsDir, { recursive: true });

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const read = (name) => readFileSync(join(contentDir, name), "utf8");

// --- Fuentes de los 4 documentos --------------------------------------------
// master commit (2026-07-02): 2429f1c5676b9d842f62ab82bf3a64d01a9a68e9
// ext-skill-attestations commit: abc8898a1d126e9bd0b46d13ae61b09547d4ec39
const RAW = (branch, path) =>
  `https://raw.githubusercontent.com/MauricioPerera/llms-txt-skills/${branch}/${path}`;

const DOC_SOURCES = [
  {
    name: "rfc-skills-in-llms-txt",
    title: "RFC: Publishing Agent Skills through llms.txt",
    candidates: [{ branch: "master", path: "docs/rfc-skills-in-llms-txt.md" }],
  },
  {
    name: "ext-executable-skills",
    title: "Extension: Executable Skills",
    candidates: [{ branch: "master", path: "docs/ext-executable-skills.md" }],
  },
  {
    name: "ext-skill-attestations",
    title: "Extension: Skill Attestations",
    // intenta master primero; si 404, usa la rama ext-skill-attestations
    candidates: [
      { branch: "master", path: "docs/ext-skill-attestations.md" },
      { branch: "ext-skill-attestations", path: "docs/ext-skill-attestations.md" },
    ],
  },
  {
    name: "mcpwasm-readme",
    title: "mcpwasm — Static MCP (reference implementation README)",
    local: join(__dirname, "..", "README.md"),
  },
];

const COMMIT_BY_BRANCH = {
  master: "2429f1c5676b9d842f62ab82bf3a64d01a9a68e9",
  "ext-skill-attestations": "abc8898a1d126e9bd0b46d13ae61b09547d4ec39",
};

// --- 1) Fetch / copia de los 4 docs -> content/docs/<name>.md ----------------
const docs = {}; // name -> markdown string
const provenance = [];

for (const src of DOC_SOURCES) {
  let markdown = null;
  let used = null;
  if (src.local) {
    markdown = readFileSync(src.local, "utf8");
    used = { source: "local", path: src.local };
  } else {
    for (const c of src.candidates) {
      const url = RAW(c.branch, c.path);
      const res = await fetch(url);
      if (res.ok) {
        markdown = await res.text();
        used = { source: "github-raw", branch: c.branch, path: c.path, url, commit: COMMIT_BY_BRANCH[c.branch] };
        break;
      }
      // si 404, probar siguiente candidato
    }
  }
  if (markdown === null) {
    throw new Error(`No se pudo obtener el doc ${src.name} de ningun candidato`);
  }
  docs[src.name] = markdown;
  writeFileSync(join(docsDir, `${src.name}.md`), markdown, "utf8");
  provenance.push({ name: src.name, title: src.title, ...used });
  console.log(`doc ${src.name}: ${markdown.length} bytes <- ${used.source}${used.branch ? " " + used.branch + "@" + used.commit.slice(0, 7) : ""}`);
}

writeFileSync(join(__dirname, "doc-sources.json"), JSON.stringify(provenance, null, 2) + "\n", "utf8");

// --- 2) Ingest de los 4 docs en WasmOkfIndex -> snapshot + sha256 ------------
// init minimemory wasm (Node: initSync con buffer). TAREA24: wasm desde npm.
initSync({ module: readFileSync(require.resolve("@rckflr/minimemory/minimemory_bg.wasm")) });

// Parsear cada doc por headings (level 1..3) -> secciones; extraer parrafos de
// prosa (>= 40 chars, sin bloques de codigo). title = "<doc>: <seccion>".
const MAX_PARA = 800;
const concepts = [];
for (const src of DOC_SOURCES) {
  const doc = docs[src.name];
  const lines = doc.split(/\r?\n/);
  const sections = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(/^(#{1,3})\s+(.*)$/);
    if (m) {
      cur = { title: m[2].trim(), body: [] };
      sections.push(cur);
    } else if (cur) {
      cur.body.push(line);
    }
  }
  let pi = 0;
  for (const s of sections) {
    if (!s.title || s.body.length === 0) continue;
    const slug = s.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    const joined = s.body.join("\n");
    const noCode = joined.replace(/```[\s\S]*?```/g, "");
    const paras = noCode
      .split(/\n\s*\n/)
      .map((p) => p.replace(/\n/g, " ").replace(/\s+/g, " ").trim())
      // Solo prosa: descartar blockquotes (ejemplos/citas, p.ej. comandos en
      // español como 'crea una imagen de ...' que introducen tokens spurious
      // como "de" con idf alto y ruido en queries no relacionadas).
      .filter((p) => p.length >= 40 && !p.startsWith(">"));
    for (const p of paras) {
      const text = p.length > MAX_PARA ? p.slice(0, MAX_PARA) : p;
      concepts.push({
        id: `${src.name}-${slug}-${pi}`,
        title: `${src.name}: ${s.title}`,
        text,
      });
      pi++;
    }
  }
}

if (concepts.length < 10) {
  console.error(`POCOS conceptos (${concepts.length}); revisar parser.`);
  process.exit(1);
}

const idx = WasmOkfIndex.with_chunk_size(800, 50);
let totalChunks = 0;
for (const c of concepts) {
  const content = `---\ntype: docs\ntitle: ${c.title}\n---\n${c.text}`;
  const n = idx.ingest_concept(c.id, content);
  totalChunks += n;
}
console.log(`conceptos: ${concepts.length}, chunks insertados: ${totalChunks}, idx.len: ${idx.len()}`);

// Sanity probes.
const probe1 = JSON.parse(idx.search("tool_sha256 integrity verification", 5, null));
const probe2 = JSON.parse(idx.search("receta de paella", 5, null));
console.log(`probe 'tool_sha256 integrity verification' hits: ${probe1.length} top: ${probe1[0] ? probe1[0].title + " score=" + probe1[0].score : "(none)"}`);
console.log(`probe 'receta de paella' hits: ${probe2.length}`);

const snapshot = idx.export_snapshot();
writeFileSync(join(__dirname, "skills-index.snapshot"), snapshot, "utf8");
const snapshotSha = sha256(snapshot);
console.log(`snapshot: ${snapshot.length} bytes, sha256: ${snapshotSha}`);

// --- 3) Skills: tool.js + SKILL.md + tool_sha256 ----------------------------
const SKILLS = ["search_spec", "get_doc", "list_docs"];
const skillDesc = {
  search_spec: "BM25 search over the llms-txt-skills spec snapshot (4 docs). Returns hits {text,score,title,concept_id}.",
  get_doc: "Fetch one of the 4 published documents by name. Returns {name,length,content} (content truncated to 4000 chars).",
  list_docs: "List the 4 published documents with title and path. Static, no fetch.",
};
const skills = {};
for (const name of SKILLS) {
  const tool = read(`${name}.tool.js`);
  skills[name] = { tool, skillMd: read(`${name}.SKILL.md`), hash: sha256(tool) };
}

// --- 4) /llms.txt: linea skills-memory a nivel origin + ## Skills -------------
// La linea skills-memory va ANTES del heading "## Skills": algunos parsers
// conformes pliegan lineas sueltas tras la lista dentro del ultimo skill.
const skillLines = SKILLS.map((name) => {
  const meta = JSON.stringify({
    version: "1.0.0",
    tool: `/skills/${name}/tool.js`,
    tool_sha256: skills[name].hash,
  });
  return `- [${name}](/skills/${name}/SKILL.md): ${skillDesc[name]} <!-- skill: ${meta} -->`;
});

const memoryMeta = JSON.stringify({
  snapshot: "/skills-index.snapshot",
  snapshot_sha256: snapshotSha,
  format: "minimemory-okf-v1",
});

const llmsTxt =
  `# llmstxt-docs\n\n` +
  `> Publisher of the llms-txt-skills standard documents. Serves the RFC, the executable-skills and skill-attestations extensions, and the mcpwasm reference README, plus a hash-pinned BM25 search snapshot and 3 executable skills to query them.\n\n` +
  `<!-- skills-memory: ${memoryMeta} -->\n\n` +
  `## Skills\n\n` +
  skillLines.join("\n") + "\n";

// --- 5) Genera worker.mjs ---------------------------------------------------
const docConstants = DOC_SOURCES.map((src) =>
  `const DOC_${src.name.toUpperCase().replace(/-/g, "_")}_MD = ${JSON.stringify(docs[src.name])};`
).join("\n");

const skillConstants = SKILLS.map((name) =>
  `const ${name.toUpperCase()}_TOOL_JS = ${JSON.stringify(skills[name].tool)};\n` +
  `const ${name.toUpperCase()}_SKILL_MD = ${JSON.stringify(skills[name].skillMd)};`
).join("\n");

const docRoutes = DOC_SOURCES.map((src) => {
  const constName = `DOC_${src.name.toUpperCase().replace(/-/g, "_")}_MD`;
  return `    if (path === "/docs/${src.name}.md") { return new Response(${constName}, { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" } }); }`;
}).join("\n");

const skillRoutes = SKILLS.map((name) =>
  `    if (path === "/skills/${name}/tool.js") { return new Response(${name.toUpperCase()}_TOOL_JS, { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" } }); }\n` +
  `    if (path === "/skills/${name}/SKILL.md") { return new Response(${name.toUpperCase()}_SKILL_MD, { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" } }); }`
).join("\n");

const worker =
`// AUTOGENERADO por build.mjs. No editar a mano.
${docConstants}
${skillConstants}
const SNAPSHOT = ${JSON.stringify(snapshot)};
const LLMS_TXT = ${JSON.stringify(llmsTxt)};

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/llms.txt") {
      return new Response(LLMS_TXT, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
    }

${docRoutes}

${skillRoutes}

    if (path === "/skills-index.snapshot") {
      return new Response(SNAPSHOT, { headers: { "content-type": "application/octet-stream", "cache-control": "no-store" } });
    }

    return json({ error: "Not Found", path }, 404);
  }
};
`;

writeFileSync(join(__dirname, "worker.mjs"), worker, "utf8");

const wrangler =
  `name = "llmstxt-docs"\n` +
  `main = "worker.mjs"\n` +
  `compatibility_date = "2026-06-01"\n` +
  `account_id = "091122c40cc6f8d0d421cbc90e2caca8"\n`;
writeFileSync(join(__dirname, "wrangler.toml"), wrangler, "utf8");

console.log("\nGenerated: worker.mjs, wrangler.toml, skills-index.snapshot, doc-sources.json");
console.log("Declared tool_sha256:");
for (const name of SKILLS) console.log(`  ${name}: ${skills[name].hash}`);
console.log(`Declared snapshot_sha256: ${snapshotSha}`);
console.log(`Concepts ingested: ${concepts.length}, chunks: ${totalChunks}`);