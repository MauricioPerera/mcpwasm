registerTool({
  name: "create_order",
  description: "Create an order for a book (decrements stock atomically). Returns {ok:true, order_id, book_id, qty, remaining_stock} on success, or {ok:false, status:409, error, ...} when the book does not exist or stock is insufficient.",
  inputSchema: {
    type: "object",
    properties: {
      book_id: { type: "number", description: "Book id to order." },
      qty: { type: "number", description: "Quantity to order (integer >= 1)." }
    },
    required: ["book_id", "qty"]
  },
  handler: async function (args) {
    args = args || {};
    if (typeof args.book_id !== "number" || !Number.isFinite(args.book_id)) {
      throw new Error("book_id must be a finite number");
    }
    if (typeof args.qty !== "number" || !Number.isFinite(args.qty) ||
        args.qty < 1 || Math.floor(args.qty) !== args.qty) {
      throw new Error("qty must be an integer >= 1");
    }
    const body = JSON.stringify({ book_id: args.book_id, qty: args.qty });
    const r = await host.fetchOrigin("/api/order", { method: "POST", body: body });
    if (r.status === 409) {
      // stock insuficiente o libro inexistente: devolver el motivo con ok:false
      let reason = null;
      try { reason = JSON.parse(r.body); } catch { reason = { error: r.body }; }
      return Object.assign({ ok: false, status: 409 }, reason);
    }
    if (r.status >= 400) {
      return { ok: false, status: r.status, error: r.body };
    }
    const parsed = JSON.parse(r.body);
    return Object.assign({ ok: true }, parsed);
  }
});