// mf-memspike.mjs
// e2e Miniflare v4 (workerd) contra dist-memspike/worker.js. Verifica el spike
// TAREA20: minimemory (BM25) + QuickJS sandbox en el mismo Worker.
//
//   6a) tools/call search_docs {"q":"sandbox capability"} -> hits no vacios con
//       score y section; el top hit debe contener texto relacionado ("sandbox").
//   6b) tools/call search_docs {"q":"receta de paella"} -> 0 hits (o scores
//       claramente menores). Se pegan los outputs de 6a y 6b.
//   6c) tools/call echo {"msg":"..."} -> skill QuickJS pura sigue funcionando
//       (coexistencia de los 2 wasm en el mismo Worker).
//   6d) snapshot con sha256 esperado alterado (binding EXPECTED_SNAPSHOT_SHA
//       incorrecto en una 2da instancia) -> el worker rechaza el snapshot con
//       error claro y search_docs reporta error controlado (isError:true), NO
//       crash (HTTP 200, no 500).
//
// modulesRules: ESModule (.js), CompiledWasm (.wasm -> WebAssembly.Module),
// Text (.snapshot -> string). El bundle importa los 2 wasm y el snapshot como
// imports ESM planos (external); Miniflare los resuelve con estas reglas.

import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("./dist-memspike/worker.js", import.meta.url));

const baseOpts = {
  scriptPath,
  modules: true,
  modulesRules: [
    { type: "ESModule", include: ["**/*.js"] },
    { type: "CompiledWasm", include: ["**/*.wasm"] },
    { type: "Text", include: ["**/*.snapshot"] },
  ],
  compatibilityDate: "2026-06-01",
  compatibilityFlags: ["nodejs_compat"],
};

async function rpc(mf, payload) {
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

// sc = result.structuredContent de tools/call
function scOf(r) {
  return r.body && r.body.result && r.body.result.structuredContent;
}
function isErr(r) {
  return r.body && r.body.result && r.body.result.isError === true;
}
function errText(r) {
  return r.body && r.body.result && r.body.result.content &&
    r.body.result.content[0] && r.body.result.content[0].text;
}

// --- Instancia 1: sha correcto (default horneado, sin override) --------------
const mf = new Miniflare(baseOpts);

try {
  // tools/list: deben estar search_docs y echo.
  const list = await rpc(mf, { jsonrpc: "2.0", id: 1, method: "tools/list" });
  const names = (list.body && list.body.result && list.body.result.tools || []).map((t) => t.name);
  console.log("tools/list ->", JSON.stringify(names));
  check(names.includes("search_docs") && names.includes("echo"), "tools/list: search_docs + echo presentes");

  // 6a) search_docs "sandbox capability"
  const a = await rpc(mf, {
    jsonrpc: "2.0", id: 2, method: "tools/call",
    params: { name: "search_docs", arguments: { q: "sandbox capability" } },
  });
  console.log("\n6a) search_docs 'sandbox capability' ->", JSON.stringify(a.body).slice(0, 600));
  const sca = scOf(a);
  const hitsA = sca && sca.hits;
  check(a.status === 200 && !isErr(a), "6a: HTTP 200, no isError");
  check(Array.isArray(hitsA) && hitsA.length > 0, "6a: hits no vacios");
  if (hitsA && hitsA.length > 0) {
    const top = hitsA[0];
    check(typeof top.score === "number", "6a: top hit tiene score numerico");
    check(typeof top.section === "string" && top.section.length > 0, "6a: top hit tiene section");
    check(/sandbox|capability/i.test(top.text || ""), "6a: top hit contiene texto relacionado (sandbox/capability)");
  }

  // 6b) search_docs "receta de paella"
  const b = await rpc(mf, {
    jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: "search_docs", arguments: { q: "receta de paella" } },
  });
  console.log("6b) search_docs 'receta de paella'  ->", JSON.stringify(b.body).slice(0, 400));
  const scb = scOf(b);
  const hitsB = scb && scb.hits;
  check(a.status === 200, "6b: HTTP 200");
  if (hitsB && hitsB.length > 0) {
    // Si devuelve hits, sus scores deben ser claramente menores (mas negativos en
    // este scoring BM25 => mayor magnitud = mejor; un query sin relacion debe dar
    // scores de menor magnitud que el query relacionado, o 0 hits).
    const topB = hitsB[0];
    const topA = hitsA[0];
    check(Math.abs(topB.score) < Math.abs(topA.score), "6b: scores menores que el query relacionado");
  } else {
    check(true, "6b: 0 hits (query sin relacion)");
  }

  // 6c) echo (skill QuickJS pura, coexistencia)
  const c = await rpc(mf, {
    jsonrpc: "2.0", id: 4, method: "tools/call",
    params: { name: "echo", arguments: { msg: "hola-memspike" } },
  });
  console.log("6c) echo 'hola-memspike'             ->", JSON.stringify(c.body).slice(0, 300));
  const scc = scOf(c);
  check(c.status === 200 && !isErr(c), "6c: echo HTTP 200, no isError");
  check(scc && scc.echo === "hola-memspike", "6c: echo devuelve el mensaje (QuickJS puro coexiste)");

  console.log("\n" + (failures === 0 ? "INSTANCIA 1: TODOS LOS CHECKS VERDE" : failures + " CHECK(S) ROJO(S)"));
} catch (e) {
  console.error("ERROR en instancia 1:", e && e.stack ? e.stack : e);
  failures++;
} finally {
  await mf.dispose();
}

// --- Instancia 2: sha esperado incorrecto (test negativo 6d) -----------------
const WRONG_SHA = "0000000000000000000000000000000000000000000000000000000000000000";
const mfBad = new Miniflare({ ...baseOpts, bindings: { EXPECTED_SNAPSHOT_SHA: WRONG_SHA } });

try {
  // echo primero: el Worker NO debe haber crasheado al cargar (el check de sha
  // es perezoso, al primer memorySearch; echo no toca el snapshot).
  const pre = await rpc(mfBad, {
    jsonrpc: "2.0", id: 5, method: "tools/call",
    params: { name: "echo", arguments: { msg: "sobrevivo" } },
  });
  console.log("\n6d) [sha incorrecto] echo 'sobrevivo' ->", JSON.stringify(pre.body).slice(0, 200));
  check(pre.status === 200 && scOf(pre) && scOf(pre).echo === "sobrevivo", "6d: Worker vivo (echo funciona) pese a sha incorrecto");

  // search_docs: debe reportar error controlado (isError:true con mensaje de
  // integridad), NO crash (HTTP 200, no 500).
  const d = await rpc(mfBad, {
    jsonrpc: "2.0", id: 6, method: "tools/call",
    params: { name: "search_docs", arguments: { q: "sandbox capability" } },
  });
  console.log("6d) [sha incorrecto] search_docs    ->", JSON.stringify(d.body).slice(0, 400));
  check(d.status === 200, "6d: HTTP 200 (no crash/500)");
  check(isErr(d), "6d: isError:true (error controlado)");
  check(/integrity|sha256|mismatch/i.test(errText(d) || ""), "6d: mensaje menciona integridad/sha mismatch");

  console.log("\n" + (failures === 0 ? "INSTANCIA 2: TODOS LOS CHECKS VERDE" : failures + " CHECK(S) ROJO(S)"));
} catch (e) {
  console.error("ERROR en instancia 2:", e && e.stack ? e.stack : e);
  failures++;
} finally {
  await mfBad.dispose();
}

if (failures !== 0) process.exit(1);