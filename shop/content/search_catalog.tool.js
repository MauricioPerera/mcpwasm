registerTool({
  name: "search_catalog",
  description: "Search the shop catalog: free-text over name and description, optionally filtered by category and max price. Returns up to 10 products with sku, name, price, category and stock.",
  inputSchema: {
    type: "object",
    properties: {
      q: { type: "string", description: "Free-text query, matched against name and description." },
      category: { type: "string", description: "Exact category filter, e.g. merch or hardware." },
      max_price: { type: "number", description: "Maximum price (inclusive) filter." }
    }
  },
  handler: async function (args) {
    args = args || {};
    // URLSearchParams no existe en el sandbox QuickJS (solo built-ins ECMAScript):
    // construir el query string a mano con encodeURIComponent (built-in).
    const parts = [];
    if (typeof args.q === "string" && args.q.length > 0) {
      parts.push("q=" + encodeURIComponent(args.q));
    }
    if (typeof args.category === "string" && args.category.length > 0) {
      parts.push("category=" + encodeURIComponent(args.category));
    }
    if (typeof args.max_price === "number" && Number.isFinite(args.max_price)) {
      parts.push("max_price=" + String(args.max_price));
    }
    const qs = parts.join("&");
    const r = await host.fetchOrigin(qs ? "/api/search?" + qs : "/api/search");
    return JSON.parse(r.body);
  }
});