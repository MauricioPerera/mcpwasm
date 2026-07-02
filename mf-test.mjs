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
  return { status: res.status, text: await res.text() };
}

try {
  console.log("initialize   ->", JSON.stringify(await rpc({ jsonrpc:"2.0", id:1, method:"initialize", params:{} })));
  console.log("tools/list   ->", JSON.stringify(await rpc({ jsonrpc:"2.0", id:2, method:"tools/list" })));
  console.log("create_pay   ->", JSON.stringify(await rpc({ jsonrpc:"2.0", id:3, method:"tools/call", params:{ name:"create_payment", arguments:{ amount:4200, currency:"usd" } } })));
} catch (e) {
  console.error("ERROR:", e.message);
} finally {
  await mf.dispose();
}
