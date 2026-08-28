// test-ephemeral.mjs — Suite hermetica del proxy de previews (worker-ephemeral.mjs).
//
// La API de Cloudflare es FAKE (outboundService de Miniflare): challenge con k/g
// diminutos, verificacion del PoW en el fake, cuenta "creada" con apiToken falso.
// El proxy corre real: cookie de sesion, KV, multipart hacia la API fake.
//
// Verifica: creacion sin login, reuso de sesion (1 PoW por sesion), estado,
// borrado, y la regla estructural: el apiToken JAMAS aparece en una respuesta.

import { Miniflare } from "miniflare";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const CHECKS = [];
const check = (ok, label) => {
  CHECKS.push(ok);
  console.log(`  ${ok ? "ok" : "FALLO"}: ${label}`);
};

// --- API fake de Cloudflare -------------------------------------------------
const challenges = new Map(); // challengeToken -> seed Buffer
let creations = 0;
let deploys = 0;
let deletes = 0;
let lastDeployedName = null;
let accountsCreated = 0;

function fakeCloudflare(req) {
  const url = new URL(req.url);
  const p = url.pathname;

  if (req.method === "POST" && p.endsWith("/provisioning/previews/challenge")) {
    const seed = randomBytes(16);
    const token = "ct-" + randomBytes(8).toString("hex");
    challenges.set(token, seed);
    return jsonResponse(200, {
      result: {
        challengeToken: token,
        seed: seed.toString("base64url"),
        k: 2,
        g: 3,
      },
    });
  }

  if (req.method === "POST" && p.endsWith("/provisioning/previews")) {
    return req.json().then((body) => {
      const seed = challenges.get(body.challengeToken);
      if (!seed) return jsonResponse(403, { error: "challenge desconocido" });
      // verificar el PoW: mismos checkpoints que el crypto nativo
      let h = createHash("sha256").update(seed).digest();
      const expected = [new Uint8Array(h)];
      for (let j = 0; j < 2; j++) {
        for (let i = 0; i < 3; i++) h = createHash("sha256").update(h).digest();
        expected.push(new Uint8Array(h));
      }
      const got = body?.solution?.checkpoints;
      if (!got) return jsonResponse(403, { error: "sin solution" });
      const gotBuf = Buffer.from(got, "base64");
      const okPow = expected.every((cp, i) =>
        gotBuf.subarray(i * 32, (i + 1) * 32).equals(Buffer.from(cp))
      );
      if (!okPow) return jsonResponse(403, { error: "PoW invalido" });
      creations++;
      const now = Date.now();
      return jsonResponse(201, {
        result: {
          account: {
            id: "acc-" + creations,
            name: "Fake Order " + creations,
            apiToken: "SECRET-TOKEN-" + creations,
            expiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
          },
          claim: {
            url: "https://dash.cloudflare.com/claim-preview?claimToken=fake-" + creations,
            expiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
          },
        },
      });
    });
  }

  const scriptM = p.match(/\/accounts\/([^/]+)\/workers\/scripts\/([^/]+)$/);
  if (scriptM) {
    const [, , name] = scriptM;
    if (req.method === "PUT") {
      deploys++;
      lastDeployedName = name;
      return jsonResponse(200, { result: { id: name } });
    }
    if (req.method === "DELETE") {
      deletes++;
      return jsonResponse(200, { result: { id: name } });
    }
    if (req.method === "POST") return jsonResponse(200, { result: { enabled: true } });
  }

  if (req.method === "GET" && p.match(/\/workers\/subdomain$/)) {
    return jsonResponse(200, { result: { subdomain: "fake-sub" } });
  }

  return jsonResponse(404, { error: "ruta fake desconocida: " + p });
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// --- Miniflare ----------------------------------------------------------------
const mf = new Miniflare({
  scriptPath: fileURLToPath(new URL("./worker-ephemeral.mjs", import.meta.url)),
  modules: true,
  compatibilityDate: "2026-06-01",
  compatibilityFlags: ["nodejs_compat"],
  bindings: { CF_API_BASE: "http://fake-cf.internal/client/v4" },
  kvNamespaces: { SESSIONS: "PREV" },
  outboundService: (req) => fakeCloudflare(req),
});

async function call(path, opts = {}, cookie = null) {
  const headers = { ...(opts.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  const res = await mf.dispatchFetch("http://localhost" + path, { ...opts, headers });
  const setCookie = res.headers.get("Set-Cookie");
  let body = null;
  try { body = await res.json(); } catch { body = await res.text(); }
  return { status: res.status, body, setCookie };
}

const HELLO = [{
  name: "hello.js",
  content: `export default { async fetch() { return new Response("hola desde preview"); } }`,
}];

async function main() {
  console.log("[1] primer POST /preview: crea cuenta temporal (sin login) y despliega");
  const r1 = await call("/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files: HELLO, main: "hello.js" }),
  });
  check(r1.status === 200, `POST /preview HTTP ${r1.status}`);
  check(r1.body?.created === true && Boolean(r1.body?.previewUrl), `previewUrl: ${r1.body?.previewUrl}`);
  check(Boolean(r1.body?.claimUrl), "claimUrl presente (human-in-the-loop)");
  check(r1.setCookie?.includes("HttpOnly"), "cookie de sesion httpOnly emitida");
  const cookie1 = r1.setCookie?.match(/mcpwasm_preview_sid=[A-Za-z0-9-]+/)?.[0];
  check(Boolean(cookie1), "sid extraible de la cookie");
  check(creations === 1, `cuentas creadas: ${creations} (esperado 1)`);
  check(deploys === 1 && lastDeployedName?.startsWith("mcpwasm-preview-"), `script desplegado: ${lastDeployedName}`);

  console.log("[2] seguridad estructural: el apiToken JAMAS sale del worker");
  const serialized = JSON.stringify(r1.body);
  check(!serialized.includes("SECRET-TOKEN"), "respuesta sin apiToken");
  check(!(r1.setCookie ?? "").includes("SECRET-TOKEN"), "cookie no contiene apiToken");

  console.log("[3] segundo POST con la misma sesion: reuso (sin nuevo PoW ni cuenta)");
  const r2 = await call("/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files: [{ name: "hello.js", content: `export default { async fetch() { return new Response("v2"); } }` }],
      main: "hello.js",
    }),
  }, cookie1);
  check(r2.status === 200 && r2.body?.created === false, "reuso de la misma cuenta temporal");
  check(creations === 1, `cuentas creadas sigue en: ${creations}`);
  check(deploys === 2, `deploys acumulados: ${deploys} (redeploy sobre la misma cuenta)`);

  console.log("[4] GET /preview: estado de la sesion");
  const r3 = await call("/preview", { method: "GET" }, cookie1);
  check(r3.status === 200 && r3.body?.previewUrl === r1.body?.previewUrl, "estado consistente");
  check(typeof r3.body?.msToExpiry === "number" && r3.body?.msToExpiry > 0, "msToExpiry positivo");
  check(!JSON.stringify(r3.body).includes("SECRET-TOKEN"), "estado sin apiToken");

  console.log("[5] segundo cliente sin cookie: sesion propia (cuenta aparte)");
  const r4 = await call("/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files: HELLO, main: "hello.js" }),
  });
  check(r4.status === 200 && r4.body?.created === true, "segundo cliente: cuenta nueva");
  check(creations === 2, `cuentas creadas: ${creations} (esperado 2)`);
  check(r4.body?.accountName !== r1.body?.accountName, "nombres de cuenta distintos");

  console.log("[6] body invalido -> 400 sin tocar Cloudflare");
  const r5 = await call("/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files: [], main: "x.js" }),
  }, cookie1);
  check(r5.status === 400, `HTTP 400 por files vacio`);
  const r6 = await call("/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files: [{ name: "../evil.js", content: "x" }], main: "../evil.js" }),
  }, cookie1);
  check(r6.status === 400, "HTTP 400 por traversal en name");

  console.log("[7] DELETE /preview: borra el script y la sesion");
  const r7 = await call("/preview", { method: "DELETE" }, cookie1);
  check(r7.status === 200 && r7.body?.deleted === true, `delete del script: ${r7.body?.scriptName}`);
  check(deletes === 1, `deletes en la API fake: ${deletes}`);
  const r8 = await call("/preview", { method: "GET" }, cookie1);
  check(r8.status === 404, "sesion borrada -> GET 404");

  console.log(`TEST EPHEMERAL PROXY: ${CHECKS.every(Boolean) ? "PASS" : "FALLO"} (${CHECKS.filter(Boolean).length}/${CHECKS.length})`);
  process.exit(CHECKS.every(Boolean) ? 0 : 1);
}

main().catch((e) => {
  console.error("TEST EPHEMERAL PROXY: ERROR —", e.message);
  process.exit(1);
});