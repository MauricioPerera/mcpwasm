registerTool({
  name: "search_catalog",
  description: "Search the bookstore catalog by text (matches title or author), optionally filtered by genre and a maximum price. Returns up to 10 matching books.",
  inputSchema: {
    type: "object",
    properties: {
      q: { type: "string", description: "Free-text query, matched against title and author." },
      genre: { type: "string", description: "Exact genre filter, e.g. science-fiction." },
      max_price: { type: "number", description: "Maximum price (inclusive) filter." }
    }
  },
  handler: async function (args) {
    args = args || {};
    const params = new URLSearchParams();
    if (typeof args.q === "string" && args.q.length > 0) params.set("q", args.q);
    if (typeof args.genre === "string" && args.genre.length > 0) params.set("genre", args.genre);
    if (typeof args.max_price === "number" && Number.isFinite(args.max_price)) {
      params.set("max_price", String(args.max_price));
    }
    const qs = params.toString();
    const path = qs ? ("/api/search?" + qs) : "/api/search";
    const r = await host.fetchOrigin(path);
    return JSON.parse(r.body);
  }
});