// scripts/validate-publisher.mjs — linter de publishers para el onboarding.
//
// Valida un origin que publica skills llms-txt-skills: fetchea /llms.txt (cap
// 256 KB), parsea con llmstxt-parse.mjs (parser reutilizado, NO duplicado), por
// cada skill ejecutable fetchea el tool.js (cap 1 MB) y verifica sha256 contra el
// declarado; fetchea /.well-known/agent-skills/attestations.json (cap 256 KB;
// ausente -> todas unattested) y verifica firmas Ed25519 (WebCrypto de Node)
// contra el registry de revisores; si el origin declara skills-memory, fetchea
// el snapshot (cap 4 MB) y verifica snapshot_sha256.
//
// Uso:
//   node scripts/validate-publisher.mjs <origin> [--mode off|advisory|enforcing] [--reviewers <ruta-json>]
//
// --mode enforcing (default): exit 0 SOLO si todas las skills tienen hash OK,
//   estan attested y el snapshot (si hay) verifica. Cualquier FAIL -> 1.
// --mode advisory: unattested/expired son warning (no afectan exit); hash mismatch,
//   firma invalida y snapshot mismatch siempre FAIL -> 1.
// --mode off: solo hashes y caps (no fetchea/verifica attestations). Snapshot sigue
//   verificandose (es un hash check, independiente del modo de atestacion).
//
// --reviewers <ruta>: JSON con el formato del REVIEWERS del gateway
//   ({attester: {public_key: <base64 raw 32>, registered_at: "YYYY-MM-DD"}}).
//   Si no se pasa, se extrae REVIEWERS de wrangler-gateway.toml local (literal TOML
//   de una linea: `REVIEWERS = '{...}'` -> match simple del contenido entre comillas
//   simples y JSON.parse). DEPENDENCIA: requiere wrangler-gateway.toml en el cwd si
//   no se pasa --reviewers.
//
// Node 22 puro: fetch + crypto.subtle nativos. Sin dependencias nuevas.

import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { parseLlmsTxt } from "../llmstxt-parse.mjs";

// Caps identicas a DEFAULT_SIZE_CAPS del gateway (T42).
const CAPS = {
  llms: 262144, // 256 KB
  tool: 1048576, // 1 MB
  attestations: 262144, // 256 KB
  snapshot: 4194304, // 4 MB
};
const FETCH_TIMEOUT_MS = 8000; // linter offline-local: un poco mas holgado que el gateway (5s)

class SizeLimitError extends Error {
  constructor(maxBytes) {
    super("body excede el cap de tamano (" + maxBytes + " bytes)");
    this.name = "SizeLimitError";
    this.maxBytes = maxBytes;
  }
}

// Fetch de texto con cap de tamano en dos niveles (espejo del fetchText del
// gateway): (a) precheck por Content-Length sin leer el body; (b) streaming
// defensivo acumulando hasta cap. Lanza SizeLimitError si excede.
async function fetchText(url, maxBytes) {
  const sep = url.includes("?") ? "&" : "?";
  const resp = await fetch(url + sep + "_gw=" + Date.now(), {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "follow",
  });
  const cl = resp.headers.get("content-length");
  if (cl !== null) {
    const cln = Number(cl);
    if (Number.isFinite(cln) && cln > maxBytes) {
      if (resp.body) {
        try { await resp.body.cancel(); } catch { /* best-effort */ }
      }
      throw new SizeLimitError(maxBytes);
    }
  }
  const body = resp.body;
  if (!body) return { status: resp.status, text: "" };
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let received = 0;
  const parts = [];
  let exceeded = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > maxBytes) {
        exceeded = true;
        break;
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    try { await reader.cancel(); } catch { /* best-effort */ }
  }
  if (exceeded) throw new SizeLimitError(maxBytes);
  parts.push(decoder.decode()); // flush
  return { status: resp.status, text: parts.join("") };
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function canonicalOrigin(s) {
  try {
    return new URL(s).origin;
  } catch {
    return null;
  }
}

function todayUtcStr() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Verifica firma Ed25519 de data contra pubB64 (raw 32 bytes base64). true/false.
async function verifyEd25519(pubB64, sigB64, data) {
  try {
    const pubRaw = Buffer.from(pubB64, "base64");
    const sig = Buffer.from(sigB64, "base64");
    const key = await crypto.subtle.importKey("raw", pubRaw, { name: "Ed25519" }, false, [
      "verify",
    ]);
    return await crypto.subtle.verify("Ed25519", key, sig, data);
  } catch {
    return false;
  }
}

// Veredicto por skill (espejo de verdictForSkill del gateway, INVALID DOMINA) +
// razon legible. Matching: mismo origin canonico + skill + tool_sha256.
// attester no registrado -> ignorado; registrado + firma falla -> invalid.
// firma valida en ventana -> attested; hoy>valid_until -> expired.
// Precedencia: invalid > attested > expired > unattested.
async function verdictForSkill(skill, canon, attestations, reviewers, today) {
  if (!attestations || attestations.length === 0) {
    return { verdict: "unattested", reason: "sin atestaciones publicadas" };
  }
  let hasInvalid = false;
  let hasValidInWindow = false;
  let hasExpired = false;
  let matched = 0;
  for (const a of attestations) {
    if (!a || typeof a !== "object") continue;
    if (a.skill !== skill.name) continue;
    if (typeof a.tool_sha256 !== "string" || a.tool_sha256 !== skill.sha256) continue;
    const aCanon = canonicalOrigin(a.origin);
    if (!aCanon || aCanon !== canon) continue; // otra origin: no replayable
    if (typeof a.attester !== "string" || typeof a.signature !== "string") continue;
    matched++;
    const reg = reviewers[a.attester];
    if (!reg || typeof reg.public_key !== "string") continue; // desconocido: ignorado
    const payload = new TextEncoder().encode(
      canon + "\n" + skill.name + "\n" + skill.sha256 + "\n" + a.signed_on + "\n" + a.valid_until
    );
    const ok = await verifyEd25519(reg.public_key, a.signature, payload);
    if (!ok) {
      hasInvalid = true; // firma que falla contra clave REGISTRADA -> invalid
      continue;
    }
    if (today > a.valid_until) {
      hasExpired = true;
      continue;
    }
    if (today >= a.signed_on && today <= a.valid_until) {
      hasValidInWindow = true;
    }
  }
  if (hasInvalid) return { verdict: "invalid", reason: "firma Ed25519 invalida contra revisor registrado" };
  if (hasValidInWindow) return { verdict: "attested", reason: "firma valida en ventana" };
  if (hasExpired) return { verdict: "expired", reason: "atestacion expirada (hoy > valid_until)" };
  if (matched === 0) return { verdict: "unattested", reason: "ninguna atestacion coincide (origin+skill+sha)" };
  return { verdict: "unattested", reason: "atestacion presente pero fuera de ventana" };
}

// --reviewers <ruta> o extrae REVIEWERS de wrangler-gateway.toml (literal TOML de
// una linea, comillas simples). DEPENDENCIA documentada arriba.
async function loadReviewers(reviewersPath) {
  let raw;
  if (reviewersPath) {
    raw = await readFile(reviewersPath, "utf8");
    try {
      const o = JSON.parse(raw);
      return o && typeof o === "object" ? o : {};
    } catch {
      throw new Error("--reviewers: JSON invalido en " + reviewersPath);
    }
  }
  const tomlPath = "wrangler-gateway.toml";
  if (!existsSync(tomlPath)) {
    throw new Error("sin --reviewers y no se encuentra wrangler-gateway.toml en el cwd");
  }
  const toml = readFileSync(tomlPath, "utf8");
  const m = toml.match(/^REVIEWERS\s*=\s*'(.*)'\s*$/m);
  if (!m) {
    throw new Error("no se encontro la linea REVIEWERS en wrangler-gateway.toml");
  }
  try {
    const o = JSON.parse(m[1]);
    return o && typeof o === "object" ? o : {};
  } catch {
    throw new Error("REVIEWERS de wrangler-gateway.toml no es JSON valido");
  }
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function rpad(s, n) {
  s = String(s);
  return s.length >= n ? s : " ".repeat(n - s.length) + s;
}

async function main() {
  const args = process.argv.slice(2);
  let originArg = null;
  let mode = "enforcing";
  let reviewersPath = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--mode") {
      mode = args[++i];
      if (mode !== "off" && mode !== "advisory" && mode !== "enforcing") {
        console.error("--mode debe ser off|advisory|enforcing");
        process.exit(2);
      }
    } else if (a === "--reviewers") {
      reviewersPath = args[++i];
      if (!reviewersPath) {
        console.error("--reviewers requiere una ruta");
        process.exit(2);
      }
    } else if (!originArg) {
      originArg = a;
    } else {
      console.error("argumento inesperado: " + a);
      process.exit(2);
    }
  }
  if (!originArg) {
    console.error("uso: node scripts/validate-publisher.mjs <origin> [--mode off|advisory|enforcing] [--reviewers <ruta>]");
    process.exit(2);
  }

  const canon = canonicalOrigin(originArg);
  if (!canon) {
    console.error("origin invalido: " + originArg);
    process.exit(2);
  }

  const reviewers = await loadReviewers(reviewersPath);
  const reviewersCount = Object.keys(reviewers).length;

  // 1) /llms.txt
  let llmsText;
  let llmsStatus = "ok";
  try {
    const r = await fetchText(canon + "/llms.txt", CAPS.llms);
    if (r.status !== 200) {
      console.error("origin: " + canon);
      console.error("NO OK: /llms.txt HTTP " + r.status);
      process.exit(1);
    }
    llmsText = r.text;
  } catch (e) {
    if (e && e.name === "SizeLimitError") llmsStatus = "cap-exceeded";
    console.error("origin: " + canon);
    console.error("NO OK: fetch /llms.txt fallo: " + String((e && e.message) || e));
    process.exit(1);
  }

  const { skills, memory } = parseLlmsTxt(llmsText);

  // 2) tool.js por skill (hash + cap 1 MB)
  const rows = [];
  for (const s of skills) {
    const toolUrl = new URL(s.toolPath, canon).href;
    let hashOk = false;
    let hashReason = "";
    let gotSha = null;
    try {
      const r = await fetchText(toolUrl, CAPS.tool);
      if (r.status !== 200) {
        hashReason = "tool.js HTTP " + r.status;
      } else {
        gotSha = await sha256Hex(r.text);
        if (gotSha === s.sha256) {
          hashOk = true;
          hashReason = "sha256 OK";
        } else {
          hashReason = "sha256 mismatch (declarado " + s.sha256.slice(0, 12) + "…, obtenido " + gotSha.slice(0, 12) + "…)";
        }
      }
    } catch (e) {
      if (e && e.name === "SizeLimitError") {
        hashReason = "tool.js excede cap 1 MB";
      } else {
        hashReason = "fetch tool.js fallo: " + String((e && e.message) || e);
      }
    }
    rows.push({
      name: s.name,
      toolPath: s.toolPath,
      hashOk,
      hashReason,
      gotSha,
      declaredSha: s.sha256,
      verdict: null,
      attestReason: null,
    });
  }

  // 3) attestations (si modo != off)
  let attestations = null;
  let attestFetchNote = null;
  if (mode !== "off") {
    const url = canon + "/.well-known/agent-skills/attestations.json";
    try {
      const r = await fetchText(url, CAPS.attestations);
      if (r.status === 404) {
        attestations = null;
        attestFetchNote = "ausente (404) -> todas unattested";
      } else if (r.status !== 200) {
        attestations = null;
        attestFetchNote = "HTTP " + r.status + " -> todas unattested";
      } else {
        try {
          const arr = JSON.parse(r.text);
          attestations = Array.isArray(arr) ? arr : null;
          if (!attestations) attestFetchNote = "JSON no-array -> todas unattested";
        } catch {
          attestations = null;
          attestFetchNote = "JSON invalido -> todas unattested";
        }
      }
    } catch (e) {
      attestations = null;
      if (e && e.name === "SizeLimitError") {
        attestFetchNote = "excede cap 256 KB -> todas unattested";
      } else {
        attestFetchNote = "fetch fallo -> todas unattested";
      }
    }
  }

  const today = todayUtcStr();
  for (const row of rows) {
    if (mode === "off") {
      row.verdict = "-";
      row.attestReason = "modo off";
    } else {
      const { verdict, reason } = await verdictForSkill(
        { name: row.name, sha256: row.declaredSha },
        canon,
        attestations,
        reviewers,
        today
      );
      row.verdict = verdict;
      row.attestReason = reason;
    }
  }

  // 4) snapshot (si hay linea skills-memory)
  let snapshotStatus = "none"; // none | ok | mismatch | fetch-fail | http-error | unsupported | cap-exceeded
  let snapshotReason = "";
  if (memory) {
    if (memory.unsupported) {
      snapshotStatus = "unsupported";
      snapshotReason = "format '" + memory.format + "' no soportado";
    } else {
      const snapUrl = new URL(memory.snapshot, canon).href;
      try {
        const r = await fetchText(snapUrl, CAPS.snapshot);
        if (r.status !== 200) {
          snapshotStatus = "http-error";
          snapshotReason = "snapshot HTTP " + r.status;
        } else {
          const h = await sha256Hex(r.text);
          if (h === memory.snapshot_sha256) {
            snapshotStatus = "ok";
            snapshotReason = "snapshot_sha256 OK";
          } else {
            snapshotStatus = "mismatch";
            snapshotReason = "snapshot_sha256 mismatch (declarado " + memory.snapshot_sha256.slice(0, 12) + "…, obtenido " + h.slice(0, 12) + "…)";
          }
        }
      } catch (e) {
        if (e && e.name === "SizeLimitError") {
          snapshotStatus = "cap-exceeded";
          snapshotReason = "snapshot excede cap 4 MB";
        } else {
          snapshotStatus = "fetch-fail";
          snapshotReason = "fetch snapshot fallo: " + String((e && e.message) || e);
        }
      }
    }
  }

  // 5) salida: tabla por skill + resumen
  const nameW = Math.max(5, ...rows.map((r) => r.name.length));
  const hashW = 6;
  const verdW = Math.max(11, ...rows.map((r) => String(r.verdict).length));
  const sep = "+-" + "-".repeat(nameW) + "-+-" + "-".repeat(hashW) + "-+-" + "-".repeat(verdW) + "-+---------------------------";
  console.log("origin: " + canon);
  console.log("mode:   " + mode + "  | revisores registrados: " + reviewersCount);
  if (mode !== "off" && attestFetchNote) {
    console.log("attestations: " + attestFetchNote);
  }
  console.log(sep);
  console.log("| " + pad("skill", nameW) + " | " + rpad("hash", hashW) + " | " + pad("attestation", verdW) + " | razon");
  console.log(sep);
  for (const row of rows) {
    const hashCol = row.hashOk ? "OK" : "FAIL";
    console.log("| " + pad(row.name, nameW) + " | " + rpad(hashCol, hashW) + " | " + pad(row.verdict, verdW) + " | " + row.hashReason + (mode !== "off" ? " | " + row.attestReason : ""));
  }
  console.log(sep);

  // snapshot line
  let snapshotLine;
  if (snapshotStatus === "none") {
    snapshotLine = "snapshot: ausente (sin linea skills-memory)";
  } else {
    const tag = snapshotStatus === "ok" ? "OK" : "FAIL";
    snapshotLine = "snapshot: " + tag + " (" + snapshotReason + ")";
  }
  console.log(snapshotLine);

  // resumen
  const hashOkCount = rows.filter((r) => r.hashOk).length;
  const hashFailCount = rows.length - hashOkCount;
  const counts = { attested: 0, expired: 0, invalid: 0, unattested: 0 };
  if (mode !== "off") {
    for (const r of rows) counts[r.verdict] = (counts[r.verdict] || 0) + 1;
  }
  console.log(
    "resumen: " + rows.length + " skills | hash " + hashOkCount + " OK / " + hashFailCount + " FAIL" +
    (mode !== "off"
      ? " | attestation " + counts.attested + " attested, " + counts.expired + " expired, " + counts.invalid + " invalid, " + counts.unattested + " unattested"
      : " | attestation -- (modo off)") +
    " | snapshot " + (snapshotStatus === "ok" ? "OK" : snapshotStatus === "none" ? "ausente" : "FAIL")
  );

  // exit code
  let exit = 0;
  const fails = [];
  for (const r of rows) {
    if (!r.hashOk) fails.push(r.name + ": hash FAIL (" + r.hashReason + ")");
  }
  if (mode === "off") {
    // solo hashes (y snapshot). snapshot mismatch cuenta.
  } else if (mode === "enforcing") {
    for (const r of rows) {
      if (r.verdict !== "attested") fails.push(r.name + ": attestation " + r.verdict + " (" + r.attestReason + ")");
    }
  } else if (mode === "advisory") {
    // unattested/expired son warning; invalid y hash mismatch SI fallan.
    for (const r of rows) {
      if (r.verdict === "invalid") fails.push(r.name + ": attestation invalid (" + r.attestReason + ")");
    }
  }
  if (snapshotStatus === "mismatch" || snapshotStatus === "fetch-fail" || snapshotStatus === "http-error" || snapshotStatus === "cap-exceeded") {
    fails.push("snapshot: " + snapshotReason);
  }
  if (fails.length > 0) exit = 1;

  if (exit === 1) {
    console.log("veredicto: FAIL");
    for (const f of fails) console.log("  - " + f);
  } else {
    console.log("veredicto: PASS");
  }
  process.exit(exit);
}

main().catch((e) => {
  console.error("error inesperado: " + String((e && e.message) || e));
  process.exit(1);
});