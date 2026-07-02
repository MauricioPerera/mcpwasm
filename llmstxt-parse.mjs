// llmstxt-parse.mjs
// Parser puro del formato "Skills" de /llms.txt del demo site.
//
// Formato de cada linea ejecutable (seccion "## Skills"):
//   - [<name>](<skillMdPath>): <description> <!-- skill: {"version":"1.0.0","tool":"<toolPath>","tool_sha256":"<hex>"} -->
//
// Linea de memoria (a nivel origin, fuera de la lista de skills):
//   <!-- skills-memory: {"snapshot":"<path>","snapshot_sha256":"<hex>","format":"minimemory-okf-v1"} -->
//
// Exporta parseLlmsTxt(text) -> { skills: [...], memory: {...} | null }
//  - Funcion PURA: no hace fetch, no importa nada. Recibe el texto y devuelve
//    skills + la declaracion de memoria (si la linea skills-memory esta presente).
//  - skills: solo parsea lineas con el comentario `<!-- skill: {...} -->`
//    (skills ejecutables). Lineas sin el comentario (solo enlace) se ignoran.
//    Si el JSON del comentario es invalido, la linea se omite (no lanza).
//  - memory: parsea UNA linea `<!-- skills-memory: {...} -->`. Requiere snapshot
//    (string), snapshot_sha256 (string) y format (string). Si el JSON es invalido
//    o faltan campos -> memory: null (no rompe nada). Si el format NO es
//    "minimemory-okf-v1" -> memory presente con unsupported: true (el gateway no
//    lo procesa pero no falla). Solo "minimemory-okf-v1" se procesa.

const LINE_RE =
  /^\s*-\s+\[([^\]]+)\]\(([^)]*)\):\s*(.*?)\s*<!--\s*skill:\s*(\{.*?\})\s*-->\s*$/;

const MEMORY_RE =
  /^\s*<!--\s*skills-memory:\s*(\{.*?\})\s*-->\s*$/;

export function parseLlmsTxt(text) {
  if (typeof text !== "string") return { skills: [], memory: null };
  const skills = [];
  let memory = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const m = rawLine.match(LINE_RE);
    if (m) {
      const name = m[1];
      const description = m[3];
      let meta;
      try {
        meta = JSON.parse(m[4]);
      } catch {
        continue;
      }
      if (
        !meta ||
        typeof meta !== "object" ||
        typeof meta.tool !== "string" ||
        typeof meta.tool_sha256 !== "string"
      ) {
        continue;
      }
      skills.push({
        name,
        description,
        toolPath: meta.tool,
        sha256: meta.tool_sha256,
        version: typeof meta.version === "string" ? meta.version : undefined,
      });
      continue;
    }

    // Linea de memoria (a nivel origin). Solo la primera valida se toma.
    if (memory === null) {
      const mm = rawLine.match(MEMORY_RE);
      if (mm) {
        let memMeta;
        try {
          memMeta = JSON.parse(mm[1]);
        } catch {
          continue; // JSON invalido: ignorar (no rompe)
        }
        if (
          memMeta &&
          typeof memMeta === "object" &&
          typeof memMeta.snapshot === "string" &&
          typeof memMeta.snapshot_sha256 === "string" &&
          typeof memMeta.format === "string"
        ) {
          memory = {
            snapshot: memMeta.snapshot,
            snapshot_sha256: memMeta.snapshot_sha256,
            format: memMeta.format,
            unsupported: memMeta.format !== "minimemory-okf-v1",
          };
        }
        // Si faltan campos -> memory queda null (ignorado silenciosamente).
      }
    }
  }
  return { skills, memory };
}