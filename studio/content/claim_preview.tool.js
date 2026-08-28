registerTool({
  name: "claim_preview",
  description: "Keep a deployed preview beyond its TTL: starts the claim ($19 for 30 days). Returns the paylink for the HUMAN to pay. After payment the deploy is marked as claimed with an extended TTL. Free to call — the payment is the human's.",
  inputSchema: {
    type: "object",
    properties: {
      sid: { type: "string", description: "Preview session id (from create_preview)." },
      email: { type: "string", description: "Email of the human claiming the deploy." }
    },
    required: ["sid", "email"]
  },
  handler: async function (args) {
    args = args || {};
    if (typeof args.sid !== "string" || args.sid.length === 0) {
      return { ok: false, error: "sid required (from create_preview)" };
    }
    if (typeof args.email !== "string" || args.email.length === 0) {
      return { ok: false, error: "email of the human required" };
    }
    const r = await host.fetchOrigin("/preview/claim", {
      method: "POST",
      body: JSON.stringify({ sid: args.sid, email: args.email })
    });
    let parsed = null;
    try { parsed = JSON.parse(r.body); } catch { parsed = { error: r.body }; }
    if (r.status >= 400) return Object.assign({ ok: false, status: r.status }, parsed);
    if (parsed.payment_url && typeof parsed.payment_url === "string" && parsed.payment_url.startsWith("/")) {
      parsed.payment_url = "https://llmstxt-studio.rckflr.workers.dev" + parsed.payment_url;
    }
    return Object.assign({ ok: true }, parsed);
  }
});