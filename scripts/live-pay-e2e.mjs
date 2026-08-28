// live-pay-e2e.mjs — flujo paylink EN VIVO contra el worker desplegado:
// crear orden -> payment_url -> GET pagina -> POST /api/pay -> estado paid.
const ORIGIN = "https://llmstxt-shop.rckflr.workers.dev";
const coid = "live-pay-" + Date.now();

const create = await fetch(ORIGIN + "/api/orders", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ sku: "byoa-tee", qty: 1, email: "paylink-demo@example.com", client_order_id: coid }),
});
const order = await create.json();
console.log("orden live:", order.order_id, "total", order.total, "| payment_url:", order.payment_url);
if (!order.payment_url) { console.error("SIN payment_url"); process.exit(1); }

const page = await fetch(ORIGIN + order.payment_url);
const html = await page.text();
console.log("paylink page:", page.status, page.headers.get("content-type"), "| tiene boton:", html.includes("Pagar"), "| etiqueta simulacion:", html.includes("SIMULACION"));

const pt = order.payment_url.split("pt=")[1];
const wrong = await fetch(ORIGIN + "/api/pay/" + order.order_id, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ payment_token: "falso" }),
});
console.log("token falso:", wrong.status, wrong.status === 403 ? "OK" : "FALLO");

const pay = await fetch(ORIGIN + "/api/pay/" + order.order_id, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ payment_token: pt }),
});
const paid = await pay.json();
console.log("pago:", pay.status, JSON.stringify(paid));

const again = await fetch(ORIGIN + "/api/pay/" + order.order_id, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ payment_token: pt }),
});
const againBody = await again.json();
console.log("pago repetido:", JSON.stringify(againBody));

const status = await fetch(ORIGIN + "/api/orders/" + order.order_id);
const st = await status.json();
console.log("estado final:", st.status);

const ok = paid.ok === true && paid.status === "paid" && againBody.already === true && st.status === "paid" && wrong.status === 403;
console.log(ok ? "LIVE PAYLINK E2E: PASS" : "LIVE PAYLINK E2E: FALLO");
process.exit(ok ? 0 : 1);