# Changelog

All notable changes to the [`@rckflr/mcpwasm`](https://www.npmjs.com/package/@rckflr/mcpwasm)
package. Format based on [Keep a Changelog](https://keepachangelog.com/); dates
are the npm publish dates. Entries describe what each published tarball ships
relative to the previous one (verified against the actual tarballs, not just
the git log).

## [0.6.0] — 2026-07-10

### Added
- **Scopes: multiple projects on one origin — both runtimes.** Implements
  §2.5 of the Executable Skills extension **v0.5** (resolves core RFC v0.10
  Open Question 6). A skill line may declare `"scope":"<name>"`
  (pattern `^[a-z][a-z0-9_-]*$`); the runtime exposes the tool under the
  public name **`<scope>__<toolName>`** (e.g. `kdd__search_knowledge`). The
  rename happens at the **host boundary only**: published `tool.js` bytes,
  `tool_sha256` verification, and attestations are untouched — the
  universal-template property (one ecosystem-wide hash for the generated
  `search_knowledge`) is preserved.
- **One `skills-memory` line per scope** (at most one unscoped). Each scope's
  snapshot is fetched and sha256-verified independently; every skill gets
  `host.memorySearch` bound to **its own scope's** snapshot — per-project
  memory isolation on a shared origin. `parseLlmsTxt()` now returns
  `memories` (array, one entry per scope); the legacy `memory` field remains
  the first unscoped entry (additive, backward compatible).
- Skill recipes follow the public name: `skill://<scope>__<name>` in
  `resources/list`/`read`, and `get_skill_guide` takes public names.
- New local-suite scenario: two scopes sharing the same internal tool name,
  per-scope memory isolation (cross-scope query ⇒ 0 hits), public-name
  collision skipped with a diagnostic, and scoped resource URIs.

### Changed
- Invalid `scope` values make the line non-executable (reported in
  `nonExecutable` with a reason, not loaded). Public-name collisions keep the
  first line and skip the rest with a diagnostic (stderr locally, `rejected`
  in the gateway).
- Gateway L2 discovery cache format: `snapshotText` (single) → `snapshots`
  (per-scope map). Old cached entries are hydrated transparently
  (`snapshotText` ⇒ `{"": text}`); no cache flush needed.
- No `scope` anywhere ⇒ behavior identical to 0.5.0.

## [0.5.0] — 2026-07-10

### Added
- **Skill recipes (SKILL.md) as MCP resources — both runtimes.** An executable
  skill has two halves: the *recipe* (SKILL.md — when/how to use, sequencing,
  constraints) and the *capability* (tool.js). Until now the MCP path served
  only the capability; the recipe never reached the agent. Discovery now also
  fetches each verified skill's SKILL.md, verifies it against the `sha256`
  declared in the `llms.txt` line (core RFC field), and exposes it:
  - via MCP **resources** (`resources/list` + `resources/read`,
    `skill://<name>`, `text/markdown`) — capability advertised in
    `initialize`;
  - via a synthetic **`get_skill_guide`** tool (runtime-provided, not
    sandboxed) as a universal fallback for MCP clients without resources
    support.
  Fetch failure / HTTP error / sha256 mismatch ⇒ the *recipe* is omitted with
  a warning; the *tool* (independently verified by `tool_sha256`) loads
  unaffected — the halves fail independently. Under `enforcing` attestation
  mode, an excluded skill's recipe is excluded with it. New size cap:
  `MAX_SKILLMD_BYTES` (default 256 KB). `parseLlmsTxt()` skills gain
  `skillPath`/`skillSha256` (additive).

## [0.4.0] — 2026-07-10

### Added
- **Origin memory in the local runtime** (`bin/mcpwasm-local.mjs`): if the
  origin declares `skills-memory` (format `minimemory-okf-v1`), the snapshot is
  fetched (4 MB cap), verified against `snapshot_sha256`, and only then is
  `host.memorySearch` injected into every skill — the same contract as the
  gateway. Any failure (hash mismatch, fetch error, unknown format, engine
  missing) degrades to capability-absent: skills still list, calls fail closed
  in-sandbox (`isError:true`). This closes the memory half of the gateway/local
  capability asymmetry — the local runtime is now the full-featured reference.
- **Sigstore (keyless) attestation verification, local runtime only**:
  opt-in via `--require-attestation "<issuer>|<identity>"`. Fail-closed: every
  skill must have a matching, in-window attestation whose `sigstore_bundle`
  verifies against exactly that OIDC identity (in-toto Statement v1 in a DSSE
  envelope, predicate cross-checked against the attestation's own fields).
  New module `sigstore-attest.mjs` (exported as `./sigstore-attest`). The
  gateway remains Ed25519-only — Workers has no `node:fs` for `@sigstore/tuf`'s
  trust-root cache (spec `ext-skill-attestations` v0.4 §2.4 names this profile
  explicitly).
- **`index.json` cross-check** (both runtimes): discovery also fetches
  `/.well-known/agent-skills/index.json`; when it declares a `tool_sha256` for
  a skill, it must match the one in `llms.txt` — a disagreement rejects the
  skill (drift/tampering signal), same treatment as a hash mismatch against
  the fetched `tool.js`.
- **Prose-skill reporting** (both runtimes): non-executable skills found in
  `## Skills` (no `tool`/`tool_sha256`) are now reported on stderr with a
  reason instead of silently dropped, and the "no executable skills" error
  counts them. `parseLlmsTxt()` return shape gains `nonExecutable` and the
  parser now tracks the `## Skills` section boundary.

### Changed
- `@rckflr/minimemory` added as an **optionalDependency** (~630 KB, wasm BM25
  engine): installed by default with `npx`/`npm install`, lazily imported by
  the local runtime; if missing, the runtime says so on stderr and runs
  without memory.

### Fixed
- Local runtime `--serve`: a request with malformed percent-encoding crashed
  the whole process (uncaught `URIError` in the internal file server); now
  answers HTTP 400.
- Local runtime `--serve`: discovery failure called `process.exit(1)` while
  the internal server was still tearing down, crashing with libuv's
  `UV_HANDLE_CLOSING` assertion on Windows (exit 127 instead of 1); now sets
  `process.exitCode` and lets Node exit naturally.

## [0.3.1] — 2026-07-09

### Fixed
- `--serve` crashed on exit on Windows (exit code 127, the same libuv
  double-close race, on the graceful-shutdown path).

## [0.3.0] — 2026-07-09

### Added
- `--serve <dir> [--port N]`: internal static file server (127.0.0.1 only)
  over a local directory, so a cloned skills repo becomes a connectable origin
  in one step — the publisher's local development loop.

## [0.2.1] — 2026-07-08

### Fixed
- Gateway `serverInfo` reporting, local runtime size caps measured in bytes,
  and strict attestation date validation (analysis follow-ups).

## [0.2.0] — 2026-07-08

### Added
- **Local MCP runtime** (`bin/mcpwasm-local.mjs`, the `mcpwasm` bin): stdio
  MCP server that discovers an origin's `llms.txt`, verifies every
  `tool_sha256`, loads each verified skill into its own QuickJS-wasm context,
  and serves `tools/list` / `tools/call` — `npx -y @rckflr/mcpwasm <origin>`,
  zero infrastructure on either side.

## [0.1.0] — 2026-07-08

### Added
- Initial npm release: embeddable host (`AsyncToolHost` / sync `ToolHost`),
  MCP core, and `llms.txt` executable-skills parser — the library the
  Cloudflare Workers gateway builds on.
