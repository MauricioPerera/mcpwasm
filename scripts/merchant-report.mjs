// merchant-report.mjs — dashboard comercial EN VIVO de las plataformas BYOA.
// Uso: node scripts/merchant-report.mjs
// Tokens: env SHOP_ADMIN_TOKEN o %TEMP%\shop-admin-token.txt.
// Muestra: ordenes, licencias vendidas (revenue simulado) y veredicto del gateway.
import { readFileSync } from "node:fs";

const SHOP = "https://llmstxt-shop.rckflr.workers.dev";
const STUDIO = "https://llmstxt-studio.rckflr.workers.dev";
const GATEWAY = "https://llmstxt-gateway.rckflr.workers.dev";

function adminToken() {
  if (process.env.SHOP_ADMIN_TOKEN) return process.env.SHOP_ADMIN_TOKEN;
  try { return readFileSync(process.env.TEMP + "\\shop-admin-token.txt", "utf8").trim(); } catch { return null; }
}

const token = adminToken();
if (!token) {
  console.error("sin ADMIN_TOKEN: exporta SHOP_ADMIN_TOKEN o crea %TEMP%\\shop-admin-token.txt");
  process.exit(1);
}
const auth = { Authorization: "Bearer " + token };

let fail = 0;
const line = (s) => console.log(s);

// --- tienda ------------------------------------------------------------------
const orders = await fetch(SHOP + "/api/orders?limit=10", { headers: { Authorization: "Bearer " + token } }).then((r) => (r.ok ? r.json() : { orders: [] }));
const paid = (orders.orders || []).filter((o) => o.status === "paid");
console.log("== llmstxt-shop (mercado) ==");
console.log(`ordenes: ${orders.count ?? 0} | pagadas: ${(orders.orders || []).filter((o) => o.status === "paid").length}`);
for (const o of (orders.orders || []).slice(0, 5)) {
  console.log(`  #${o.order_id} ${o.sku} x${o.qty} $${o.total} [${o.status}] ${o.client_order_id ? "(" + String(o.client_order_id).slice(0, 24) + "...)" : ""}`);
}
try {
  const lic = await fetch(SHOP + "/api/licenses", { headers: { Authorization: "Bearer " + token } }).then((r) => r.json());
  console.log(`licencias de creador: ${lic.count ?? 0} | activas: ${lic.active} | revenue simulado: $${lic.revenue?.toFixed ? lic.revenue.toFixed(2) : lic.revenue} | usos restantes: ${lic.uses_left}`);
  for (const l of (lic.licenses || []).slice(0, 5)) {
    console.log(`  [${l.status}] ${l.email} — $${l.price} | usos ${l.uses_left}/${l.uses_total} | vence ${String(l.expires_at).slice(0, 10)} | token ...${l.token.slice(-8)}`);
  }
} catch {
  console.log("  (licencias: endpoint no disponible en este deploy)");
}

// --- gateway (veredicto enforcing) ---------------------------------------------
console.log("\n== gateway (enforcing) ==");
try {
  const gw = await fetch("https://llmstxt-gateway.rckflr.workers.dev/mcp?origin=" + encodeURIComponent(SHOP), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  console.log("shop via gateway:", gw.status === 200 ? "aceptado" : "HTTP " + gw.status + " (CLIENTS mode: se necesita token de cliente)");
} catch (e) {
  console.log("gateway no consultable:", e.message);
}