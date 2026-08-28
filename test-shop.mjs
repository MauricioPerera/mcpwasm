// test-shop.mjs — Suite hermetica de llmstxt-shop (Miniflare + D1 en memoria).
// Verifica: descubrimiento (hashes v0.4 == bytes servidos), busqueda de catalogo,
// producto por sku, creacion de ordenes ATOMICAS con stock decrement, IDEMPOTENCIA
// (mismo client_order_id -> misma orden, sin duplicado), 409 por stock, order_status,
// y el panel merchant con token (401 sin token). La tool.js del sandbox se ejecuta
// de verdad contra el worker (flujo fetchOrigin completo).

import { Miniflare } from "miniflare";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CHECKS = [];
const check = (ok, label) => { CHECKS.push(ok); console.log(`  ${ok ? "ok" : "FALLO"}: ${label}`); };

async function call(mf, path, opts = {}) {
  const res = await mf.dispatchFetch("http://localhost" + path, opts);
  let body = null;
  try { body = await res.json(); } catch { body = await res.text(); }
  return { status: res.status, body };
}

// ejecuta un tool.js REAL del worker dentro de un mini-sandbox con host.fetchOrigin
async function runTool(mf, skillName, args) {
  const toolRes = await mf.dispatchFetch("http://localhost/skills/" + skillName + "/tool.js");
  const toolJs = await toolRes.text();
  let captured = null;
  const fakeHost = {
    fetchOrigin: async (path, opts = {}) => {
      const res = await mf.dispatchFetch("http://localhost" + path, {
        method: opts.method || "GET",
        headers: opts.headers,
        body: opts.body,
      });
      const body = await res.text();
      return { status: res.status, body };
    },
  };
  const fn = new Function("registerTool", "host", toolJs);
  fn((def) => { captured = def; }, fakeHost);
  return await captured.handler(args);
}

async function main() {
  const mf = new Miniflare({
    scriptPath: fileURLToPath(new URL("./shop/worker.mjs", import.meta.url)),
    modules: true,
    compatibilityDate: "2026-06-01",
    bindings: { ADMIN_TOKEN: "test-admin" },
    d1Databases: { DB: "shop-db" },
  });

  // schema + seed (D1 exec() corta por saltos de linea: statement por statement)
  const db = await mf.getD1Database("DB");
  const schema = readFileSync(fileURLToPath(new URL("./shop/schema.sql", import.meta.url)), "utf8");
  for (const stmt of schema.split(";").map((s) => s.trim()).filter(Boolean)) {
    await db.prepare(stmt).run();
  }
  const catalog = JSON.parse(readFileSync(fileURLToPath(new URL("./shop/catalog.json", import.meta.url)), "utf8"));
  for (const p of catalog) {
    await db.prepare("INSERT INTO products (sku, name, description, category, price, stock) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(p.sku, p.name, p.description, p.category, p.price, p.stock).run();
  }

  console.log("[1] descubrimiento");
  const llms = await (await mf.dispatchFetch("http://localhost/llms.txt")).text();
  const lines = llms.split("\n").filter((l) => l.includes("<!-- skill:"));
  check(lines.length === 7, `7 skills en llms.txt (${lines.length})`);
  for (const line of lines) {
    const m = line.match(/^- \[([^\]]+)\]\(([^)]+)\):.*"tool":"([^"]+)","tool_sha256":"([a-f0-9]{64})"/);
    check(Boolean(m), `linea v0.4: ${m ? m[1] : "?"}`);
    if (m) {
      const toolJs = await (await mf.dispatchFetch("http://localhost" + m[3])).text();
      check(createHash("sha256").update(Buffer.from(toolJs, "utf8")).digest("hex") === m[4], `${m[1]}: hash == bytes servidos`);
    }
  }

  console.log("[2] catalogo (tool real del sandbox)");
  const search = await runTool(mf, "search_catalog", { q: "mug", max_price: 50 });
  check(Array.isArray(search) && search.length === 1 && search[0].sku === "wasm-mug", "search_catalog 'mug' -> wasm-mug");
  const searchAll = await runTool(mf, "search_catalog", {});
  check(searchAll.length === 8, `search sin filtros -> 8 productos (${searchAll.length})`);
  const product = await runTool(mf, "get_product", { sku: "byoa-tee" });
  check(product.found === true && product.price === 25, "get_product byoa-tee -> found, price 25");
  const missing = await runTool(mf, "get_product", { sku: "no-existe" });
  check(missing.found === false, "get_product inexistente -> {found:false}");

  console.log("[3] orden con idempotencia (tool real del sandbox)");
  const coid = "test-intent-001";
  const order1 = await runTool(mf, "create_order", { sku: "byoa-tee", qty: 2, email: "agente@example.com", client_order_id: coid });
  check(order1.ok === true && order1.remaining_stock === 36, `create_order -> order_id=${order1.order_id}, stock ${order1.remaining_stock}`);
  check(order1.total === 50, "total = 2 x 25");
  const order2 = await runTool(mf, "create_order", { sku: "byoa-tee", qty: 2, email: "agente@retry.dev", client_order_id: coid });
  check(order2.idempotent === true && order2.order_id === order1.order_id, "reintento con misma clave -> MISMA orden");
  check(order2.email === "agente@retry.dev" ? false : true, "el email del reintento NO pisa la orden original");
  const { count } = (await call(mf, "/api/orders?limit=100&x=1", { headers: { Authorization: "Bearer test-admin" } })).body;
  // 1 orden creada a pesar del reintento
  check(count === 1, `ordenes en la DB: ${count} (idempotencia sin duplicados)`);

  console.log("[4] stock atomico y 409");
  const big = await runTool(mf, "create_order", { sku: "ephemeral-clock", qty: 100, email: "x@y.dev", client_order_id: "big-1" });
  check(big.ok === false && big.status === 409 && big.available === 8, "stock insuficiente -> 409 con available=8");
  const badSku = await runTool(mf, "create_order", { sku: "fantasma", qty: 1, email: "x@y.dev", client_order_id: "g-1" });
  check(badSku.ok === false && badSku.status === 409, "sku desconocido -> 409");
  const badEmail = await runTool(mf, "create_order", { sku: "wasm-mug", qty: 1, email: "no-es-email", client_order_id: "e-1" });
  check(badEmail.ok === false && badEmail.error.includes("email"), "email invalido -> rechazo con mensaje claro");

  console.log("[5] order_status");
  const status = await runTool(mf, "order_status", { order_id: order1.order_id });
  check(status.found === true && status.order.sku === "byoa-tee" && status.order.status === "confirmed", "order_status devuelve la orden");
  const statusMissing = await runTool(mf, "order_status", { order_id: 99999 });
  check(statusMissing.found === false, "order_status inexistente -> {found:false}");

  console.log("[6] paylink: orden -> pago simulado -> paid");
  const pOrder = await runTool(mf, "create_order", { sku: "wasm-mug", qty: 1, email: "pagador@example.com", client_order_id: "pay-1" });
  check(pOrder.ok === true && typeof pOrder.payment_url === "string" && pOrder.payment_url.startsWith("https://llmstxt-shop"), `payment_url absoluta: ${(pOrder.payment_url || "").slice(0, 55)}...`);
  const pt = (pOrder.payment_url || "").split("pt=")[1] || "";
  const wrongPay = await call(mf, "/api/pay/" + pOrder.order_id, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payment_token: "token-falso" }) });
  check(wrongPay.status === 403, "pago con token incorrecto -> 403");
  const page = await mf.dispatchFetch("http://localhost" + pOrder.payment_url.replace("https://llmstxt-shop.rckflr.workers.dev", ""));
  const pageHtml = await page.text();
  check(page.status === 200 && (page.headers.get("content-type") || "").includes("text/html"), "GET paylink -> HTML");
  check(pageHtml.includes("SIMULACION") && pageHtml.includes("Pagar") && pageHtml.includes("llmstxt-shop"), "paylink: pagina con boton de pago simulado");
  const pay = await call(mf, "/api/pay/" + pOrder.order_id, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payment_token: pt }) });
  check(pay.status === 200 && pay.body.ok === true && pay.body.status === "paid", "POST /api/pay con token correcto -> paid");
  const payAgain = await call(mf, "/api/pay/" + pOrder.order_id, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payment_token: pt }) });
  check(payAgain.body.already === true, "pago repetido -> already:true");
  const statusPaid = await runTool(mf, "order_status", { order_id: pOrder.order_id });
  check(statusPaid.found === true && statusPaid.order.status === "paid", "order_status refleja PAID");
  const noPt = await call(mf, "/api/pay/" + pOrder.order_id, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  check(noPt.status === 403, "pago sin token -> 403");

  console.log("[7] merchant panel con token");
  const noAuth = await call(mf, "/api/orders");
  check(noAuth.status === 401, "GET /api/orders sin token -> 401");
  const withAuth = await call(mf, "/api/orders?limit=10", { headers: { Authorization: "Bearer test-admin" } });
  check(withAuth.status === 200 && withAuth.body.count === 2 && withAuth.body.orders.map((o) => o.status).includes("paid"), "con token -> ordenes (incluida la PAGADA del paylink)");

  console.log("[8] licencia de creador: el acceso a create_product se VENDE");
  const noTok = await runTool(mf, "create_product", { name: "sin-token", price: 5 });
  check(noTok.ok === false && noTok.needs_payment === true, "create_product sin token -> needs_payment");
  const buy = await runTool(mf, "buy_creator_access", { email: "merchant@example.com" });
  check(buy.ok === true && typeof buy.payment_url === "string" && buy.payment_url.startsWith("https://llmstxt-shop"), "buy_creator_access -> paylink de licencia");
  const pt2 = buy.payment_url.split("pt=")[1];
  const licToken = buy.payment_url.split("/buy/")[1].split("?")[0];
  const licPage = await mf.dispatchFetch("http://localhost" + buy.payment_url.replace("https://llmstxt-shop.rckflr.workers.dev", ""));
  const licHtml = await licPage.text();
  check(licPage.status === 200 && licHtml.includes("Licencia de creador"), "GET /buy/:token -> pagina de licencia");
  const badActivate = await call(mf, "/api/licenses/activate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payment_token: "falso" }) });
  check(badActivate.status === 404, "activar con payment_token falso -> 404");
  const activate = await call(mf, "/api/licenses/activate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payment_token: pt2 }) });
  check(activate.status === 200 && activate.body.license_token === licToken, "activar con payment_token -> license_token");
  const licInfo = await runTool(mf, "check_license", { access_token: licToken });
  check(licInfo.found === true && licInfo.valid === true && licInfo.uses_left === 25, "check_license -> activa con 25 usos");
  const badTok = await call(mf, "/api/products", { method: "POST", headers: { Authorization: "Bearer token-falso", "Content-Type": "application/json" }, body: JSON.stringify({ name: "x", price: 1 }) });
  check(badTok.status === 401, "create product con token falso -> 401");
  const created1 = await runTool(mf, "create_product", { name: "Agent Made Mug", price: 21, stock: 10, access_token: licToken });
  check(created1.ok === true && created1.sku === "agent-made-mug" && created1.uses_left === 24, "create_product -> producto creado, uses_left 24");
  const created2 = await runTool(mf, "create_product", { name: "Agent Made Mug", price: 22, stock: 5, access_token: licToken });
  check(created2.ok === true && created2.sku !== created1.sku && created2.sku.startsWith("agent-made-mug-"), "sku duplicado -> slug con sufijo unico");
  const seen = await runTool(mf, "search_catalog", { q: "Agent Made" });
  check(Array.isArray(seen) && seen.some((p) => p.sku === created1.sku), "search_catalog ve el producto creado por el agente");
  const noEmail = await runTool(mf, "buy_creator_access", {});
  check(noEmail.ok === false && noEmail.error.includes("email"), "buy_creator_access sin email -> error claro");

  console.log("[9] panel merchant: licencias vendidas");
  const licNoAuth = await call(mf, "/api/licenses");
  check(licNoAuth.status === 401, "GET /api/licenses sin token -> 401");
  const licList = await call(mf, "/api/licenses", { headers: { Authorization: "Bearer test-admin" } });
  const licRow = licList.body?.licenses?.find((l) => l.token === licToken);
  check(licList.status === 200 && licRow && licRow.status === "active" && licRow.uses_left === 23 && licList.body.revenue === 19, "panel: licencia activa con usos y revenue ($19)");

  const ok = CHECKS.every(Boolean);
  console.log(`TEST SHOP: ${ok ? "PASS" : "FALLO"} (${CHECKS.filter(Boolean).length}/${CHECKS.length})`);
  await mf.dispose();
  process.exit(ok ? 0 : 1);
}

main().catch(async (e) => {
  console.error("TEST SHOP: ERROR —", e.message);
  process.exit(1);
});