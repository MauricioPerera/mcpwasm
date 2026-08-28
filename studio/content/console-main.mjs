// console-main.mjs — cola de la consola del studio en el navegador:
//   1. store de sesiones sobre localStorage (el apiToken SOLO vive aqui)
//   2. expone create_preview / preview_status / claim_preview / discard_preview
//      al agente del usuario via navigator.modelContext (WebMCP) cuando existe;
//      sin WebMCP, la consola sigue operable a mano (demo, estado, discard).
// Consumo MCP en terminal: npx -y @rckflr/mcpwasm <este-origin> --previews
// ---------------------------------------------------------------------------

import { makeConsoleTools } from "./console-tools.mjs";

const ACTIVE_KEY = "mcpwasm-console-active";
const PREFIX = "mcpwasm-console-session-";

const store = {
  get(sid) { try { const raw = localStorage.getItem(PREFIX + sid); return raw ? JSON.parse(raw) : null; } catch { return null; } },
  set(sid, session) { try { localStorage.setItem(PREFIX + sid, JSON.stringify(session)); } catch { /* quota */ } },
  remove(sid) { try { localStorage.removeItem(PREFIX + sid); } catch {} },
};

// el origen del relay de provisioning (deno deploy) lo inyecta el build en
// <meta name="console-relay">; sin relay configurado cae al proxy del worker
// (challenge ok, create bloqueado por CF con 1017 — verificado).
function relayBase() {
  try {
    const meta = document.querySelector('meta[name="console-relay"]');
    const v = meta && meta.content && meta.content.trim();
    return v || "";
  } catch { return ""; }
}

const tools = makeConsoleTools({
  fetchImpl: (url, init) => fetch(url, init),
  platformOrigin: location.origin,
  apiBase: relayBase() ? relayBase() + "/client/v4" : location.origin + "/console/cf",
  store,
});

function log(kind, text) {
  const el = document.createElement("div");
  el.className = kind === "ok" ? "log-ok" : kind === "err" ? "log-err" : "log-info";
  el.textContent = (kind === "err" ? "✗ " : kind === "ok" ? "✓ " : "· ") + text;
  document.getElementById("log").appendChild(el);
}

function fmtRemaining(expiresAt) {
  const ms = expiresAt ? Date.parse(expiresAt) - Date.now() : NaN;
  if (!Number.isFinite(ms)) return "";
  const min = Math.max(0, Math.round(ms / 60000));
  return min >= 60 ? Math.floor(min / 60) + " h " + (min % 60) + " min" : min + " min";
}

function renderSession(session) {
  const box = document.getElementById("claim-box");
  const link = document.getElementById("claim-link");
  const meta = document.getElementById("preview-meta");
  const status = document.getElementById("status-line");
  if (!session || !session.previewUrl) {
    link.removeAttribute("href");
    return;
  }
  document.getElementById("preview").src = session.previewUrl;
  document.getElementById("preview-meta").textContent =
    " · " + session.previewUrl.replace(/^https:\/\//, "").slice(0, 46) +
    (session.expiresAt ? " · vence en " + fmtRemaining(session.expiresAt) : "");
  status.textContent = "preview activo: " + session.previewUrl;
  if (session.claimUrl) {
    document.getElementById("claim-box").classList.remove("hidden");
    link.href = session.claimUrl;
    document.getElementById("claim-text").textContent =
      "tienes " + (session.claimExpiresAt ? "hasta " + fmtAbs(session.claimExpiresAt) : "pocos minutos") +
      " para reclamar la app en tu propia cuenta de Cloudflare ($19 la consolida la plataforma 30 días).";
  }
}

function fmtAbs(iso) { try { return new Date(iso).toLocaleString(); } catch { return iso; } }

async function runButton(btn, fn) {
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = "…";
  try { await fn(); } catch (e) { log("err", (e && e.message) ? e.message : String(e)); }
  btn.disabled = false; btn.textContent = old;
}

const DEMO_FILES = [{
  name: "app.js",
  content:
    "export default {\n" +
    "  async fetch(request) {\n" +
    "    return new Response(\n" +
    "      '<!doctype html><meta charset=\"utf-8\"><body style=\"font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#0d1117;color:#e6edf3\"><div><h1>Hola 👋</h1><p>Fui desplegada desde la consola del studio, a una cuenta temporal de Cloudflare — sin cuenta, sin wrangler.</p></div>',\n" +
    "      { headers: { \"content-type\": \"text/html; charset=utf-8\" } }\n" +
    "    );\n" +
    "  },\n" +
    "};",
}];

document.getElementById("demo-btn").addEventListener("click", (ev) => runButton(ev.currentTarget, async () => {
  log("info", "creando cuenta temporal + PoW + deploy (desde el navegador)…");
  const out = await tools.create_preview({ files: DEMO_FILES, main: "app.js" });
  if (!out.ok) return log("err", out.error || "create_preview fallo");
  localStorage.setItem(ACTIVE_KEY, out.sid);
  log("ok", "preview listo: " + out.previewUrl + (out.registered === false ? " (plataforma sin registrar: modo local)" : ""));
  renderSession({ previewUrl: out.previewUrl, claimUrl: out.claimUrl, claimExpiresAt: out.claimExpiresAt, expiresAt: out.expiresAt, sid: out.sid, scriptName: out.scriptName });
}));

document.getElementById("status-btn").addEventListener("click", (ev) => runButton(ev.currentTarget, async () => {
  const sid = localStorage.getItem(ACTIVE_KEY);
  if (!sid) return log("info", "no hay sesion activa");
  const st = await tools.preview_status({ sid });
  if (!st.ok) return log("err", st.error);
  log("ok", "estado: vence en " + fmtRemaining(st.expiresAt) + (st.claimed ? " · RECLAMADO por " + (st.claimed.email || "alguien") : " · sin reclamar"));
  if (st.claimed) renderSession(Object.assign({}, store.get(sid), { previewUrl: st.previewUrl || null, claimUrl: st.claimUrl }));
}));

document.getElementById("discard-btn").addEventListener("click", (ev) => runButton(ev.currentTarget, async () => {
  const sid = localStorage.getItem(ACTIVE_KEY);
  if (!sid) return log("info", "no hay sesion activa");
  const del = await tools.discard_preview({ sid });
  log(del.deleted ? "ok" : "info", del.deleted ? "descartado: " + del.scriptName : "no se pudo borrar el script (TTL lo cubre)");
  localStorage.removeItem(ACTIVE_KEY);
  document.getElementById("preview").src = "about:blank";
  document.getElementById("preview-meta").textContent = "";
  document.getElementById("status-line").textContent = "sin preview activo";
}));

// --- WebMCP: las mismas tools, expuestas en la pagina -------------------------
const WEBMCP_DEFS = [
  {
    name: "create_preview",
    description: "Deploy a small web app to a throwaway Cloudflare account (dies unless claimed). Returns previewUrl + claimUrl. files: [{name, content}] ES-module Worker; main = entry file.",
    inputSchema: {
      type: "object",
      properties: {
        files: { type: "array", items: { type: "object", properties: { name: { type: "string" }, content: { type: "string" } }, required: ["name", "content"] } },
        main: { type: "string" },
        sid: { type: "string" },
      },
      required: ["files", "main"],
    },
    handle: (args) => tools.create_preview(args || {}),
  },
  {
    name: "preview_status",
    description: "Check the preview session for this tab: lifetime left, previewUrl, claim state.",
    inputSchema: { type: "object", properties: { sid: { type: "string" } }, required: ["sid"] },
    handle: (args) => tools.preview_status(args || {}),
  },
  {
    name: "claim_preview",
    description: "Start the claim so the HUMAN can keep the app: returns the paylink to open ($19 / 30 days).",
    inputSchema: { type: "object", properties: { sid: { type: "string" }, email: { type: "string" } }, required: ["sid", "email"] },
    handle: (args) => tools.claim_preview(args || {}),
  },
  {
    name: "discard_preview",
    description: "Delete the preview deploy now (instead of waiting for the TTL).",
    inputSchema: { type: "object", properties: { sid: { type: "string" } }, required: ["sid"] },
    handle: (args) => tools.discard_preview(args || {}),
  },
];

function wireWebMCP() {
  const mc = navigator.modelContext;
  const note = document.getElementById("mcp-note");
  if (!mc || typeof mc.registerTool !== "function") {
    note.textContent = "WebMCP no disponible en este navegador: usa el botón demo, o conecta tu agente por MCP en la terminal (npx -y @rckflr/mcpwasm " + location.origin + " --previews).";
    return;
  }
  let n = 0;
  for (const def of WEBMCP_DEFS) {
    try {
      mc.registerTool({
        name: def.name,
        description: def.description,
        inputSchema: def.inputSchema,
        execute: async (input) => {
          const out = await def.handle(input);
          log(out && out.ok ? "ok" : "info", "agente → " + def.name + ": " + summarize(out));
          return { content: [{ type: "text", text: JSON.stringify(out) }] };
        },
      });
      n++;
    } catch (e) { log("err", "WebMCP " + def.name + ": " + (e && e.message)); }
  }
  note.textContent = "WebMCP activo: " + n + " tools expuestas al agente en esta página.";
  log("ok", "WebMCP listo — " + n + " tools visibles para tu agente");
}

function summarize(out) {
  try {
    const s = JSON.stringify(out);
    return s.length > 180 ? s.slice(0, 177) + "…" : s;
  } catch { return "(resultado no serializable)"; }
}

// restore de sesion activa + arranque
try {
  const activeSid = localStorage.getItem(ACTIVE_KEY);
  const session = activeSid ? store.get(activeSid) : null;
  if (session && session.previewUrl) {
    renderSession(session);
    log("info", "sesion activa restaurada: " + session.scriptName);
  }
} catch {}
wireWebMCP();