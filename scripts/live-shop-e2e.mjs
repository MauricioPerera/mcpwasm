// scripts/live-shop-e2e.mjs — E2E EN VIVO de llmstxt-shop: el runtime local real
// contra https://llmstxt-shop.rckflr.workers.dev (D1 real). Flujo de compra BYOA:
// discovery -> search_catalog -> get_product -> (el humano aprueba) -> create_order
// con client_order_id -> reintento idempotente -> order_status. Limpia dejando la
// orden (queda como registro real del e2e).
import { spawn } from "node:child_process";

const ORIGIN = "https://llmstxt-shop.rckflr.workers.dev";
const CHECKS = [];
const check = (ok, label) => { CHECKS.push(ok); console.log(`  ${ok ? "ok" : "FALLO"}: ${label}`); };

function rpc(proc, id, method, params, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    const timer = setTimeout(() => reject(new Error("timeout " + method)), timeoutMs);
    let buf = "";
    const onLine = (line) => {
      try { const obj = JSON.parse(line); if (obj.id === id) { clearTimeout(timer); resolve(obj); } } catch {}
    };
    proc.stdout.on("data", (d) => { buf += d; const lines = buf.split("\n"); buf = lines.pop(); lines.forEach(onLine); });
    proc.stdin.write(msg);
  });
}
const unwrap = (call) => call.result?.structuredContent?.result ?? call.result?.structuredContent ?? {};

const proc = spawn(process.execPath, ["bin/mcpwasm-local.mjs", ORIGIN], { stdio: ["pipe", "pipe", "pipe"] });
let errTxt = "";
proc.stderr.on("data", (d) => { errTxt += d; });

try {
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("runtime no listo: " + errTxt.slice(-300))), 90000);
    proc.stderr.on("data", (d) => { if (String(d).includes("listo:")) { clearTimeout(t); resolve(); } });
  });
  console.log("[live-shop] runtime listo contra " + ORIGIN);
  check(errTxt.includes("4 skill(s) verificadas"), "4 skills verificadas contra el origin real (hashes)");

  await rpc(proc, 1, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "shop-live", version: "1.0.0" } });
  const list = await rpc(proc, 2, "tools/list", {});
  const names = (list.result?.tools ?? []).map((t) => t.name);
  check(["search_catalog", "get_product", "create_order", "order_status"].every((n) => names.includes(n)), `tools/list: ${names.join(", ")}`);

  console.log("[live-shop] busqueda de catalogo");
  const search = unwrap(await rpc(proc, 3, "tools/call", { name: "search_catalog", arguments: { category: "hardware", max_price: 50 } }));
  check(Array.isArray(search) && search.length >= 1 && search.every((p) => p.category === "hardware"), `hardware <= $50: ${search.map((p) => p.sku).join(", ")}`);

  const product = unwrap(await rpc(proc, 3 + 0.5, "tools/call", { name: "get_product", arguments: { sku: "d1-coaster" } }));
  check(product.found === true && product.stock > 0, `get_product d1-coaster -> stock ${product.stock}`);

  console.log("[live-shop] compra con aprobacion implicita (e2e de prueba)");
  const coid = "live-e2e-" + Date.now();
  const order = unwrap(await rpc(proc, 4, "tools/call", {
    name: "create_order",
    arguments: { sku: "d1-coaster", qty: 1, email: "live-e2e@rckflr.dev", client_order_id: coid },
  }));
  check(order.ok === true && order.remaining_stock === product.stock - 1, `create_order -> order_id=${order.order_id}, total $${order.total}, stock ${order.remaining_stock}`);

  console.log("[live-shop] reintento idempotente (mismo client_order_id)");
  const retry = unwrap(await rpc(proc, 5, "tools/call", {
    name: "create_order",
    arguments: { sku: "d1-coaster", qty: 1, email: "live-e2e@rckflr.dev", client_order_id: coid },
  }));
  check(retry.idempotent === true && retry.order_id === order.order_id, `reintento -> MISMA orden ${retry.order_id} (sin duplicado)`);

  const status = unwrap(await rpc(proc, 6, "tools/call", { name: "order_status", arguments: { order_id: order.order_id } }));
  check(status.found === true && status.order.status === "confirmed", "order_status -> confirmed");

  // stock en vivo decrementado
  const after = unwrap(await rpc(proc, 7, "tools/call", { name: "get_product", arguments: { sku: "d1-coaster" } }));
  check(after.stock === product.stock - 1, "stock en vivo decrementado");
  console.log(`  [live-shop] orden real registrada: ${order.order_id} (${coid})`);
} finally {
  proc.kill();
}

const ok = CHECKS.every(Boolean);
console.log(`LIVE SHOP E2E: ${ok ? "PASS" : "FALLO"} (${CHECKS.filter(Boolean).length}/${CHECKS.length})`);
process.exit(ok ? 0 : 1);