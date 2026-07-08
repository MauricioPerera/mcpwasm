// test-local.mjs — e2e HERMETICO del runtime MCP local (bin/mcpwasm-local.mjs).
//
// Levanta un publisher fake en http://127.0.0.1:<puerto> (llms.txt + tool.js,
// sha256 reales computados sobre los bytes servidos, + una skill con hash
// DELIBERADAMENTE roto), spawnea el binario apuntando a ese origin y habla MCP
// por stdio: initialize -> notifications/initialized -> tools/list ->
// tools/call (pura y con fetchOrigin). Sin red externa: todo es localhost.
//
// Checks:
//   1. initialize -> result con serverInfo.name = mcpwasm-local.
//   2. notifications/initialized -> SIN respuesta.
//   3. tools/list -> sum_numbers y origin_time; corrupt NO listada (hash roto).
//   4. tools/call sum_numbers {a:2,b:40} -> structuredContent.result 42.
//   5. tools/call origin_time -> epoch numerico (fetchOrigin al origin local).
//   6. tools/call a tool inexistente -> isError:true (error de tool, no crash).

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

const SUM_TOOL = `registerTool({
  name: "sum_numbers",
  description: "Sum two numbers a and b.",
  inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] },
  handler(args) { return Number(args.a) + Number(args.b); }
});`;

const TIME_TOOL = `registerTool({
  name: "origin_time",
  description: "Fetch /api/time from the publishing origin.",
  inputSchema: { type: "object", properties: {} },
  handler: async function () {
    const r = await host.fetchOrigin("/api/time");
    return JSON.parse(r.body);
  }
});`;

const CORRUPT_TOOL = `registerTool({
  name: "corrupt",
  description: "Su hash declarado es incorrecto: NO debe cargar.",
  inputSchema: { type: "object", properties: {} },
  handler() { return { ok: true }; }
});`;

function llmsTxt() {
  return (
    "# fake publisher local\n\n## Skills\n\n" +
    `- [sum_numbers](/skills/sum_numbers/SKILL.md): Sum two numbers. <!-- skill: ${JSON.stringify({ version: "1.0.0", tool: "/skills/sum_numbers/tool.js", tool_sha256: sha(SUM_TOOL) })} -->\n` +
    `- [origin_time](/skills/origin_time/SKILL.md): Origin time. <!-- skill: ${JSON.stringify({ version: "1.0.0", tool: "/skills/origin_time/tool.js", tool_sha256: sha(TIME_TOOL) })} -->\n` +
    `- [corrupt](/skills/corrupt/SKILL.md): Hash roto a proposito. <!-- skill: ${JSON.stringify({ version: "1.0.0", tool: "/skills/corrupt/tool.js", tool_sha256: "0".repeat(64) })} -->\n`
  );
}

const server = createServer((req, res) => {
  const u = new URL(req.url, "http://127.0.0.1");
  const send = (status, body, ct = "text/plain; charset=utf-8") => {
    res.writeHead(status, { "content-type": ct });
    res.end(body);
  };
  if (u.pathname === "/llms.txt") return send(200, llmsTxt());
  if (u.pathname === "/skills/sum_numbers/tool.js") return send(200, SUM_TOOL, "application/javascript");
  if (u.pathname === "/skills/origin_time/tool.js") return send(200, TIME_TOOL, "application/javascript");
  if (u.pathname === "/skills/corrupt/tool.js") return send(200, CORRUPT_TOOL, "application/javascript");
  if (u.pathname === "/api/time") return send(200, JSON.stringify({ epoch: 1788254400000 }), "application/json");
  return send(404, "not found");
});

let failures = 0;
function check(cond, msg) {
  console.log((cond ? "PASS " : "FAIL ") + msg);
  if (!cond) failures++;
}

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const ORIGIN = "http://127.0.0.1:" + port;
console.log("publisher fake en " + ORIGIN);

const binPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "bin", "mcpwasm-local.mjs");
const child = spawn(process.execPath, [binPath, ORIGIN], { stdio: ["pipe", "pipe", "pipe"] });

const stderrLines = [];
child.stderr.on("data", (d) => {
  for (const l of String(d).split(/\r?\n/)) if (l.trim()) stderrLines.push(l);
});

// Lector de respuestas: una linea JSON por respuesta, en orden (el runtime
// procesa en serie). Cada waiter toma la siguiente linea.
const pending = [];
const waiting = [];
let buf = "";
child.stdout.on("data", (d) => {
  buf += String(d);
  let i;
  while ((i = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const w = waiting.shift();
    if (w) w(line);
    else pending.push(line);
  }
});

function nextLine(timeoutMs = 30000) {
  if (pending.length > 0) return Promise.resolve(pending.shift());
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout esperando respuesta del runtime")), timeoutMs);
    waiting.push((l) => {
      clearTimeout(t);
      resolve(l);
    });
  });
}

function send(obj) {
  child.stdin.write(JSON.stringify(obj) + "\n");
}

try {
  // 1) initialize (encola detras del descubrimiento; el primer await cubre el arranque)
  send({ jsonrpc: "2.0", id: 1, method: "initialize" });
  const init = JSON.parse(await nextLine(60000));
  console.log("[1] initialize ->", JSON.stringify(init).slice(0, 160));
  check(init.result && init.result.serverInfo && init.result.serverInfo.name === "mcpwasm-local",
    "initialize: serverInfo.name = mcpwasm-local");

  // 2) notificacion: NO debe producir respuesta (la siguiente linea que llegue
  //    debe ser la respuesta del tools/list, id 2)
  send({ jsonrpc: "2.0", method: "notifications/initialized" });

  // 3) tools/list
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const list = JSON.parse(await nextLine());
  console.log("[3] tools/list ->", JSON.stringify(list).slice(0, 200));
  check(list.id === 2, "notificacion sin respuesta (la linea siguiente es id=2, no la notificacion)");
  const names = ((list.result && list.result.tools) || []).map((t) => t.name);
  check(names.includes("sum_numbers"), "tools/list contiene sum_numbers");
  check(names.includes("origin_time"), "tools/list contiene origin_time");
  check(!names.includes("corrupt"), "corrupt (hash roto) NO listada");
  check(stderrLines.some((l) => /corrupt/.test(l) && /sha256 mismatch/.test(l)),
    "stderr registra el rechazo de corrupt por sha256 mismatch");

  // 4) tools/call pura
  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "sum_numbers", arguments: { a: 2, b: 40 } } });
  const sum = JSON.parse(await nextLine());
  console.log("[4] sum_numbers ->", JSON.stringify(sum).slice(0, 160));
  check(sum.result && sum.result.structuredContent && sum.result.structuredContent.result === 42,
    "sum_numbers(2,40) -> structuredContent.result 42");

  // 5) tools/call con fetchOrigin al origin local
  send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "origin_time", arguments: {} } });
  const time = JSON.parse(await nextLine());
  console.log("[5] origin_time ->", JSON.stringify(time).slice(0, 160));
  check(time.result && time.result.structuredContent && typeof time.result.structuredContent.epoch === "number",
    "origin_time -> epoch numerico via host.fetchOrigin");

  // 6) tool inexistente -> isError, no crash
  send({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "nope", arguments: {} } });
  const nope = JSON.parse(await nextLine());
  console.log("[6] tool inexistente ->", JSON.stringify(nope).slice(0, 160));
  check(nope.result && nope.result.isError === true, "tool inexistente -> isError:true (error de tool, no crash)");
} catch (e) {
  console.error("ERROR en test-local:", e && e.stack ? e.stack : e);
  failures++;
} finally {
  child.stdin.end();
  await new Promise((r) => child.on("exit", r));
  server.close();
}

console.log("\n" + (failures === 0 ? "TODOS LOS CHECKS VERDE" : failures + " CHECK(S) ROJO(S)"));
process.exit(failures === 0 ? 0 : 1);
