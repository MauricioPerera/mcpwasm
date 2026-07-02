registerTool({
  name: "get_book",
  description: "Get full details of a single book by its numeric id. Returns {found:false} when the book does not exist.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "number", description: "Book id." }
    },
    required: ["id"]
  },
  handler: async function (args) {
    args = args || {};
    if (typeof args.id !== "number" || !Number.isFinite(args.id)) {
      throw new Error("id must be a finite number");
    }
    const r = await host.fetchOrigin("/api/book/" + encodeURIComponent(args.id));
    if (r.status === 404) return { found: false };
    return JSON.parse(r.body);
  }
});