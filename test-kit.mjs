// test-kit.mjs — pruebas herméticas del byoa-kit:
// [1] build del kit: worker con llms.txt v0.4 y hashes REALES del contenido
// [2] API CRUD en D1 (Miniflare)
// [3] tools reales ejecutadas en sandbox con host.fetchOrigin (runTool)
import { Miniflare } from "miniflare";
import { readFileSync, mkdtempSync, cpSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const repo = dirname(fileURLToPath(import.meta.url));
const CHECKS = [];
const check = (cond, label) => {
  CHECKS.push(!!cond);
  console.log(`  ${cond ? "ok" : "FALLO"}: ${label}`);
};
const sha = (s) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

// runTool: ejecuta una tool REAL del kit en un mini-sandbox con fetchOrigin
async function runTool(mf, toolFile, args) {
  const toolSrc = readFileSync(join(repo, "byoa-kit", "content", toolFile), "utf8");
  let registered = null;
  const registerTool = (t) => { registered = t; };
  const host = {
    fetchOrigin: async (p, opts = {}) => {
      const res = await mf.dispatchFetch("http://localhost" + p, {
        method: opts.method || "GET",
        headers: opts.headers || (opts.body ? { "Content-Type": "application/json" } : undefined),
        body: opts.body,
      });
      return { status: res.status, body: await res.text() };
    },
  };
  const fn = new Function("registerTool", "host", toolSrc + ";");
  fn(registerTool, host);
  if (!registered || !registered.handler) throw new Error("la tool no se registro: " + toolFile);
  return registered.handler(args || {});
}

async function main() {
  // [1] scaffold por nombre (dentro del repo: workerd no arranca desde %TEMP% en Windows)
  console.log("[1] scaffold del kit");
  const tmp = join(repo, ".tmp-kit-test");
  const scaffoldDir = join(tmp, "mi-tienda");
  cpSync(join(repo, "byoa-kit"), scaffoldDir, { recursive: true });
  const cfgPath = join(scaffoldDir, "kit.config.json");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  cfg.name = "llmstxt-mi-tienda";
  cfg.origin = "https://llmstxt-mi-tienda.example.dev";
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  check(cfg.skills.length === 5 && cfg.monetize.enabled === true, `config con ${cfg.skills.length} skills + monetize ON`);

  // [2] build: discovery con hashes del contenido real
  console.log("[2] build: llms.txt v0.4 con hashes reales");
  execFileSync(process.execPath, [join(scaffoldDir, "build.mjs")], { stdio: "pipe", cwd: scaffoldDir });
  const workerSrc = readFileSync(join(scaffoldDir, "worker.mjs"), "utf8");
  check(workerSrc.includes("LLMS_TXT") && workerSrc.includes("tool_sha256"), "worker generado con llms.txt v0.4 embebido");
  const listTool = readFileSync(join(scaffoldDir, "content", "list_items.tool.js"), "utf8");
  check(workerSrc.includes(sha(listTool)), "tool_sha256 en el llms.txt sale del contenido REAL");
  const skillMd = readFileSync(join(scaffoldDir, "content", "create_item.SKILL.md"), "utf8");
  check(skillMd.includes("HUMANO"), "SKILL.md de escritura trae la regla de aprobacion humana");

  // [3] API CRUD en D1
  console.log("[3] API CRUD en D1 (Miniflare)");
  const mf = new Miniflare({
    scriptPath: join(scaffoldDir, "worker.mjs"),
    modules: true,
    compatibilityDate: "2026-06-01",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: "kit-db" },
  });
  const db = await mf.getD1Database("DB");
  const schema = readFileSync(join(scaffoldDir, "schema.sql"), "utf8");
  for (const s of schema.split(";").map((x) => x.trim()).filter(Boolean)) await db.prepare(s).run();
  const seed = JSON.parse(readFileSync(join(scaffoldDir, "seed.json"), "utf8"));
  for (const it of seed) {
    await db.prepare("INSERT INTO items (id, name, description, price, stock) VALUES (?,?,?,?,?)")
      .bind(it.id, it.name, it.description, it.price, it.stock).run();
  }
  const listRes = await mf.dispatchFetch("http://localhost/api/items");
  const items = await listRes.json();
  check(listRes.status === 200 && Array.isArray(items) && items.length === 2, "GET /api/items -> seed de 2 items");
  const one = await (await mf.dispatchFetch("http://localhost/api/items/1")).json();
  check(one.found === true && one.name === "starter-widget", "GET /api/items/1 -> item semilla");
  const miss = await mf.dispatchFetch("http://localhost/api/items/999");
  check(miss.status === 404, "GET /api/items/999 -> 404");
  const createRes = await mf.dispatchFetch("http://localhost/api/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "kit-nuevo", price: 9.5, stock: 3 }) });
  const created = await createRes.json();
  check(createRes.status === 401 && created.needs_payment === true, "POST /api/items sin licencia -> 401 needs_payment (monetize ON)");
  const badCreate = await mf.dispatchFetch("http://localhost/api/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "", price: -1 }) });
  check(badCreate.status === 400 || badCreate.status === 401, "POST invalido -> 400/401");

  // [4] tools reales via runTool
  console.log("[4] tools reales (sandbox con fetchOrigin)");
  const listed = await runTool(mf, "list_items.tool.js", { q: "kit" });
  check(Array.isArray(listed) && listed.some((i) => i.name === "kit-nuevo") === false, "list_items (sin items nuevos aun, solo semilla)");

  console.log("[5] monetizacion: comprar acceso -> pagar -> crear con token");
  const gated = await runTool(mf, "create_item.tool.js", { name: "sin-token", price: 1 });
  check(gated.ok === false && gated.needs_payment === true && typeof gated.next_step === "string", "create_item sin token -> needs_payment + next_step");
  const buy = await runTool(mf, "buy_creator_access.tool.js", { email: "merchant@example.com" });
  check(buy.ok === true && typeof buy.payment_url === "string" && buy.payment_url.startsWith("https://"), "buy_creator_access -> paylink absoluta");
  const licToken = buy.payment_url.split("/buy/")[1].split("?")[0];
  const pt = buy.payment_url.split("pt=")[1];
  const licPageRes = await mf.dispatchFetch("http://localhost" + buy.payment_url.replace(/^https?:\/\/[^/]+/, ""));
  const licHtml = await licPageRes.text();
  check(licPageRes.status === 200 && licHtml.includes("Licencia ACTIVA") === false && licHtml.includes("Pagar"), "paylink de licencia: pagina con boton (token oculto antes de pagar)");
  const activate = await mf.dispatchFetch("http://localhost/api/licenses/activate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payment_token: licToken && "" }) });
  check(activate.status === 400 || activate.status === 404, "activar sin payment_token real -> rechazo");
  const activate2 = await mf.dispatchFetch("http://localhost/api/licenses/activate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payment_token: buy.payment_url.split("pt=")[1] }) });
  const act = await activate2.json();
  check(activate2.status === 200 && act.license_token === licToken, "pago -> licencia activa con license_token");
  const licInfo = await runTool(mf, "check_license.tool.js", { access_token: licToken });
  check(licInfo.found === true && licInfo.valid === true && licInfo.uses_left === 25, "check_license -> activa con 25 usos");
  const badTok = await runTool(mf, "create_item.tool.js", { name: "x", price: 2, access_token: "token-falso" });
  check(badTok.ok === false && badTok.needs_payment === true, "create_item con token falso -> needs_payment");
  const made = await runTool(mf, "create_item.tool.js", { name: "por-tool", price: 3, access_token: licToken });
  check(made.ok === true && typeof made.id === "number" && made.uses_left === 24, "create_item con token -> crea y decrementa usos");
  const badTool = await runTool(mf, "create_item.tool.js", { name: "x", price: -5, access_token: licToken });
  check(badTool.ok === false, "create_item valida price negativo");
  const noEmail = await runTool(mf, "buy_creator_access.tool.js", {});
  check(noEmail.ok === false && noEmail.error.includes("email"), "buy_creator_access sin email -> error claro");

  const ok = CHECKS.every(Boolean);
  console.log(`TEST KIT: ${ok ? "PASS" : "FALLO"} (${CHECKS.filter(Boolean).length}/${CHECKS.length})`);
  await mf.dispose();
  rmSync(tmp, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error("TEST KIT: ERROR —", e.message); process.exit(1); });