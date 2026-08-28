registerTool({
  name: "create_order",
  description: "Create an order for a product (decrements stock atomically). Returns {ok:true, order_id, sku, qty, total, remaining_stock, order_status}. IDEMPOTENT: pass a client_order_id (any string unique to this purchase intent, e.g. a UUID) and retries return the SAME order instead of duplicating it. Returns {ok:false, status:409} when the SKU is unknown or stock is insufficient.",
  inputSchema: {
    type: "object",
    properties: {
      sku: { type: "string", description: "Product SKU to order." },
      qty: { type: "number", description: "Quantity, integer >= 1." },
      email: { type: "string", description: "Customer email for the order confirmation." },
      client_order_id: { type: "string", description: "Optional idempotency key: a string unique to this purchase intent. On retry with the same key, the API returns the original order instead of creating a duplicate." }
    },
    required: ["sku", "qty", "email"]
  },
  handler: async function (args) {
    args = args || {};
    if (typeof args.sku !== "string" || args.sku.length === 0) {
      return { ok: false, error: "sku must be a non-empty string" };
    }
    if (typeof args.qty !== "number" || !Number.isFinite(args.qty) ||
        args.qty < 1 || Math.floor(args.qty) !== args.qty) {
      return { ok: false, error: "qty must be an integer >= 1" };
    }
    if (typeof args.email !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(args.email)) {
      return { ok: false, error: "email must be a valid address" };
    }
    const body = JSON.stringify({
      sku: args.sku, qty: args.qty, email: args.email,
      client_order_id: typeof args.client_order_id === "string" ? args.client_order_id : undefined
    });
    const r = await host.fetchOrigin("/api/orders", { method: "POST", body });
    let parsed = null;
    try { parsed = JSON.parse(r.body); } catch { parsed = { error: r.body }; }
    if (r.status >= 400) {
      return Object.assign({ ok: false, status: r.status }, parsed);
    }
    // payment_url es RELATIVA al origin: absolutizarla para el humano
    if (parsed.payment_url && typeof parsed.payment_url === "string") {
      parsed.payment_url = "https://llmstxt-shop.rckflr.workers.dev" + parsed.payment_url;
    }
    return Object.assign({ ok: true }, parsed);
  }
});