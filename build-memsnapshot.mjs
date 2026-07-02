// build-memsnapshot.mjs
// Construye mem-docs.snapshot para el spike TAREA20 (minimemory + QuickJS).
//
// Usa la base embebida minimemory v3.2.0 (vendored en vendor-minimemory/), que
// expone WasmOkfIndex: indice BM25-only (sin embeddings) con ingest_concept +
// search + export_snapshot/import_snapshot. La API publicada en npm (3.0.1) NO
// expone BM25 usable desde JS (ver TAREA20-REPORT.md), por eso se usa el build
// v3.2.0 (wasm ~563KB) que agrega WasmOkfIndex.
//
// Formato OKF: cada concepto es markdown con frontmatter YAML que REQUIERE un
// campo `type` (sin `type` o frontmatter roto => ingest_concept devuelve 0
// chunks y se salta). Usamos type: docs y title: <nombre de seccion del README>;
// search() devuelve {concept_id, chunk_id, score, title?, snippet}, de donde
// sacamos section = title y text = snippet.
//
// Snapshot = JSON string (export_snapshot). Lo volcamos a mem-docs.snapshot
// (bytes UTF-8) y computamos su sha256 -> mem-snapshot-sha.json. El worker
// verifica el sha256 del snapshot bundleado contra la constante esperada antes
// de importarlo (mismo principio de integridad que tool_sha256).

import { initSync, WasmOkfIndex } from "./vendor-minimemory/minimemory.js";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const WASM_PATH = "vendor-minimemory/minimemory_bg.wasm";
const SNAPSHOT_PATH = "mem-docs.snapshot";
const SHA_PATH = "mem-snapshot-sha.json";

// --- 1) init minimemory wasm (Node: initSync con buffer) ---------------------
initSync({ module: readFileSync(WASM_PATH) });

// --- 2) Parsear README.md en secciones -> parrafos reales --------------------
const readme = readFileSync("README.md", "utf8");

// Split por headings ## (level 2) y # (level 1). Cada seccion -> titulo + cuerpo.
const lines = readme.split(/\r?\n/);
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

// Para cada seccion, extraer parrafos (separados por linea en blanco), quitando
// bloques de codigo (```...```) y lineas sueltas de codigo/lista. Parrafos de
// prosa con >= 40 chars. Recortamos a ~400 chars para que cada concepto sea 1
// chunk BM25 con snippet significativo.
const MAX_PARA = 400;
const concepts = [];
for (const s of sections) {
  if (!s.title || s.body.length === 0) continue;
  const slug = s.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  // Reconstruir cuerpo y separar en parrafos por linea en blanco.
  const joined = s.body.join("\n");
  // Quitar bloques de codigo cerrados.
  const noCode = joined.replace(/```[\s\S]*?```/g, "");
  const paras = noCode.split(/\n\s*\n/).map((p) => p.replace(/\n/g, " ").replace(/\s+/g, " ").trim()).filter((p) => p.length >= 40);
  let pi = 0;
  for (const p of paras) {
    if (concepts.length >= 20) break;
    const text = p.length > MAX_PARA ? p.slice(0, MAX_PARA) : p;
    concepts.push({ id: `${slug}-${pi}`, title: s.title, text });
    pi++;
  }
  if (concepts.length >= 20) break;
}

if (concepts.length < 15) {
  console.error(`POCOS conceptos (${concepts.length}); se esperaban >=15. Revisar parser de README.`);
  process.exit(1);
}

// --- 3) Ingestar conceptos en WasmOkfIndex -----------------------------------
// with_chunk_size(800, 50): chunks ~800 chars. Nuestros parrafos son <= 400 =>
// cada concepto queda en 1 chunk (snippet = parrafo entero).
const idx = WasmOkfIndex.with_chunk_size(800, 50);
let totalChunks = 0;
for (const c of concepts) {
  const content = `---\ntype: docs\ntitle: ${c.title}\n---\n${c.text}`;
  const n = idx.ingest_concept(c.id, content);
  totalChunks += n;
}
console.log(`conceptos: ${concepts.length}, chunks insertados: ${totalChunks}, idx.len: ${idx.len()}`);

// Sanity: search debe devolver hits para un termino presente y [] para uno ausente.
const probe = JSON.parse(idx.search("sandbox capability quickjs", 5, null));
console.log("probe 'sandbox capability quickjs' hits:", probe.length, probe[0] ? probe[0].title : "(none)");

// --- 4) Exportar snapshot + sha256 -------------------------------------------
const snapshot = idx.export_snapshot();
writeFileSync(SNAPSHOT_PATH, snapshot, "utf8");
const sha256 = createHash("sha256").update(snapshot, "utf8").digest("hex");
writeFileSync(SHA_PATH, JSON.stringify({ sha256, concepts: concepts.length, chunks: totalChunks }, null, 2) + "\n", "utf8");

console.log(`snapshot: ${SNAPSHOT_PATH} (${snapshot.length} bytes)`);
console.log(`sha256:   ${sha256}`);
console.log(`meta:     ${SHA_PATH}`);