// tests/test-relay-rules.mjs — ORACULO del contrato relay-rules.
// Las reglas del relay de provisioning: que rutas/metodos se permiten y que
// CORS responde. Puro y sin Deno: relay/deno/main.ts consume estas reglas.
// Uso: node tests/test-relay-rules.mjs
import { allowedRoute, corsHeaders, RELAY_ORIGIN } from "../relay/rules.mjs";

const CHECKS = [];
const check = (ok, label) => { CHECKS.push(ok); console.log(`  ${ok ? "ok" : "FALLO"}: ${label}`); };

function main() {
  // --- 1. las 6 rutas del ciclo de la consola pasan ---------------------------
  check(allowedRoute("POST", "/client/v4/provisioning/previews/challenge"), "POST challenge permitido");
  check(allowedRoute("POST", "/client/v4/provisioning/previews"), "POST create permitido");
  check(allowedRoute("PUT", "/client/v4/accounts/abc123/workers/scripts/mcpwasm-preview-deadbeef"), "PUT script permitido");
  check(allowedRoute("GET", "/client/v4/accounts/abc123/workers/subdomain"), "GET subdomain permitido");
  check(allowedRoute("POST", "/client/v4/accounts/abc123/workers/scripts/mcpwasm-preview-deadbeef/subdomain"), "POST enable permitido");
  check(allowedRoute("DELETE", "/client/v4/accounts/abc123/workers/scripts/mcpwasm-preview-deadbeef"), "DELETE script (discard) permitido");

  // --- 2. todo lo demas se Niega ----------------------------------------------
  check(allowedRoute("GET", "/client/v4/zones") === false, "GET zonas prohibido");
  check(allowedRoute("POST", "/client/v4/accounts/abc123/workers/scripts/n") === false, "POST sin metodo permitido se Niega");
  check(allowedRoute("DELETE", "/client/v4/accounts/abc123") === false, "DELETE de cuenta se niega");
  check(allowedRoute("PUT", "/client/v4/accounts/abc/workers") === false, "PUT raro se niega");
  check(allowedRoute("POST", "/client/v4/provisioning/previews/") === false, "trailing slash se niega (ruta exacta)");
  check(allowedRoute("POST", "/client/v4/../admin") === false, "path traversal se niega");

  // --- 3. CORS: solo origins permitidos reciben ACAO (+ PNA) -------------------
  const allowed = corsHeaders("https://llmstxt-studio.rckflr.workers.dev", false);
  check(allowed["access-control-allow-origin"] === "https://llmstxt-studio.rckflr.workers.dev", "ACAO para el origin del studio");
  check(allowed["access-control-allow-private-network"] === "true", "preflight PNA permitido (consola https -> relay privado)");
  const denied = corsHeaders("https://evil.test", false);
  check(!denied["access-control-allow-origin"], "origin desconocido SIN ACAO");
  const devAny = corsHeaders("https://cualquiera.test", true);
  check(devAny["access-control-allow-origin"] === "https://cualquiera.test", "allow-any (test/dev) refleja el origin");
  const noOrigin = corsHeaders(null, false);
  check(!noOrigin["access-control-allow-origin"], "sin origin tampoco ACAO");

  const ok = CHECKS.every(Boolean);
  console.log(`ORACULO relay-rules: ${ok ? "PASS" : "FALLO"} (${CHECKS.filter(Boolean).length}/${CHECKS.length})`);
  process.exit(ok ? 0 : 1);
}

main();