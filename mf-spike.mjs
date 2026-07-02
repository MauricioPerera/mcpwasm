// mf-spike.mjs
// e2e Miniflare v4 contra dist-spike/worker.js. Verifica el spike TAREA5:
//   - tools/call fetch_home -> espera 200 con structuredContent.status==200 y
//     firstLine no vacia (GET del Worker desplegado devuelve texto "toolhost-mcp server...").
//   - tools/call fetch_evil -> espera isError:true con mensaje que contenga "origin".
// Imprime ambas respuestas. Miniflare v4 permite fetch saliente real por defecto
// (usa undici); no hace falta flag extra. Si se bloqueara, habilitar el outbound
// via el provider de fetch de Miniflare (no fue necesario aqui).

import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";

const mf = new Miniflare({
  scriptPath: fileURLToPath(new URL("./dist-spike/worker.js", import.meta.url)),
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
  return { status: res.status, body: await res.json() };
}

let failures = 0;
function check(cond, msg) {
  console.log((cond ? "PASS " : "FAIL ") + msg);
  if (!cond) failures++;
}

try {
  // 1) tools/list
  const list = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  console.log("\nlist ->", JSON.stringify(list.body));

  // 2) fetch_home: debe volver 200 con datos reales del origin permitido.
  const home = await rpc({
    jsonrpc: "2.0", id: 2, method: "tools/call",
    params: { name: "fetch_home", arguments: {} },
  });
  console.log("fetch_home ->", JSON.stringify(home.body));
  const sc = home.body && home.body.result && home.body.result.structuredContent;
  check(home.status === 200, "fetch_home: HTTP 200");
  check(sc && sc.status === 200, "fetch_home: structuredContent.status==200");
  check(sc && typeof sc.firstLine === "string" && sc.firstLine.length > 0, "fetch_home: firstLine no vacia");
  check(home.body && home.body.result && home.body.result.isError === false, "fetch_home: isError==false");

  // 3) fetch_evil: debe fallar con isError y mensaje que contenga "origin".
  const evil = await rpc({
    jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: "fetch_evil", arguments: {} },
  });
  console.log("fetch_evil  ->", JSON.stringify(evil.body));
  const errText =
    evil.body && evil.body.result && evil.body.result.content &&
    evil.body.result.content[0] && evil.body.result.content[0].text;
  check(evil.body && evil.body.result && evil.body.result.isError === true, "fetch_evil: isError==true");
  check(typeof errText === "string" && /origin/i.test(errText), 'fetch_evil: mensaje contiene "origin"');

  console.log("\n" + (failures === 0 ? "TODOS LOS CHECKS VERDE" : failures + " CHECK(S) ROJO(S)"));
} catch (e) {
  console.error("ERROR en mf-spike:", e && e.stack ? e.stack : e);
  failures++;
} finally {
  await mf.dispose();
}

if (failures !== 0) process.exit(1);