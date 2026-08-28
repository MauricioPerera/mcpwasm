// test-sqlite.mjs — e2e HERMETICO de la capability sqlite (--sqlite) del
// runtime MCP local. Dos secciones:
//
// 1. UNIT: makeSqliteCapability directa — policy readonly (SELECT/PRAGMA/EXPLAIN
//    ok, INSERT rechazado con mensaje claro), params, forma objeto y array,
//    multi-statement rechazada, maxRows/truncated, escritura con write:true.
// 2. E2E: publisher fake (llms.txt + tool.js que usa host.sqlite), runtime con
//    --sqlite <archivo> -> SELECT ok, INSERT rechazado (solo lectura);
//    reinicio con --sqlite-write -> INSERT ok y PERSISTIDO en el archivo;
//    --sqlite-write sin --sqlite -> exit 2 (validacion de args).
//
// Todo localhost/temporal: sin red externa.

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
import { makeSqliteCapability } from "./sqlite-capability.mjs";
import { DatabaseSync } from "node:sqlite";

const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const here = path.dirname(fileURLToPath(import.meta.url));

// ---------------- seccion 1: unit ----------------
async function unit() {
  const cap = await makeSqliteCapability({ path: ":memory:", write: false });

  // forma objeto: SELECT
  const sel = JSON.parse(await cap(JSON.stringify({ sql: "SELECT 1+1 AS dos" })));
  assert.strictEqual(sel.rows[0].dos, 2);
  assert.strictEqual(sel.count, 1);

  // forma array con params
  const par = JSON.parse(await cap(JSON.stringify(["SELECT ? AS x", ["hola"]])));
  assert.strictEqual(par.rows[0].x, "hola");

  // readonly: INSERT rechazado por policy (mensaje claro)
  const ins = JSON.parse(await cap(JSON.stringify(["INSERT INTO t VALUES (1)"])));
  assert.match(ins.error, /SOLO LECTURA/);

  // multi-statement rechazada (guard anti SQL stacking)
  const multi = JSON.parse(await cap(JSON.stringify(["SELECT 1; SELECT 2"])));
  assert.match(multi.error, /una sola statement/);

  // forma array con objeto
  const obj = JSON.parse(await cap(JSON.stringify([{ sql: "SELECT 42 AS n" }])));
  assert.strictEqual(obj.rows[0].n, 42);

  // write:true: DDL + DML, y persistence en el mismo handle
  const wcap = await makeSqliteCapability({ path: ":memory:", write: true });
  const cr = JSON.parse(await wcap(JSON.stringify(["CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)"])));
  assert.strictEqual(cr.changes, 0);
  const put = JSON.parse(await wcap(JSON.stringify(["INSERT INTO t (name) VALUES (?)", ["lamp"]])));
  assert.strictEqual(put.changes, 1);
  const back = JSON.parse(await wcap(JSON.stringify(["SELECT id, name FROM t"])));
  assert.strictEqual(back.rows.length, 1);
  assert.strictEqual(back.rows[0].name, "lamp");

  // maxRows + truncated
  await wcap(JSON.stringify(["INSERT INTO t (name) SELECT name FROM t"])); // 2
  await wcap(JSON.stringify(["INSERT INTO t (name) SELECT name FROM t"])); // 4
  const cap500 = await makeSqliteCapability({ path: ":memory:", write: true, maxRows: 3 });
  await cap500(JSON.stringify(["CREATE TABLE big (id INTEGER PRIMARY KEY)"]));
  for (let i = 0; i < 5; i++) await cap500(JSON.stringify(["INSERT INTO big DEFAULT VALUES"]));
  const big = JSON.parse(await cap500(JSON.stringify(["SELECT id FROM big"])));
  assert.strictEqual(big.count, 3);
  assert.strictEqual(big.truncated, true);

  console.log("unit sqlite-capability: OK");
}

// ---------------- seccion 2: e2e ----------------
const DB_DEMO_TOOL = `registerTool({
  name: "db_rows",
  description: "SELECT rows from the mounted SQLite via the injected capability.",
  inputSchema: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] },
  handler: async function (args) {
    return await host.sqlite({ sql: args.sql });
  }
});
registerTool({
  name: "db_add",
  description: "INSERT a row (requires --sqlite-write).",
  inputSchema: { type: "object", properties: { name: { type: "string" }, price: { type: "number" } }, required: ["name", "price"] },
  handler: async function (args) {
    return await host.sqlite({ sql: "INSERT INTO items (name, price) VALUES (?, ?)", params: [args.name, args.price] });
  }
});`;

function mcpRpc(child, obj) {
  return new Promise((resolve) => {
    const onLine = (d) => {
      for (const line of d.toString().split("\n")) {
        if (!line.trim()) continue;
        try {
          const m = JSON.parse(line);
          if (m.id === obj.id) {
            child.stdout.off("data", onLine);
            resolve(m);
          }
        } catch {}
      }
    };
    child.stdout.on("data", onLine);
    child.stdin.write(JSON.stringify(obj) + "\n");
  });
}

async function spawnRuntime(args) {
  const bin = path.join(here, "bin", "mcpwasm-local.mjs");
  const child = spawn(process.execPath, [bin, ...args], { stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (c) => { stderr += c; });
  child.stderrTail = () => stderr.split("\n").filter(Boolean).slice(-2).join(" / ");
  await new Promise((r) => setTimeout(r, 2500)); // discovery
  return child;
}

async function e2e() {
  const tmp = mkdtempSync(path.join(tmpdir(), "mcpwasm-sqlite-"));
  const dbFile = path.join(tmp, "data.db");

  // DB de archivo del CONSUMIDOR: tabla + 2 filas, cerrada antes del runtime
  const pre = new DatabaseSync(dbFile);
  pre.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, price REAL)");
  pre.exec("INSERT INTO items (name, price) VALUES ('lamp', 42.5), ('desk', 199.0)");
  pre.close();

  const toolSha = sha(DB_DEMO_TOOL);
  const llmsTxt =
    "# sqlite demo\n\n## Skills\n\n" +
    "- [db_demo](/skills/db_demo/SKILL.md): SQL over the consumer-mounted SQLite. " +
    '<!-- skill: {"version":"1.0.0","tool":"/skills/db_demo/tool.js","tool_sha256":"' + toolSha + '"} -->\n';

  const server = createServer((req, res) => {
    const p = new URL(req.url, "http://x").pathname;
    if (p === "/llms.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(llmsTxt);
    } else if (p === "/skills/db_demo/tool.js") {
      res.writeHead(200, { "content-type": "application/javascript" });
      res.end(DB_DEMO_TOOL);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;

  // --- escenario 1: readonly por defecto ---
  let c = await spawnRuntime([origin, "--sqlite", dbFile]);
  c.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } }) + "\n");
  c.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const init = await mcpRpc(c, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
  assert.strictEqual(init.result.serverInfo.name, "mcpwasm-local");
  const list = await mcpRpc(c, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  const names = (list.result.tools || []).map((t) => t.name);
  assert.ok(names.includes("db_rows") && names.includes("db_add"), "tools db_demo listadas: " + names.join(", "));

  const rows = await mcpRpc(c, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "db_rows", arguments: { sql: "SELECT name, price FROM items ORDER BY price DESC" } } });
  assert.ok(!rows.result.isError, "SELECT ok en readonly");
  const parsedRows = JSON.parse(rows.result.content[0].text);
  assert.strictEqual(parsedRows.rows.length, 2);
  assert.strictEqual(parsedRows.rows[0].name, "desk");

  const denied = await mcpRpc(c, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "db_add", arguments: { name: "chair", price: 10 } } });
  // fail controlado: la capability devuelve {error} (el agente lo lee), no excepcion
  assert.match(denied.result.content[0].text, /SOLO LECTURA/);
  assert.strictEqual(denied.result.structuredContent.error.includes("SOLO LECTURA"), true);

  const stacked = await mcpRpc(c, { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "db_rows", arguments: { sql: "SELECT 1; SELECT 2" } } });
  assert.match(stacked.result.content[0].text, /una sola statement/);
  c.kill();

  // --- escenario 2: --sqlite-write -> INSERT ok y persistido ---
  c = await spawnRuntime([origin, "--sqlite", dbFile, "--sqlite-write"]);
  c.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } }) + "\n");
  c.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  await mcpRpc(c, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
  const put = await mcpRpc(c, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "db_add", arguments: { name: "chair", price: 79.9 } } });
  assert.ok(!put.result.isError, "INSERT ok con --sqlite-write: " + (put.result.content ? put.result.content[0].text : ""));
  const after = await mcpRpc(c, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "db_rows", arguments: { sql: "SELECT name FROM items" } } });
  const afterRows = JSON.parse(after.result.content[0].text);
  assert.strictEqual(afterRows.rows.length, 3, "INSERT persistido en el archivo");
  assert.ok(afterRows.rows.some((r) => r.name === "chair"));
  c.kill();

  // --- escenario 3: --sqlite-write sin --sqlite -> exit 2 (validacion) ---
  const code = await new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(here, "bin", "mcpwasm-local.mjs"), origin, "--sqlite-write"], { stdio: ["ignore", "ignore", "pipe"] });
    p.stderr.setEncoding("utf8");
    let errTxt = "";
    p.stderr.on("data", (c) => { errTxt += c; });
    p.on("exit", (code2) => resolve({ code: code2, err: errTxt }));
  });
  assert.strictEqual(code.code, 2, "--sqlite-write sin --sqlite debe salir 2, salio " + code.code);

  server.close();
  rmSync(tmp, { recursive: true, force: true });
  console.log("e2e sqlite (--sqlite readonly/write + validacion args): OK");
}

// ---------------- runner ----------------
unit()
  .then(() => e2e())
  .then(() => {
    console.log("TEST SQLITE: PASS");
    process.exit(0);
  })
  .catch((e) => {
    console.error("TEST SQLITE: FAIL —", (e && e.message) || e);
    process.exit(1);
  });

