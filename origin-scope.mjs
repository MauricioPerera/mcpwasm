// origin-scope.mjs
// FUENTE UNICA de "que es el origin de un publicador" para los tres runtimes y
// para la herramienta de atestaciones.
//
// El problema que resuelve: `new URL(s).origin` conserva solo scheme+host+puerto
// y descarta el path en silencio. Eso es correcto para un publicador en la raiz
// de un dominio, pero NO para un GitHub Pages de PROYECTO
// (https://user.github.io/REPO/), donde el llms.txt vive bajo /REPO/. Antes de
// este modulo habia TRES criterios distintos conviviendo:
//   - scripts/attest.mjs        conservaba el path (firmaba con el)
//   - worker-gateway.mjs        conservaba el path al comparar atestaciones,
//                               pero recibia el origin ya recortado => NUNCA casaba
//   - bin/mcpwasm-local.mjs     lo descartaba de los dos lados => casaba SIEMPRE,
//                               con lo que una atestacion de /proyecto-A valia
//                               para /proyecto-B del mismo host
// El resultado observable era peor que un error: pedir <host>/REPO cargaba en
// silencio las skills de <host>, sin aviso, con HTTP 200.
//
// Para publicadores en la raiz TODAS estas funciones se comportan exactamente
// igual que el codigo anterior (basePath vacio => sin cambios de conducta).

// Base canonica de un publicador: scheme+host+puerto+path, sin barras finales.
// Devuelve null si no es un http(s) URL valido.
export function canonicalBase(input) {
  let u;
  try {
    u = new URL(input);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  return (u.origin + u.pathname).replace(/\/+$/, "");
}

// Path de la base ("" para un publicador en la raiz).
export function basePath(base) {
  const b = canonicalBase(base);
  if (b === null) return "";
  try {
    return new URL(b).pathname.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

// Resuelve un path DECLARADO POR EL PUBLICADOR contra la base. La base lleva "/"
// final para que un path relativo cuelgue de ella y no de su directorio padre
// (`new URL("x", "https://h/REPO")` daria https://h/x, que no es lo que el
// publicador declaro). Los paths absolutos mantienen la semantica HTTP normal:
// se resuelven desde la raiz del host, que es como los escribe un publicador de
// GitHub Pages (`/REPO/skills/...`).
export function resolveFromBase(base, p) {
  return new URL(p, base + "/").href;
}

// ¿El URL cae DENTRO de la base? Mismo origin y pathname igual a la base o
// colgando de ella. El borde "/" es obligatorio: sin el, la base /REPO
// aceptaria /REPOevil. Base sin path => cualquier path del host (conducta
// identica a la del chequeo `url.origin !== allowedOrigin` anterior).
export function isUnderBase(base, urlStr) {
  let u;
  const b = canonicalBase(base);
  if (b === null) return false;
  try {
    u = new URL(urlStr);
  } catch {
    return false;
  }
  if (u.origin !== new URL(b).origin) return false;
  const bp = basePath(b);
  if (bp === "") return true;
  return u.pathname === bp || u.pathname.startsWith(bp + "/");
}

// URLs candidatas para un recurso /.well-known/... RFC 8615 los ancla a la RAIZ
// del host, pero un publicador de GitHub Pages de proyecto no puede servir la
// raiz del host (no es suya). Se prueba primero bajo la base y se cae a la raiz;
// para un publicador en la raiz las dos coinciden y se devuelve UNA sola
// candidata => cero fetches extra respecto del codigo anterior.
export function wellKnownCandidates(base, suffix) {
  const b = canonicalBase(base);
  if (b === null) return [];
  const root = new URL(b).origin;
  const scoped = b + suffix;
  const atRoot = root + suffix;
  return scoped === atRoot ? [atRoot] : [scoped, atRoot];
}
