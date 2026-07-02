# Extension: Skill Attestations

**Status:** Draft (v0.1)
**Date:** 2026-07-02
**Extends:** [Extension: Executable Skills](./ext-executable-skills.md) (v0.3)
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
  "signature": "<ed25519-signature-hex>",
  "note": "reviewed for v0.3 capability contract; no data exfiltration paths"
}
```

| Field | Requirement | Meaning |
|---|---|---|
| `origin` | REQUIRED | The publishing origin the review applies to. |
| `skill` | REQUIRED | Skill name as it appears in `llms.txt`. |
| `tool_sha256` | REQUIRED | The exact artifact hash reviewed. A new artifact version voids the attestation by construction. |
| `attester` | REQUIRED | Reviewer identity, `<type>:<name>` (e.g. `human:mauricio`). |
| `signed_on` / `valid_until` | REQUIRED | Validity window, ISO dates. Past `valid_until` the attestation is EXPIRED. |
| `signature` | REQUIRED | Ed25519 over the signing payload (§2.2), lowercase hex. |
| `note` | OPTIONAL | Human context; not part of the signed payload semantics beyond §2.2. |

### 2.2 Signing payload

The signature covers the UTF-8 bytes of the canonical string:

```
origin + "\n" + skill + "\n" + tool_sha256 + "\n" + signed_on + "\n" + valid_until
```

**`origin` is deliberately inside the payload.** Identical bytes on a different origin are a *different skill in effect*: `fetchOrigin` is scoped to the publishing origin, so the same code talks to a different backend. An attestation MUST NOT be replayable across origins. (This is the one place this extension diverges from the donor PoC, which had no cross-site dimension.)

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
  "human:mauricio": { "public_key": "<ed25519-public-key-hex>", "registered_at": "2026-07-02" }
}
```

Runtimes MAY populate it by explicit configuration (recommended) or TOFU-pin keys on first sight (consistent with core RFC §4.6). An attestation from an unknown attester verifies as UNKNOWN-ATTESTER, not as valid.

## 4. Runtime behavior

A runtime that supports this extension evaluates, per skill, at discovery time:

| Verdict | Condition |
|---|---|
| `attested` | ≥1 attestation with valid signature from a registered key, matching `origin`+`skill`+`tool_sha256`, within its validity window |
| `expired` | matching attestations exist but all are past `valid_until` |
| `invalid` | a signature fails verification (SHOULD be surfaced loudly — a forged attestation is worse than none) |
| `unattested` | no matching attestation (including hash mismatch after a skill update) |

Runtimes SHOULD support at least two modes:

- **Advisory** (default): all verified skills load; the verdict is exposed to the consumer (e.g. in the tool description or a discovery diagnostic) so agents/operators can decide.
- **Enforcing**: only `attested` skills load; everything else is excluded like a hash mismatch.

Verification MUST be independently computable from static files: fetch `attestations.json`, verify Ed25519 (available in Workers/browsers via WebCrypto) against the registry. No callbacks to any service.

## 5. Security considerations

- **What this buys:** an agent operator can require "code reviewed by someone I chose, endorsement not expired" before executing third-party artifacts. Compromising the publisher's site is no longer enough to ship malicious code to enforcing runtimes — the attacker also needs a registered reviewer's private key.
- **What this does not buy:** a review is a point-in-time human judgment; it cannot guarantee the absence of vulnerabilities. Key compromise of a reviewer defeats the ring for that reviewer's attestations (mitigation: multiple reviewers, short windows). Revocation before `valid_until` is unsolved here (§6) — short validity windows are the honest stopgap.
- **Expiry is a feature.** An expired attestation returning to `unattested` is the freshness layer doing its job: endorsements rot unless renewed, exactly like the donor PoC's TTL model.

## 6. Open questions

1. Discovery of third-party attestations not hosted on the publishing origin (reviewer-side feeds? aggregators?).
2. Revocation before expiry (a static revocation list at the same well-known path is the zero-infra candidate).
3. Should `enforcing` mode distinguish per-capability risk (e.g. require attestation only for skills using POST)?
4. Alignment with core RFC §4.6: a signed `llms.txt` could pin `attestations.json` transitively.

## 7. Changelog

- **v0.1 (2026-07-02):** Initial draft, adapted from the ccdd okf-integration PoC (Ed25519 attestations + freshness windows + key registry), with origin-binding added for the cross-site skill context.
