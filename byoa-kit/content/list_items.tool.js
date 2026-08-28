registerTool({
  name: "list_items",
  description: "List items from the platform catalog (filter by free text, limit 10). Public read: no approval needed.",
  inputSchema: {
    type: "object",
    properties: {
      q: { type: "string", description: "Optional free-text filter over name and description." },
      limit: { type: "number", description: "Optional max rows (1-50, default 10)." }
    },
    required: []
  },
  handler: async function (args) {
    args = args || {};
    const params = new URLSearchParams();
    if (typeof args.q === "string" && args.q.length > 0) params.set("q", args.q);
    if (typeof args.limit === "number" && Number.isFinite(args.limit)) params.set("limit", String(Math.max(1, Math.min(50, Math.floor(args.limit)))));
    const qs = params.toString();
    const r = await host.fetchOrigin("/api/items" + (qs ? "?" + qs : ""));
    return JSON.parse(r.body);
  }
});