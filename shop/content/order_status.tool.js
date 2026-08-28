registerTool({
  name: "order_status",
  description: "Look up one order by its numeric id. Returns {found:true, order:{order_id, sku, qty, email, total, status, created_at}} or {found:false}.",
  inputSchema: {
    type: "object",
    properties: {
      order_id: { type: "number", description: "Numeric order id returned by create_order." }
    },
    required: ["order_id"]
  },
  handler: async function (args) {
    args = args || {};
    if (typeof args.order_id !== "number" || !Number.isFinite(args.order_id)) {
      return { found: false, error: "order_id must be a finite number" };
    }
    const r = await host.fetchOrigin("/api/orders/" + String(args.order_id));
    if (r.status === 404) return { found: false };
    const parsed = JSON.parse(r.body);
    return { found: true, order: parsed };
  }
});