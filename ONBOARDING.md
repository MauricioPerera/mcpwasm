# Onboarding third-party publishers

mcpwasm turns any static site publishing `/llms.txt` with executable skills into
an MCP server. The gateway is deployed with a closed origin allowlist
(`ALLOWED_ORIGINS`); a site is not reachable through it until its origin is
explicitly added. This document is the honest process for getting a
**third-party** publisher (a site you do not control) onto the gateway.

It assumes you have read the gateway's security model and attestation mechanics
in the [README](./README.md). It does not repeat them; it states what a
third-party publisher must do and what the maintainer does on their side.

## Requirements

A publisher site is eligible when all of the following hold:

- A valid `/llms.txt` under a `## Skills` section, listing each executable skill
  with its `tool` path and a correct `tool_sha256` (hex SHA-256 of the `tool.js`
  bytes). A skill whose declared hash does not match the fetched bytes is
  rejected and not registered — so the hash must be recomputed whenever
  `tool.js` changes. (Optional: an origin-memory snapshot line with a matching
  `snapshot_sha256` if the skills search over the site's own content.)
- All discovery payloads within the gateway's size caps (defaults, env-configurable):
  `llms.txt` ≤ 256 KB, each `tool.js` ≤ 1 MB, `attestations.json` ≤ 256 KB,
  the memory snapshot ≤ 4 MB. Oversized content is rejected before it is fully
  read; the publisher must stay under the caps.
- `attestations.json` published at
  `/.well-known/agent-skills/attestations.json` (Ed25519 reviewer attestations,
  spec `ext-skill-attestations` v0.2). In the deployed `enforcing` mode, a skill
  with no valid attestation does not load, so this file is what makes the skills
  usable, not cosmetic.
- The onboarding lint passes green:

  ```bash
  node scripts/validate-publisher.mjs <origin>
  ```

  Exit `0` means the site is eligible in `enforcing` mode. A non-zero exit lists
  what to fix; the publisher resolves it before requesting onboarding.

## Request

Open a GitHub issue in [MauricioPerera/mcpwasm](https://github.com/MauricioPerera/mcpwasm)
with:

- the origin (the `https://...` URL that serves `/llms.txt`),
- a short description of each skill and what its `tool.js` does, and
- a contact for the publisher.

There is no form or automated submission; the issue is the request. The
maintainer will not activate an origin whose lint does not pass.

## Review & attestation

The maintainer:

- re-runs the onboarding lint against the origin (exit `0` required),
- reads the `tool.js` source of every skill — the gateway verifies the bytes
  match the declared SHA-256 but does not vet what a tool does; that review is
  here, by a human, before attestation, and
- signs an Ed25519 attestation per skill with `scripts/attest.mjs` and publishes
  the result in the publisher's `attestations.json`.

**Current policy, stated explicitly:** only `human:mauricio` attests third-party
skills today. The reviewer registry (`REVIEWERS` in `wrangler-gateway.toml`,
`attester → { public_key, registered_at }`) is what the gateway checks signatures
against, and it may grow to additional reviewers in the future. Until then, a
third-party skill is `attested` only when signed by `human:mauricio` with a
valid key inside its `[signed_on, valid_until]` window.

## Activation

The maintainer adds the origin to the `ALLOWED_ORIGINS` var in
`wrangler-gateway.toml` and runs `wrangler deploy`. The origin is reachable on
the next request.

External origins are served through the gateway's global `fetch` path — they
do **not** need a service binding. Service bindings (`DEMO`, `BOOKSTORE`,
`DOCS`) exist only for same-account workers, because Cloudflare returns error
1042 on same-account worker-to-worker fetch over `workers.dev`; a binding
bypasses that. A third-party origin has no such constraint and goes through
ordinary `fetch`.

## Operation

Once activated:

- Discovery is cached for 60 s in two layers: layer 1 caches the parsed result
  per isolate, layer 2 caches the full post-verification result in the Cache API
  per colo (`X-Gw-Discovery: hit|l2|miss`). What is cached is post-verification
  (the `tool.js` bytes were already hash-checked when layer 2 was populated).
- The deployed mode is `enforcing`: a skill without a valid attestation does not
  load — excluded exactly like a `tool_sha256` mismatch (logged, not
  registered). `expired` and `invalid` skills are excluded too; only `attested`
  loads.
- Attestations carry `valid_until`. When the date passes the window, the
  verdict becomes `expired` and the skill stops loading. The publisher must
  arrange renewal before expiry.
- Re-attest after every `tool.js` change: the SHA-256 changes, so the existing
  attestation (which signs the old hash) no longer matches and the skill drops
  to `unattested` → excluded. The maintainer signs the new hash.
- Changing `ATTESTATION_MODE` or the `REVIEWERS` registry changes the discovery
  cache fingerprint and invalidates the layer-2 cache instantly — no stale
  verdicts are served across the change.

## Revocation

A publisher can be taken off the gateway by either or both of:

- Removing the origin from `ALLOWED_ORIGINS` (edit the var, `wrangler deploy`).
  The origin is blocked at the next request — this is the immediate lever.
- Letting attestations expire or not renewing them. With no valid attestation in
  its window the skill is `expired`/`unattested` and stops loading under
  `enforcing`, with no deploy needed on the gateway side.

A change to `REVIEWERS` (e.g. removing a reviewer's public key) or to
`ATTESTATION_MODE` also invalidates the layer-2 cache by fingerprint, so
verdicts recompute against the new config on the next request rather than
serving the old result.