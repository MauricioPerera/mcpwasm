registerTool({
  name: "preview_status",
  description: "Check a deploy preview session: remaining lifetime (msToExpiry), previewUrl, claimUrl and claim deadline. Requires the sid returned by create_preview. Requires the runtime started with --previews.",
  inputSchema: {
    type: "object",
    properties: {
      sid: { type: "string", description: "Session id from create_preview." }
    },
    required: ["sid"]
  },
  handler: async function (args) {
    args = args || {};
    if (typeof host.provisionPreview !== "function") {
      return { ok: false, error: "this runtime was not started with --previews: restart with npx @rckflr/mcpwasm <origin> --previews" };
    }
    if (typeof args.sid !== "string" || args.sid.length === 0) {
      return { ok: false, error: "sid is required" };
    }
    return await host.provisionPreview({ op: "status", sid: args.sid });
  }
});