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
//
// Segunda seccion (--serve): un directorio real en disco (mkdtemp) sirve de
// "git clone" fake; verifica el flujo completo end-to-end sobre el file
// server interno, ademas de la defensa contra directory traversal.

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { initSync as memInit, WasmOkfIndex } from "@rckflr/minimemory";

const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

// Snapshot de origin-memory REAL (BM25), construido aqui mismo con minimemory:
// dos conceptos distinguibles para poder asertar hits relevantes vs 0 hits.
const _require = createRequire(import.meta.url);
memInit({ module: readFileSync(_require.resolve("@rckflr/minimemory/minimemory_bg.wasm")) });
const _memIdx = WasmOkfIndex.with_chunk_size(800, 50);
_memIdx.ingest_concept(
  "returns-policy",
  "---\ntype: docs\ntitle: Returns policy\n---\nCustomers can return any product within thirty days of purchase for a full refund. Returns require the original receipt and unused condition."
);
_memIdx.ingest_concept(
  "shipping-info",
  "---\ntype: docs\ntitle: Shipping info\n---\nStandard shipping takes five business days. Express shipping arrives in two days for an extra fee."
);
const MEM_SNAPSHOT = _memIdx.export_snapshot();
const MEM_SNAPSHOT_SHA = sha(MEM_SNAPSHOT);

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

const SEARCH_TOOL = `registerTool({
  name: "search_mem",
  description: "BM25 search over the origin memory snapshot.",
  inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
  handler: async function (args) {
    const r = await host.memorySearch(args.q, 5);
    return r;
  }
});`;

// declaredMemHash es mutable a proposito: el escenario [memory-tamper] re-usa el
// mismo server declarando un hash FALSO para el mismo snapshot servido.
let declaredMemHash = MEM_SNAPSHOT_SHA;

function llmsTxt() {
  return (
    "# fake publisher local\n\n" +
    `<!-- skills-memory: ${JSON.stringify({ snapshot: "/mem.snapshot", snapshot_sha256: declaredMemHash, format: "minimemory-okf-v1" })} -->\n\n` +
    "## Skills\n\n" +
    `- [sum_numbers](/skills/sum_numbers/SKILL.md): Sum two numbers. <!-- skill: ${JSON.stringify({ version: "1.0.0", tool: "/skills/sum_numbers/tool.js", tool_sha256: sha(SUM_TOOL) })} -->\n` +
    `- [origin_time](/skills/origin_time/SKILL.md): Origin time. <!-- skill: ${JSON.stringify({ version: "1.0.0", tool: "/skills/origin_time/tool.js", tool_sha256: sha(TIME_TOOL) })} -->\n` +
    `- [search_mem](/skills/search_mem/SKILL.md): Search origin memory. <!-- skill: ${JSON.stringify({ version: "1.0.0", tool: "/skills/search_mem/tool.js", tool_sha256: sha(SEARCH_TOOL) })} -->\n` +
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
  if (u.pathname === "/skills/search_mem/tool.js") return send(200, SEARCH_TOOL, "application/javascript");
  if (u.pathname === "/skills/corrupt/tool.js") return send(200, CORRUPT_TOOL, "application/javascript");
  if (u.pathname === "/mem.snapshot") return send(200, MEM_SNAPSHOT, "application/json");
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

  // 7) origin-memory: snapshot verificado -> host.memorySearch inyectada.
  check(stderrLines.some((l) => /origin-memory: snapshot verificado/.test(l)),
    "stderr confirma snapshot verificado + memorySearch inyectada");
  send({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "search_mem", arguments: { q: "refund returns thirty days" } } });
  const mem = JSON.parse(await nextLine());
  console.log("[7] search_mem(refund) ->", JSON.stringify(mem).slice(0, 200));
  const memHits = mem.result && mem.result.structuredContent && mem.result.structuredContent.hits;
  check(Array.isArray(memHits) && memHits.length > 0, "search_mem: query relevante -> hits no vacios");
  check(memHits && memHits[0] && typeof memHits[0].score === "number" && /return|refund/i.test(memHits[0].text || ""),
    "search_mem: top hit con score numerico y texto del concepto correcto (returns-policy)");

  // 8) origin-memory: query sin relacion -> 0 hits (BM25 real, no eco).
  send({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "search_mem", arguments: { q: "receta de paella valenciana" } } });
  const memMiss = JSON.parse(await nextLine());
  console.log("[8] search_mem(paella) ->", JSON.stringify(memMiss).slice(0, 160));
  const missHits = memMiss.result && memMiss.result.structuredContent && memMiss.result.structuredContent.hits;
  check(Array.isArray(missHits) && missHits.length === 0, "search_mem: query sin relacion -> 0 hits");
} catch (e) {
  console.error("ERROR en test-local:", e && e.stack ? e.stack : e);
  failures++;
} finally {
  child.stdin.end();
  const exitCode = await new Promise((r) => child.on("exit", (code) => r(code)));
  check(exitCode === 0, "el proceso termina con exit code 0 (sin --serve)");
}

// ---------------------------------------------------------------------------
// [memory-tamper] mismo server, hash del snapshot DECLARADO falso: la memoria
// NO debe inyectarse (fail-closed), search_mem falla controlado (isError:true)
// y el resto de las skills sigue funcionando.
console.log("\n[memory-tamper] snapshot con sha256 declarado falso:");
declaredMemHash = "0".repeat(64);
{
  const child2 = spawn(process.execPath, [binPath, ORIGIN], { stdio: ["pipe", "pipe", "pipe"] });
  const stderr2 = [];
  child2.stderr.on("data", (d) => {
    for (const l of String(d).split(/\r?\n/)) if (l.trim()) stderr2.push(l);
  });
  const pending2 = [];
  const waiting2 = [];
  let buf2 = "";
  child2.stdout.on("data", (d) => {
    buf2 += String(d);
    let i;
    while ((i = buf2.indexOf("\n")) !== -1) {
      const line = buf2.slice(0, i).trim();
      buf2 = buf2.slice(i + 1);
      if (!line) continue;
      const w = waiting2.shift();
      if (w) w(line);
      else pending2.push(line);
    }
  });
  const nextLine2 = (timeoutMs = 60000) => {
    if (pending2.length > 0) return Promise.resolve(pending2.shift());
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout (memory-tamper)")), timeoutMs);
      waiting2.push((l) => {
        clearTimeout(t);
        resolve(l);
      });
    });
  };
  try {
    child2.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_mem", arguments: { q: "refund" } } }) + "\n");
    const tampered = JSON.parse(await nextLine2());
    console.log("[tamper] search_mem ->", JSON.stringify(tampered).slice(0, 200));
    check(tampered.result && tampered.result.isError === true,
      "memory-tamper: search_mem -> isError:true (capability ausente, fallo controlado, no crash)");
    check(stderr2.some((l) => /origin-memory: snapshot sha256 mismatch/.test(l)),
      "memory-tamper: stderr registra el sha256 mismatch del snapshot");
    check(!stderr2.some((l) => /snapshot verificado/.test(l)),
      "memory-tamper: la capability NO se reporta como inyectada");

    child2.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "sum_numbers", arguments: { a: 20, b: 22 } } }) + "\n");
    const sum2 = JSON.parse(await nextLine2());
    check(sum2.result && sum2.result.structuredContent && sum2.result.structuredContent.result === 42,
      "memory-tamper: el resto de las skills sigue funcionando (sum_numbers -> 42)");
  } catch (e) {
    console.error("ERROR en memory-tamper:", e && e.stack ? e.stack : e);
    failures++;
  } finally {
    child2.stdin.end();
    await new Promise((r) => child2.on("exit", () => r()));
    server.close();
  }
}

// ---------------------------------------------------------------------------
// [--serve] directorio real en disco (simula un git clone) + file server
// interno del runtime + defensa contra directory traversal.
console.log("\n[--serve] directorio local -> file server interno -> MCP:");

const servedDir = mkdtempSync(path.join(tmpdir(), "mcpwasm-serve-test-"));
const outsideSecretPath = path.join(tmpdir(), "mcpwasm-serve-test-secret.txt");
writeFileSync(outsideSecretPath, "secreto que NO debe ser servible", "utf8");
try {
  mkdirSync(path.join(servedDir, "skills", "sum_numbers"), { recursive: true });
  writeFileSync(path.join(servedDir, "skills", "sum_numbers", "tool.js"), SUM_TOOL, "utf8");
  writeFileSync(
    path.join(servedDir, "llms.txt"),
    "# fake repo local (--serve)\n\n## Skills\n\n" +
      `- [sum_numbers](/skills/sum_numbers/SKILL.md): Sum two numbers. <!-- skill: ${JSON.stringify({ version: "1.0.0", tool: "/skills/sum_numbers/tool.js", tool_sha256: sha(SUM_TOOL) })} -->\n`,
    "utf8"
  );

  const servePort = 8956; // fijo: la prueba de traversal necesita conocer el puerto de antemano
  const serveChild = spawn(process.execPath, [binPath, "--serve", servedDir, "--port", String(servePort)], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const serveStderr = [];
  serveChild.stderr.on("data", (d) => {
    for (const l of String(d).split(/\r?\n/)) if (l.trim()) serveStderr.push(l);
  });
  const servePending = [];
  const serveWaiting = [];
  let serveBuf = "";
  serveChild.stdout.on("data", (d) => {
    serveBuf += String(d);
    let i;
    while ((i = serveBuf.indexOf("\n")) !== -1) {
      const line = serveBuf.slice(0, i).trim();
      serveBuf = serveBuf.slice(i + 1);
      if (!line) continue;
      const w = serveWaiting.shift();
      if (w) w(line);
      else servePending.push(line);
    }
  });
  function serveNextLine(timeoutMs = 30000) {
    if (servePending.length > 0) return Promise.resolve(servePending.shift());
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      serveWaiting.push((l) => {
        clearTimeout(t);
        resolve(l);
      });
    });
  }

  try {
    serveChild.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "sum_numbers", arguments: { a: 11, b: 31 } } }) + "\n");
    const res = JSON.parse(await serveNextLine(60000));
    console.log("[--serve] sum_numbers(11,31) ->", JSON.stringify(res).slice(0, 160));
    check(res.result && res.result.structuredContent && res.result.structuredContent.result === 42,
      "--serve: descubrimiento + sandbox end-to-end sobre el file server interno -> 42");
    check(serveStderr.some((l) => /solo 127\.0\.0\.1, no expuesto a la red/.test(l)),
      "--serve: stderr confirma bind solo a 127.0.0.1");

    // Directory traversal: pedir directo por HTTP al file server interno un
    // path que intenta escapar del directorio servido.
    const traversalAttempts = [
      "/../mcpwasm-serve-test-secret.txt",
      "/skills/../../mcpwasm-serve-test-secret.txt",
      "/..%2fmcpwasm-serve-test-secret.txt",
    ];
    let allBlocked = true;
    for (const t of traversalAttempts) {
      const r = await fetch("http://127.0.0.1:" + servePort + t);
      if (r.status === 200) allBlocked = false;
    }
    check(allBlocked, "--serve: 3 intentos de directory traversal -> ninguno devuelve 200 (todos bloqueados)");

    const legit = await fetch("http://127.0.0.1:" + servePort + "/llms.txt");
    check(legit.status === 200, "--serve: /llms.txt legitimo sigue sirviendose (200) tras el hardening de traversal");
  } finally {
    serveChild.stdin.end();
    const serveExitCode = await new Promise((r) => serveChild.on("exit", (code) => r(code)));
    // Regresion real: process.exit() forzado justo despues de server.close()
    // (ambos async) disparaba una condicion de carrera de doble-cierre de
    // handle que en Windows terminaba el proceso con exit code 127 (via
    // "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" de libuv),
    // aun cuando la respuesta por stdout ya habia sido correcta. No
    // reproduce en Linux/CI, pero el exit code 0 es la asercion correcta
    // en cualquier plataforma.
    check(serveExitCode === 0, "--serve: el proceso termina con exit code 0 (sin el crash de libuv en Windows)");
  }

  // --serve con directorio inexistente: debe fallar rapido con exit != 0, sin colgar.
  const badDirChild = spawn(process.execPath, [binPath, "--serve", path.join(servedDir, "no-existe")], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  badDirChild.stdin.end();
  const badDirExit = await new Promise((r) => badDirChild.on("exit", (code) => r(code)));
  check(badDirExit !== 0, "--serve con directorio inexistente: el proceso termina con exit code != 0");
} finally {
  rmSync(servedDir, { recursive: true, force: true });
  rmSync(outsideSecretPath, { force: true });
}

console.log("\n" + (failures === 0 ? "TODOS LOS CHECKS VERDE" : failures + " CHECK(S) ROJO(S)"));
process.exit(failures === 0 ? 0 : 1);
