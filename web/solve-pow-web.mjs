// solve-pow-web.mjs — PoW de cuentas temporales de Cloudflare, puro JS portable
// a navegador (sin node:crypto, sin deps). La consola del studio resuelve el
// challenge de provisioning EN LA PESTANA.
//
// CONTRATO: knowledge/contracts/solve-pow-web.md
// Oraculo:  tests/test-solve-pow-web.mjs (comparado contra node:crypto; sellado).
//
// La implementacion sha256/cadena es la MISMA de worker-ephemeral.mjs (verificada
// alli contra node:crypto y en produccion contra la API de Cloudflare), portada
// literal. La unica diferencia: la entrada es string -> bytes con TextEncoder
// (estandar en Node y navegadores), y btoa se implementa localmente para no
// depender del DOM (Node no lo trae hasta v16+ global... si existe, se usa).
// ---------------------------------------------------------------------------

const H0 = [];
const K = [];
{
  const isPrime = (n) => {
    for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;
    return true;
  };
  const frac32 = (x) => Math.floor((x - Math.floor(x)) * 0x100000000);
  let count = 0;
  for (let p = 2; count < 64; p++) {
    if (!isPrime(p)) continue;
    const s = Math.sqrt(p), c = Math.cbrt(p);
    if (count < 8) H0.push(frac32(s) | 0);
    K.push(frac32(c) | 0);
    count++;
  }
}
const rotr = (x, n) => (x >>> n) | (x << (32 - n));

function sha256(msg) {
  const len = msg.length;
  const bitLen = len * 8;
  const withPad = new Uint8Array((((len + 8) >> 6) + 1) << 6);
  withPad.set(msg);
  withPad[len] = 0x80;
  const dv = new DataView(withPad.buffer);
  dv.setUint32(withPad.length - 4, bitLen >>> 0);
  dv.setUint32(withPad.length - 8, Math.floor(bitLen / 0x100000000));
  const w = new Int32Array(64);
  let h0 = H0[0], h1 = H0[1], h2 = H0[2], h3 = H0[3],
    h4 = H0[4], h5 = H0[5], h6 = H0[6], h7 = H0[7];
  for (let off = 0; off < withPad.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((x, i) => odv.setUint32(i * 4, x >>> 0));
  return out;
}

// Identico a solvePow de wrangler: checkpoints[j] = sha256^g aplicado (j*g) veces.
function solvePow(seedBytes, k, g) {
  const checkpoints = new Array(k + 1);
  let h = sha256(seedBytes);
  checkpoints[0] = h;
  for (let j = 0; j < k; j++) {
    for (let i = 0; i < g; i++) h = sha256(h);
    checkpoints[j + 1] = h;
  }
  return checkpoints;
}
function encodeCheckpoints(checkpoints) {
  let bin = "";
  for (const cp of checkpoints) bin += String.fromCharCode(...cp);
  return btoa(bin);
}

// --- wrappers del contrato (entrada string, salida portable) ---------------
const te = new TextEncoder();

export function sha256Web(msg) {
  return sha256(te.encode(msg));
}

// checkpoints[j] = sha256^g aplicado (j*g) veces, empezando en sha256(seed).
// Identico a solvePow de wrangler y de worker-ephemeral.mjs.
function solvePowWebInner(seedBytes, k, g) {
  const checkpoints = new Array(k + 1);
  let h = sha256(seedBytes);
  checkpoints[0] = h;
  for (let j = 0; j < k; j++) {
    for (let i = 0; i < g; i++) h = sha256(h);
    checkpoints[j + 1] = h;
  }
  return checkpoints;
}

export function solvePowWeb(seed, k, g) {
  if (typeof seed !== "string" || seed.length === 0) throw new TypeError("seed requerida");
  if (!Number.isInteger(k) || k < 0) throw new TypeError("k debe ser entero >= 0");
  if (!Number.isInteger(g) || g < 0) throw new TypeError("g debe ser entero >= 0");
  return solvePowWebInner(te.encode(seed), k, g);
}

// variante byte-level: la seed del challenge de CF es base64url DE CODIFICADA
// a bytes (no un string UTF-8) — el chain debe correr sobre los bytes crudos.
export function solvePowBytes(seedBytes, k, g) {
  if (!(seedBytes instanceof Uint8Array)) throw new TypeError("seedBytes debe ser Uint8Array");
  if (!Number.isInteger(k) || k < 0) throw new TypeError("k debe ser entero >= 0");
  if (!Number.isInteger(g) || g < 0) throw new TypeError("g debe ser entero >= 0");
  return solvePowWebInner(seedBytes, k, g);
}

export function encodeCheckpointsWeb(checkpoints) {
  let bin = "";
  for (const cp of checkpoints) bin += String.fromCharCode(...cp);
  return btoaPolyfill(bin);
}

// btoa no existe en Node < 16 y no es lo unico: este polyfill es puro JS.
function btoaPolyfill(bin) {
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bin.length; i += 3) {
    const b0 = bin.charCodeAt(i), b1 = bin.charCodeAt(i + 1), b2 = bin.charCodeAt(i + 2);
    const has1 = i + 1 < bin.length, has2 = i + 2 < bin.length;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (has1 ? b1 >> 4 : 0)];
    out += has1 ? B64[((b1 & 15) << 2) | (has2 ? b2 >> 6 : 0)] : "=";
    out += has2 ? B64[b2 & 63] : "=";
  }
  return out;
}
