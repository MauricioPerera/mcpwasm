// relay/rules.mjs — reglas puras del relay de provisioning (testables en Node;
// Deno las consume tambien sin APIs de plataforma). STUB: implementar.

export const RELAY_ORIGIN = "https://llmstxt-studio.rckflr.workers.dev";

export function allowedRoute(method, path) {
  throw new Error("NotImplemented: allowedRoute");
}

export function corsHeaders(origin, allowAnyOrigin) {
  throw new Error("NotImplemented: corsHeaders");
}