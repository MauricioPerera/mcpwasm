// deploy-preview-web.mjs — orquestador del navegador para create_preview:
//   cuenta temporal (ephemeral-account-web) + deploy (deploy-app-web)
//   + registro en la plataforma (POST /preview/register, SOLO metadatos).
//
// Regla estructural: el apiToken de la cuenta vive SOLO en el store local de
// la consola (este return). Jamas viaja al registro de la plataforma.
// Contrato: knowledge/contracts/deploy-preview-web.md.
// ---------------------------------------------------------------------------

import { createAccountWeb } from "./ephemeral-account-web.mjs";
import { deployAppWeb } from "./deploy-app-web.mjs";

export async function deployPreviewWeb(fetchImpl, opts = {}) {
  const apiBase = opts.apiBase || "https://api.cloudflare.com/client/v4";
  const platformOrigin = opts.platformOrigin ? String(opts.platformOrigin).replace(/\/+$/, "") : "";

  // 1) cuenta temporal: nueva, o la guardada por la consola en opts.account
  let account = null;
  let claim = null;
  if (opts.account && opts.account.id && opts.account.apiToken) {
    account = opts.account;
    claim = {
      url: opts.account.claimUrl || null,
      expiresAt: opts.account.claimExpiresAt || null,
    };
  } else {
    const created = await createAccountWeb(fetchImpl, { apiBase });
    account = created.account;
    claim = created.claim;
  }

  const sid = opts.sid || crypto.randomUUID();
  const scriptName = "mcpwasm-preview-" + sid.slice(0, 8);

  // 2) deploy de los archivos en la cuenta temporal
  const deployed = await deployAppWeb(fetchImpl, {
    apiBase: opts.apiBase,
    accountId: account.id,
    apiToken: account.apiToken,
    scriptName,
    files: opts.files,
    main: opts.main,
  });

  // 3) registro en la plataforma: SOLO metadatos, best effort
  const expiresAt = account.expiresAt || null;
  const claimUrl = claim ? claim.url : null;
  const claimExpiresAt = claim ? claim.expiresAt : null;
  const meta = { sid, accountName: account.name, scriptName, previewUrl: deployed.previewUrl, claimUrl, expiresAt, claimExpiresAt };
  let registered = false;
  if (platformOrigin) {
    try {
      const res = await fetchImpl(`${platformOrigin}/preview/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(meta),
      });
      registered = !!res.ok;
    } catch {
      registered = false;
    }
  }

  return {
    ok: true,
    sid,
    scriptName,
    account,
    claim,
    previewUrl: deployed.previewUrl,
    claimUrl,
    expiresAt,
    registered,
  };
}