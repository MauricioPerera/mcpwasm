// Publisher: pon aqui el origin de TU plataforma desplegada.
const ORIGIN = "https://llmstxt-byoa-kit.rckflr.workers.dev";

registerTool({
  name: "create_item",
  description: "PAID TOOL (creator license): create a new item on the platform (name, price, optional description/stock). Buy access with buy_creator_access, then pass the license token as access_token. Without a valid token returns needs_payment. REAL-WORLD EFFECT: always confirm name and price with the human first.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Item name (non-empty)." },
      description: { type: "string", description: "Optional item description." },
      price: { type: "number", description: "Price >= 0." },
      stock: { type: "number", description: "Optional initial stock (default 0)." },
      access_token: { type: "string", description: "Creator license token (from the human, after paying the buy_creator_access paylink)." }
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
        ok: false, needs_payment: true,
        next_step: "llama buy_creator_access {email} para generar el paylink; el humano paga y te da el license_token",
        price_hint: "licencia de creador ($19 / 25 creaciones / 30 dias)"
      };
    }
    const body = JSON.stringify({
      name: args.name,
      description: typeof args.description === "string" ? args.description : undefined,
      price: args.price,
      stock: typeof args.stock === "number" ? args.stock : undefined
    });
    const r = await host.fetchOrigin("/api/items", {
      method: "POST",
      headers: { Authorization: "Bearer " + args.access_token },
      body
    });
    let parsed = null;
    try { parsed = JSON.parse(r.body); } catch { parsed = { error: r.body }; }
    if (r.status === 401) return Object.assign({ ok: false, needs_payment: true }, parsed);
    if (r.status >= 400) return Object.assign({ ok: false, status: r.status }, parsed);
    return Object.assign({ ok: true }, parsed);
  }
});