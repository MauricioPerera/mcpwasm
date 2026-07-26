// Verifica el flujo OFFLINE de attest.mjs: firmar contra la salida del build,
// sin origin desplegado, y que el gateway REAL acepte esas firmas en enforcing.
import { Miniflare } from "miniflare";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileP = promisify(execFile);
const repo = path.dirname(fileURLToPath(import.meta.url));
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
let bad = 0;
const check = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) bad++; };

const T1 = 'registerTool({ name: "alpha", description: "d", inputSchema: { type: "object" }, handler(){ return "a"; } });';
const T2 = 'registerTool({ name: "beta", description: "d", inputSchema: { type: "object" }, handler(){ return "b"; } });';

// Publicador que sirve el llms.txt "nuevo" (post-build) y las atestaciones que
// le inyectemos. Empieza SIN atestaciones, como tras un rebuild.
let ATT = "[]";
const server = createServer((req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  const routes = {
    "/a.js": [T1, "application/javascript"],
    "/b.js": [T2, "application/javascript"],
    "/.well-known/agent-skills/attestations.json": [ATT, "application/json"],
  };
  if (p === "/llms.txt") { res.writeHead(200, { "content-type": "text/plain" }); res.end(LLMS); return; }
  const hit = routes[p];
  if (!hit) { res.writeHead(404); res.end("nf"); return; }
  res.writeHead(200, { "content-type": hit[1] });
  res.end(hit[0]);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const LLMS = "# p\n\n## Skills\n\n" +
  `- [alpha](/a.md): d. <!-- skill: ${JSON.stringify({ version: "1.0.0", tool: "/a.js", tool_sha256: sha(T1) })} -->\n` +
  `- [beta](/b.md): d. <!-- skill: ${JSON.stringify({ version: "1.0.0", tool: "/b.js", tool_sha256: sha(T2) })} -->\n`;

const keyDir = mkdtempSync(path.join(tmpdir(), "att-"));
const attestJs = path.join(repo, "scripts", "attest.mjs");
const run = (...a) => execFileP(process.execPath, [attestJs, ...a], { cwd: keyDir, encoding: "utf8" });
const PUB = (await run("keygen")).stdout.trim();

// (1) la salida del build: un llms.txt local, y un worker generado que lo embebe
const llmsPath = path.join(keyDir, "llms.txt");
writeFileSync(llmsPath, LLMS, "utf8");
const workerPath = path.join(keyDir, "worker.mjs");
writeFileSync(workerPath, "const LLMS_TXT = " + JSON.stringify(LLMS) + ";\nexport default {};\n", "utf8");

// (2) firmar SIN red: el origin todavia sirve lo viejo (aqui: sin atestaciones)
const fromLlms = JSON.parse((await run("sign", ORIGIN, "--all", "2030-01-01", "--llms", llmsPath)).stdout);
check(Array.isArray(fromLlms) && fromLlms.length === 2, "--all firma TODAS las skills del llms.txt (array listo para attestations.json)");
check(fromLlms.every((a) => a.tool_sha256 === sha(a.skill === "alpha" ? T1 : T2)), "--llms: los hashes firmados salen de la fuente LOCAL");

const fromWorker = JSON.parse((await run("sign", ORIGIN, "alpha", "2030-01-01", "--from-worker", workerPath)).stdout);
check(fromWorker.tool_sha256 === sha(T1), "--from-worker: extrae LLMS_TXT del worker generado y firma el hash correcto");
check(fromWorker.skill === "alpha" && !Array.isArray(fromWorker), "firma de una sola skill sigue emitiendo un objeto (compatibilidad)");

// (3) el gateway REAL debe aceptarlas en enforcing
ATT = JSON.stringify(fromLlms);
const mf = new Miniflare({
  scriptPath: path.join(repo, "dist-gateway", "worker.js"),
  modules: true,
  modulesRules: [{ type: "ESModule", include: ["**/*.js"] }, { type: "CompiledWasm", include: ["**/*.wasm"] }],
  compatibilityDate: "2026-06-01",
  compatibilityFlags: ["nodejs_compat"],
  bindings: {
    ALLOWED_ORIGINS: ORIGIN,
    ATTESTATION_MODE: "enforcing",
    REVIEWERS: JSON.stringify({ "human:mauricio": { public_key: PUB, registered_at: "2026-01-01" } }),
  },
});
const res = await mf.dispatchFetch("http://localhost/mcp?origin=" + encodeURIComponent(ORIGIN), {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
});
const body = await res.json();
const names = (body.result && body.result.tools || []).map((t) => t.name);
console.log("   gateway enforcing ->", res.headers.get("x-gw-attestations"), "| tools:", names.join(", ") || "(ninguna)");
check(names.includes("alpha") && names.includes("beta"), "el gateway en ENFORCING carga las 2 skills con las firmas hechas offline");
check(/2attested/.test(res.headers.get("x-gw-attestations") || ""), "X-Gw-Attestations reporta 2attested");
await mf.dispose();

server.close();
rmSync(keyDir, { recursive: true, force: true });
console.log(bad === 0 ? "\nOK" : `\n${bad} ROJO(S)`);
process.exit(bad ? 1 : 0);
