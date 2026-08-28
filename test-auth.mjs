// test-auth.mjs — E2E hermético del Device Flow (RFC 8628) con --auth.
//
// Escenario: plataforma con datos por-usuario (la tienda). El origin PROTEGE
// llms.txt con el Bearer: sin token -> 401 (fail-closed). El runtime con
// --auth hace device flow contra el issuer (aquí el mismo origin), el HUMANO
// (el test, simulando el navegador) autoriza, y el token queda en local.
//
// 1) primera activación: runtime pide device code, imprime URL+código por
//    STDERR (stdout es protocolo MCP), el test autoriza vía HTTP, y
//    tools/call my_orders devuelve los datos AUTENTICADOS del usuario.
// 2) segunda activación: token en local -> silencioso, sin device code.
// 3) token revocado en el servidor -> descubrimiento 401 -> re-auth
//    automática UNA vez -> el test re-autoriza -> funciona.
//
// Uso: node test-auth.mjs
// (spawn con stdio pipes; el runtime se mata con kill al final de cada caso)

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("./bin/mcpwasm-local.mjs", import.meta.url));
const PORT = 12440;
const BASE = `http://127.0.0.1:${PORT}`;
const USER_TOK = "usr_tok_ana_9f3e"; // token de ANA (lo emite la tienda)
const CLIENT_ID = "mcpwasm";

// UNA sola fuente de verdad para tool.js: el hash de llms.txt se calcula
// sobre ESTA cadena y el servidor sirve EXACTAMENTE esta cadena.
const TOOL_JS = [
  "registerTool({",
  '  name: "my_orders",',
  '  description: "pedidos del usuario autenticado",',
  '  inputSchema: { type: "object", properties: {} },',
  "  async handler() {",
  '    const r = await host.fetchOrigin("api/orders", { method: "GET" });',
  "    return r;",
  "  },",
  "});",
].join("\n");

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) {
    pass++;
    console.log("  ok: " + label);
  } else {
    fail++;
    console.log("  FAIL: " + label);
  }
}

// ---------- plataforma fake con OAuth device flow --------------------------
// estado de autorización del fake OAuth
const devices = new Map(); // device_code -> {authorized, done}
const issued = new Set(); // tokens en circulación
const revoked = new Set(); // tokens revocados (401)

function tokenValid(t) {
  return typeof t === "string" && issued.has(t) && !revoked.has(t);
}

function bearer(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
  });
}

function form(body) {
  const m = {};
  for (const kv of String(body).split("&")) {
    const i = kv.indexOf("=");
    if (i > 0) m[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
  }
  return m;
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, BASE);
  const p = u.pathname;
  // --- OAuth: metadata RFC 8414 -------------------------------------------
  if (p === "/.well-known/oauth-authorization-server") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        issuer: BASE,
        device_authorization_endpoint: BASE + "/device/code",
        token_endpoint: BASE + "/device/token",
      })
    );
    return;
  }
  // --- OAuth: device code (RFC 8628 paso 1) --------------------------------
  if (p === "/device/code" && req.method === "POST") {
    const dc = "dc_" + crypto.randomBytes(8).toString("hex");
    devices.set(dc, { authorized: false });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        device_code: dc,
        user_code: "KZTR-4821",
        verification_uri: BASE + "/conectar",
        verification_uri_complete: BASE + "/conectar?code=" + dc,
        expires_in: 300,
        interval: 0.2,
      })
    );
    return;
  }
  // --- OAuth: el HUMANO autoriza (el test simula el navegador) -------------
  if (p === "/conectar" && u.searchParams.get("code")) {
    const dc = u.searchParams.get("code");
    const d = devices.get(dc);
    if (d) d.authorized = true;
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html><body>autorizado</body></html>");
    return;
  }
  // --- OAuth: poll del token (RFC 8628 paso 2) -----------------------------
  if (p === "/device/token" && req.method === "POST") {
    const f = form(await readBody(req));
    const d = devices.get(f.device_code);
    if (!d) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "expired_token" }));
      return;
    }
    if (!d.authorized) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "authorization_pending" }));
      return;
    }
    if (d.done) {
      // device code ya canjeado: el runtime no debe reusarlo (no ocurre aquí)
    }
    d.done = true;
    // token FRESCO por emisión (como un servidor real): cada device flow emite
    // uno nuevo; la revocación aplica a los ya emitidos, no a los futuros
    const tok = "usr_tok_" + crypto.randomBytes(8).toString("hex");
    issued.add(tok);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        access_token: tok,
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "rt_" + crypto.randomBytes(6).toString("hex"),
        scope: "orders:read cart:write",
      })
    );
    return;
  }
  // --- plataforma: llms.txt PROTEGIDO (requiere Bearer de ANA) -------------
  const tok = bearer(req);
  if (p === "/llms.txt") {
    if (!tokenValid(tok)) {
      res.writeHead(401, { "www-authenticate": 'Bearer realm="' + BASE + '"' });
      res.end("no autenticado");
      return;
    }
    const body = [
      "# Tienda (protegida por token)",
      "",
      "## Skills",
      "",
      "- [cuenta](skills/cuenta/SKILL.md): cuenta del comprador <!-- skill: {\"version\":\"1.0.0\",\"tool\":\"skills/cuenta/tool.js\",\"tool_sha256\":\"" +
        crypto.createHash("sha256").update(TOOL_JS, "utf8").digest("hex") +
        "\"} -->",
    ].join("\n");
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end(body);
    return;
  }
  // --- plataforma: la API valida el token EN CADA request ------------------
  if (p === "/api/orders") {
    if (!tokenValid(tok)) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "token invalido" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ user: "ana", orders: [{ id: 1, item: "candelabro", total: 120 }] }));
    return;
  }
  // --- plataforma: tool.js (también protegida) ------------------------------
  if (p === "/skills/cuenta/tool.js") {
    if (!tokenValid(tok)) {
      res.writeHead(401);
      res.end("no autenticado");
      return;
    }
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(TOOL_JS);
    return;
  }
  if (p === "/skills/cuenta/SKILL.md") {
    if (!tokenValid(tok)) {
      res.writeHead(401);
      res.end("no");
      return;
    }
    res.writeHead(200, { "content-type": "text/markdown" });
    res.end("# cuenta\n\nPedidos del comprador autenticado.\n");
    return;
  }
  res.writeHead(404);
  res.end("no encontrado");
});

// ---------- sesión de runtime (spawn + MCP stdio) ---------------------------
function session(args) {
  const p = spawn(process.execPath, [BIN, ...args], { stdio: ["pipe", "pipe", "pipe"] });
  p.stdout.setEncoding("utf8");
  p.stderr.setEncoding("utf8");
  let buf = "";
  let outTxt = "";
  let errTxt = "";
  const pending = new Map();
  p.stdout.on("data", (c) => {
    outTxt += c;
    buf += c;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && pending.has(msg.id)) {
          pending.get(msg.id)(msg);
          pending.delete(msg.id);
        }
      } catch {
        // línea no-JSON en stdout: no debería pasar
      }
    }
  });
  p.stderr.on("data", (c) => {
    errTxt += c;
  });
  return {
    proc: p,
    get stdoutText() {
      return outTxt;
    },
    get stderr() {
      return errTxt;
    },
    rpc(obj) {
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("rpc timeout: " + obj.method)), 30000);
        pending.set(obj.id, (m) => {
          clearTimeout(t);
          resolve(m);
        });
        p.stdin.write(JSON.stringify(obj) + "\n");
      });
    },
  };
}

async function init(s) {
  const r = await s.rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  return r;
}

// CRED_TEST: aísla el almacén local de credenciales del usuario real
const credDir = mkdtempSync(path.join(tmpdir(), "mlive-cred-"));
process.env.USERPROFILE = credDir; // auth-device usa os.homedir()

const SESSIONS = []; // para volcar stderr de cada runtime si algo falla

server.listen(PORT, "127.0.0.1", async () => {
  console.log("plataforma fake (OAuth device flow) en :" + PORT);
  try {
    await main();
  } catch (e) {
    console.log("FAIL: " + String((e && e.message) || e));
    fail++;
  }
  if (fail !== 0) {
    for (const [i, s] of SESSIONS.entries()) {
      console.log("--- stderr runtime " + (i + 1) + " (últimas 25 líneas) ---");
      console.log(s.stderr.split("\n").slice(-25).join("\n"));
    }
  }
  console.log(fail === 0 ? "TEST AUTH DEVICE FLOW: PASS (" + pass + " checks)" : "TEST AUTH DEVICE FLOW: FAIL");
  server.close();
  process.exit(fail === 0 ? 0 : 1);
});

async function main() {
  // ---------- 1) primera activación: device flow + llamada autenticada -----
  console.log("[1] primera activación: --auth -> device flow -> token local");
  const s1 = session([BASE, "--auth", BASE, "--auth-client-id", CLIENT_ID]);
  SESSIONS.push(s1);
  // el device code llega por STDERR (stdout es protocolo MCP): el runtime está
  // en medio del descubrimiento; NO llamar initialize todavía (se encola tras él)
  const waited = await waitFor(() => s1.stderr.includes("AUTENTICACION REQUERIDA"), 15000);
  ok(waited, "runtime imprime URL de autorización por stderr (nunca stdout)");
  ok(s1.stdoutText.indexOf("KZTR-4821") === -1, "el user_code NO cruza a stdout (canal MCP limpio)");
  const m = /\/conectar\?code=(dc_[0-9a-f]+)/.exec(s1.stderr);
  ok(!!m, "verification_uri_complete con device_code en stderr");
  if (!m) throw new Error("sin device_code en stderr");
  await fetch(BASE + "/conectar?code=" + m[1]); // <- el usuario autoriza en su navegador
  const init1 = await init(s1); // responde cuando el descubrimiento terminó
  ok(init1 && init1.result && init1.result.protocolVersion !== undefined, "initialize responde tras autorizar");
  const tools = await s1.rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  ok(tools.result && Array.isArray(tools.result.tools) && tools.result.tools.some((t) => t.name === "my_orders"), "tools/list con my_orders tras autorizar");
  const call = await s1.rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "my_orders", arguments: {} } });
  const out = call.result && call.result.content && call.result.content[0] ? call.result.content[0].text : "";
  ok(out.includes("candelabro"), "tools/call my_orders -> datos AUTENTICADOS de ana" + (out.includes("candelabro") ? "" : " — obtenido: " + out.slice(0, 300)));
  ok(s1.stderr.includes("token guardado") || s1.stderr.includes("obtenido (device flow)"), "token persistido localmente");
  s1.proc.kill();
  await sleep(300);

  // ---------- 2) segunda activación: silenciosa (token en local) -----------
  console.log("[2] segunda activación: token en local -> sin device flow");
  const s2 = session([BASE, "--auth", BASE]);
  SESSIONS.push(s2);
  await init(s2);
  await waitFor(() => s2.stderr.includes("cargado (local)"), 15000);
  ok(s2.stderr.includes("cargado (local)"), "token cargado del almacén local");
  ok(s2.stderr.indexOf("AUTENTICACION REQUERIDA") === -1, "sin device flow en la segunda activación");
  const tools2 = await s2.rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  ok(tools2.result && tools2.result.tools.some((t) => t.name === "my_orders"), "tools/list OK (silencioso)");
  s2.proc.kill();
  await sleep(300);

  // ---------- 3) revocación en el servidor -> re-auth automática UNA vez ---
  console.log("[3] token revocado -> 401 -> re-auth automática (device flow de nuevo)");
  for (const t of issued) revoked.add(t); // la tienda revoca el token de ana
  const s3 = session([BASE, "--auth", BASE]);
  SESSIONS.push(s3);
  await waitFor(() => s3.stderr.includes("re-autenticando"), 15000);
  ok(s3.stderr.includes("re-autenticando"), "detecta 401 y re-autentica automáticamente");
  await waitFor(() => s3.stderr.includes("AUTENTICACION REQUERIDA"), 15000);
  ok(!!/\/conectar\?code=(dc_[0-9a-f]+)/.exec(s3.stderr), "nuevo device code tras la revocación");
  const m3 = /\/conectar\?code=(dc_[0-9a-f]+)/.exec(s3.stderr);
  if (m3) await fetch(BASE + "/conectar?code=" + m3[1]);
  await init(s3); // responde cuando la re-carga terminó
  const tools3 = await s3.rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  ok(tools3.result && tools3.result.tools.some((t) => t.name === "my_orders"), "tools/list tras re-auth");
  s3.proc.kill();
  await sleep(200);

  // ---------- 4) sin --auth contra origin protegido: fail-closed -----------
  console.log("[4] sin --auth contra origin protegido -> fail-closed (401)");
  const s4 = session([BASE]);
  SESSIONS.push(s4);
  await init(s4); // el initialize responde; el descubrimiento falla en background
  await waitFor(() => /HTTP 401/.test(s4.stderr) || s4.proc.exitCode !== null, 15000);
  ok(/HTTP 401/.test(s4.stderr), "diagnóstico claro de 401 sin credencial");
  s4.proc.kill();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(pred, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return true;
    await sleep(150);
  }
  return pred();
}