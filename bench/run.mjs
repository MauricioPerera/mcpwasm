// bench/run.mjs — Benchmark reproducible del sistema mcpwasm desplegado.
// Node puro, fetch global, sin dependencias. Mide wall-clock por request
// (performance.now), captura status y X-Gw-Discovery cuando exista, calcula
// min/p50/p95/p99/max por escenario y separa warm (hit) vs cold (miss).
// Salida: tabla a stdout + bench/results.json con datos crudos.
//
// Uso:  node bench/run.mjs            (corre la matriz completa, run "auto")
//       node bench/run.mjs --run=2    (etiqueta la corrida)
//
// El token del gateway se lee de ./.gateway-token en runtime; NUNCA se imprime
// ni se escribe a results.json.

import fs from 'node:fs';
import path from 'node:path';

// ---------- config ----------
const TOKEN_PATH = path.resolve('.gateway-token');
const GW = 'https://llmstxt-gateway.rckflr.workers.dev/mcp';
const GW_ROOT = 'https://llmstxt-gateway.rckflr.workers.dev/mcp';
const POC = 'https://toolhost-mcp.rckflr.workers.dev/mcp';
const DEMO = 'https://llmstxt-demo-site.rckflr.workers.dev';
const BOOK = 'https://llmstxt-bookstore.rckflr.workers.dev';
const BOOK_ROOT = 'https://llmstxt-bookstore.rckflr.workers.dev/';
const STOCK_API = 'https://llmstxt-bookstore.rckflr.workers.dev/api/stock-report';

// book_id 7 "Second Foundation" tiene stock 0 -> create_order da 409 controlado (no muta).
const WRITE_409_BOOK_ID = 7;
// book_id 8 "I, Robot" stock alto (25) -> create_order real (muta D1).
const WRITE_REAL_BOOK_ID = 8;

const TOKEN = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
const AUTH = 'Bearer ' + TOKEN;

// ---------- helpers ----------
function pct(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}
function stats(arr) {
  const s = arr.slice().sort((a, b) => a - b);
  if (s.length === 0) return { n: 0, min: null, p50: null, p95: null, p99: null, max: null, mean: null };
  const mean = Math.round(s.reduce((x, y) => x + y, 0) / s.length);
  return { n: s.length, min: s[0], p50: pct(s, 0.5), p95: pct(s, 0.95), p99: pct(s, 0.99), max: s[s.length - 1], mean };
}
function gwUrl(origin) { return GW + '?origin=' + encodeURIComponent(origin); }
function nowISO() { return new Date().toISOString(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Una request POST JSON-RPC contra el gateway (con auth).
async function gwRpc(origin, method, params) {
  const url = gwUrl(origin);
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
  const t0 = performance.now();
  let r, err = null;
  try {
    r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: AUTH }, body });
  } catch (e) { err = String(e && e.message || e); return { ms: null, status: null, disc: 'ERR', ok: false, err, body: null }; }
  const ms = Math.round(performance.now() - t0);
  const disc = r.headers.get('x-gw-discovery') || '(none)';
  const status = r.status;
  const text = await r.text();
  let parsed = null, isError = null, orderId = null;
  try {
    parsed = JSON.parse(text);
    isError = parsed?.result?.isError ?? null;
    // captura orderId de create_order real
    if (parsed?.result?.structuredContent) {
      const sc = parsed.result.structuredContent;
      if (sc.order_id != null) orderId = sc.order_id;
      if (sc.orderId != null) orderId = sc.orderId;
      if (sc.id != null && method === 'tools/call') orderId = sc.id;
    }
  } catch { /* body no json */ }
  return { ms, status, disc, ok: status >= 200 && status < 300 && !err, err, body: text.slice(0, 500), isError, orderId };
}

// POST JSON-RPC contra la PoC (sin auth).
async function pocRpc(method, params) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
  const t0 = performance.now();
  let r, err = null;
  try {
    r = await fetch(POC, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  } catch (e) { err = String(e && e.message || e); return { ms: null, status: null, disc: 'ERR', ok: false, err, body: null }; }
  const ms = Math.round(performance.now() - t0);
  const status = r.status;
  const text = await r.text();
  return { ms, status, disc: '(n/a)', ok: status >= 200 && status < 300 && !err, err, body: text.slice(0, 500) };
}

// GET directo (baseline bookstore API o ping de worker).
async function directGet(url) {
  const t0 = performance.now();
  let r, err = null;
  try { r = await fetch(url, { method: 'GET' }); }
  catch (e) { err = String(e && e.message || e); return { ms: null, status: null, disc: 'ERR', ok: false, err, body: null }; }
  const ms = Math.round(performance.now() - t0);
  const status = r.status;
  const text = await r.text();
  // Para GET directo el "ok" es roundtrip exitoso (respuesta HTTP recibida);
  // el 404 del ping al bookstore root es el resultado esperado, no un error.
  return { ms, status, disc: '(n/a)', ok: !err && ms != null, err, body: text.slice(0, 200) };
}

// ---------- escenarios ----------
// Cada escenario: { key, label, N, warmup, kind:'seq'|'concurrent'|'cold', fn, origin?, sleepBefore? }
// kind:'cold' = duerme sleepBefore segundos (>60s TTL del cache de descubrimiento)
// antes de 1 request medido, para forzar un miss determinista y medir el costo
// del descubrimiento (fetch llms.txt + sha256 + compile) aislado del warm.
const SCENARIOS = [
  { key: 'a-baseline-direct', label: 'a baseline-direct (GET /api/stock-report, sin gateway)', N: 30, warmup: 1, kind: 'seq', fn: () => directGet(STOCK_API) },
  { key: 'b-poc-sandbox', label: 'b poc-sandbox (create_payment, sandbox sync, sin auth)', N: 30, warmup: 1, kind: 'seq', fn: () => pocRpc('tools/call', { name: 'create_payment', arguments: { amount: 10, currency: 'USD' } }) },
  // cold probes: un sleep 65s cubre c-cold (demo) y d-cold (bookstore), ambos caches expirados.
  { key: 'c-cold', label: 'c-cold (demo sum_numbers, miss forzado tras 65s)', N: 1, warmup: 0, kind: 'cold', sleepBefore: 65, origin: DEMO, fn: () => gwRpc(DEMO, 'tools/call', { name: 'sum_numbers', arguments: { a: 3, b: 4 } }) },
  { key: 'd-cold', label: 'd-cold (bookstore stock_report, miss forzado)', N: 1, warmup: 0, kind: 'cold', sleepBefore: 0, origin: BOOK, fn: () => gwRpc(BOOK, 'tools/call', { name: 'stock_report', arguments: {} }) },
  { key: 'c-gw-pure', label: 'c gw-pure (demo sum_numbers, sandbox+descubrimiento warm)', N: 30, warmup: 1, kind: 'seq', origin: DEMO, fn: () => gwRpc(DEMO, 'tools/call', { name: 'sum_numbers', arguments: { a: 3, b: 4 } }) },
  { key: 'd-gw-read', label: 'd gw-read (bookstore stock_report, +fetchOrigin GET +D1 warm)', N: 30, warmup: 1, kind: 'seq', origin: BOOK, fn: () => gwRpc(BOOK, 'tools/call', { name: 'stock_report', arguments: {} }) },
  { key: 'e-gw-search', label: 'e gw-search (search_catalog genre=sci-fi max_price=15)', N: 30, warmup: 1, kind: 'seq', origin: BOOK, fn: () => gwRpc(BOOK, 'tools/call', { name: 'search_catalog', arguments: { genre: 'science-fiction', max_price: 15 } }) },
  { key: 'f-gw-write-409', label: 'f gw-write-409 (create_order book_id=7 stock 0, 409 controlado)', N: 30, warmup: 1, kind: 'seq', origin: BOOK, fn: () => gwRpc(BOOK, 'tools/call', { name: 'create_order', arguments: { book_id: WRITE_409_BOOK_ID, qty: 1 } }) },
  { key: 'g-gw-write-real', label: 'g gw-write-real (create_order book_id=8 qty=1, MUTA D1)', N: 3, warmup: 0, kind: 'seq', origin: BOOK, fn: () => gwRpc(BOOK, 'tools/call', { name: 'create_order', arguments: { book_id: WRITE_REAL_BOOK_ID, qty: 1 } }) },
  { key: 'h-gw-interrupt', label: 'h gw-interrupt (busy_loop hasta corte del gas)', N: 3, warmup: 0, kind: 'seq', origin: BOOK, fn: () => gwRpc(BOOK, 'tools/call', { name: 'busy_loop', arguments: {} }) },
  { key: 'i-gw-tools-list', label: 'i gw-tools-list (tools/list bookstore warm)', N: 20, warmup: 1, kind: 'seq', origin: BOOK, fn: () => gwRpc(BOOK, 'tools/list', {}) },
  // i-cold necesita su propio sleep 65s: bookstore se caldeo con d/e/f/i previas.
  { key: 'i-cold', label: 'i-cold (bookstore tools/list, miss forzado tras 65s)', N: 1, warmup: 0, kind: 'cold', sleepBefore: 65, origin: BOOK, fn: () => gwRpc(BOOK, 'tools/list', {}) },
  { key: 'j-gw-concurrent', label: 'j gw-concurrent (10x stock_report en paralelo x3 rondas)', N: 30, warmup: 0, kind: 'concurrent', origin: BOOK, fn: () => gwRpc(BOOK, 'tools/call', { name: 'stock_report', arguments: {} }) },
  // extras: ping de worker crudo (sin procesado MCP) para aislar overhead de sandbox.
  { key: 'x-gw-ping', label: 'x gw-ping (GET gateway root, roundtrip worker crudo)', N: 30, warmup: 1, kind: 'seq', fn: () => directGet(GW_ROOT) },
  { key: 'x-book-ping', label: 'x book-ping (GET bookstore root 404, roundtrip worker crudo)', N: 30, warmup: 1, kind: 'seq', fn: () => directGet(BOOK_ROOT) },
];

// ---------- runner ----------
async function runSequential(sc) {
  const samples = [];
  for (let i = 0; i < sc.warmup; i++) {
    try { await sc.fn(); } catch (e) { /* warmup fallo: ignorado */ }
  }
  for (let i = 0; i < sc.N; i++) {
    const s = await sc.fn();
    s.i = i + 1;
    samples.push(s);
    const tag = s.ms == null ? 'ERR' : String(s.ms).padStart(6) + 'ms';
    console.log(`  ${sc.key} #${String(i + 1).padStart(2)} ${tag}  status=${s.status}  disc=${s.disc}${s.isError != null ? ' isError=' + s.isError : ''}${s.orderId != null ? ' order=' + s.orderId : ''}${s.err ? ' err=' + s.err : ''}`);
  }
  return samples;
}

async function runCold(sc) {
  if (sc.sleepBefore > 0) {
    console.log(`  ${sc.key}: durmiendo ${sc.sleepBefore}s para expirar el cache de descubrimiento (TTL 60s)...`);
    await sleep(sc.sleepBefore * 1000);
  }
  const samples = [];
  for (let i = 0; i < sc.N; i++) {
    const s = await sc.fn();
    s.i = i + 1;
    samples.push(s);
    const tag = s.ms == null ? 'ERR' : String(s.ms).padStart(6) + 'ms';
    console.log(`  ${sc.key} #${i + 1} ${tag}  status=${s.status}  disc=${s.disc}${s.isError != null ? ' isError=' + s.isError : ''}${s.err ? ' err=' + s.err : ''}`);
  }
  return samples;
}

async function runConcurrent(sc) {
  // 3 rondas de 10 requests en paralelo (Promise.all).
  const ROUNDS = 3, PER = 10;
  const samples = [];
  for (let round = 1; round <= ROUNDS; round++) {
    const t0 = performance.now();
    const res = await Promise.all(Array.from({ length: PER }, (_, k) => sc.fn().then(s => { s.round = round; s.k = k + 1; return s; })));
    const wall = Math.round(performance.now() - t0);
    const misses = res.filter(s => s.disc === 'miss').length;
    const errs = res.filter(s => s.ok === false || s.ms == null).length;
    console.log(`  ${sc.key} round ${round}: wall=${wall}ms  miss=${misses}/${PER}  err=${errs}/${PER}`);
    for (const s of res) {
      samples.push(s);
      const tag = s.ms == null ? 'ERR' : String(s.ms).padStart(6) + 'ms';
      console.log(`    r${round} #${String(s.k).padStart(2)} ${tag}  status=${s.status}  disc=${s.disc}${s.err ? ' err=' + s.err : ''}`);
    }
  }
  return samples;
}

function summarize(sc, samples) {
  const valid = samples.filter(s => typeof s.ms === 'number');
  const all = stats(valid.map(s => s.ms));
  // split hit/miss solo si hay disc relevante
  const hasDisc = valid.some(s => s.disc === 'hit' || s.disc === 'miss');
  let warm = null, cold = null;
  if (hasDisc) {
    warm = stats(valid.filter(s => s.disc === 'hit').map(s => s.ms));
    cold = stats(valid.filter(s => s.disc === 'miss').map(s => s.ms));
  }
  const errs = samples.filter(s => s.ok === false || s.ms == null).length;
  const orderIds = valid.map(s => s.orderId).filter(x => x != null);
  return { key: sc.key, label: sc.label, N: sc.N, all, warm, cold, errs, misses: valid.filter(s => s.disc === 'miss').length, hits: valid.filter(s => s.disc === 'hit').length, orderIds };
}

function printSummaryRow(s) {
  const a = s.all;
  const row = (z) => z && z.n ? `n=${z.n} min=${z.min} p50=${z.p50} p95=${z.p95} p99=${z.p99} max=${z.max}` : 'n=0';
  console.log(`  ${s.key.padEnd(20)} ALL[${row(a)}] errs=${s.errs}`);
  if (s.warm || s.cold) {
    console.log(`    ${' '.padEnd(20)} warm(hit)[${row(s.warm)}]`);
    console.log(`    ${' '.padEnd(20)} cold(miss)[${row(s.cold)}]`);
  }
  if (s.orderIds.length) console.log(`    orders creadas: ${JSON.stringify(s.orderIds)}`);
}

// ---------- main ----------
async function main() {
  const argRun = process.argv.find(a => a.startsWith('--run='));
  const runLabel = argRun ? argRun.split('=')[1] : 'auto';
  const startedAt = nowISO();
  console.log(`\n=== BENCHMARK mcpwasm — run=${runLabel} inicio=${startedAt} ===`);
  console.log(`gateway=${GW}\n`);

  const results = { runLabel, startedAt, gateway: GW, poc: POC, scenarios: [] };

  for (const sc of SCENARIOS) {
    console.log(`\n--- ${sc.label} (N=${sc.N}, warmup=${sc.warmup}, kind=${sc.kind}${sc.sleepBefore ? ', sleepBefore=' + sc.sleepBefore + 's' : ''}) ---`);
    const t0 = performance.now();
    let samples;
    if (sc.kind === 'concurrent') samples = await runConcurrent(sc);
    else if (sc.kind === 'cold') samples = await runCold(sc);
    else samples = await runSequential(sc);
    const wall = Math.round(performance.now() - t0);
    const sum = summarize(sc, samples);
    sum.wallMs = wall;
    results.scenarios.push({ ...sum, raw: samples.map(s => ({ i: s.i ?? s.k, round: s.round, ms: s.ms, status: s.status, disc: s.disc, ok: s.ok, isError: s.isError, orderId: s.orderId, err: s.err || null })) });
    printSummaryRow(sum);
    console.log(`  wall escenario: ${wall}ms`);
  }

  results.finishedAt = nowISO();
  fs.writeFileSync(path.resolve('bench/results.json'), JSON.stringify(results, null, 2));
  console.log(`\n=== fin run=${runLabel} a las ${results.finishedAt} — bench/results.json escrito ===`);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });