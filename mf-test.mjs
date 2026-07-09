// mf-test.mjs
// e2e Miniflare v4 contra dist/worker.js (PoC sincrono: host.mjs + tools-inline.mjs
// + internal-logic.mjs). Verifica:
//   1) initialize -> serverInfo.name == toolhost-mcp.
//   2) tools/list -> incluye create_payment y refund_payment.
//   3) create_payment(4200, usd) -> isError:false, structuredContent {ok:true,
//      paymentId: "pay_...", status:"succeeded"}.
//   4) refund_payment con un paymentId inexistente -> isError:true, error
//      controlado (no crash). NOTA: buildHost(env) se llama por-request (ver
//      worker.mjs), asi que el Map `payments` de internal-logic.mjs es nuevo en
//      cada request -- encadenar create_payment -> refund_payment del MISMO pago
//      entre dos llamadas RPC separadas no es posible con esta arquitectura (cada
//      rpc() es un request nuevo, sin estado compartido); por eso este check usa
//      un id que nunca pudo existir, en vez de intentar reusar el de (3).
//   5) tool inexistente -> isError:true (error de tool, no crash).
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";

// Windows: new URL(...).pathname produce "/D:/..." y Miniflare lo prefija con "D:\"
// => "D:\\D:\\...". fileURLToPath devuelve la ruta nativa correcta.
const mf = new Miniflare({
  scriptPath: fileURLToPath(new URL("./dist/worker.js", import.meta.url)),
  modules: true,
  modulesRules: [
    { type: "ESModule", include: ["**/*.js"] },
    { type: "CompiledWasm", include: ["**/*.wasm"] },
  ],
  compatibilityDate: "2026-06-01",
  compatibilityFlags: ["nodejs_compat"],
});

async function rpc(payload) {
  const res = await mf.dispatchFetch("http://localhost/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* json queda null; los checks sobre json lo reportan como fallo */
  }
  return { status: res.status, text, json };
}

let failures = 0;
function check(cond, msg) {
  console.log((cond ? "PASS " : "FAIL ") + msg);
  if (!cond) failures++;
}

try {
  const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  console.log("initialize   ->", JSON.stringify(init));
  check(init.status === 200, "initialize: HTTP 200");
  check(
    init.json && init.json.result && init.json.result.serverInfo && init.json.result.serverInfo.name === "toolhost-mcp",
    "initialize: serverInfo.name == toolhost-mcp"
  );

  const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  console.log("tools/list   ->", JSON.stringify(list));
  const names = (list.json && list.json.result && list.json.result.tools || []).map((t) => t.name);
  check(names.includes("create_payment"), "tools/list: incluye create_payment");
  check(names.includes("refund_payment"), "tools/list: incluye refund_payment");

  const pay = await rpc({
    jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: "create_payment", arguments: { amount: 4200, currency: "usd" } },
  });
  console.log("create_pay   ->", JSON.stringify(pay));
  const paySc = pay.json && pay.json.result && pay.json.result.structuredContent;
  check(pay.json && pay.json.result && pay.json.result.isError === false, "create_payment: isError==false");
  check(paySc && paySc.ok === true, "create_payment: structuredContent.ok==true");
  check(typeof paySc?.paymentId === "string" && paySc.paymentId.startsWith("pay_"), "create_payment: paymentId con formato pay_*");
  check(paySc && paySc.status === "succeeded", "create_payment: status==succeeded");

  const refund = await rpc({
    jsonrpc: "2.0", id: 4, method: "tools/call",
    params: { name: "refund_payment", arguments: { paymentId: "pay_no_existe" } },
  });
  console.log("refund_pay   ->", JSON.stringify(refund));
  check(refund.json && refund.json.result && refund.json.result.isError === true, "refund_payment(id inexistente): isError==true (error controlado, no crash)");

  const nope = await rpc({
    jsonrpc: "2.0", id: 5, method: "tools/call",
    params: { name: "nope", arguments: {} },
  });
  console.log("tool inexist ->", JSON.stringify(nope));
  check(nope.json && nope.json.result && nope.json.result.isError === true, "tool inexistente: isError==true (error de tool, no crash)");

  console.log("\n" + (failures === 0 ? "TODOS LOS CHECKS VERDE" : failures + " CHECK(S) ROJO(S)"));
} catch (e) {
  console.error("ERROR en mf-test:", e && e.stack ? e.stack : e);
  failures++;
} finally {
  await mf.dispose();
}

if (failures !== 0) process.exit(1);
