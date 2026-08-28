registerTool({
  name: "get_item",
  description: "Get full details of one item by numeric id: name, description, price, stock. Returns {found:false} when the id does not exist.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "number", description: "Numeric item id." }
    },
    required: ["id"]
  },
  handler: async function (args) {
    args = args || {};
    if (typeof args.id !== "number" || !Number.isFinite(args.id) || args.id < 1) {
      return { found: false, error: "id must be a positive number" };
    }
    const r = await host.fetchOrigin("/api/items/" + Math.floor(args.id));
    if (r.status === 404) return { found: false };
    return JSON.parse(r.body);
  }
});