registerTool({
  name: "create_preview",
  description: "Deploy a small web app to a throwaway Cloudflare account that dies in 60 minutes. Returns {ok, sid, previewUrl, claimUrl, claimExpiresAt, expiresAt, accountName, created}. The previewUrl is a live public URL to show the human right away. The claimUrl lets the HUMAN keep the app permanently (they open it and log in to Cloudflare); if nobody claims it, everything self-destructs at expiresAt. Pass the sid from a previous call to redeploy on the same account without a new session. Requires the runtime started with --previews.",
  inputSchema: {
    type: "object",
    properties: {
      files: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Module file name, e.g. app.js." },
            content: { type: "string", description: "Full file content (UTF-8)." }
          },
          required: ["name", "content"]
        },
        description: "1 to 20 files. The app is a Cloudflare Worker ES module: main must export default { fetch(request) { ... } }. For a web page, serve HTML from the fetch handler. Total under 8 MB."
      },
      main: { type: "string", description: "Entry module name; must be one of files[].name. Example: app.js" },
      sid: { type: "string", description: "Optional session id from a previous create_preview. When present, the SAME account is reused (fast redeploy, no new session)." }
    },
    required: ["files", "main"]
  },
  handler: async function (args) {
    args = args || {};
    if (typeof host.provisionPreview !== "function") {
      return { ok: false, error: "this runtime was not started with --previews: restart with npx @rckflr/mcpwasm <origin> --previews" };
    }
    // el host valida limites; el payload viaja por el puente JSON del host (no fetchOrigin)
    const result = await host.provisionPreview({ op: "create", files: args.files, main: args.main, sid: args.sid });
    return result;
  }
});