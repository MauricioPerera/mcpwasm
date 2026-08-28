// sqlite-capability.mjs — capability host.sqlite de PRIMERA CLASE (solo runtime
// local): node:sqlite no existe en Cloudflare Workers, misma asimetria honesta
// que Sigstore (ver README "Capability support by runtime"). OPT-IN del
// CONSUMIDOR: la base es un dato del usuario que corre el runtime — un origin
// nunca la recibe sin que el usuario la monte explicitamente via --sqlite.
//
// Politica de seguridad:
//  - Solo lectura POR DEFECTO: para archivos, la conexion se abre readonly a
//    nivel SQLite (SQLITE_OPEN_READONLY) Y el policy check rechaza no-SELECT
//    con mensaje claro antes de tocar la base (defensa en profundidad + error
//    legible in-sandbox).
//  - Escritura solo con --sqlite-write (el consumidor asume el riesgo: la DB
//    es SU archivo local, montada por EL, no dato del publicador).
//  - Una sola statement por llamada (guard contra SQL stacking: "a; b" => error).
//  - maxRows default 500: volcado predecible hacia el sandbox (techo real:
//    64 MB de memoria QuickJS).
//  - Nunca lanza: devuelve {error} JSON (fail controlado in-sandbox, isError:true).
//  - Contrato del puente (extraCapabilities): recibe JSON.stringify([...args])
//    (ARRAY), devuelve JSON string. Acepta ["<sql>", params?] | [{sql, params?}]
//    — mismo estilo flexible que memorySearch.
//
// NOTA node:sqlite: builtin desde Node 22.5 (import dinamico => sin costo para
// Node 18/20, soportados por engines>=18; sin --sqlite no se toca).

const READONLY_RE = /^\s*(select|pragma|explain)\b/i;
const ROWS_RE = /^\s*(select|pragma|explain)\b/i;
const DEFAULT_MAX_ROWS = 500;

function fail(msg) {
  return JSON.stringify({ error: msg });
}

export async function makeSqliteCapability({ path: dbPath, write = false, maxRows = DEFAULT_MAX_ROWS } = {}) {
  if (typeof dbPath !== "string" || dbPath.length === 0) {
    throw new Error("sqlite: se requiere una ruta de base de datos (o ':memory:')");
  }
  let mod;
  try {
    mod = await import("node:sqlite");
  } catch (e) {
    throw new Error("node:sqlite no disponible (requiere Node >= 22.5): " + String((e && e.message) || e));
  }
  const isMemory = dbPath === ":memory:";
  // ReadOnly a nivel sqlite para archivos (defensa real, no solo policy).
  // :memory: + readonly no tiene sentido (DB vacia eterna); el policy check
  // sigue aplicando en ambos casos.
  const db = new mod.DatabaseSync(dbPath, isMemory || write ? {} : { readOnly: true });

  return async function sqliteRaw(argsJson) {
    let sql = null;
    let params = [];
    let parsed = null;
    try {
      parsed = JSON.parse(argsJson);
    } catch (e) {
      return fail("host.sqlite: args JSON invalido — " + String((e && e.message) || e));
    }
    if (Array.isArray(parsed)) {
      const first = parsed[0];
      const second = parsed[1];
      if (typeof first === "string") {
        sql = first;
        if (Array.isArray(second)) params = second;
      } else if (first && typeof first === "object") {
        sql = first.sql;
        if (Array.isArray(first.params)) params = first.params;
      }
    } else if (parsed && typeof parsed === "object") {
      sql = parsed.sql;
      if (Array.isArray(parsed.params)) params = parsed.params;
    }
    if (typeof sql !== "string" || sql.trim() === "") {
      return fail("host.sqlite: se requiere un string sql");
    }
    const trimmed = sql.trim().replace(/;\s*$/, "");
    if (trimmed.includes(";")) {
      return fail("host.sqlite: una sola statement por llamada (se detecto ';')");
    }
    if (!write && !READONLY_RE.test(trimmed)) {
      return fail("host.sqlite: modo SOLO LECTURA (sin --sqlite-write) — permitido: SELECT/PRAGMA/EXPLAIN. Recibido: " + trimmed.slice(0, 60));
    }
    try {
      const stmt = db.prepare(trimmed);
      if (ROWS_RE.test(trimmed)) {
        const rows = stmt.all(...params);
        const truncated = rows.length > maxRows;
        const out = truncated ? rows.slice(0, maxRows) : rows;
        return JSON.stringify({ rows: out, count: out.length, truncated: truncated || undefined });
      }
      const info = stmt.run(...params);
      return JSON.stringify({ changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) });
    } catch (e) {
      return fail("host.sqlite: " + String((e && e.message) || e));
    }
  };
}