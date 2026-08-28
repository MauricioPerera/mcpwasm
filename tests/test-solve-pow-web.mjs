// tests/test-solve-pow-web.mjs — ORACULO del contrato solve-pow-web.
// Verifica el solver de PoW puro-JS (portable a navegador, SIN node:crypto)
// contra la referencia real de node:crypto — la misma prueba que ya validan
// los spikes (scripts/spike-ephemeral-cf.mjs) y los tests hermeticos.
// Uso: node tests/test-solve-pow-web.mjs
import { createHash } from "node:crypto";
import { solvePowWeb, sha256Web, encodeCheckpointsWeb } from "../web/solve-pow-web.mjs";

const CHECKS = [];
const check = (ok, label) => { CHECKS.push(ok); console.log(`  ${ok ? "ok" : "FALLO"}: ${label}`); };

// --- 1. sha256 puro-JS == node:crypto sobre vectores variados ---------------
const vectors = [
  "", "abc", "hola mundo", "x".repeat(63), "y".repeat(64), "z".repeat(65),
  JSON.stringify({ seed: "challenge-token", k: 1000, g: 2000 }),
];
for (const v of vectors) {
  const expected = createHash("sha256").update(v).digest();
  const got = sha256Web(v);
  check(Buffer.compare(Buffer.from(got), expected) === 0, `sha256Web(${JSON.stringify(v.slice(0, 24))}${v.length > 24 ? "..." : ""}) == node:crypto`);
}

// --- 2. la cadena: k+1 checkpoints, g pasos entre cada uno ------------------
const { seed, k, g } = { seed: "unit-seed-2026", k: 5, g: 3 };
const cps = solvePowWeb(seed, k, g);
check(Array.isArray(cps) && cps.length === k + 1, `solvePowWeb devuelve ${k + 1} checkpoints (${cps.length})`);

// referencia con node:crypto: la misma cadena, mismos checkpoints
let h = createHash("sha256").update(seed).digest();
const ref = [h];
for (let j = 0; j < k; j++) {
  for (let i = 0; i < g; i++) h = createHash("sha256").update(h).digest();
  ref.push(h);
}
let allMatch = true;
for (let i = 0; i <= k; i++) {
  if (Buffer.compare(Buffer.from(cps[i]), ref[i]) !== 0) { allMatch = false; break; }
}
check(allMatch, "cada checkpoint == cadena sha256 de node:crypto (seed, k=g pasos)");

// --- 3. determinismo y seed distinta -> cadena distinta --------------------
const cps2 = solvePowWeb(seed, k, g);
check(Buffer.compare(Buffer.from(cps[3]), Buffer.from(cps2[3])) === 0, "determinista: misma seed -> mismos checkpoints");
const cps3 = solvePowWeb("otra-seed", k, g);
check(Buffer.compare(Buffer.from(cps[3]), Buffer.from(cps3[3])) !== 0, "seed distinta -> cadena distinta");

// --- 4. encode base64 concatenado (formato del provisioning) ---------------
const b64 = encodeCheckpointsWeb(cps);
const expectB64 = Buffer.concat(ref).toString("base64");
check(b64 === expectB64, "encodeCheckpointsWeb == base64 de la concatenacion (formato challenge de CF)");

// --- 5. presupuesto: k=2, g=3 corre sin error (forma) ----------------------
const tiny = solvePowWeb("tiny", 2, 3);
check(tiny.length === 3, "k=2 -> 3 checkpoints");

const ok = CHECKS.every(Boolean);
console.log(`ORACULO solve-pow-web: ${ok ? "PASS" : "FALLO"} (${CHECKS.filter(Boolean).length}/${CHECKS.length})`);
process.exit(ok ? 0 : 1);