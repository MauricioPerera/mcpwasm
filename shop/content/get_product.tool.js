registerTool({
  name: "get_product",
  description: "Get full details of one product by SKU: name, description, category, price and live stock. Returns {found:false} when the SKU does not exist.",
  inputSchema: {
    type: "object",
    properties: {
      sku: { type: "string", description: "Product SKU, e.g. wasm-mug." }
    },
    required: ["sku"]
  },
  handler: async function (args) {
    args = args || {};
    if (typeof args.sku !== "string" || args.sku.length === 0) {
      return { found: false, error: "sku must be a non-empty string" };
    }
    const r = await host.fetchOrigin("/api/product/" + encodeURIComponent(args.sku));
    if (r.status === 404) return { found: false };
    return JSON.parse(r.body);
  }
});