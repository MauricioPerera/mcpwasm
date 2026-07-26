// test-subpath.mjs — publicadores que viven bajo un PATH (GitHub Pages de
// proyecto, https://user.github.io/REPO). Cubre los dos runtimes end-to-end y el
// scope del sandbox. Hermetico: todo en 127.0.0.1, sin red externa.
//
// Regresiones que fija (#19, #21):
//   - pedir <host>/REPO servia en silencio las skills de <host> (HTTP 200, sin aviso)
//   - un publicador que solo existe bajo /REPO daba 404
//   - una atestacion firmada para <host>/REPO nunca casaba en el gateway
//   - una atestacion de <host>/proyecto-A casaba para <host>/proyecto-B en el local
//   - una entrada con path en ALLOWED_ORIGINS no casaba nunca (403 permanente)
//   - el sandbox no acotaba fetchOrigin al subpath del publicador

import { Miniflare } from "miniflare";
import { createServer } from "node:http";
import { createHash, generateKeyPairSync, sign as edSign } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { newQuickJSAsyncWASMModuleFromVariant, newVariant } from "quickjs-emscripten-core";
import baseAsyncifyVariant from "@jitl/quickjs-wasmfile-release-asyncify";
import { AsyncToolHost } from "./host-async.mjs";

const repo = path.dirname(fileURLToPath(import.meta.url));
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
let failures = 0;
const check = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) failures++; };

const mkTool = (name, ret) => `registerTool({ name: ${JSON.stringify(name)}, description: "t", inputSchema: { type: "object" }, handler(){ return ${JSON.stringify(ret)}; } });`;
const ROOT_TOOL = mkTool("root_tool", "RAIZ");
const PROJ_TOOL = mkTool("proj_tool", "PROYECTO");
const llms = (toolPath, hash, name) =>
  "# publisher\n\n## Skills\n\n" +
  `- [${name}](${toolPath.replace("tool.js", "SKILL.md")}): d. <!-- skill: ${JSON.stringify({ version: "1.0.0", tool: toolPath, tool_sha256: hash })} -->\n`;

// --- publicador: raiz con UNA skill, /REPO con OTRA -------------------------
let SERVE_ROOT = true;
let ATTESTATIONS = "[]";
const hits = [];
const server = createServer((req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  hits.push(p);
  const routes = {
    "/REPO/llms.txt": [llms("/REPO/t.js", sha(PROJ_TOOL), "proj_tool"), "text/plain"],
    "/REPO/t.js": [PROJ_TOOL, "application/javascript"],
    "/REPO/.well-known/agent-skills/attestations.json": [ATTESTATIONS, "application/json"],
    "/REPO/api/ok": ['{"scope":"proyecto"}', "application/json"],
    "/otro/secreto": ['{"scope":"otro-proyecto"}', "application/json"],
  };
  if (SERVE_ROOT) {
    routes["/llms.txt"] = [llms("/t.js", sha(ROOT_TOOL), "root_tool"), "text/plain"];
    routes["/t.js"] = [ROOT_TOOL, "application/javascript"];
  }
  const hit = routes[p];
  if (!hit) { res.writeHead(404, { "content-type": "text/plain" }); res.end("nf"); return; }
  res.writeHead(200, { "content-type": hit[1] });
  res.end(hit[0]);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;
const ROOT = `http://127.0.0.1:${PORT}`;
const PROJECT = `${ROOT}/REPO`;

// --- 1) runtime local -------------------------------------------------------
function runLocal(originArg) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(repo, "bin", "mcpwasm-local.mjs"), originArg]);
    let out = "", errBuf = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (errBuf += d));
    p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
    setTimeout(() => {
      p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
      setTimeout(() => {
        p.stdin.end(); p.kill();
        const names = [];
        for (const l of out.split("\n")) { if (!l.trim()) continue; try { const m = JSON.parse(l); if (m.id === 2 && m.result && m.result.tools) names.push(...m.result.tools.map((t) => t.name)); } catch {} }
        resolve({ names, err: errBuf });
      }, 3500);
    }, 6500);
  });
}

console.log("[1] runtime local con publicador bajo /REPO");
let r = await runLocal(PROJECT);
check(r.names.includes("proj_tool"), "local: <host>/REPO expone la skill del PROYECTO");
check(!r.names.includes("root_tool"), "local: NO expone la skill de la raiz (sin sustitucion silenciosa)");

r = await runLocal(ROOT);
check(r.names.includes("root_tool") && !r.names.includes("proj_tool"), "local: <host> raiz sigue exponiendo la suya (sin regresion)");

SERVE_ROOT = false;
r = await runLocal(PROJECT);
check(r.names.includes("proj_tool"), "local: publicador que SOLO existe bajo /REPO funciona (antes: 404)");
SERVE_ROOT = true;

// --- 2) scope del sandbox ---------------------------------------------------
console.log("\n[2] scope de fetchOrigin bajo un subpath");
const quickjs = await newQuickJSAsyncWASMModuleFromVariant(newVariant(baseAsyncifyVariant, {}));
const scopeHost = new AsyncToolHost({ quickjs, allowedOrigin: PROJECT });
await scopeHost.init();
scopeHost.loadToolSource(`registerTool({ name: "f", description: "", inputSchema: { type: "object" }, handler(a){ const r = host.fetchOrigin(a.p); return { status: r.status, body: r.body }; } });`);
const call = async (p) => { try { return { ok: true, out: await scopeHost.callTool("f", { p }) }; } catch (e) { return { ok: false, msg: String(e.message) }; } };

let c = await call("/REPO/api/ok");
check(c.ok && c.out.status === 200, "sandbox: path DENTRO del subpath -> permitido");
c = await call("/otro/secreto");
check(!c.ok && /fuera del scope/i.test(c.msg), "sandbox: mismo host FUERA del subpath -> bloqueado");
c = await call("https://evil.example/x");
check(!c.ok && /origin no permitido/i.test(c.msg), "sandbox: otro origin -> 'origin no permitido' (mensaje intacto)");
c = await call("/REPOevil/x");
check(!c.ok && /fuera del scope/i.test(c.msg), "sandbox: prefijo confuso /REPOevil -> bloqueado");
scopeHost.dispose();

const rootHost = new AsyncToolHost({ quickjs, allowedOrigin: ROOT });
await rootHost.init();
rootHost.loadToolSource(`registerTool({ name: "f", description: "", inputSchema: { type: "object" }, handler(a){ const r = host.fetchOrigin(a.p); return { status: r.status }; } });`);
const rc = await rootHost.callTool("f", { p: "/otro/secreto" });
check(rc.status === 200, "sandbox: publicador en la raiz sigue alcanzando todo el host (sin regresion)");
rootHost.dispose();

// --- 3) gateway -------------------------------------------------------------
console.log("\n[3] gateway con publicador bajo /REPO");
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const jwk = publicKey.export({ format: "jwk" });
let x = jwk.x.replace(/-/g, "+").replace(/_/g, "/"); while (x.length % 4) x += "=";
const PUB = Buffer.from(x, "base64").toString("base64");
const today = new Date().toISOString().slice(0, 10);
const mkAtt = (origin) => {
  const payload = Buffer.from([origin, "proj_tool", sha(PROJ_TOOL), "2026-01-01", "2030-01-01"].join("\n"), "utf8");
  return { origin, skill: "proj_tool", tool_sha256: sha(PROJ_TOOL), attester: "human:test", signed_on: "2026-01-01", valid_until: "2030-01-01", signature: edSign(null, payload, privateKey).toString("base64") };
};

function gw(allowed, extra = {}) {
  return new Miniflare({
    scriptPath: path.join(repo, "dist-gateway", "worker.js"),
    modules: true,
    modulesRules: [{ type: "ESModule", include: ["**/*.js"] }, { type: "CompiledWasm", include: ["**/*.wasm"] }],
    compatibilityDate: "2026-06-01",
    compatibilityFlags: ["nodejs_compat"],
    bindings: { ALLOWED_ORIGINS: allowed, ...extra },
  });
}
async function gwList(mf, originParam) {
  const res = await mf.dispatchFetch("http://localhost/mcp?origin=" + encodeURIComponent(originParam), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const body = await res.json();
  return { status: res.status, attest: res.headers.get("x-gw-attestations"), tools: (body.result && body.result.tools || []).map((t) => t.name) };
}

let mf = gw(PROJECT);
let g = await gwList(mf, PROJECT);
check(g.tools.includes("proj_tool") && !g.tools.includes("root_tool"), "gateway: ALLOWED_ORIGINS con path + ?origin con path -> skill del PROYECTO");
g = await gwList(mf, ROOT);
check(g.status === 403, "gateway: la raiz NO esta permitida por una entrada con path -> 403");
await mf.dispose();

mf = gw(ROOT);
g = await gwList(mf, ROOT);
check(g.tools.includes("root_tool"), "gateway: publicador en la raiz (sin regresion)");
await mf.dispose();

console.log("\n[4] atestaciones ligadas al subpath (enforcing)");
ATTESTATIONS = JSON.stringify([mkAtt(PROJECT)]);
mf = gw(PROJECT, { ATTESTATION_MODE: "enforcing", REVIEWERS: JSON.stringify({ "human:test": { public_key: PUB, registered_at: today } }) });
g = await gwList(mf, PROJECT);
check(g.tools.includes("proj_tool") && /1attested/.test(g.attest || ""), "gateway enforcing: atestacion firmada CON path -> attested (antes: unattested)");
await mf.dispose();

ATTESTATIONS = JSON.stringify([mkAtt(ROOT + "/otro-proyecto")]);
mf = gw(PROJECT, { ATTESTATION_MODE: "enforcing", REVIEWERS: JSON.stringify({ "human:test": { public_key: PUB, registered_at: today } }) });
g = await gwList(mf, PROJECT);
check(g.status !== 200 || !g.tools.includes("proj_tool"), "gateway enforcing: atestacion de OTRO proyecto del mismo host -> rechazada");
await mf.dispose();

server.close();
console.log(failures === 0 ? "\nTODOS LOS CHECKS VERDE" : `\n${failures} CHECK(S) ROJO(S)`);
process.exit(failures ? 1 : 0);
