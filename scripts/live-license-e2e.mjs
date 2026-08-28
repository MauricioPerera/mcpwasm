// live-license-e2e.mjs — flujo comercial EN VIVO contra llmstxt-shop:
// comprar acceso de creador -> pagar paylink -> activar -> crear producto con el token.
const ORIGIN = "https://llmstxt-shop.rckflr.workers.dev";
const email = "merchant-live-" + Date.now() + "@example.com";

// 1) la tool de compra (flujo del agente): paylink para el humano
const buy = await fetch(ORIGIN + "/api/licenses/purchase", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email }),
});
const lic = await buy.json();
console.log("1. compra iniciada:", buy.status, "| paylink:", lic.payment_url);
if (!lic.payment_url) { console.error("SIN paylink"); process.exit(1); }

// 2) el humano abre el paylink (pagina de licencia)
const pt = lic.payment_url.split("pt=")[1];
const licToken = lic.payment_url.split("/buy/")[1].split("?")[0];
const page = await fetch(ORIGIN + lic.payment_url);
const html = await page.text();
console.log("2. paylink page:", page.status, "| es pagina de licencia:", html.includes("Licencia de creador"), "| muestra token tras pagar:", html.includes(licToken) === false, "(oculto antes de pagar)");

// 3) pagar (simulado): activar la licencia
const wrong = await fetch(ORIGIN + "/api/licenses/activate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payment_token: "falso" }) });
console.log("3a. activar con token falso:", wrong.status, wrong.status === 404 ? "OK" : "FALLO");
const activate = await fetch(ORIGIN + "/api/licenses/activate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payment_token: pt }) });
const act = await activate.json();
console.log("3b. pago -> licencia activa:", activate.status, act.status, act.already ? "(already)" : "");

// 4) el agente crea un producto con el token
const slug = "live-lic-" + Date.now();
const create = await fetch(ORIGIN + "/api/products", {
  method: "POST",
  headers: { Authorization: "Bearer " + licToken, "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Live License Product", price: 33, stock: 7, sku: slug }),
});
const created = await create.json();
console.log("4. create_product:", create.status, "| sku:", created.sku, "| uses_left:", created.uses_left);

// 5) el catalogo lo ve el mundo (search)
const search = await fetch(ORIGIN + "/api/search?q=" + encodeURIComponent("Live License"));
const results = await search.json();
console.log("5. search lo encuentra:", Array.isArray(results) && results.some((p) => p.sku === slug) ? "OK" : "FALLO");

// 6) la licencia refleja el uso
const lic2 = await fetch(ORIGIN + "/api/license/" + licToken);
const l2 = await lic2.json();
console.log("6. licencia:", l2.status, "| uses_left:", l2.uses_left, "| vence:", (l2.expires_at || "").slice(0, 10));

const ok = wrong.status === 404 && act.status === "active" && created.ok === true && created.uses_left === 24 && l2.uses_left === 24 && l2.status === "active";
console.log(ok ? "LIVE LICENSE E2E: PASS" : "LIVE LICENSE E2E: FALLO");
process.exit(ok ? 0 : 1);