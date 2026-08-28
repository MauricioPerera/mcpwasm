// deploy-app-web.mjs — despliega los archivos del app en la cuenta temporal
// de Cloudflare DESDE EL NAVEGADOR: PUT multipart del script + subdomain +
// enable. Contrato: knowledge/contracts/deploy-app-web.md.
//
// Mismo flujo que preview-capability.mjs (uploadScript/getSubdomain/
// enableScriptSubdomain, verificados en produccion), con fetch inyectable y
// FormData/Blob estandar (sin Buffer ni Node).
// ---------------------------------------------------------------------------

const DEFAULT_COMPAT_DATE = "2024-01-01";

export async function deployAppWeb(fetchImpl, opts = {}) {
  const apiBase = opts.apiBase || "https://api.cloudflare.com/client/v4";
  const accountId = opts.accountId;
  const apiToken = opts.apiToken;
  const scriptName = opts.scriptName;
  const files = opts.files;
  const main = opts.main;
  if (!apiBase || !accountId || !apiToken || !scriptName || !Array.isArray(files) || files.length === 0 || !main) {
    throw new TypeError("deployAppWeb: accountId, apiToken, scriptName, files y main son requeridos");
  }
  if (!files.some((f) => f.name === main)) {
    throw new Error("main no esta en files");
  }

  const meta = {
    main_module: main,
    compatibility_date: opts.compatibilityDate || DEFAULT_COMPAT_DATE,
    rules: [{ type: "CompiledWasm", globs: ["**/*.wasm"], fallthrough: false }],
  };
  if (Array.isArray(opts.compatibilityFlags) && opts.compatibilityFlags.length) {
    meta.compatibility_flags = opts.compatibilityFlags;
  }

  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(meta)], { type: "application/json" }));
  for (const f of files) {
    const type = f.name.endsWith(".wasm") ? "application/wasm" : "application/javascript+module";
    form.append(f.name, new Blob([f.content], { type }), f.name);
  }

  const putRes = await fetchImpl(
    `${apiBase}/accounts/${accountId}/workers/scripts/${scriptName}`,
    { method: "PUT", headers: { Authorization: `Bearer ${apiToken}` }, body: form },
  );
  if (!putRes.ok) {
    const detail = await safeText(putRes);
    throw new Error(`deploy HTTP ${putRes.status}: ${detail.slice(0, 200)}`);
  }

  const subdomain = await getSubdomain(fetchImpl, { apiBase, accountId, apiToken });
  if (subdomain == null) {
    return { deployed: true, subdomain: null, previewUrl: null, enabled: false };
  }
  const enabled = await enableScriptSubdomain(fetchImpl, { apiBase, accountId, apiToken, scriptName });
  const previewUrl = `https://${scriptName}.${subdomain}.workers.dev`;
  return { deployed: true, subdomain, previewUrl, enabled };
}

async function getSubdomain(fetchImpl, opts) {
  const { apiBase, accountId, apiToken } = opts;
  const res = await fetchImpl(`${apiBase}/accounts/${accountId}/workers/subdomain`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  if (!res.ok) return null;
  try {
    const body = await res.json();
    return (body && body.result && body.result.subdomain) || null;
  } catch {
    return null;
  }
}

async function enableScriptSubdomain(fetchImpl, opts) {
  const { apiBase, accountId, apiToken, scriptName } = opts;
  const res = await fetchImpl(
    `${apiBase}/accounts/${accountId}/workers/scripts/${scriptName}/subdomain`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: new Blob([JSON.stringify({ enabled: true })], { type: "application/json" }),
    },
  );
  return res.ok || res.status === 409;
}

async function safeText(res) {
  try { return await res.text(); } catch { return ""; }
}