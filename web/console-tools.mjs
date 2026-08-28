// console-tools.mjs — tools del agente para la consola del studio en el
// navegador (estilo Modelar): create_preview, preview_status, claim_preview,
// discard_preview. Operan sobre el nucleo de provisioning web y un store de
// sesiones inyectado (en el navegador, localStorage; en tests, memoria).
//
// Regla estructural: el apiToken de la cuenta temporal vive SOLO en el store
// local. Ninguna tool lo devuelve — el agente Ve metadatos y el claimUrl.
// Contrato: knowledge/contracts/console-tools.md.
// ---------------------------------------------------------------------------

import { deployPreviewWeb } from "./deploy-preview-web.mjs";

export function makeConsoleTools(deps = {}) {
  const platformOrigin = deps.platformOrigin ? String(deps.platformOrigin).replace(/\/+$/, "") : "";
  const apiBase = deps.apiBase || "https://api.cloudflare.com/client/v4";
  const fetchImpl = deps.fetchImpl || null;
  if (typeof fetchImpl !== "function") throw new TypeError("makeConsoleTools: fetchImpl requerido");
  const store = deps.store || null;
  if (!store || typeof store.get !== "function" || typeof store.set !== "function" || typeof store.remove !== "function") {
    throw new TypeError("makeConsoleTools: store { get, set, remove } requerido");
  }

  // --- create_preview: crea o reusa la sesion efimera -----------------------
  async function create_preview(args) {
    const files = args && Array.isArray(args.files) ? args.files : null;
    const main = args && args.main;
    if (!files || files.length === 0 || !main) {
      return { ok: false, error: "create_preview requiere files (lista de {name, content}) y main" };
    }
    const sid = args.sid || null;
    if (sid) {
      const storedSession = store.get(sid);
      if (!storedSession || !storedSession.account) {
        return { ok: false, error: "sid no encontrada en esta consola (puede haber expirado)" };
      }
    }
    const opts = { platformOrigin, apiBase, files, main };
    if (sid) { opts.sid = sid; opts.account = store.get(sid).account; }
    const out = await deployPreviewWeb(fetchImpl, opts);
    if (!out || out.ok !== true) {
      return { ok: false, error: (out && out.error) || "create_preview fallo" };
    }
    store.set(out.sid, {
      account: out.account,
      scriptName: out.scriptName,
      previewUrl: out.previewUrl,
      claimUrl: out.claimUrl,
      expiresAt: out.expiresAt,
      claimExpiresAt: out.claim && out.claim.expiresAt ? out.claim.expiresAt : null,
      savedAt: new Date().toISOString(),
    });
    return {
      ok: true,
      sid: out.sid,
      scriptName: out.scriptName,
      previewUrl: out.previewUrl,
      claimUrl: out.claimUrl,
      expiresAt: out.expiresAt,
      accountName: out.account.name,
      registered: out.registered,
    };
  }

  // --- preview_status: local + estado del claim en la plataforma ------------
  async function preview_status(args) {
    const sid = args && args.sid;
    const session = sid ? store.get(sid) : null;
    if (!session) return { ok: false, error: "sesion no encontrada (puede haber expirado)" };
    const out = {
      ok: true, sid, scriptName: session.scriptName, previewUrl: session.previewUrl,
      claimUrl: session.claimUrl, expiresAt: session.expiresAt,
      msToExpiry: session.expiresAt ? Date.parse(session.expiresAt) - Date.now() : null,
    };
    if (platformOrigin) {
      try {
        const res = await fetchImpl(`${platformOrigin}/preview?sid=${encodeURIComponent(sid)}`);
        if (res.ok) {
          const remote = await res.json();
          if (remote && remote.sid) {
            out.claimed = remote.claimed ?? null;
            out.claim_pending = remote.claim_pending ?? null;
            if (remote.claimed && remote.expiresAt && session.expiresAt && Date.parse(remote.expiresAt) > Date.parse(session.expiresAt)) {
              out.expiresAt = remote.expiresAt; // el claim extendio el TTL
              out.msToExpiry = Date.parse(remote.expiresAt) - Date.now();
            }
          }
        }
      } catch { /* la plataforma caida no rompe el status local */ }
    }
    return out;
  }

  // --- claim_preview: inicia el claim (paylink) para el humano --------------
  async function claim_preview(args) {
    const sid = args && args.sid;
    const email = args && args.email;
    const session = sid ? store.get(sid) : null;
    if (!session) return { ok: false, error: "sesion no encontrada" };
    if (!email || email.indexOf("@") === -1) return { ok: false, error: "email requerido para reclamar" };
    const res = await fetchImpl(`${platformOrigin}/preview/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sid, email }),
    });
    if (!res.ok) {
      const detail = await safeText(res);
      return { ok: false, error: `claim HTTP ${res.status}: ${detail.slice(0, 120)}` };
    }
    const body = await res.json();
    if (!body || body.ok === false) return { ok: false, error: (body && body.error) || "claim no disponible" };
    const paymentUrl = body.payment_url
      ? (body.payment_url.startsWith("http") ? body.payment_url : platformOrigin + (body.payment_url.startsWith("/") ? "" : "/") + body.payment_url)
      : (session.claimUrl || null);
    return {
      ok: true, sid, status: body.status || "pending",
      payment_url: paymentUrl, price: body.price, days: body.days,
      note: "el humano paga el claim en el navegador; la app se consolida en la cuenta de la plataforma",
    };
  }

  // --- discard_preview: borra el script con el token LOCAL + registro -------
  async function discard_preview(args) {
    const sid = args && args.sid;
    const session = sid ? store.get(sid) : null;
    if (!session || !session.account) return { ok: false, error: "sesion no encontrada" };
    let deleted = false;
    try {
      const res = await fetchImpl(
        `${apiBase}/accounts/${encodeURIComponent(session.account.id)}/workers/scripts/${encodeURIComponent(session.scriptName)}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${session.account.apiToken}` } },
      );
      deleted = !!res.ok;
    } catch { deleted = false; }
    store.remove(sid);
    if (platformOrigin) {
      try { await fetchImpl(`${platformOrigin}/preview/discard?sid=${encodeURIComponent(sid)}`, { method: "POST", body: "{}" }); } catch {}
    }
    return { ok: true, deleted, scriptName: session.scriptName };
  }

  return { create_preview, preview_status, claim_preview, discard_preview };
}

async function safeText(res) {
  try { return await res.text(); } catch { return ""; }
}