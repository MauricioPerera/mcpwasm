registerTool({
  name: "buy_creator_access",
  description: "Start the purchase of a creator license to list products ($19 for 25 listings, 30 days). Returns the paylink for the HUMAN to pay. After payment the paylink page shows the license token: the human gives it to you for create_product. Free to call.",
  inputSchema: {
    type: "object",
    properties: {
      email: { type: "string", description: "Email of the human buying the license (for the receipt and the license record)." }
    },
    required: ["email"]
  },
  handler: async function (args) {
    args = args || {};
    if (typeof args.email !== "string" || args.email.length === 0) {
      return { ok: false, error: "email required (the human's email)" };
    }
    const r = await host.fetchOrigin("/api/licenses/purchase", {
      method: "POST",
      body: JSON.stringify({ email: args.email })
    });
    let parsed = null;
    try { parsed = JSON.parse(r.body); } catch { parsed = { error: r.body }; }
    if (r.status >= 400) return Object.assign({ ok: false, status: r.status }, parsed);
    if (parsed.payment_url && typeof parsed.payment_url === "string") {
      parsed.payment_url = "https://llmstxt-shop.rckflr.workers.dev" + parsed.payment_url;
    }
    return Object.assign({ ok: true }, parsed);
  }
});