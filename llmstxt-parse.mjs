// llmstxt-parse.mjs
// Parser puro del formato "Skills" de /llms.txt del demo site.
//
// Formato de cada linea ejecutable (seccion "## Skills"):
//   - [<name>](<skillMdPath>): <description> <!-- skill: {"version":"1.0.0","tool":"<toolPath>","sha256":"<hex>"} -->
//
// Exporta parseLlmsTxt(text) -> [{ name, description, toolPath, sha256, version }]
//  - Funcion PURA: no hace fetch, no importa nada. Recibe el texto y devuelve la lista.
//  - Solo parsea lineas con el comentario `<!-- skill: {...} -->` (skills ejecutables).
//  - Lineas de skills sin el comentario (solo enlace descriptivo) se ignoran.
//  - Si el JSON del comentario es invalido, la linea se omite (no lanza).

const LINE_RE =
  /^\s*-\s+\[([^\]]+)\]\(([^)]*)\):\s*(.*?)\s*<!--\s*skill:\s*(\{.*?\})\s*-->\s*$/;

export function parseLlmsTxt(text) {
  if (typeof text !== "string") return [];
  const out = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const m = rawLine.match(LINE_RE);
    if (!m) continue;
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
      typeof meta.sha256 !== "string"
    ) {
      continue;
    }
    out.push({
      name,
      description,
      toolPath: meta.tool,
      sha256: meta.sha256,
      version: typeof meta.version === "string" ? meta.version : undefined,
    });
  }
  return out;
}