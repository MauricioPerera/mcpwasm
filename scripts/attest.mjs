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

function canonicalOrigin(s) {
  return new URL(s).origin;
}

// Extrae el tool_sha256 declarado en llms.txt para la skill <skill>.
// Linea: - [skill](/path): desc <!-- skill: {"tool":"...","tool_sha256":"..."} -->
function extractToolSha(txt, skill) {
  const lines = txt.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(
      /^-\s+\[([^\]]+)\]\([^)]*\):\s*.*?<!--\s*skill:\s*(\{.*\})\s*-->/
    );
    if (m && m[1] === skill) {
      try {
        const meta = JSON.parse(m[2]);
        if (meta && typeof meta.tool_sha256 === "string") return meta.tool_sha256;
      } catch {
        /* seguir */
      }
    }
  }
  return null;
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

async function cmdSign(origin, skill, validUntil) {
  if (!validUntil || !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) {
    console.error("valid_until debe ser YYYY-MM-DD");
    process.exit(1);
  }
  const key = loadKey();
  const priv = createPrivateKey({ key: key.private_jwk, format: "jwk" });
  const canon = canonicalOrigin(origin);

  // Lee el llms.txt del origin (produccion) y obtiene el tool_sha256 real.
  let res;
  try {
    res = await fetch(canon + "/llms.txt");
  } catch (e) {
    console.error("fetch llms.txt fallo: " + String(e && e.message || e));
    process.exit(1);
  }
  if (!res.ok) {
    console.error("llms.txt: HTTP " + res.status);
    process.exit(1);
  }
  const txt = await res.text();
  const toolSha = extractToolSha(txt, skill);
  if (!toolSha) {
    console.error("skill '" + skill + "' no encontrada o sin tool_sha256 en llms.txt");
    process.exit(1);
  }

  const signedOn = todayUtcStr();
  const payload = Buffer.from(
    [canon, skill, toolSha, signedOn, validUntil].join("\n"),
    "utf8"
  );
  const sig = sign(null, payload, priv);
  const att = {
    origin: canon,
    skill,
    tool_sha256: toolSha,
    attester: key.attester,
    signed_on: signedOn,
    valid_until: validUntil,
    signature: b64(sig),
  };
  console.log(JSON.stringify(att, null, 2));
}

const [, , sub, ...rest] = process.argv;
if (sub === "keygen") {
  cmdKeygen();
} else if (sub === "sign") {
  const [origin, skill, validUntil] = rest;
  if (!origin || !skill || !validUntil) {
    console.error("uso: sign <origin> <skill> <valid_until>");
    process.exit(1);
  }
  cmdSign(origin, skill, validUntil);
} else {
  console.error("uso: attest.mjs keygen | sign <origin> <skill> <valid_until>");
  process.exit(1);
}