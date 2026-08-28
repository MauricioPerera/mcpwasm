// scripts/live-browser-e2e.mjs — e2e REAL de la consola en navegador (Chromium
// local via playwright-core): la pagina de la consola corre en localhost:8321
// (los mismos archivos que empaqueta el build del studio), el relay local en
// :8000, y create_preview se ejecuta con el stack real del navegador (fetch,
// localStorage, modulos ES). Es el mismo grafo de modulos de produccion.
// Uso: CF_RELAY_ALLOW_ANY_ORIGIN=1 deno run -A relay/deno/main.ts  (otra shell)
//      node scripts/live-browser-e2e.mjs
import { chromium } from "playwright-core";
import http from "node:http";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RELAY = process.env.RELAY_BASE || "http://localhost:8000";
const PORT = 8321;
mkdirSync(join(ROOT, "artifacts"), { recursive: true });

const CHECKS = [];
const check = (ok, label) => { CHECKS.push(ok); console.log(`  ${ok ? "ok" : "FALLO"}: ${label}`); };

// servidor estatico local de la consola (los mismos archivos que empaqueta el build)
const CONSOLE_MODULES = ["solve-pow-web.mjs", "ephemeral-account-web.mjs", "deploy-app-web.mjs", "deploy-preview-web.mjs", "console-tools.mjs", "console-webmcp.mjs"];
const assets = new Map();
assets.set("/console", readFileSync(join(ROOT, "studio/content/console.html"), "utf8").replace("__RELAY_ORIGIN__", RELAY));
assets.set("/console/console-main.mjs", readFileSync(join(ROOT, "studio/content/console-main.mjs"), "utf8"));
for (const m of CONSOLE_MODULES) {
  assets.set("/console/" + m, readFileSync(join(ROOT, "web", m), "utf8"));
}

function serveLocal() {
  const srv = http.createServer((req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    const body = assets.get(path);
    if (body === undefined) { res.writeHead(404, { "content-type": "application/json" }); res.end("{}"); return; }
    const type = path.endsWith(".mjs") ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8";
    res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    res.end(body);
  });
  return new Promise((resolve) => srv.listen(PORT, () => resolve(srv)));
}

const DEMO_FILES = [{
  name: "app.js",
  content: "export default{async fetch(){return new Response('<!doctype html><meta charset=\"utf-8\"><body style=\"font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#0d1117;color:#e6edf3\"><h1>deployado desde el navegador ✅</h1>',{headers:{'content-type':'text/html'}})}}",
}];

async function chromiumLauncher() {
  for (const channel of ["msedge", "chrome"]) {
    try { return await chromium.launch({ channel, headless: true }); } catch {}
  }
  throw new Error("sin Chromium local (msedge/chrome)");
}

async function main() {
  const srv = await serveLocal();
  const browser = await chromiumLauncher();
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror]", String(e && e.message ? e.message : e).slice(0, 160)));

  await page.goto(`http://localhost:${PORT}/console`, { waitUntil: "networkidle" });
  const meta = await page.evaluate(() => document.querySelector('meta[name="console-relay"]')?.content || "");
  check(meta === RELAY, `consola local con relay configurado (${meta || "vacio"})`);

  const toolsOk = await page.evaluate(() => Boolean(window.__consoleTools) && typeof window.__consoleTools.create_preview === "function");
  check(toolsOk, "las tools estan vivas en la pagina (globalThis.__consoleTools)");

  await page.waitForTimeout(400);
  const mcpNote = await page.evaluate(() => document.getElementById("mcp-note")?.textContent || "");
  check(mcpNote.length > 10, "panel de agentes: " + mcpNote.slice(0, 70));

  // EL FLUJO DE PRODUCTO real: click del boton demo (create_preview corre con
  // el fetch del tab, la UI muestra log + iframe + claim) — lo mismo que hace
  // el humano con el demo y lo mismo que dispara la tool del agente.
  const t0 = Date.now();
  await page.click("#demo-btn");
  try {
    await page.waitForFunction(() => (document.getElementById("status-line")?.textContent || "").includes("preview activo"), null, { timeout: 90000 });
  } catch {}
  const uiState = await page.evaluate(() => {
    const sid = localStorage.getItem("mcpwasm-console-active");
    const session = sid ? JSON.parse(localStorage.getItem("mcpwasm-console-session-" + sid) || "null") : null;
    return {
      session,
      statusLine: document.getElementById("status-line")?.textContent || "",
      iframeSrc: document.getElementById("preview")?.src || "",
      logText: document.getElementById("log")?.textContent || "",
    };
  });
  const outcome = { out: uiState.session, ms: null };
  if (!outcome.out) {
    console.log("  [ui-log]", uiState.logText.slice(0, 300));
  }
  check(Boolean(outcome.out) && Boolean(outcome.out.previewUrl), `create_preview OK desde la UI del navegador (${outcome.out ? "sid " + String(outcome.out.sid).slice(0, 8) : "sin sesion — ver [ui-log]"})`);
  check(Boolean(outcome.out) && typeof outcome.out.account.apiToken === "string" && outcome.out.account.apiToken.length > 0, "el apiToken del deploy vive en el store LOCAL");

  if (outcome.out) {
    check(typeof outcome.out.account.apiToken === "string", "el store local muestra la cuenta con su token (uso interno de la consola)");
  } else {
    check(false, "no hubo sesion que guardar (create fallo)");
  }

  if (outcome.out) {
    if (uiState.iframeSrc.replace(/\/+$/, "") !== outcome.out.previewUrl.replace(/\/+$/, "")) {
      console.log("  [iframe-src]", uiState.iframeSrc.slice(0, 120), "| esperaba:", outcome.out.previewUrl);
    }
    check(uiState.iframeSrc.replace(/\/+$/, "") === outcome.out.previewUrl.replace(/\/+$/, ""), "el iframe del preview apunta a la app deployada");
  } else {
    check(false, "sin iframe que verificar (create fallo)");
  }

  let previewStatus = 0;
  if (outcome.out && outcome.out.previewUrl) {
    for (let i = 0; i < 6; i++) {
      previewStatus = (await fetch(outcome.out.previewUrl)).status;
      if (previewStatus === 200) break;
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
  check(previewStatus === 200, `preview publico HTTP ${previewStatus}`);

  writeFileSync(join(ROOT, "artifacts/console-verified.png"), await page.screenshot({ fullPage: true }));
  console.log("  screenshot: artifacts/console-verified.png");

  await browser.close();
  const passed = CHECKS.filter(Boolean).length;
  const ok = CHECKS.every(Boolean);
  console.log(`LIVE BROWSER E2E: ${ok ? "PASS" : "FALLO"} (${passed}/${CHECKS.length})`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("LIVE BROWSER E2E: ERROR", (e && e.message ? e.message : String(e)).slice(0, 300));
  console.error((e && e.stack ? e.stack : "").split("\n").slice(1, 5).join("\n"));
  process.exit(1);
});