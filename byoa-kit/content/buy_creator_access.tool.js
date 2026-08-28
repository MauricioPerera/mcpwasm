// Publisher: pon aqui el origin de TU plataforma desplegada.
const ORIGIN = "https://llmstxt-byoa-kit.rckflr.workers.dev";

registerTool({
  name: "buy_creator_access",
  description: "Start the purchase of a creator license to create items on this platform. Returns the paylink for the HUMAN to pay. After payment the paylink page shows the license token: the human gives it to you for create_item. Free to call.",
  inputSchema: {
    type: "object",
    properties: {
      email: { type: "string", description: "Email of the human buying the license (receipt + license record)." }
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
    // payment_url es relativa al origin: absolutizarla para el humano
    if (parsed.payment_url && typeof parsed.payment_url === "string" && parsed.payment_url.startsWith("/")) {
      parsed.payment_url = ORIGIN + parsed.payment_url;
    }
    return Object.assign({ ok: true }, parsed);
  }
});