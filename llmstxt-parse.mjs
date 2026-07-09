// llmstxt-parse.mjs
// Parser puro del formato "Skills" de /llms.txt del demo site.
//
// Formato de cada linea ejecutable (seccion "## Skills"):
//   - [<name>](<skillMdPath>): <description> <!-- skill: {"version":"1.0.0","tool":"<toolPath>","tool_sha256":"<hex>"} -->
//
// Formato de una skill de PROSA (core llms-txt-skills spec, sin tool.js): la
// misma linea de lista, con o sin el comentario `<!-- skill: {...} -->`, pero
// sin 'tool'/'tool_sha256'. No es ejecutable por este runtime, pero SI se
// reporta (en `nonExecutable`, no en `skills`) para que el caller no la trate
// como si no existiera -- antes esta funcion la descartaba en silencio.
//
// Linea de memoria (a nivel origin, fuera de la lista de skills):
//   <!-- skills-memory: {"snapshot":"<path>","snapshot_sha256":"<hex>","format":"minimemory-okf-v1"} -->
//
// Exporta parseLlmsTxt(text) -> { skills: [...], nonExecutable: [...], memory: {...} | null }
//  - Funcion PURA: no hace fetch, no importa nada. Recibe el texto y devuelve
//    skills ejecutables + skills de prosa descubiertas + la declaracion de
//    memoria (si la linea skills-memory esta presente).
//  - Ambos arrays (skills, nonExecutable) solo consideran lineas DENTRO de la
//    seccion `## Skills` (heading exacto, case-insensitive, hasta el proximo
//    `## `): sin este limite, hacer el comentario opcional haria que CUALQUIER
//    bullet "- [texto](url): descripcion" en otra seccion del documento (notas,
//    changelog, etc.) se reportara como skill de prosa por error.
//  - skills: lineas con el comentario `<!-- skill: {...} -->` Y 'tool'/'tool_sha256'
//    ambos string (Executable Skills extension v0.4).
//  - nonExecutable: lineas de la seccion ## Skills que no calificaron como
//    ejecutables -- sin comentario, con comentario pero sin tool/tool_sha256,
//    o con JSON invalido. Cada entrada trae `reason` para diagnostico.
//  - memory: parsea UNA linea `<!-- skills-memory: {...} -->` (en cualquier
//    parte del documento, tipicamente antes de ## Skills). Requiere snapshot
//    (string), snapshot_sha256 (string) y format (string). Si el JSON es invalido
//    o faltan campos -> memory: null (no rompe nada). Si el format NO es
//    "minimemory-okf-v1" -> memory presente con unsupported: true (el gateway no
//    lo procesa pero no falla). Solo "minimemory-okf-v1" se procesa.

const SKILLS_HEADING_RE = /^##\s+skills\s*$/i;
const HEADING2_RE = /^##\s+/;

// El comentario `<!-- skill: {...} -->` es OPCIONAL: el core RFC permite una
// entrada de skill sin metadata inline (solo enlace + descripcion).
const LINE_RE =
  /^\s*-\s+\[([^\]]+)\]\(([^)]*)\):\s*(.*?)\s*(?:<!--\s*skill:\s*(\{.*?\})\s*-->)?\s*$/;

const MEMORY_RE =
  /^\s*<!--\s*skills-memory:\s*(\{.*?\})\s*-->\s*$/;

export function parseLlmsTxt(text) {
  if (typeof text !== "string") return { skills: [], nonExecutable: [], memory: null };
  const skills = [];
  const nonExecutable = [];
  let memory = null;
  let inSkillsSection = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const stripped = rawLine.trim();

    if (SKILLS_HEADING_RE.test(stripped)) {
      inSkillsSection = true;
      continue;
    }
    if (inSkillsSection && HEADING2_RE.test(stripped)) {
      inSkillsSection = false;
    }

    if (inSkillsSection) {
      const m = rawLine.match(LINE_RE);
      if (m) {
        const name = m[1];
        const url = m[2];
        const description = m[3];
        const metaRaw = m[4];
        let meta = null;
        let metaError = false;
        if (metaRaw) {
          try {
            meta = JSON.parse(metaRaw);
          } catch {
            metaError = true;
          }
        }
        if (
          meta &&
          typeof meta === "object" &&
          typeof meta.tool === "string" &&
          typeof meta.tool_sha256 === "string"
        ) {
          skills.push({
            name,
            description,
            toolPath: meta.tool,
            sha256: meta.tool_sha256,
            version: typeof meta.version === "string" ? meta.version : undefined,
          });
        } else {
          let reason;
          if (!metaRaw) {
            reason = "sin metadata inline (skill de prosa, solo enlace)";
          } else if (metaError) {
            reason = "metadata JSON invalida";
          } else {
            reason = "no declara 'tool'/'tool_sha256' (skill de prosa, ver SKILL.md)";
          }
          nonExecutable.push({ name, url, description, reason });
        }
        continue;
      }
    }

    // Linea de memoria (a nivel origin, puede estar fuera de ## Skills).
    // Solo la primera valida se toma.
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
  return { skills, nonExecutable, memory };
}
