// sigstore-attest.mjs
// Verificacion de atestaciones "keyless" via Sigstore -- un tipo ADICIONAL de
// atestacion junto al ed25519 pre-registrado ya existente (ext-skill-attestations
// v0.2). El RFC (core RFC Sec 4.6) ya sugiere Sigstore para provenance ligado a
// identidad: "the artifact is signed by an OIDC identity... and recorded in a
// public log". El ed25519 requiere pre-registrar la clave publica de cada
// revisor humano (REVIEWERS); Sigstore verifica CUALQUIER identidad OIDC (un
// login de GitHub/Google, o -- el caso realista para CI -- un workflow de
// GitHub Actions) sin coordinacion previa, mientras el runtime declare que
// identidad especifica confia (certificateIssuer/certificateIdentityURI).
//
// LIMITACION DE PLATAFORMA (confirmada durante el desarrollo): el paquete
// 'sigstore' depende de @sigstore/tuf para cachear la "trusted root" (las
// claves publicas de Fulcio/Rekor/CT log) via TUF, y esa cache usa node:fs sin
// forma de saltearla por la API publica. Cloudflare Workers no tiene
// filesystem, asi que este modulo SOLO puede correr en un runtime Node real
// (bin/mcpwasm-local.mjs) -- NO en worker-gateway.mjs.
//
// Payload firmado: un in-toto Statement v1 (https://in-toto.io/Statement/v1)
// dentro de un DSSE envelope, cuyo `predicate` debe traer EXACTAMENTE los mismos
// 5 campos que el modelo ed25519 (origin, skill, tool_sha256, signed_on,
// valid_until). El cruce contra los campos de nivel superior de la atestacion
// es OBLIGATORIO: sin el, alguien podria tomar un bundle validamente firmado
// para (origin, skill) A y reetiquetar el JSON exterior como si fuera de B sin
// volver a firmar nada -- el DSSE en si seguiria verificando (la firma cubre el
// payload interno, no los campos JSON que un caller le agrega alrededor).

import { verify as sigstoreVerify } from "sigstore";

// expected = { issuer, identity }: el issuer OIDC (ej.
// "https://token.actions.githubusercontent.com") y la identidad exacta
// esperada (ej. "https://github.com/OWNER/REPO/.github/workflows/release.yml@refs/heads/main"),
// tipicamente provenientes del registro de revisores del runtime (la entrada
// "sigstore:<identity>" en REVIEWERS). Devuelve true/false; CUALQUIER fallo
// (bundle ausente/malformado, firma invalida, cert no confiable en Fulcio,
// Rekor no verifica, identidad no coincide, o predicate no coincide con los
// campos declarados) devuelve false -- nunca lanza, para que el caller lo trate
// igual que un ed25519 invalido (INVALID domina, spec Sec 4).
export async function verifySigstoreAttestation(attestation, expected) {
  const bundle = attestation && attestation.sigstore_bundle;
  if (!bundle || typeof bundle !== "object") return false;
  if (!expected || typeof expected.issuer !== "string" || typeof expected.identity !== "string") {
    return false;
  }

  let signer;
  try {
    signer = await sigstoreVerify(bundle, {
      certificateIssuer: expected.issuer,
      certificateIdentityURI: expected.identity,
    });
  } catch {
    // Firma invalida, certificado no encadena a la CA de Fulcio, la entrada de
    // Rekor no verifica, o la identidad del certificado no coincide con la
    // esperada -- cualquiera de estos es motivo suficiente de rechazo.
    return false;
  }
  if (!signer) return false;

  let statement;
  try {
    const payloadB64 = bundle.dsseEnvelope && bundle.dsseEnvelope.payload;
    if (typeof payloadB64 !== "string") return false;
    statement = JSON.parse(Buffer.from(payloadB64, "base64").toString("utf8"));
  } catch {
    return false;
  }
  const predicate = statement && statement.predicate;
  if (!predicate || typeof predicate !== "object") return false;

  return (
    predicate.origin === attestation.origin &&
    predicate.skill === attestation.skill &&
    predicate.tool_sha256 === attestation.tool_sha256 &&
    predicate.signed_on === attestation.signed_on &&
    predicate.valid_until === attestation.valid_until
  );
}

// Construye el in-toto Statement v1 que un publisher debe firmar (con `sigstore
// attest` / la CLI/SDK que use) para producir el DSSE envelope de una atestacion.
// No firma nada por si misma -- esta funcion es solo el payload canonico,
// analoga a la construccion del string ed25519 en el core RFC (origin+"\n"+...).
export function buildSigstoreStatement({ origin, skill, tool_sha256, signed_on, valid_until }) {
  return {
    _type: "https://in-toto.io/Statement/v1",
    subject: [{ name: skill + "@" + origin, digest: { sha256: tool_sha256 } }],
    predicateType: "https://github.com/MauricioPerera/mcpwasm/attestation/v1",
    predicate: { origin, skill, tool_sha256, signed_on, valid_until },
  };
}
