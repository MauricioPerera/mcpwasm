registerTool({
  name: "search_spec",
  description: "BM25 search over the llms-txt-skills spec snapshot (4 documents). Returns hits as {text, score, title, concept_id}.",
  inputSchema: {
    type: "object",
    properties: {
      q: { type: "string", description: "Free-text BM25 query over the spec documents." },
      k: { type: "number", description: "Max number of hits to return (integer 1..10, default 5)." }
    },
    required: ["q"]
  },
  handler: async function (args) {
    args = args || {};
    // Validacion de tipos (sandbox ECMAScript puro).
    if (typeof args.q !== "string" || args.q.trim().length === 0) {
      throw new Error("q must be a non-empty string");
    }
    let k = 5;
    if (args.k !== undefined && args.k !== null) {
      if (typeof args.k !== "number" || !Number.isFinite(args.k) || Math.floor(args.k) !== args.k) {
        throw new Error("k must be an integer number");
      }
      if (args.k < 1 || args.k > 10) {
        throw new Error("k must be between 1 and 10 inclusive");
      }
      k = args.k;
    }
    // host.memorySearch(query, k) es la capability que implementa el gateway
    // (provisional). Devuelve {hits:[{text,score,title,concept_id}]} o {error}.
    const r = await host.memorySearch(args.q, k);
    if (r && r.error) throw new Error(r.error);
    return r;
  }
});