// test-studio-e2e.mjs — E2E de la plataforma: el runtime local REAL (npx pattern)
// contra un origin studio local (servido con --serve) y una API de Cloudflare FAKE.
//
// Flujo verificado: descubrimiento del llms.txt con verificacion de hashes ->
// initialize -> tools/list (3 tools del studio) -> tools/call create_preview
// (ejecuta el tool.js REAL dentro del sandbox QuickJS -> host.provisionPreview
// -> challenge+PoW+create+deploy contra la API fake) -> previewUrl/claimUrl ->
// reuso con sid -> discard. El apiToken NUNCA aparece en ninguna respuesta del
// MCP ni en el store visible por el LLM.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";

const PORT = 12481; // origin studio fake
const CF_PORT = 12482; // API de Cloudflare fake
const CHECKS = [];
const check = (ok, label) => { CHECKS.push(ok); console.log(`  ${ok ? "ok" : "FALLO"}: ${label}`); };

// --- API de Cloudflare fake ---------------------------------------------------
const challenges = new Map();
let creations = 0;
let deploys = 0;
const cf = http.createServer((req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const json = (status, obj) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (req.method === "POST" && p.endsWith("/provisioning/previews/challenge")) {
      const seed = Buffer.from("cfseed-cfseed-cf!");
      const token = "ct-" + creations;
      challenges.set(token, seed);
      return json(200, { result: { challengeToken: token, seed: seed.toString("base64url"), k: 2, g: 3 } });
    }
    if (req.method === "POST" && p.endsWith("/provisioning/previews")) {
      const body2 = JSON.parse(body);
      const seed = challenges.get(body2.challengeToken);
      if (!seed) return json(403, { errors: [{ code: 999, message: "challenge desconocido" }] });
      let h = createHash("sha256").update(seed).digest();
      const expected = [h];
      for (let j = 0; j < 2; j++) {
        for (let i = 0; i < 3; i++) h = createHash("sha256").update(h).digest();
        expected.push(h);
      }
      const got = Buffer.from(body2?.solution?.checkpoints || "", "base64");
      const okPow = expected.every((cp, i) => got.subarray(i * 32, (i + 1) * 32).equals(cp));
      if (!okPow) return json(403, { errors: [{ code: 999, message: "PoW invalido" }] });
      creations++;
      const now = Date.now();
      return json(201, { result: {
        account: { id: "acc" + creations, name: "Studio Live " + creations, apiToken: "STUDIO-TOKEN-" + creations, expiresAt: new Date(now + 3600000).toISOString() },
        claim: { url: "https://dash.cloudflare.com/claim-preview?token=fake" + creations, expiresAt: new Date(now + 3600000).toISOString() },
      } });
    }
    const scriptM = p.match(/\/accounts\/[^/]+\/workers\/scripts\/([^/]+)$/);
    if (scriptM) {
      if (req.method === "PUT") { deploys++; return json(200, { result: { id: scriptM[1] } }); }
      if (req.method === "DELETE") return json(200, { result: { id: scriptM[1] } });
      if (req.method === "POST") return json(200, { result: { enabled: true } });
    }
    if (req.method === "GET" && p.match(/\/workers\/subdomain$/)) return json(200, { result: { subdomain: "studio-e2e" } });
    json(404, { errors: [{ code: 1, message: "no" }] });
  });
});

// --- origin studio (los archivos generados por studio/build.mjs) ---------------
const origin = http.createServer((req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  const md = (t) => { res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" }); res.end(t); };
  const js = (t) => { res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" }); res.end(t); };
  if (p === "/llms.txt") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end(llmsText);
  }
  if (p === "/skills/create_preview/SKILL.md") return md(skillMd("create_preview"));
  if (p === "/skills/create_preview/tool.js") return js(toolJs("create_preview"));
  if (p === "/skills/preview_status/SKILL.md") return md(skillMd("preview_status"));
  if (p === "/skills/preview_status/tool.js") return js(toolJs("preview_status"));
  if (p === "/skills/discard_preview/SKILL.md") return md(skillMd("discard_preview"));
  if (p === "/skills/discard_preview/tool.js") return js(toolJs("discard_preview"));
  res.writeHead(404); res.end("no");
});

// los archivos del studio: leer de studio/content + hashes como en build.mjs
import { readFileSync } from "node:fs";
const read = (f) => readFileSync("studio/content/" + f, "utf8");
const sha = (s) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
const SKILLS = ["create_preview", "preview_status", "discard_preview"];
const skillMd = (n) => read(n + ".SKILL.md");
const toolJs = (n) => read(n + ".tool.js");
const llmsText =
  `# llmstxt-studio\n\n> Forge web apps with your agent.\n\n## Skills\n\n` +
  SKILLS.map((n) => {
    const titles = { create_preview: "Deploy a small web app to a throwaway Cloudflare account (60-min TTL).", preview_status: "Check a preview session.", discard_preview: "Delete a deploy preview now." };
    return `- [${n}](/skills/${n}/SKILL.md): ${titles[n]} <!-- skill: {"version":"1.0.0","sha256":"${sha(skillMd(n))}","tool":"/skills/${n}/tool.js","tool_sha256":"${sha(toolJs(n))}"} -->\n`;
  }).join("");

// --- driver MCP por stdio (patron test-auth) -----------------------------------
function rpc(proc, id, method, params, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    const timer = setTimeout(() => reject(new Error("timeout " + method)), timeoutMs);
    const onLine = (line) => {
      try {
        const obj = JSON.parse(line);
        if (obj.id === id) { clearTimeout(timer); resolve(obj); }
      } catch { /* no-json */ }
    };
    let buf = "";
    proc.stdout.on("data", (d) => { buf += d; const lines = buf.split("\n"); buf = lines.pop(); lines.forEach(onLine); });
    proc.stdin.write(msg);
  });
}

async function main() {
  await new Promise((r) => cf.listen(CF_PORT, r));
  await new Promise((r) => origin.listen(PORT, r));
  process.env.CF_API_BASE = `http://127.0.0.1:${CF_PORT}/client/v4`;

  const home = await mkdtemp(path.join(tmpdir(), "studio-e2e-"));
  const proc = spawn(process.execPath, [
    "bin/mcpwasm-local.mjs", `http://127.0.0.1:${PORT}`, "--previews",
  ], {
    env: { ...process.env, USERPROFILE: home, HOME: home },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let errTxt = "";
  proc.stderr.on("data", (d) => { errTxt += d; });

  // esperar "listo" en stderr (el runtime hace discovery + hash verification)
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("runtime no listo: " + errTxt.slice(-300))), 60000);
    proc.stderr.on("data", (d) => { if (String(d).includes("listo:")) { clearTimeout(t); resolve(); } });
  });
  check(errTxt.includes("previews: capability inyectada"), "capability provisionPreview inyectada");
  check(errTxt.includes("3 skill(s) verificadas"), "3 skills verificadas (hashes ok)");

  const init = await rpc(proc, 1, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "studio-e2e", version: "1.0.0" } });
  check(Boolean(init.result), "initialize OK");
  const list = await rpc(proc, 2, "tools/list", {});
  const names = (list.result?.tools ?? []).map((t) => t.name);
  check(names.includes("create_preview") && names.includes("preview_status") && names.includes("discard_preview"), `tools/list: ${names.join(", ")}`);

  console.log("[e2e] tools/call create_preview (sandbox -> host -> CF fake)");
  const call = await rpc(proc, 3, "tools/call", {
    name: "create_preview",
    arguments: { files: [{ name: "app.js", content: "export default { fetch() { return new Response('hola studio'); } }" }], main: "app.js" },
  });
  const sc = call.result?.structuredContent ?? call.result?.content?.[0];
  const out = typeof sc?.result === "object" ? sc.result : sc;
  check(out?.ok === true, `create_preview ok=${out?.ok} ${out?.error ? "— " + out.error : ""}`);
  check(Boolean(out?.previewUrl) && Boolean(out?.claimUrl), `previewUrl: ${out?.previewUrl}`);
  check(!JSON.stringify(call.result).includes("STUDIO-TOKEN"), "el apiToken NO aparece en la respuesta MCP");
  check(creations === 1 && deploys === 1, `cuenta creada (${creations}) + deploy (${deploys}) contra la API fake`);

  console.log("[e2e] reuso con sid");
  const call2 = await rpc(proc, 4, "tools/call", {
    name: "create_preview",
    arguments: { files: [{ name: "app.js", content: "export default { fetch() { return new Response('v2'); } }" }], main: "app.js", sid: out.sid },
  });
  const out2 = (call2.result?.structuredContent?.result) ?? call2.result?.structuredContent ?? {};
  check(out2?.created === false && out2?.sid === out.sid, "redeploy sobre la misma cuenta");
  check(creations === 1, `creaciones sigue en ${creations} (PoW pagado 1 vez)`);

  console.log("[e2e] status y discard");
  const call3 = await rpc(proc, 5, "tools/call", { name: "preview_status", arguments: { sid: out.sid } });
  const out3 = call3.result?.structuredContent?.result ?? call3.result?.structuredContent ?? {};
  check(out3?.ok === true && out3?.msToExpiry > 0, "status con msToExpiry");
  const call4 = await rpc(proc, 6, "tools/call", { name: "discard_preview", arguments: { sid: out.sid } });
  const out4 = call4.result?.structuredContent?.result ?? call4.result?.structuredContent ?? {};
  check(out4?.deleted === true, "discard borra el script");

  proc.kill();
  cf.close(); origin.close();
  const ok = CHECKS.every(Boolean);
  console.log(`TEST STUDIO E2E: ${ok ? "PASS" : "FALLO"} (${CHECKS.filter(Boolean).length}/${CHECKS.length})`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error("TEST STUDIO E2E: ERROR —", e.message); process.exit(1); });