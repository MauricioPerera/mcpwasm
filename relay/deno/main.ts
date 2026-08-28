// relay/deno/main.ts — relay de provisioning para la consola del studio.
//
// Cloudflare rechaza la CREACION de cuentas (POST /provisioning/previews)
// cuando la peticion llega desde un Worker de Cloudflare (403 code 1017,
// worker_subrequest_blocked — verificado en produccion). El relay corre
// FUERA de Cloudflare (Deno Deploy): consola (navegador) -> relay -> CF API.
//
// Proxy pura: transmite metodo/authorization/body sin tocar; no guarda nada
// (sin KV, sin logs de tokens). Whitelist estricta de rutas + CORS para la
// consola (https://llmstxt-studio.rckflr.workers.dev y localhost).
// Uso: deployctl deploy --project=<proyecto> relay/deno/main.ts
// ---------------------------------------------------------------------------

const CF_BASE = Deno.env.get("CF_RELAY_TARGET") || "https://api.cloudflare.com";
const ALLOWED_ORIGINS = new Set([
  "https://llmstxt-studio.rckflr.workers.dev",
  "http://localhost:8787",
]);

// (metodo, ruta) que la consola necesita contra la cuenta temporal
const ROUTES: Array<{ method: string; re: RegExp }> = [
  { method: "POST", re: /^\/client\/v4\/provisioning\/previews\/challenge$/ },
  { method: "POST", re: /^\/client\/v4\/provisioning\/previews$/ },
  { method: "PUT", re: /^\/client\/v4\/accounts\/[^/]+\/workers\/scripts\/[\w-]+$/ },
  { method: "GET", re: /^\/client\/v4\/accounts\/[^/]+\/workers\/subdomain$/ },
  { method: "POST", re: /^\/client\/v4\/accounts\/[^/]+\/workers\/scripts\/[\w-]+\/subdomain$/ },
  { method: "DELETE", re: /^\/client\/v4\/accounts\/[^/]+\/workers\/scripts\/[\w-]+$/ },
];

function allowedRoute(method: string, path: string): boolean {
  return ROUTES.some((r) => r.method === method && r.re.test(path));
}

function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    "cache-control": "no-store",
    vary: "Origin",
  };
  if (origin && (ALLOWED_ORIGINS.has(origin) || Deno.env.get("CF_RELAY_ALLOW_ANY_ORIGIN") === "1")) {
    h["access-control-allow-origin"] = origin;
    h["access-control-allow-methods"] = "GET, POST, PUT, DELETE, OPTIONS";
    h["access-control-allow-headers"] = "content-type, authorization";
    // Private Network Access: si el origin es publico (https) la peticion a
    // este host privado exige este header en el preflight
    h["access-control-allow-private-network"] = "true";
  }
  return h;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  const url = new URL(req.url);
  if (!allowedRoute(req.method, url.pathname)) {
    return new Response(
      JSON.stringify({ error: "ruta no permitida por el relay: " + req.method + " " + url.pathname }),
      { status: 404, headers: { "content-type": "application/json", ...cors } },
    );
  }

  const target = CF_BASE + url.pathname + url.search;
  const headers = new Headers();
  for (const h of ["authorization", "content-type"]) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  const init: RequestInit = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "HEAD") init.body = await req.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch {
    return new Response(
      JSON.stringify({ error: "relay: no se pudo alcanzar api.cloudflare.com" }),
      { status: 502, headers: { "content-type": "application/json", ...corsHeaders(origin) } },
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") || "application/json",
      ...cors,
    },
  });
});