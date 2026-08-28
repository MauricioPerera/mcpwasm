// relay/deno/main.ts — relay de provisioning para la consola del studio.
//
// Cloudflare rechaza la CREACION de cuentas (POST /provisioning/previews)
// cuando la peticion llega desde un Worker de Cloudflare (403 code 1017,
// worker_subrequest_blocked — verificado en produccion). El relay corre
// FUERA de Cloudflare (Deno Deploy): consola (navegador) -> relay -> CF API.
//
// Proxy pura: transmite metodo/authorization/body sin tocar; no guarda nada
// (sin KV, sin logs de tokens). Las reglas (whitelist + CORS) viven en
// ./rules.mjs, testeado con Node (contrato relay-rules).
// Uso: deno check relay/deno/main.ts
//      deployctl deploy --project=<proyecto> relay/deno/main.ts
// ---------------------------------------------------------------------------

import { allowedRoute, corsHeaders } from "../rules.mjs";

const CF_BASE = Deno.env.get("CF_RELAY_TARGET") || "https://api.cloudflare.com";

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin, Deno.env.get("CF_RELAY_ALLOW_ANY_ORIGIN") === "1");

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
      { status: 502, headers: { "content-type": "application/json", ...cors } },
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