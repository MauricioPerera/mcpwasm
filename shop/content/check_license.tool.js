registerTool({
  name: "check_license",
  description: "Check a creator license token: status, listings left, expiry. Free. Useful to verify a token before trying create_product, or to remind the human how many listings they have left.",
  inputSchema: {
    type: "object",
    properties: {
      access_token: { type: "string", description: "Creator license token." }
    },
    required: ["access_token"]
  },
  handler: async function (args) {
    args = args || {};
    if (typeof args.access_token !== "string" || args.access_token.length === 0) {
      return { found: false, error: "access_token required" };
    }
    const r = await host.fetchOrigin("/api/license/" + encodeURIComponent(args.access_token));
    if (r.status === 404) return { found: false };
    return JSON.parse(r.body);
  }
});