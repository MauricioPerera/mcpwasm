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
        headers: opts.body ? { "Content-Type": "application/json" } : undefined,
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
  check(cfg.skills.length === 3, `config con ${cfg.skills.length} skills: ${cfg.skills.join(", ")}`);

  // [2] build: discovery con hashes del contenido real
  console.log("[2] build: llms.txt v0.4 con hashes reales");
  execFileSync(process.execPath, [join(scaffoldDir, "build.mjs")], { stdio: "pipe", cwd: scaffoldDir });
  const workerSrc = readFileSync(join(scaffoldDir, "worker.mjs"), "utf8");
  check(workerSrc.includes("LLMS_TXT") && workerSrc.includes("tool_sha256"), "worker generado con llms.txt v0.4 embebido");
  const listTool = readFileSync(join(scaffoldDir, "content", "list_items.tool.js"), "utf8");
  check(workerSrc.includes(sha(listTool)), "tool_sha256 en el llms.txt sale del contenido REAL");
  const skillMd = readFileSync(join(scaffoldDir, "content", "create_item.SKILL.md"), "utf8");
  check(skillMd.includes("aprobación humana"), "SKILL.md de escritura trae la regla de aprobación humana");

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
  check(createRes.status === 201 && created.ok === true && created.id === 3, "POST /api/items -> 201 con id asignado");
  const badCreate = await mf.dispatchFetch("http://localhost/api/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "", price: -1 }) });
  check(badCreate.status === 400, "POST invalido -> 400");

  // [4] tools reales via runTool
  console.log("[4] tools reales (sandbox con fetchOrigin)");
  const listed = await runTool(mf, "list_items.tool.js", { q: "kit" });
  check(Array.isArray(listed) && listed.some((i) => i.name === "kit-nuevo"), "list_items filtra por texto (matchea name o description)");
  const got = await runTool(mf, "get_item.tool.js", { id: 3 });
  check(got.found === true && got.price === 9.5, "get_item por id");
  const made = await runTool(mf, "create_item.tool.js", { name: "por-tool", price: 3 });
  check(made.ok === true && typeof made.id === "number", "create_item escribe (aprobacion humana en su SKILL.md)");
  const badTool = await runTool(mf, "create_item.tool.js", { name: "x", price: -5 });
  check(badTool.ok === false, "create_item valida price negativo");

  const ok = CHECKS.every(Boolean);
  console.log(`TEST KIT: ${ok ? "PASS" : "FALLO"} (${CHECKS.filter(Boolean).length}/${CHECKS.length})`);
  await mf.dispose();
  rmSync(tmp, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error("TEST KIT: ERROR —", e.message); process.exit(1); });