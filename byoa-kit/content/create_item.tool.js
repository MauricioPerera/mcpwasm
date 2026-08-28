registerTool({
  name: "create_item",
  description: "Create a new item on the platform (name, description, price, stock). REAL-WORLD EFFECT: this writes to the live catalog — ALWAYS confirm name and price with the human before invoking.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Item name (non-empty)." },
      description: { type: "string", description: "Optional item description." },
      price: { type: "number", description: "Price >= 0." },
      stock: { type: "number", description: "Optional initial stock (default 0)." }
    },
    required: ["name", "price"]
  },
  handler: async function (args) {
    args = args || {};
    if (typeof args.name !== "string" || args.name.trim().length === 0) {
      return { ok: false, error: "name must be a non-empty string" };
    }
    if (typeof args.price !== "number" || !Number.isFinite(args.price) || args.price < 0) {
      return { ok: false, error: "price must be a number >= 0" };
    }
    const body = JSON.stringify({
      name: args.name,
      description: typeof args.description === "string" ? args.description : undefined,
      price: args.price,
      stock: typeof args.stock === "number" ? args.stock : undefined
    });
    const r = await host.fetchOrigin("/api/items", { method: "POST", body });
    let parsed = null;
    try { parsed = JSON.parse(r.body); } catch { parsed = { error: r.body }; }
    if (r.status >= 400) return Object.assign({ ok: false, status: r.status }, parsed);
    return Object.assign({ ok: true }, parsed);
  }
});