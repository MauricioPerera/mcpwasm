// verify-shop-attest.mjs — Verifica el veredicto de attestations del gateway
// ENFORCING con el registro REAL de REVIEWERS (wrangler-gateway.toml) contra el
// origin EN VIVO de llmstxt-shop. Debe reportar 4attested y las 4 tools visibles.
// Uso: node scripts/verify-shop-attest.mjs  (requiere build-gateway.mjs antes)
import { Miniflare } from "miniflare";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const REVIEWERS = readFileSync(path.join(repo, "wrangler-gateway.toml"), "utf8")
  .split("\n")
  .filter((l) => l.startsWith("REVIEWERS"))[0]
  .replace(/^REVIEWERS\s*=\s*'/, "")
  .replace(/'\s*$/, "");
const reviewers = JSON.parse(REVIEWERS);
console.log("revisores en el registro:", Object.keys(reviewers).join(", "));

const mf = new Miniflare({
  scriptPath: path.join(repo, "dist-gateway", "worker.js"),
  modules: true,
  modulesRules: [{ type: "ESModule", include: ["**/*.js"] }, { type: "CompiledWasm", include: ["**/*.wasm"] }],
  compatibilityDate: "2026-06-01",
  compatibilityFlags: ["nodejs_compat"],
  bindings: {
    ALLOWED_ORIGINS: "https://llmstxt-shop.rckflr.workers.dev",
    ATTESTATION_MODE: "enforcing",
    REVIEWERS,
  },
});

const res = await mf.dispatchFetch(
  "http://localhost/mcp?origin=" + encodeURIComponent("https://llmstxt-shop.rckflr.workers.dev"),
  { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) }
);
const names = (await res.json()).result?.tools?.map((t) => t.name) ?? [];
const verdict = res.headers.get("x-gw-attestations");
console.log("gateway enforcing -> X-Gw-Attestations:", verdict, "| tools:", names.join(", ") || "(ninguna)");

const ok = /4attested/.test(verdict || "") && names.includes("search_catalog") && names.includes("create_order");
console.log(ok ? "VERIFY SHOP ATTESTATIONS: PASS" : "VERIFY SHOP ATTESTATIONS: FALLO");
await mf.dispose();
process.exit(ok ? 0 : 1);