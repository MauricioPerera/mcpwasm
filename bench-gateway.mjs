// bench-gateway.mjs — 20 POST tools/call stock_report secuenciales contra produccion.
// Captura time_total (ms) y X-Gw-Discovery de cada uno; calcula p50/p95 separando
// miss vs hit. El cache de descubrimiento del isolate tiene TTL 60s; el primer
// request de cada isolate es "miss" y los siguientes (mismo isolate, <60s) son "hit".
const GW = 'https://llmstxt-gateway.rckflr.workers.dev/mcp';
const ORIGIN = 'https://llmstxt-bookstore.rckflr.workers.dev';
const N = 20;
const BODY = JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'tools/call',
  params: { name: 'stock_report', arguments: {} },
});

function pct(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

(async () => {
  const samples = [];
  for (let i = 0; i < N; i++) {
    const url = GW + '?origin=' + encodeURIComponent(ORIGIN);
    const t0 = performance.now();
    let r;
    try {
      r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: BODY });
    } catch (e) {
      samples.push({ i, ms: null, disc: 'ERR', err: String(e && e.message || e) });
      console.log(`#${i + 1} ERR ${String(e && e.message || e)}`);
      continue;
    }
    const ms = Math.round(performance.now() - t0);
    const disc = r.headers.get('x-gw-discovery') || '(none)';
    const status = r.status;
    samples.push({ i: i + 1, ms, disc, status });
    console.log(`#${String(i + 1).padStart(2)} ${String(ms).padStart(6)}ms  status=${status}  x-gw-discovery=${disc}`);
  }

  const valid = samples.filter(s => typeof s.ms === 'number');
  const misses = valid.filter(s => s.disc === 'miss').map(s => s.ms).sort((a, b) => a - b);
  const hits = valid.filter(s => s.disc === 'hit').map(s => s.ms).sort((a, b) => a - b);

  console.log('\n================ LATECY TABLE ================');
  console.log(`Total requests: ${N}`);
  console.log(`miss (cold discovery): n=${misses.length}` + (misses.length ? `  min=${misses[0]}  p50=${pct(misses, 0.5)}  p95=${pct(misses, 0.95)}  max=${misses[misses.length - 1]}` : ''));
  console.log(`hit  (warm cache):     n=${hits.length}` + (hits.length ? `  min=${hits[0]}  p50=${pct(hits, 0.5)}  p95=${pct(hits, 0.95)}  max=${hits[hits.length - 1]}` : ''));
  const all = valid.map(s => s.ms).sort((a, b) => a - b);
  console.log(`ALL:                   n=${all.length}  min=${all[0]}  p50=${pct(all, 0.5)}  p95=${pct(all, 0.95)}  max=${all[all.length - 1]}`);
  console.log('===========================================');
})().catch(e => { console.error('FATAL', e); process.exit(1); });