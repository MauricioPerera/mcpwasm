// internal-logic.mjs (version Worker)
// La logica interna del dueño. El secreto llega por binding de entorno (env),
// no esta hardcodeado ni cruza al sandbox de la tool.

export function makeInternalLogic(secretApiKey) {
  const secretAccessLog = [];
  let paymentCounter = 1000;
  const payments = new Map();

  function createPayment({ amount, currency }) {
    secretAccessLog.push({ fn: "createPayment", usedKeyPrefix: String(secretApiKey).slice(0, 7) });
    if (typeof amount !== "number" || amount <= 0) throw new Error("amount invalido");
    const id = "pay_" + ++paymentCounter;
    const payment = { id, amount, currency: String(currency), status: "succeeded" };
    payments.set(id, payment);
    return payment;
  }

  function refundPayment({ paymentId }) {
    secretAccessLog.push({ fn: "refundPayment", usedKeyPrefix: String(secretApiKey).slice(0, 7) });
    const p = payments.get(paymentId);
    if (!p) throw new Error("pago no encontrado: " + paymentId);
    p.status = "refunded";
    return { id: p.id, status: p.status };
  }

  const INTERNAL_METHODS = { createPayment, refundPayment };

  function callInternal(name, args) {
    const fn = INTERNAL_METHODS[name];
    if (!fn) throw new Error("capability denegada: metodo interno no permitido -> " + name);
    return fn(args ?? {});
  }

  return { callInternal, secretAccessLog };
}
