// tools-inline.mjs
// En produccion estos textos vendrian de R2/KV. Aca van inline para que el Worker
// sea autocontenido. Son EXACTAMENTE los mismos tool.js que escribe el dueño.

export const TOOL_SOURCES = [
`registerTool({
  name: "create_payment",
  description: "Crea un pago usando la logica interna de la plataforma",
  inputSchema: {
    type: "object",
    properties: {
      amount: { type: "number", description: "Monto en centavos" },
      currency: { type: "string", description: "Moneda ISO, ej: usd" }
    },
    required: ["amount", "currency"]
  },
  handler(args) {
    const payment = host.callInternal("createPayment", { amount: args.amount, currency: args.currency });
    return { ok: true, paymentId: payment.id, status: payment.status };
  }
});`,
`registerTool({
  name: "refund_payment",
  description: "Reembolsa un pago existente",
  inputSchema: { type: "object", properties: { paymentId: { type: "string" } }, required: ["paymentId"] },
  handler(args) {
    const r = host.callInternal("refundPayment", { paymentId: args.paymentId });
    return { ok: true, paymentId: r.id, status: r.status };
  }
});`,
];
