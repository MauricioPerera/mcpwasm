// byoa-init.mjs — scaffoldea una nueva plataforma BYOA desde byoa-kit/.
// Uso: node scripts/byoa-init.mjs <nombre-plataforma>
// Copia byoa-kit/ -> <nombre>/, sustituye nombre/origin en kit.config.json y
// wrangler.toml, e imprime los siguientes pasos.
import { mkdirSync, readFileSync, writeFileSync, cpSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const kitDir = join(repo, "byoa-kit");
const name = process.argv[2];

if (!name || !/^[a-z0-9-]+$/.test(name)) {
  console.error("uso: node scripts/byoa-init.mjs <nombre-kebab-case>");
  process.exit(1);
}
const dest = join(repo, name);
if (existsSync(dest)) {
  console.error(`ya existe: ${name}/`);
  process.exit(1);
}

cpSync(kitDir, dest, { recursive: true });

// kit.config.json: nombre + origin
const cfgPath = join(dest, "kit.config.json");
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
cfg.name = "llmstxt-" + name;
cfg.origin = `https://llmstxt-${name}.rckflr.workers.dev`;
cfg.description = `${name}: plataforma BYOA construida con el kit (edita esta descripcion).`;
writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");

// wrangler.toml: nombre del worker y de la D1
const wrPath = join(dest, "wrangler.toml");
const wr = readFileSync(wrPath, "utf8")
  .replace(/name = "[^"]+"/, `name = "llmstxt-${name}"`)
  .replace(/database_name = "[^"]+"/, `database_name = "llmstxt-${name}-db"`);
writeFileSync(wrPath, wr);

// README propio
const readme = readFileSync(join(dest, "README.md"), "utf8");
writeFileSync(join(dest, "README.md"), readme.replace("# byoa-kit", `# ${name} (BYOA)`));

console.log(`plataforma scaffoldeada: ${name}/`);
console.log("");
console.log("siguientes pasos:");
console.log(`  1. edita ${name}/kit.config.json y ${name}/content/ (tools + SKILL.md)`);
console.log(`  2. npx wrangler d1 create llmstxt-${name}-db   # pega el id en ${name}/wrangler.toml`);
console.log(`  3. cd ${name} && node build.mjs`);
console.log(`  4. npx wrangler d1 execute llmstxt-${name}-db --remote -c wrangler.toml --file schema.sql`);
console.log(`  5. npx wrangler deploy -c wrangler.toml`);
console.log(`  6. firma attestations: node scripts/attest.mjs sign https://llmstxt-${name}.rckflr.workers.dev --all <fecha> > content/attestations.json  && node build.mjs && npx wrangler deploy -c wrangler.toml`);