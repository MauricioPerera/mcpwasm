// spike-ephemeral-gateway.mjs — ¿Puede una cuenta temporal de Cloudflare hospedar
// el gateway mcpwasm COMPLETO (sandbox QuickJS-WASM) y ejecutar tools reales?
//
// Flujo (mecanismo verificado en spike-ephemeral-cf.mjs):
//   challenge -> PoW -> crear cuenta temporal (apiToken en la respuesta, sin login)
//   -> subir dist-gateway/worker.js + 2 .wasm (regla CompiledWasm) -> workers.dev
//   -> POST /mcp?origin=<demo-site> initialize / tools/list / tools/call
//
// El origin de prueba es el demo site PUBLICADO (https://llmstxt-demo-site.
// rckflr.workers.dev): el gateway lo descarga por internet (sin service
// bindings — el error 1042 solo aplica same-account) y ejecuta sus tools en
// el sandbox QuickJS dentro de la cuenta temporal.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://api.cloudflare.com/client/v4";
const PREVIEWS = `${API}/provisioning/previews`;
const SCRIPT_NAME = "mcpwasm-ephemeral-gateway";
const DEMO = "https://llmstxt-demo-site.rckflr.workers.dev";
const root = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(root, "..", "dist-gateway");
const CHECKS = [];
const check = (ok, label) => { CHECKS.push(ok); console.log(`  ${ok ? "ok" : "FALLO"}: ${label}`); };

function solvePow(seed, k, g) {
  const checkpoints = new Array(k + 1);
  let h = createHash("sha256").update(seed).digest();
  checkpoints[0] = h;
  for (let j = 0; j < k; j++) {
    for (let i = 0; i < g; i++) h = createHash("sha256").update(h).digest();
    checkpoints[j + 1] = h;
  }
  return checkpoints;
}
const encodeCheckpoints = (cp) => Buffer.concat(cp).toString("base64");

async function rpc(base, origin, body, tries = 3) {
  const url = `${base}/mcp?origin=${encodeURIComponent(origin)}`;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json) return { status: res.status, body: json };
      if (res.status === 1102 || res.status >= 500) { await delay(2000); continue; }
      return { status: res.status, body: json };
    } catch { await delay(1500); }
  }
  return { status: 0, body: null };
}

async function main() {
  console.log("[1] cuenta temporal (challenge -> PoW -> creacion)");
  const ch = await (await fetch(`${PREVIEWS}/challenge`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  })).json();
  const challenge = ch.result ?? ch;
  const checkpoints = solvePow(Buffer.from(challenge.seed, "base64url"), challenge.k, challenge.g);
  const created = (await (await fetch(PREVIEWS, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      termsOfService: "https://www.cloudflare.com/terms/",
      privacyPolicy: "https://www.cloudflare.com/privacypolicy/",
      acceptTermsOfService: "yes",
      challengeToken: challenge.challengeToken,
      solution: { checkpoints: encodeCheckpoints(checkpoints) },
    }),
  })).json()).result;
  const account = created?.account;
  check(Boolean(account?.id && account?.apiToken), `cuenta temporal: ${account?.name}`);
  const claim = created?.claim;
  console.log(`    claim URL (60 min): ${claim?.url}`);

  console.log("[2] subir el gateway REAL (QuickJS-WASM + minimemory)");
  const workerJs = await readFile(path.join(DIST, "worker.js"), "utf8");
  const qjsWasm = await readFile(path.join(DIST, "quickjs-asyncify.wasm"));
  const memWasm = await readFile(path.join(DIST, "minimemory_bg.wasm"));
  const metadata = {
    main_module: "worker.js",
    compatibility_date: "2026-06-01",
    compatibility_flags: ["nodejs_compat"],
    bindings: [
      { type: "plain_text", name: "ALLOWED_ORIGINS", text: DEMO },
      { type: "plain_text", name: "ATTESTATION_MODE", text: "advisory" },
    ],
    rules: [{ type: "CompiledWasm", globs: ["**/*.wasm"], fallthrough: false }],
  };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("worker.js", new Blob([workerJs], { type: "application/javascript+module" }), "worker.js");
  form.append("quickjs-asyncify.wasm", new Blob([qjsWasm], { type: "application/wasm" }), "quickjs-asyncify.wasm");
  form.append("minimemory_bg.wasm", new Blob([memWasm], { type: "application/wasm" }), "minimemory_bg.wasm");
  const depRes = await fetch(`${API}/accounts/${account.id}/workers/scripts/${SCRIPT_NAME}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${account.apiToken}` },
    body: form,
  });
  check(depRes.ok, `deploy del gateway HTTP ${depRes.status}`);
  if (!depRes.ok) throw new Error("deploy fallo: " + (await depRes.text()).slice(0, 300));

  const subRes = await fetch(`${API}/accounts/${account.id}/workers/subdomain`, {
    headers: { Authorization: `Bearer ${account.apiToken}` },
  });
  const subdomain = subRes.ok ? (await subRes.json()).result?.subdomain : null;
  check(Boolean(subdomain), `workers.dev subdomain: ${subdomain}`);
  if (subdomain) {
    await fetch(`${API}/accounts/${account.id}/workers/scripts/${SCRIPT_NAME}/subdomain`, {
      method: "POST",
      headers: { Authorization: `Bearer ${account.apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
  }
  const base = `https://${SCRIPT_NAME}.${subdomain}.workers.dev`;
  console.log(`    gateway en: ${base}`);

  console.log("[3] MCP initialize contra el gateway temporal (origin = demo site real)");
  await delay(3000);
  const init = await rpc(base, DEMO, { jsonrpc: "2.0", id: 1, method: "initialize" });
  check(init.status === 200 && Boolean(init.body?.result), `initialize HTTP ${init.status}`);
  if (init.status !== 200) {
    console.log("    body:", JSON.stringify(init.body).slice(0, 400));
  }

  console.log("[4] tools/list (descubrimiento real: llms.txt del demo + verificacion de hashes)");
  const list = await rpc(base, DEMO, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  const names = (list.body?.result?.tools ?? []).map((t) => t.name);
  check(list.status === 200 && names.length > 0, `tools: ${names.join(", ") || "(ninguna)"}`);

  console.log("[5] tools/call sum_numbers {a:2,b:40} en el sandbox de la cuenta temporal");
  const call = await rpc(base, DEMO, {
    jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: "sum_numbers", arguments: { a: 2, b: 40 } },
  }, 4);
  const result = call.body?.result?.structuredContent?.result;
  check(result === 42, `resultado del sandbox: ${JSON.stringify(result)} (esperado 42)`);

  console.log("SPIKE EPHEMERAL GATEWAY: " + (CHECKS.every(Boolean) ? "PASS" : "FALLO") + ` (${CHECKS.filter(Boolean).length}/${CHECKS.length})`);
  console.log(`    (la cuenta muere sola en 60 min — no se reclama)`);
}

main().catch((e) => {
  console.error("SPIKE EPHEMERAL GATEWAY: ERROR —", e.message);
  process.exit(1);
});