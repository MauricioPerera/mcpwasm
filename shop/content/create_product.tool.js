registerTool({
  name: "create_product",
  description: "PAID TOOL: list a new product on the marketplace catalog. Requires a creator license token (buy via buy_creator_access: $19 for 25 listings, 30 days). Without a valid token returns needs_payment with next steps. This is a real-world effect: confirm name and price with the human first.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Product name (non-empty)." },
      description: { type: "string", description: "Product description." },
      price: { type: "number", description: "Price >= 0." },
      stock: { type: "number", description: "Initial stock (default 0)." },
      category: { type: "string", description: "Optional category (default 'marketplace')." },
      sku: { type: "string", description: "Optional SKU; generated from name if omitted." },
      access_token: { type: "string", description: "Creator license token (from the human after paying the buy_creator_access paylink)." }
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
    if (typeof args.access_token !== "string" || args.access_token.length === 0) {
      return {
        ok: false, needs_payment: true, price: 19, uses: 25,
        next_step: "llama buy_creator_access {email} para generar el paylink; el humano paga y te da el license_token; reintenta create_product con access_token"
      };
    }
    const body = JSON.stringify({
      name: args.name,
      description: typeof args.description === "string" ? args.description : undefined,
      price: args.price,
      stock: typeof args.stock === "number" ? args.stock : undefined,
      category: typeof args.category === "string" ? args.category : undefined,
      sku: typeof args.sku === "string" ? args.sku : undefined
    });
    const r = await host.fetchOrigin("/api/products", { method: "POST", headers: { Authorization: "Bearer " + args.access_token }, body });
    let parsed = null;
    try { parsed = JSON.parse(r.body); } catch { parsed = { error: r.body }; }
    if (r.status === 401) return Object.assign({ ok: false, needs_payment: true }, parsed);
    if (r.status >= 400) return Object.assign({ ok: false, status: r.status }, parsed);
    return Object.assign({ ok: true }, parsed);
  }
});