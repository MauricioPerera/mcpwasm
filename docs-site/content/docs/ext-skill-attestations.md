# Extension: Skill Attestations

**Status:** Draft (v0.3)
**Date:** 2026-07-02
**Extends:** [Extension: Executable Skills](./ext-executable-skills.md) (v0.4)
**Design donor:** the three-layer knowledge-governance PoC in [ccdd/examples/okf-integration](https://github.com/MauricioPerera/ccdd/tree/main/examples/okf-integration) (working Ed25519 attestation + freshness tooling), adapted here to executable skills.

---

## 1. Motivation

The executable-skills extension gives two rings of trust: `tool_sha256` proves **integrity** (these bytes are these bytes) and core RFC §4.6 signatures prove **authenticity** (the publisher signed them). Neither answers the question an agent operator actually cares about before running third-party code: **has a human I trust reviewed this code, and do they still stand behind it?** A correctly hashed, correctly signed malicious artifact passes both rings — the residual risk §4 of the executable-skills extension explicitly admits.

This extension adds the third ring: **attestations** — signed, expiring statements by named reviewers that a specific artifact, on a specific origin, was reviewed and endorsed. Two design commitments inherited from the donor PoC:

1. **Age is a proxy, not truth.** Whether code is still trustworthy is a human judgment; the only honest way to capture it is a human signature with an explicit validity window. Nothing here pretends to automate that judgment.
2. **Zero infrastructure, like everything else in this standard.** Attestations are static JSON files. No transparency log, no CA, no server.

This layer is **OPTIONAL**. Publishers who skip it lose nothing they have today; runtimes decide what unattested skills are worth.

## 2. Attestation format

### 2.1 The attestation object

```json
{
  "origin": "https://llmstxt-bookstore.rckflr.workers.dev",
  "skill": "create_order",
  "tool_sha256": "a3c2…",
  "attester": "human:mauricio",
  "signed_on": "2026-07-02",
  "valid_until": "2027-07-02",
  "signature": "<ed25519-signature-base64>",
  "note": "reviewed for v0.3 capability contract; no data exfiltration paths"
}
```

| Field | Requirement | Meaning |
|---|---|---|
| `origin` | REQUIRED | The publishing origin the review applies to. |
| `skill` | REQUIRED | Skill name as it appears in `llms.txt`. |
| `tool_sha256` | REQUIRED | The exact artifact hash reviewed. A new artifact version voids the attestation by construction. |
| `attester` | REQUIRED | Reviewer identity, `<type>:<name>` (e.g. `human:mauricio`). |
| `signed_on` / `valid_until` | REQUIRED | Validity window, `YYYY-MM-DD` in UTC. An attestation is EXPIRED when the current UTC date is strictly greater than `valid_until` (the end date is inclusive). |
| `signature` | REQUIRED | Ed25519 over the signing payload (§2.2), **base64** (aligned with the core RFC tooling, `scripts/verify_signatures.py`). |
| `note` | OPTIONAL | Human context; not part of the signed payload semantics beyond §2.2. |

### 2.2 Signing payload

The signature covers the UTF-8 bytes of the canonical string:

```
origin + "\n" + skill + "\n" + tool_sha256 + "\n" + signed_on + "\n" + valid_until
```

**`origin` is deliberately inside the payload.** Identical bytes on a different origin are a *different skill in effect*: `fetchOrigin` is scoped to the publishing origin, so the same code talks to a different backend. An attestation MUST NOT be replayable across origins. (This is the one place this extension diverges from the donor PoC, which had no cross-site dimension.)

### 2.1b Alternative: Sigstore (keyless) attestation

The Ed25519 model above requires pre-registering every reviewer's public key
(§3) — a coordination step that does not scale past a handful of trusted
individuals. As a **second, optional** attestation type, an entry MAY carry a
`sigstore_bundle` instead of `signature`:

```json
{
  "origin": "https://llmstxt-bookstore.rckflr.workers.dev",
  "skill": "create_order",
  "tool_sha256": "a3c2…",
  "attester": "sigstore:https://github.com/OWNER/REPO/.github/workflows/release.yml@refs/heads/main",
  "signed_on": "2026-07-02",
  "valid_until": "2027-07-02",
  "sigstore_bundle": { "mediaType": "application/vnd.dev.sigstore.bundle+json;version=0.2", "...": "..." }
}
```

`attester` is prefixed `sigstore:` followed by the exact OIDC identity URI
(e.g. a GitHub Actions workflow ref, matching the certificate's Subject
Alternative Name) — not a pre-registered key name. `sigstore_bundle` is a
standard [Sigstore Bundle](https://github.com/sigstore/protobuf-specs) (DSSE
envelope + Fulcio certificate chain + Rekor transparency-log inclusion proof).
The signed payload is an [in-toto Statement v1](https://in-toto.io/Statement/v1)
whose `predicate` carries the *same five fields* as §2.2's canonical string
(`origin`, `skill`, `tool_sha256`, `signed_on`, `valid_until`) — a verifier
MUST confirm the DSSE-embedded predicate matches the attestation's own
top-level fields; without that cross-check, a validly-signed bundle for skill
A could be relabeled as skill B's attestation without re-signing anything (the
signature only covers the DSSE payload, not whatever JSON a caller wraps
around it).

**What this buys over pre-registered Ed25519:** *any* OIDC identity can
produce a valid Sigstore signature (verifiable against Fulcio's public root +
Rekor's public transparency log) with no prior coordination with the
publisher or runtime operator. The runtime's trust decision shifts from
"which public keys do I whitelist" to "which *identities* do I require" —
e.g. "only this specific GitHub Actions release workflow", still an
allowlist, but one that scales to any number of contributors without a
manual key-registration step per person. This is the core RFC §4.6
"higher assurance... keyless signing via a transparency log" recommendation,
applied to this extension's third trust ring specifically.

**What it does not change:** the reviewer registry (§3) still decides *which*
identities are trusted — Sigstore does not eliminate the allowlist, it changes
its unit from public keys to OIDC identity strings, and removes the private
per-reviewer key-management burden (Fulcio issues short-lived certificates
per signing operation instead).

### 2.3 Publication

Attestations are published by the origin as a static JSON array at:

```
/.well-known/agent-skills/attestations.json
```

(consistent with the core RFC's `/.well-known/agent-skills/index.json` metadata layer). Multiple attestations per skill (different reviewers) are allowed and encouraged. Third-party reviewers MAY additionally publish their attestations on their own domain; how runtimes discover those is an open question (§6).

## 3. Reviewer registry (trust anchor)

Verification requires knowing reviewers' public keys. The registry is **runtime-side configuration**, not publisher data — the publisher hosting the keys that vouch for the publisher would be circular:

```json
{
  "human:mauricio": { "public_key": "<ed25519-public-key-base64>", "registered_at": "2026-07-02" },
  "sigstore:https://github.com/OWNER/REPO/.github/workflows/release.yml@refs/heads/main": {
    "issuer": "https://token.actions.githubusercontent.com",
    "registered_at": "2026-07-02"
  }
}
```

Runtimes MAY populate it by explicit configuration (recommended) or TOFU-pin keys on first sight (consistent with core RFC §4.6). An attestation from an unknown attester verifies as UNKNOWN-ATTESTER, not as valid. For a `sigstore:` entry, the registry maps the identity to its expected OIDC `issuer` (rather than a public key); verification asks Sigstore's own trust infrastructure (Fulcio, Rekor) whether the bundle's certificate was validly issued to that exact identity by that issuer — the runtime never handles or stores a reviewer's private key material, because there isn't one to store.

## 4. Runtime behavior

A runtime that supports this extension evaluates, per skill, at discovery time:

| Verdict | Condition |
|---|---|
| `attested` | ≥1 attestation with valid signature from a registered key, matching `origin`+`skill`+`tool_sha256`, within its validity window |
| `expired` | matching attestations exist but all are past `valid_until` |
| `invalid` | a signature fails verification (SHOULD be surfaced loudly — a forged attestation is worse than none) |
| `unattested` | no matching attestation (including hash mismatch after a skill update) |

**Precedence with multiple attestations:** `invalid` dominates — if any attestation for the skill carries a signature that FAILS verification against a *registered* key, the skill's verdict is `invalid` regardless of other valid attestations (a forged signature is a red flag, not noise; and since `attestations.json` is publisher-controlled, an attacker poisoning it can only block the publisher's own skills). Otherwise: any valid, in-window attestation → `attested`; else any expired one → `expired`; else `unattested`. Attestations from unregistered attesters are ignored for precedence (they are unverifiable, verdict input UNKNOWN-ATTESTER only as diagnostics).

Runtimes SHOULD support at least two modes:

- **Advisory** (default): all verified skills load; the verdict is exposed to the consumer (e.g. in the tool description or a discovery diagnostic) so agents/operators can decide.
- **Enforcing**: only `attested` skills load; everything else is excluded like a hash mismatch.

Verification MUST be independently computable from static files: fetch `attestations.json`, verify Ed25519 (available in Workers/browsers via WebCrypto) against the registry. No callbacks to any service.

**Sigstore verification is the one exception to "no callbacks":** confirming a Fulcio certificate chain and a Rekor inclusion proof needs network access to Sigstore's public trust infrastructure (the core RFC §4.6 already flags this trade-off for identity-bound provenance). A platform without outbound network access at verification time (or without filesystem access to cache Sigstore's TUF-distributed trust root — **confirmed in the mcpwasm reference implementation: Cloudflare Workers cannot run Sigstore verification for exactly this reason**) simply does not support the `sigstore:` attester type; it MUST fall back to treating such an entry as UNKNOWN-ATTESTER, not silently accept or crash.

## 5. Security considerations

- **What this buys:** an agent operator can require "code reviewed by someone I chose, endorsement not expired" before executing third-party artifacts. Compromising the publisher's site is no longer enough to ship malicious code to enforcing runtimes — the attacker also needs a registered reviewer's private key.
- **What this does not buy:** a review is a point-in-time human judgment; it cannot guarantee the absence of vulnerabilities. Key compromise of a reviewer defeats the ring for that reviewer's attestations (mitigation: multiple reviewers, short windows). Revocation before `valid_until` is unsolved here (§6) — short validity windows are the honest stopgap.
- **Expiry is a feature.** An expired attestation returning to `unattested` is the freshness layer doing its job: endorsements rot unless renewed, exactly like the donor PoC's TTL model.

## 6. Open questions

1. Discovery of third-party attestations not hosted on the publishing origin (reviewer-side feeds? aggregators?).
2. Revocation before expiry (a static revocation list at the same well-known path is the zero-infra candidate).
3. Should `enforcing` mode distinguish per-capability risk (e.g. require attestation only for skills using POST)?
4. Alignment with core RFC §4.6: a signed `llms.txt` could pin `attestations.json` transitively.

## 8. Reference implementation

[mcpwasm](https://github.com/MauricioPerera/mcpwasm)'s local runtime
(`bin/mcpwasm-local.mjs`, `sigstore-attest.mjs`) implements §2.1b: opt-in via
`--require-attestation <issuer>|<identity>`, verified end-to-end against a
real, live, publicly fetched Sigstore bundle (an npm package's own SLSA
provenance attestation) proving the Fulcio/Rekor verification path genuinely
works, plus all documented rejection paths (no attestations.json, no matching
entry, expired, malformed dates, invalid/mismatched bundle). The gateway
(`worker-gateway.mjs`) still implements only the Ed25519 model — confirmed
during development that Sigstore's TUF-based trust-root cache needs
filesystem access Cloudflare Workers does not have (§4).

## 7. Changelog

- **v0.3 (2026-07-09):** Added §2.1b: Sigstore (keyless) attestations as a second, optional attester type alongside Ed25519 — closes the "only pre-registered reviewers scale" bottleneck (§5) by trusting OIDC identities instead of pre-shared keys. Updated §3 (reviewer registry entry shape for `sigstore:` attesters) and §4 (network-access exception, platform-support fallback to UNKNOWN-ATTESTER). Added §8 pointing at the reference implementation.
- **v0.2 (2026-07-02):** Review fixes: base64 encoding for signatures/keys (aligned with core RFC tooling), canonical-origin and date normalization rules for the signing payload, inclusive-end UTC expiry semantics, and explicit verdict precedence (invalid dominates).
- **v0.1 (2026-07-02):** Initial draft, adapted from the ccdd okf-integration PoC (Ed25519 attestations + freshness windows + key registry), with origin-binding added for the cross-site skill context.
