// scripts/attest.mjs — herramienta de atestaciones (ext-skill-attestations v0.2).
//
// Node puro (node:crypto soporta Ed25519 nativo). Dos subcomandos:
//   (a) keygen  -> escribe .attester-key.json (privada+publica, base64) LOCAL
//       e imprime la publica (base64 raw 32 bytes) para el registro de revisores.
//   (b) sign <origin> <skill> <valid_until>  -> lee el llms.txt del origin
//       (produccion), obtiene el tool_sha256 real del skill, construye el
//       payload canonico, firma Ed25519 y emite el objeto atestacion JSON.
//
// Payload firmado = bytes UTF-8 de
//   origin + "\n" + skill + "\n" + tool_sha256 + "\n" + signed_on + "\n" + valid_until
// con origin canonico (lowercase, sin trailing slash, sin puerto default) y
// tool_sha256 hex minusculas. Attester id: "human:mauricio".
//
// La clave privada NUNCA se imprime por stdout; keygen solo imprime la publica.

import { generateKeyPairSync, createPrivateKey, sign } from "node:crypto";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { parseLlmsTxt } from "../llmstxt-parse.mjs";
import { canonicalBase } from "../origin-scope.mjs";

const ATTESTER = "human:mauricio";
const KEYFILE = ".attester-key.json";

function b64(buf) {
  return Buffer.from(buf).toString("base64");
}

// Reconstruye los 32 bytes raw de la clave publica Ed25519 desde el JWK (x,
// base64url sin padding) y los devuelve como base64 standard. Es lo que va al
// registro de revisores (REVIEWERS) y lo que el gateway importa via
// crypto.subtle.importKey("raw", ...).
function pubRawB64(publicKey) {
  const jwk = publicKey.export({ format: "jwk" });
  let x = jwk.x.replace(/-/g, "+").replace(/_/g, "/");
  while (x.length % 4) x += "=";
  return Buffer.from(x, "base64").toString("base64");
}

function todayUtcStr() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Importado de origin-scope.mjs: MISMA funcion que usan los tres runtimes, para
// que lo que se firma aqui sea exactamente lo que alla se compara. (Antes cada
// sitio tenia su propia version y no coincidian.)
function canonicalOrigin(s) {
  const c = canonicalBase(s);
  if (c === null) throw new Error("origin invalido: " + s);
  return c;
}

function loadKey() {
  if (!existsSync(KEYFILE)) {
    console.error("falta .attester-key.json: corre `node scripts/attest.mjs keygen` primero");
    process.exit(1);
  }
  return JSON.parse(readFileSync(KEYFILE, "utf8"));
}

function cmdKeygen() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubB64 = pubRawB64(publicKey);
  const privJwk = privateKey.export({ format: "jwk" });
  writeFileSync(
    KEYFILE,
    JSON.stringify({ attester: ATTESTER, public_key: pubB64, private_jwk: privJwk }, null, 2) + "\n"
  );
  // Solo la publica a stdout (va al registro de revisores; la privada jamas).
  console.log(pubB64);
}

// Obtiene el texto del llms.txt: de una fuente LOCAL si se indica, o del origin
// en vivo (comportamiento por defecto, sin cambios).
//
// Por que hace falta la fuente local: firmar leyendo el origin en vivo obliga a
// desplegar ANTES de firmar, y entre el deploy y la firma las skills quedan con
// hashes sin atestacion que coincida -- en modo enforcing eso significa que
// desaparecen del gateway. Con --llms / --from-worker se firma contra la salida
// del build y se despliega ya con las atestaciones dentro, sin ventana.
async function readLlmsText(canon, opts) {
  if (opts.llmsPath) {
    return readFileSync(opts.llmsPath, "utf8");
  }
  if (opts.workerPath) {
    // El build del docs-site no emite un llms.txt suelto: lo embebe en el
    // worker generado como `const LLMS_TXT = "...";`. Se extrae de ahi.
    const src = readFileSync(opts.workerPath, "utf8");
    const m = /const LLMS_TXT = ("(?:[^"\\]|\\.)*");/.exec(src);
    if (!m) throw new Error("no se encontro `const LLMS_TXT = \"...\";` en " + opts.workerPath);
    return JSON.parse(m[1]);
  }
  const res = await fetch(canon + "/llms.txt");
  if (!res.ok) throw new Error("llms.txt: HTTP " + res.status);
  return await res.text();
}

async function cmdSign(origin, skillArg, validUntil, opts) {
  if (!validUntil || !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) {
    console.error("valid_until debe ser YYYY-MM-DD");
    process.exit(1);
  }
  const key = loadKey();
  const priv = createPrivateKey({ key: key.private_jwk, format: "jwk" });
  const canon = canonicalOrigin(origin);

  let txt;
  try {
    txt = await readLlmsText(canon, opts);
  } catch (e) {
    console.error("no se pudo leer llms.txt: " + String((e && e.message) || e));
    process.exit(1);
  }

  // parseLlmsTxt es el MISMO parser que usan los tres runtimes. Antes esta
  // herramienta traia su propio regex: un segundo parser que podia divergir del
  // que verifica (y que ignoraba `scope`, con lo que en un origin multi-proyecto
  // podia elegir la skill equivocada).
  const { skills } = parseLlmsTxt(txt);
  const targets = skillArg === "--all" ? skills : skills.filter((s) => s.name === skillArg);
  if (targets.length === 0) {
    console.error(
      skillArg === "--all"
        ? "el llms.txt no declara ninguna skill ejecutable"
        : "skill '" + skillArg + "' no encontrada o sin tool_sha256 en llms.txt"
    );
    process.exit(1);
  }

  const signedOn = todayUtcStr();
  const out = targets.map((s) => {
    const payload = Buffer.from([canon, s.name, s.sha256, signedOn, validUntil].join("\n"), "utf8");
    return {
      origin: canon,
      skill: s.name,
      tool_sha256: s.sha256,
      attester: key.attester,
      signed_on: signedOn,
      valid_until: validUntil,
      signature: b64(sign(null, payload, priv)),
    };
  });
  // --all emite el ARRAY completo, listo para pegar en attestations.json: firmar
  // de a una es como se olvida la tercera.
  console.log(JSON.stringify(skillArg === "--all" ? out : out[0], null, 2));
}

const USAGE =
  "uso: attest.mjs keygen\n" +
  "     attest.mjs sign <origin> <skill|--all> <valid_until> [fuente]\n" +
  "\n" +
  "  <skill>        nombre de la skill, o --all para firmar TODAS las del llms.txt\n" +
  "                 (emite el array completo, listo para attestations.json)\n" +
  "  fuente (opcional; por defecto lee el llms.txt del origin EN VIVO):\n" +
  "     --llms <archivo>          leer el llms.txt de un archivo local\n" +
  "     --from-worker <archivo>   extraer LLMS_TXT de un worker generado\n" +
  "                               (p.ej. docs-site/worker.mjs recien buildeado)\n" +
  "\n" +
  "  Firmar contra una fuente local permite firmar ANTES de desplegar. Leyendo el\n" +
  "  origin en vivo hay que desplegar primero, y en modo enforcing eso deja una\n" +
  "  ventana en la que las skills no tienen atestacion que coincida: el gateway\n" +
  "  las excluye.";

const [, , sub, ...rest] = process.argv;
if (sub === "keygen") {
  cmdKeygen();
} else if (sub === "sign") {
  const opts = { llmsPath: null, workerPath: null };
  const pos = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--llms") opts.llmsPath = rest[++i];
    else if (rest[i] === "--from-worker") opts.workerPath = rest[++i];
    else pos.push(rest[i]);
  }
  const [origin, skill, validUntil] = pos;
  if (!origin || !skill || !validUntil) {
    console.error(USAGE);
    process.exit(1);
  }
  if (opts.llmsPath && opts.workerPath) {
    console.error("--llms y --from-worker son mutuamente excluyentes");
    process.exit(1);
  }
  cmdSign(origin, skill, validUntil, opts);
} else {
  console.error(USAGE);
  process.exit(1);
}