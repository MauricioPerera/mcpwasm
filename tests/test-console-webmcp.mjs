// tests/test-console-webmcp.mjs — ORACULO del contrato console-webmcp.
// El puente de la consola: registrar las 4 tools en navigator.modelContext
// (inyectado como objeto con registerTool) y envolver cada handler para que
// el agente vea {content:[{type:"text",text}]}.
// Uso: node tests/test-console-webmcp.mjs
import { registerConsoleWebMCP } from "../web/console-webmcp.mjs";

const CHECKS = [];
const check = (ok, label) => { CHECKS.push(ok); console.log(`  ${ok ? "ok" : "FALLO"}: ${label}`); };

function fakeMc() {
  const mc = { registered: [] };
  mc.registerTool = (def) => { mc.registered.push(def); };
  return mc;
}

// tools fake: la consola pasa las de console-tools; aqui memoria + un throw
const TOOLS = {
  create_preview: async (args) => ({ ok: true, sid: "s-test-123", previewUrl: "https://x.y.z" }),
  preview_status: async (args) => {
    if (!args || typeof args.sid !== "string") throw new Error("sid requerido");
    return { ok: true, sid: args.sid };
  },
  claim_preview: async (args) => ({ ok: true, payment_url: "https://studio.test/claim/p1", price: 19, days: 30 }),
  discard_preview: async () => ({ ok: true, deleted: true }),
};

function parseToolResult(res) {
  try { return JSON.parse(res.content[0].text); } catch { return null; }
}

async function main() {
  // --- 1. registro ------------------------------------------------------------
  const mc = fakeMc();
  const logs = [];
  const out1 = await registerConsoleWebMCP(mc, TOOLS, { onLog: (m) => logs.push(m) });
  check(out1.registered === 4, `4 tools registradas (${out1.registered})`);
  check(mc.registered.length === 4, "el modelContext recibio 4 registros");
  check(logs.length >= 1, "onLog recibio eventos");

  const create = mc.registered.find((t) => t.name === "create_preview");
  check(Boolean(create), "create_preview registrada");
  check(Boolean(create) && create.inputSchema && create.inputSchema.type === "object" && Array.isArray(create.inputSchema.required), "create_preview con inputSchema JSON");
  check(Boolean(create) && typeof create.description === "string" && create.description.length > 20, "create_preview con descripcion para el agente");

  // --- 2. execute envuelve el resultado como WebMCP espera --------------------
  const res = await create.execute({ files: [{ name: "app.js", content: "" }], main: "app.js" });
  check(Array.isArray(res.content) && res.content[0].type === "text", "execute -> { content: [ { type:text } ] }");
  const created = parseToolResult(res);
  check(Boolean(created) && created.ok === true && created.sid === "s-test-123", "execute entrega el JSON de la tool");

  const status = mc.registered.find((t) => t.name === "preview_status");
  const st = parseToolResult(await status.execute({ sid: "s-2" }));
  check(Boolean(st) && st.ok === true && st.sid === "s-2", "preview_status via execute llega a la tool");
  const dis = mc.registered.find((t) => t.name === "discard_preview");
  const disParsed = parseToolResult(await dis.execute({ sid: "x" }));
  check(Boolean(disParsed) && disParsed.ok === true && disParsed.deleted === true, "discard_preview via execute llega a la tool");

  // --- 3. errores del registro no abortan las demas tools ---------------------
  const mcBad = fakeMc();
  const originalRegister = mcBad.registerTool;
  mcBad.registerTool = (def) => {
    if (def.name === "claim_preview") throw new Error("registro duplicado");
    originalRegister(def);
  };
  const out2 = await registerConsoleWebMCP(mcBad, TOOLS, {});
  check(out2.registered === 3 && mcBad.registered.length === 3, `registro con un fallo -> 3/4 (${out2.registered})`);
  check(out2.failed.length === 1 && out2.failed[0].name === "claim_preview", "el fallo se reporta en failed[]");

  // --- 4. handler que lanza: execute NO lanza, devuelve error JSON visible ----
  const errOut = await status.execute({});
  const errObj = parseToolResult(errOut);
  check(checkErr(errObj), "handler que lanza -> execute devuelve {ok:false} visible al agente");
  check(Boolean(errObj) && typeof errObj.error === "string" && errObj.error.length > 0, "el error del handler viaja en el texto");
  function checkErr(o) { return Boolean(o) && o.ok === false; }

  const ok = CHECKS.every(Boolean);
  console.log(`ORACULO console-webmcp: ${ok ? "PASS" : "FALLO"} (${CHECKS.filter(Boolean).length}/${CHECKS.length})`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error("ORACULO ERROR:", e.message); process.exit(1); });