// console-webmcp.mjs — puente entre la consola del studio y navigator.modelContext
// (WebMCP): registra las 4 tools del ciclo de vida del preview para el agente
// del usuario y envuelve los resultados al formato que espera el agente
// ({content:[{type:"text",text}]}), atrapando los errores de los handlers.
// Contrato: knowledge/contracts/console-webmcp.md.
// ---------------------------------------------------------------------------

const TOOL_DEFS = [
  {
    name: "create_preview",
    description:
      "Deploy a small web app to a throwaway Cloudflare account that dies unless claimed. " +
      "files: [{name, content}] ES-module Worker (main = entry file). Returns {ok, sid, previewUrl, claimUrl, expiresAt, accountName, registered}. " +
      "Show the previewUrl to the human right away; hand them the claimUrl/paylink to keep it. Pass a previous sid to redeploy on the same account.",
    inputSchema: {
      type: "object",
      properties: {
        files: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Module file name, e.g. app.js." },
              content: { type: "string", description: "Full file content (UTF-8)." },
            },
            required: ["name", "content"],
          },
          description: "1 to 20 files. Main must export default { fetch(request) { ... } }; serve HTML from the fetch handler.",
        },
        main: { type: "string", description: "Entry module name; one of files[].name. Example: app.js" },
        sid: { type: "string", description: "Optional session id from a previous create_preview: SAME account, fast redeploy." },
      },
      required: ["files", "main"],
    },
  },
  {
    name: "preview_status",
    description:
      "Check the preview session of this console tab: remaining lifetime, previewUrl, claimUrl and claimed state. sid comes from create_preview.",
    inputSchema: {
      type: "object",
      properties: { sid: { type: "string", description: "Session id from create_preview." } },
      required: ["sid"],
    },
  },
  {
    name: "claim_preview",
    description:
      "Keep a deployed preview beyond its TTL ($19 for 30 days): starts the claim and returns the paylink for the HUMAN to open. Free to call; the payment is the human's.",
    inputSchema: {
      type: "object",
      properties: { sid: { type: "string" }, email: { type: "string", description: "Email of the human claiming." } },
      required: ["sid", "email"],
    },
  },
  {
    name: "discard_preview",
    description:
      "Delete the preview deploy NOW instead of waiting for the TTL: removes the worker from the throwaway account and drops the local session.",
    inputSchema: {
      type: "object",
      properties: { sid: { type: "string" } },
      required: ["sid"],
    },
  },
];

export async function registerConsoleWebMCP(mc, tools, opts = {}) {
  const onLog = typeof opts.onLog === "function" ? opts.onLog : () => {};
  let registered = 0;
  const failed = [];
  for (const def of TOOL_DEFS) {
    const handler = tools ? tools[def.name] : null;
    if (typeof handler !== "function") {
      onLog("sin handler para " + def.name + " (omitida)");
      continue;
    }
    try {
      mc.registerTool({
        name: def.name,
        description: def.description,
        inputSchema: JSON.parse(JSON.stringify(def.inputSchema)),
        execute: async (input) => {
          let result;
          try {
            result = await handler(input || {});
          } catch (e) {
            result = { ok: false, error: (e && e.message) ? e.message : String(e) };
          }
          if (typeof opts.onLog === "function") {
            try { onLog("agente -> " + def.name + ": " + summarize(result)); } catch {}
          }
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        },
      });
      registered++;
      onLog(def.name + " registrada en WebMCP");
    } catch (e) {
      failed.push({ name: def.name, error: (e && e.message) ? e.message : String(e) });
      onLog("fallo registrando " + def.name + ": " + (e && e.message ? e.message : String(e)));
    }
  }
  return { registered, failed };
}

function summarize(out) {
  try {
    const s = JSON.stringify(out);
    return s.length > 180 ? s.slice(0, 177) + "..." : s;
  } catch {
    return "(no serializable)";
  }
}