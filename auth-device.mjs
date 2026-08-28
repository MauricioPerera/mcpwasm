// auth-device.mjs — OAuth Device Flow (RFC 8628) para el runtime local.
//
// Responde a: "configure solo una URL, en la primera activacion se habilita el
// oauth, el usuario se autentica y el token se guarda en local" — SIN servidor
// MCP: el que gestiona el OAuth es el RUNTIME, y el token nunca cruza al LLM
// (vive en el proceso, igual que la DB de --sqlite: dato del CONSUMIDOR).
//
// Flujo (RFC 8628): el runtime pide un device code al issuer, muestra por
// stderr la URL de verificacion + user_code (el HUMANO abre su navegador con
// su sesion real de la plataforma), y hace poll del token. Luego inyecta
// Authorization: Bearer en cada fetch (descubrimiento + fetchOrigin) via el
// mismo wrapper que pasa como fetchImpl.
//
// Seguridad:
//  - El token vive SOLO en el proceso/archivo de credenciales del consumidor
//    (~/.mcpwasm/credentials.json, 0600) — JAMAS en stdout (canal MCP) ni en
//    la conversacion del LLM.
//  - Refresh automatico con refresh_token; si falla -> device flow de nuevo.
//  - Fail-closed: sin token o 401 -> diagnostico claro; nunca degrada a
//    anonimo (el publicador protegio su origin, el runtime no lo bypasea).
//  - stderr es el canal de diagnostico (stdout es EXCLUSIVO del protocolo MCP).

import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const CRED_FILE = path.join(os.homedir(), ".mcpwasm", "credentials.json");
const DEFAULT_CLIENT_ID = "mcpwasm";
const DEFAULT_INTERVAL_MS = 5000;
const MAX_POLL_MS = 300000; // 5 min: el humano tiene que actuar

function err(msg) {
  process.stderr.write("[mcpwasm-auth] " + msg + "\n");
}

// ---- almacén local de credenciales (una entrada por issuer) ---------------
export function credentialsPath() {
  return CRED_FILE;
}

function loadStore() {
  if (!existsSync(CRED_FILE)) return {};
  try {
    const data = JSON.parse(readFileSync(CRED_FILE, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function saveStore(store) {
  mkdirSync(path.dirname(CRED_FILE), { recursive: true });
  writeFileSync(CRED_FILE, JSON.stringify(store, null, 2) + "\n", "utf8");
  try {
    chmodSync(CRED_FILE, 0o600);
  } catch {
    // Windows: chmod no aplica — el archivo queda con los permisos del usuario
  }
}

export function clearCredential(issuer) {
  const store = loadStore();
  delete store[issuer];
  saveStore(store);
}

function isExpired(entry) {
  return !entry || (entry.expires_at && Date.now() >= entry.expires_at - 30000);
}

// ---- descubrimiento de endpoints (RFC 8414) con fallback convencional -----
export async function discoverEndpoints(issuer, f) {
  const well = issuer.replace(/\/+$/, "") + "/.well-known/oauth-authorization-server";
  try {
    const r = await f(well, { method: "GET" });
    if (r.status === 200) {
      const doc = await r.json();
      if (doc && typeof doc.device_authorization_endpoint === "string" && typeof doc.token_endpoint === "string") {
        return { device: doc.device_authorization_endpoint, token: doc.token_endpoint, via: "rfc8414" };
      }
    }
  } catch {
    // sin discovery válido: caemos a la convención
  }
  const base = issuer.replace(/\/+$/, "");
  return { device: base + "/device/code", token: base + "/device/token", via: "conventional" };
}

// ---- device flow: paso 1, pedir device code -------------------------------
export async function requestDeviceCode(issuer, endpoints, clientId, f) {
  const body = "client_id=" + encodeURIComponent(clientId);
  const res = await f(endpoints.device, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (res.status !== 200) {
    const t = await res.text();
    throw new Error("device authorization: HTTP " + res.status + " — " + t.slice(0, 120));
  }
  const d = await res.json();
  if (typeof d.device_code !== "string" || typeof d.user_code !== "string") {
    throw new Error("device authorization: respuesta invalida (faltan device_code/user_code)");
  }
  return d;
}

export function printUserAction(d) {
  // verification_uri_complete es preferible (RFC 8628 §3.3.1): un clic, sin tipear
  const complete = typeof d.verification_uri_complete === "string" && d.verification_uri_complete;
  const url = complete || d.verification_uri;
  err("");
  err("AUTENTICACION REQUERIDA — abre en tu navegador:");
  err("  " + url);
  if (!complete) {
    err("  codigo: " + d.user_code);
  }
  err("  (el token se guarda local, en " + CRED_FILE + " — nunca pasa por el modelo)");
  err("");
}

// ---- device flow: paso 2, poll del token ----------------------------------
export async function pollForToken(endpoints, deviceCode, clientId, f) {
  let interval = DEFAULT_INTERVAL_MS;
  const deadline = Date.now() + MAX_POLL_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    const res = await f(endpoints.token, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body:
        "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:device_code") +
        "&device_code=" + encodeURIComponent(deviceCode) +
        "&client_id=" + encodeURIComponent(clientId),
    });
    if (res.status === 200) {
      const tok = await res.json();
      if (typeof tok.access_token !== "string") {
        throw new Error("token endpoint: 200 sin access_token");
      }
      return tok;
    }
    let code = "";
    try {
      code = (await res.json()).error || "";
    } catch {
      // respuesta no-JSON: tratar como error genérico abajo
    }
    if (code === "authorization_pending") continue;
    if (code === "slow_down") {
      interval += 5000;
      continue;
    }
    if (code === "expired_token") throw new Error("device code expirado antes de autorizar");
    if (code === "access_denied") throw new Error("autorizacion denegada por el usuario");
    throw new Error("token endpoint: HTTP " + res.status + (code ? " (" + code + ")" : ""));
  }
  throw new Error("device flow: timeout esperando autorizacion del usuario (" + Math.round(MAX_POLL_MS / 1000) + "s)");
}

// ---- API para el runtime: credencial válida (store -> refresh -> device) --
export async function getCredential({ issuer, clientId = DEFAULT_CLIENT_ID, forceNew = false, log = err } = {}) {
  const f = globalThis.fetch;
  const endpoints = await discoverEndpoints(issuer, f);
  if (!forceNew) {
    const entry = loadStore()[issuer];
    if (entry && !isExpired(entry)) {
      return { ...entry, fresh: false };
    }
    // expirado PERO con refresh_token: renovar silenciosamente
    if (entry && entry.refresh_token && isExpired(entry)) {
      try {
        const res = await f(endpoints.token, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body:
            "grant_type=refresh_token" +
            "&refresh_token=" + encodeURIComponent(entry.refresh_token) +
            "&client_id=" + encodeURIComponent(clientId),
        });
        if (res.status === 200) {
          const tok = await res.json();
          const renewed = {
            access_token: tok.access_token,
            refresh_token: typeof tok.refresh_token === "string" ? tok.refresh_token : entry.refresh_token,
            expires_at: Number(tok.expires_in) > 0 ? Date.now() + Number(tok.expires_in) * 1000 : 0,
            scope: tok.scope || entry.scope || "",
          };
          const store = loadStore();
          store[issuer] = renewed;
          saveStore(store);
          log("auth: token renovado (refresh) — " + issuer);
          return { ...renewed, fresh: true };
        }
        log("auth: refresh rechazado (HTTP " + res.status + ") — re-autenticando");
      } catch (e) {
        log("auth: refresh fallo (" + String((e && e.message) || e) + ") — re-autenticando");
      }
    }
  }
  // device flow completo (primera vez, expirado sin refresh, o forceNew)
  const d = await requestDeviceCode(issuer, endpoints, clientId, f);
  printUserAction(d);
  const tok = await pollForToken(endpoints, d.device_code, clientId, f);
  const entry = {
    access_token: tok.access_token,
    refresh_token: typeof tok.refresh_token === "string" ? tok.refresh_token : "",
    expires_at: Number(tok.expires_in) > 0 ? Date.now() + Number(tok.expires_in) * 1000 : 0,
    scope: typeof tok.scope === "string" ? tok.scope : "",
  };
  const store = loadStore();
  store[issuer] = entry;
  saveStore(store);
  log("auth: token guardado en " + CRED_FILE + " (" + issuer + ")");
  return { ...entry, fresh: true };
}

// ---- wrapper de fetch: Authorization en todo lo que sale al origin --------
export function wrapFetch(accessToken, log = err) {
  const inner = (u, o) => fetch(u, o);
  return async function authFetch(url, opts) {
    const headers = { ...(opts && opts.headers ? opts.headers : {}), authorization: "Bearer " + accessToken };
    const res = await inner(url, { ...(opts || {}), headers });
    // 401: credencial revocada/expirada — diagnostico claro, sin degradar a anonimo
    if (res.status === 401) {
      log("auth: HTTP 401 — el token puede estar revocado o expirado; reinicia con --auth para re-autenticar (o --auth-logout para limpiar)");
    }
    return res;
  };
}