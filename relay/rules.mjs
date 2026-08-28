// relay/rules.mjs — reglas puras del relay de provisioning (testables en Node;
// Deno las consume tambien sin APIs de plataforma). Contrato:
// knowledge/contracts/relay-rules.md.
//
// El relay solo es una pasarela del ciclo de vida del preview: crear la cuenta
// temporal (challenge/previews), desplegar el worker (PUT + subdomain +
// enable) y descartarlo (DELETE de script). Todo lo demas esta prohibido.
// ---------------------------------------------------------------------------

export const RELAY_ORIGIN = "https://llmstxt-studio.rckflr.workers.dev";

const ROUTES = [
  { method: "POST", re: /^\/client\/v4\/provisioning\/previews\/challenge$/ },
  { method: "POST", re: /^\/client\/v4\/provisioning\/previews$/ },
  { method: "PUT", re: /^\/client\/v4\/accounts\/[^/]+\/workers\/scripts\/[\w-]+$/ },
  { method: "GET", re: /^\/client\/v4\/accounts\/[^/]+\/workers\/subdomain$/ },
  { method: "POST", re: /^\/client\/v4\/accounts\/[^/]+\/workers\/scripts\/[\w-]+\/subdomain$/ },
  { method: "DELETE", re: /^\/client\/v4\/accounts\/[^/]+\/workers\/scripts\/[\w-]+$/ },
];

export function allowedRoute(method, path) {
  if (typeof method !== "string" || typeof path !== "string") return false;
  return ROUTES.some((r) => r.method === method && r.re.test(path));
}

function ALLOWED_ORIGINS() {
  return new Set([RELAY_ORIGIN, "http://localhost:8787", "http://localhost:8321"]);
}

export function corsHeaders(origin, allowAnyOrigin) {
  const h = {
    "cache-control": "no-store",
    vary: "Origin",
  };
  const known = Boolean(origin) && (ALLOWED_ORIGINS().has(origin) || allowAnyOrigin === true);
  if (known) {
    h["access-control-allow-origin"] = origin;
    h["access-control-allow-methods"] = "GET, POST, PUT, DELETE, OPTIONS";
    h["access-control-allow-headers"] = "content-type, authorization";
    // Private Network Access: origin publico -> host privado (relay local)
    h["access-control-allow-private-network"] = "true";
  }
  return h;
}