# mcpwasm — Static MCP

[![CI](https://github.com/MauricioPerera/mcpwasm/actions/workflows/ci.yml/badge.svg)](https://github.com/MauricioPerera/mcpwasm/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40rckflr%2Fmcpwasm)](https://www.npmjs.com/package/@rckflr/mcpwasm)

**Static MCP: your tools are files, not servers.** Tools are published as
static, hash-verified content and executed sandboxed on demand. What static
site hosting did to web servers — "don't run Apache, publish HTML" — this does
to MCP servers: don't run an MCP server, publish files. The publisher needs
zero infrastructure; the MCP server is materialized per request from those
files and evaporates after responding (ephemeral instance, durable definition).

mcpwasm is the reference implementation: a sandboxed runtime for third-party
MCP tools (untrusted tool code inside QuickJS-wasm on Cloudflare Workers),
plus a gateway that turns any static site publishing `llms.txt` with
executable skills into an MCP server.

Think "php-wasm, but for MCP tools": the platform owner embeds the host, loads
`tool.js` files, and each tool runs isolated in a QuickJS WebAssembly sandbox.
The only bridge from the sandbox to the platform's internals is an explicit
capability the host injects. No capability, no access.

This repo integrates with the [llms-txt-skills](https://github.com/MauricioPerera/llms-txt-skills)
standard via two provisional extensions adopted in the spec: **executable
skills** (v0.4, with *origin memory*) and **skill attestations** (v0.3). See
the dedicated sections below.

## Use as a library (npm)

The embeddable host — what the gateway itself builds on — ships as
[`@rckflr/mcpwasm`](https://www.npmjs.com/package/@rckflr/mcpwasm):

```bash
npm install @rckflr/mcpwasm
```

```js
import { AsyncToolHost } from "@rckflr/mcpwasm";

const host = new AsyncToolHost({ allowedOrigin: "https://example.com" });
await host.init();
host.loadToolSource(toolJsSource); // a tool.js that calls registerTool({...})
const tools = host.listTools();
const result = await host.callTool("sum_numbers", { a: 2, b: 40 });
host.dispose();
```

Notes:

- In Cloudflare Workers, pass a pre-built asyncify module via the `quickjs`
  option (see `worker-gateway.mjs` for the `CompiledWasm` import pattern and
  import `@rckflr/mcpwasm/shim` first).
- Subpath exports: `/host` (sync `ToolHost`), `/host-async`, `/mcp-core`,
  `/mcp-core-async`, `/llmstxt-parse`, `/shim`.
- The sync `ToolHost` lazy-imports the optional peer `quickjs-emscripten`
  unless you pass a pre-built module; the async host's dependencies install
  with the package.
- The package contains only the host/core/parser files plus the local runtime
  binary; the workers, publisher sites and test suites stay in this repo (they
  are the deployed reference, not the library).

### Local MCP runtime — no gateway at all

The package also ships a stdio MCP server that runs an origin's skills
**locally**: it fetches `/llms.txt`, verifies every `tool_sha256`, loads each
verified skill into its own QuickJS-wasm context, and speaks MCP over
stdin/stdout — so a static site (e.g. a GitHub Pages *user* site) becomes an
MCP server on your machine with zero deployed infrastructure on either side:

```bash
npx -y @rckflr/mcpwasm https://usuario.github.io
```

MCP client configuration (Claude Code, Cursor, …):

```json
{
  "mcpServers": {
    "misitio": {
      "command": "npx",
      "args": ["-y", "@rckflr/mcpwasm", "https://usuario.github.io"]
    }
  }
}
```

Honest v1 limits (stated in `bin/mcpwasm-local.mjs`): no origin memory
(`host.memorySearch` is absent; skills that call it fail controlled, which the
spec allows), and discovery runs once per process (restart to refresh). Hash
verification and the sandbox model (per-skill contexts, origin-scoped
`fetchOrigin`, resource limits) are the same as the gateway's. Trust is your
choice of origin by default (no attestation required); Sigstore attestation
verification is available opt-in via `--require-attestation` (below). Also
cross-checks `tool_sha256` against `.well-known/agent-skills/index.json` when
the origin publishes one (see "Cross-checking against index.json"). Tested by
`npm run local` (hermetic, localhost-only; part of the CI gate).

#### Cross-checking against `index.json`

Both the local runtime and the gateway now also fetch
`/.well-known/agent-skills/index.json` — the canonical metadata layer the core
llms-txt-skills RFC defines (§8 Open Question 5: `llms.txt` is the zero-fetch
discovery pointer, `index.json` is the metadata/verification source of truth).
When a skill's name appears in both `llms.txt` and `index.json`, and the
latter declares a `tool_sha256`, it **must** match the one declared in
`llms.txt`; a mismatch rejects the skill (drift/tampering signal) exactly like
a `tool_sha256` mismatch against the fetched `tool.js` itself. Absence of
`index.json` (most origins today) changes nothing.

#### Sigstore attestations: `--require-attestation` (local runtime only)

> **Platform limitation, discovered during implementation:** the `sigstore`
> npm package depends on `@sigstore/tuf` to cache Fulcio/Rekor's trusted root
> via TUF, and that cache uses `node:fs` with no way to bypass it through the
> public API. Cloudflare Workers has no filesystem, so Sigstore verification
> **only runs in the local Node runtime** (`bin/mcpwasm-local.mjs`) — the
> gateway's attestation model remains the pre-registered-key Ed25519 scheme
> above, unaffected.

The Ed25519 model (above) requires pre-registering every reviewer's public
key — a real bottleneck (today, only the maintainer is registered). Sigstore
verifies **any** OIDC identity (a GitHub Actions workflow, a Google/GitHub
login) without pre-coordination; the runtime's trust decision is which
*identity* to require, not which *key* to whitelist — closer to what core RFC
§4.6 recommends for identity-bound provenance.

```bash
npx -y @rckflr/mcpwasm https://usuario.github.io \
  --require-attestation "https://token.actions.githubusercontent.com|https://github.com/OWNER/REPO/.github/workflows/release.yml@refs/heads/main"
```

When set, discovery additionally fetches
`/.well-known/agent-skills/attestations.json` and, for **every** skill,
requires a matching entry (`origin` + `skill` + `tool_sha256`) whose
`sigstore_bundle` verifies against exactly that `issuer|identity` pair, within
its `[signed_on, valid_until]` window. A skill without one — absent
attestations.json, no matching entry, expired, or an invalid/mismatched bundle
— is excluded, same treatment as a `tool_sha256` mismatch. This flag is
fail-closed by design: it is opt-in, but once set, absence of a valid
attestation is *not* tolerated (unlike the gateway's `advisory` mode).

The attestation object's signed payload is an
[in-toto Statement v1](https://in-toto.io/Statement/v1) inside a DSSE
envelope, whose `predicate` must carry the same 5 fields as the Ed25519 model
(`origin`, `skill`, `tool_sha256`, `signed_on`, `valid_until`) — verified to
match the attestation's own top-level fields, so a validly-signed bundle for
skill A cannot be relabeled as skill B's attestation without re-signing.
`sigstore-attest.mjs` exports `verifySigstoreAttestation` (the verifier) and
`buildSigstoreStatement` (the canonical payload shape a publisher signs with
`sigstore attest` or an equivalent SDK call — this repo does not ship a
signing tool for it, since producing a real Sigstore signature needs a live
OIDC flow, out of scope for a script run here).

Verified against a **real, live, publicly fetched** Sigstore bundle (the SLSA
provenance attestation for the `sigstore@5.0.0` npm package's own publish,
`https://registry.npmjs.org/-/npm/v1/attestations/sigstore@5.0.0`) — proving
the underlying Fulcio cert-chain + Rekor transparency-log verification
genuinely runs and succeeds, and that a schema-mismatched or wrong-identity
bundle is correctly rejected. All 6 `--require-attestation` rejection paths
(no attestations.json, empty array, no matching skill, malformed date,
expired, invalid/empty bundle) verified end-to-end against
`bin/mcpwasm-local.mjs`. **Honest gap:** producing a *positive* fixture (a
real Sigstore signature over this repo's own canonical payload, verifying as
`attested`) needs a live OIDC signing flow this environment cannot complete
headlessly — untested is the happy path specifically, not the security-critical
rejection paths.

#### Developing your own skills: `--serve <dir>`

Pointing the runtime at a raw GitHub URL does **not** work: `new URL(...).origin`
keeps only scheme+host+port, so `https://raw.githubusercontent.com/you/repo/main/`
collapses to `https://raw.githubusercontent.com` — the `you/repo/main` part (and
therefore `/llms.txt`) is gone. `--serve` is the practical alternative: it starts
an internal static file server (bound to `127.0.0.1` only, never exposed to the
network) over a local directory — e.g. your own `git clone` of a skills repo —
and uses that as the origin, combining "serve this directory" and "connect to
it" into one command:

```bash
npx -y @rckflr/mcpwasm --serve ./my-skills-repo
# npx -y @rckflr/mcpwasm --serve ./my-skills-repo --port 4000   (fixed port, optional)
```

This is meant for developing and testing your own skills locally before
publishing them (to GitHub Pages or any other static host) — not for browsing
someone else's GitHub repo directly. Path-traversal requests against the
internal file server are rejected (resolved and checked against the served
directory's root); covered by `npm run local`.

## Why

MCP clients (Claude, Cursor, others) can call arbitrary tools. Running a
third-party tool's code directly in your backend means that code can read your
secrets, hit your DB, phone home, or loop forever. You either trust the author
fully or you don't run the tool.

mcpwasm removes the trust requirement for the *code*:

- The tool runs in a separate QuickJS-wasm context with no host globals beyond
  what the host predefines (`registerTool`, `host`). No `fetch`, no `process`,
  no disk, no secrets.
- The platform secret (e.g. a Stripe key) stays on the host side. The tool can
  only ask the host to perform a *named* internal action via `host.callInternal`
  (sync host) or a scoped `host.fetchOrigin` (async host). The host decides what
  is allowed.
- The tool's `tool.js` is content-addressed by SHA-256; the gateway refuses to
  load it if the hash declared in `llms.txt` does not match the bytes it
  fetched.
- Resource limits bound what a malicious/buggy tool can do: memory cap, stack
  cap, a deterministic gas budget (interrupt-handler invocation count), and a
  wall-clock fetch deadline per call.

## Static MCP vs. a traditional MCP server

In mcpwasm, *publishing* (static files + a hash) and *execution* (a runtime
that discovers, verifies, and sandboxes on demand) are two separate things. In
a traditional MCP server they are the same thing — the server you deploy *is*
the execution, with no isolation layer in between.

| | Static MCP — local (`npx @rckflr/mcpwasm`) | Static MCP — gateway | Traditional MCP server |
|---|---|---|---|
| What the publisher ships | Static files: `llms.txt` + `tool.js` (+ `SKILL.md`) | Same static files | A running server process (any language) |
| Infrastructure the publisher operates | None — GitHub Pages, R2, any static host | None — same | The whole server: uptime, scaling, patching, secrets |
| Where the tool code runs | Your own machine, in a QuickJS-wasm sandbox | The gateway Worker, in the same sandbox | The publisher's own process, natively, no isolation |
| Integrity guarantee | SHA-256 verified before any byte executes | Same | None built in — you trust the deployed binary/image as-is |
| Third trust ring (human review) | Not enforced (v1 limit — trust is your choice of origin) | Ed25519 attestations, `enforcing` mode in production | No standard mechanism |
| Transport | stdio (JSON-RPC over stdin/stdout) | HTTP POST (JSON-RPC); needs the gateway URL + a token | Either — but fixed per implementation |
| Network hops for the MCP call itself | Zero (local process); the tool can still call out via `fetchOrigin` | Two: client → gateway → publisher origin | Zero for local stdio, one for remote HTTP |
| Measured overhead (this repo's own benchmarks) | Not separately benchmarked — same sandbox cost, no gateway hop | ~2 ms sandbox warm, ~6 ms for the full gateway vs. a direct API call ([BENCHMARK.md](./BENCHMARK.md)) | N/A — no sandbox tax, but no isolation either |
| Discovery freshness | Once per process start (restart to refresh) | Cached 60 s (two layers + cron preheat) | Whatever the server implements |
| Multi-client / shared access | No — one local process per user | Yes — one gateway serves any number of MCP clients | Yes, if built as a shared server |
| Auth | None (you chose to run it) | Optional: shared token or per-client tokens + rate limiting | Whatever the publisher builds |
| Best fit | Developing/testing your own skills locally; zero-trust execution of someone else's skills without running a server | Teams wanting one shared endpoint serving many static publishers, with signed review as policy | Stateful logic, database connections, capabilities that genuinely need no sandbox constraint |

The takeaway that doesn't fit in a table: a traditional MCP server answers "how
do I expose this logic as a tool?" Static MCP additionally answers "how do I
run code from an origin I don't fully trust?" If you write and control the
server yourself, traditional is simpler and none of this is necessary. Static
MCP matters when the tool code comes from *someone else*, and you want a
verifiable guarantee (hash + sandbox, optionally review) before running it —
that is the problem this repo exists to solve, not a general-purpose
alternative to MCP.

### If you already have an API

You do not need to build or maintain an MCP protocol server — that is the
whole point. The runtime (local or gateway) already handles JSON-RPC,
`tools/list`, `tools/call`, and the transport; none of that is your code.

What you still have to write is **not** prose. A `tool.js` per action is real,
small glue code: it validates `args` against the schema you declared, calls
your existing API through `host.fetchOrigin`, and shapes the response — see
`bookstore/content/create_order.tool.js` in this repo for a concrete example
(validates `qty` and `book_id`, handles a 409 for insufficient stock as a
distinct case, never lets a malformed call reach your backend). This is a
different, stronger mechanism than a `SKILL.md` with no `tool.js`: prose-only
skills are the core RFC's basic mode — an agent reads them and *improvises*
the HTTP call with whatever generic request tool it has, with no schema
validation, no sandbox, and no hash pinning. That is the "execution gap" that
executable skills (this repo's reference feature) close. Handing an agent a
raw "make any HTTP request" capability against your API reintroduces the
problem this project exists to avoid — your backend ends up validating
against an arbitrary caller either way; a `tool.js` does that validation
before your API is ever hit, and the agent only ever gets the specific,
parameterized actions you defined.

"Zero infrastructure" is literal for internal use — your own team pointing
`npx @rckflr/mcpwasm` (or `--serve`) at your published skills needs no server
on either side. For external clients to reach you without installing
anything, you need one endpoint answering MCP over HTTP; that means either
your origin gets added to an existing deployed gateway's `ALLOWED_ORIGINS`,
or you `wrangler deploy` your own instance of the same generic gateway code in
this repo, configured for your origin. Either way it is a one-time,
tool-agnostic deploy — not a bespoke MCP server built per API.

## Architecture

```
                         (1) publish llms.txt + tool.js + SKILL.md
   Publisher site  ───────────────────────────────────────────┐
   (static: R2/Pages/                                          │
    any host serving /llms.txt)                                │
                                                               ▼
                                                        ┌───────────────┐
   MCP client  ──POST /mcp?origin=<pub>──►  Gateway Worker │ discovers     │
   (Claude,                                            │ llms.txt,     │
    Cursor, ...)                                        │ verifies     │
        ▲                                               │ sha256 per    │
        │  (5) JSON-RPC response                         │ skill,        │
        └──────────────────────────────────────────────  │ loads tools   │
                                                        │ in sandbox    │
                                                        └──────┬────────┘
                                                               │ (2) per request:
                                                               │     new QuickJS
                                                               │     context,
                                                               │     origin-scoped
                                                               ▼
                                                        ┌───────────────┐
                                                        │ AsyncToolHost │  (3) tool code
                                                        │ (QuickJS-wasm │      calls
                                                        │  asyncify)    │      host.fetchOrigin
                                                        │               │────► (4) host fetches
                                                        │  mem/stack/   │      ONLY the allowed
                                                        │  interrupt    │      origin, returns
                                                        │  limits set   │      {status,body}
                                                        └───────────────┘
```

Flow:

1. A publisher site ships `/llms.txt` plus per-skill `tool.js` and `SKILL.md`
   files. `llms.txt` lists each executable skill with a SHA-256 of its
   `tool.js`, and may declare an *origin memory* snapshot (see below).
2. On each request the gateway downloads `llms.txt`, parses the executable
   skills, downloads each `tool.js`, verifies SHA-256, and loads the verified
   ones into a fresh `AsyncToolHost` scoped to that origin.
3. Tool code runs inside QuickJS-wasm. It can only call
   `host.fetchOrigin(path, opts?)` (`opts`: `{method: "GET"|"POST",
   body?: string ≤16 KB, contentType?}` — write skills go through POST),
   which is async from the host side but synchronous-looking inside the sandbox
   (QuickJS asyncify suspends/resumes the wasm stack). An origin that declares
   a verified memory snapshot additionally gets `host.memorySearch(query, k?)`.
4. The host fetches only the allowed origin; any other origin throws inside the
   sandbox.
5. The gateway maps MCP `tools/list` and `tools/call` over JSON-RPC 2.0 and
   returns the result to the client.

Pieces live in:

- `host.mjs` — synchronous `ToolHost` (sync tools, `host.callInternal` capability).
- `host-async.mjs` — `AsyncToolHost` (async handlers, `host.fetchOrigin` + the
  `extraCapabilities` mechanism that backs `host.memorySearch`, resource hardening).
- `mcp-core.mjs` / `mcp-core-async.mjs` — JSON-RPC 2.0 MCP core (transport-agnostic).
- `worker.mjs` — PoC MCP server (sync host, inline tools).
- `worker-spike.mjs` — async spike (fetchHome/fetchEvil).
- `worker-gateway.mjs` + `llmstxt-parse.mjs` — the gateway.
- `worker-memspike.mjs` — memory spike: the docs-site origin published and
  served through the gateway end-to-end (`host.memorySearch` over a BM25
  snapshot), exercised by `mf-memspike.mjs`.

## The executable-skill line in `llms.txt`

> **Status: Draft v0.4, adopted.** This format is specified by the
> [Executable Skills extension](https://github.com/MauricioPerera/llms-txt-skills/blob/master/docs/ext-executable-skills.md)
> of the [llms-txt-skills](https://github.com/MauricioPerera/llms-txt-skills)
> standard. This repo is its reference implementation; the spec and this code
> are kept aligned (every MUST in the spec is field-tested here).

Under a `## Skills` section, an executable skill is a normal markdown list item
followed by an HTML comment carrying a JSON object with `version`, `tool` (path
to the `tool.js`), and `tool_sha256` (hex SHA-256 of the `tool.js` bytes):

```
- [sum_numbers](/skills/sum_numbers/SKILL.md): Sum two numbers a and b. <!-- skill: {"version":"1.0.0","tool":"/skills/sum_numbers/tool.js","tool_sha256":"58daf86111bf7278446eb7e0e8c6384713b50cdb6fa97ac039e23846d723dc3e"} -->
```

Parsed by `llmstxt-parse.mjs`:

- The `<!-- skill: {...} -->` comment marks the line as an *executable* skill.
  List items without it are treated as descriptive-only and ignored by the
  gateway.
- `tool` is resolved relative to the origin.
- `tool_sha256` is verified against the fetched `tool.js` bytes before the tool is
  loaded. Mismatch → the skill is rejected (logged) and not registered.
- If the JSON is invalid the line is silently skipped (no throw).

A `tool.js` registers itself:

```js
registerTool({
  name: "sum_numbers",
  description: "Sum two numbers a and b.",
  inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] },
  handler(args) { return Number(args.a) + Number(args.b); }
});
```

## Origin memory (search over static content)

> Spec: *origin memory* in
> [Executable Skills v0.4](https://github.com/MauricioPerera/llms-txt-skills/blob/master/docs/ext-executable-skills.md).

A publisher that wants its skills to search over its own static content (docs,
catalog text, any corpus) declares a memory snapshot with a single HTML comment
**before** the `## Skills` section (this ordering is required by the reference
parser):

```
<!-- skills-memory: {"snapshot":"/skills-index.snapshot","snapshot_sha256":"a0235f071aa7e28f2096312f22f1ad035901595f3fa91d2cc92b5879bbb7f6d5","format":"minimemory-okf-v1"} -->

## Skills
...
```

- `snapshot` is a path (relative to the origin) to a BM25 snapshot in the
  `minimemory-okf-v1` format (built by the [`@rckflr/minimemory`](https://www.npmjs.com/package/@rckflr/minimemory)
  engine; the wasm binary ships as `minimemory_bg.wasm`).
- `snapshot_sha256` is the hex SHA-256 of the snapshot bytes. The gateway
  downloads the snapshot and **verifies it against this hash before injecting
  the capability** — same content-addressing rule as `tool.js`. On mismatch,
  fetch failure, non-200, or an unsupported `format`, the snapshot is discarded
  and **the capability is not injected**.
- When the snapshot verifies, the gateway injects
  `host.memorySearch(query, k?)` into every skill of that origin (via the
  `extraCapabilities` bridge in `AsyncToolHost`, same raw-JSON asyncify pattern
  as `host.fetchOrigin`). `k` defaults to 5 and is clamped to `[1, 10]`. It
  returns `{ hits: [{ text, score, title, concept_id }] }` (or `{ error }`).
- Without a verified snapshot the capability is absent: a skill that calls
  `host.memorySearch` sees `undefined` and throws **inside the sandbox**,
  surfacing as `isError: true` (controlled failure, not a gateway crash). The
  skills still list — only the memory capability is missing.

The reference publisher is the docs-site (see "Repository layout"): it serves
the spec snapshot and a `search_spec` skill that runs
`host.memorySearch(args.q, k)` to do BM25 search over the four llms-txt-skills
documents, plus `get_doc` and `list_docs`.

## Skill attestations (advisory)

> Spec: [Skill Attestations v0.3](https://github.com/MauricioPerera/llms-txt-skills/blob/master/docs/ext-skill-attestations.md).

This section describes the **gateway's** model: Ed25519 signatures from a
runtime-side pre-registered `REVIEWERS` key registry. The **local runtime**
additionally supports **Sigstore (keyless)** attestations via
`--require-attestation` — no pre-registered key, any OIDC identity the runtime
explicitly trusts — see "Sigstore attestations" above; that section closes
the "only one registered reviewer scales" bottleneck this one has.

A publisher may serve a third trust ring — signed reviewer attestations — at
`/.well-known/agent-skills/attestations.json`. Each entry is an Ed25519
signature over the canonical payload and has this shape:

```json
{
  "origin": "https://llmstxt-docs.rckflr.workers.dev",
  "skill": "search_spec",
  "tool_sha256": "95301993...",
  "attester": "human:mauricio",
  "signed_on": "2026-07-02",
  "valid_until": "2027-07-02",
  "signature": "<base64 Ed25519 signature>"
}
```

The signed payload is the UTF-8 bytes of
`origin + "\n" + skill + "\n" + tool_sha256 + "\n" + signed_on + "\n" + valid_until`
with `origin` canonical (lowercase, no trailing slash, no default port) and
`tool_sha256` lowercase hex. The gateway:

- Fetches `attestations.json` during discovery (only when attestations are
  not `off`). A 404 or malformed array means "no attestations" (every skill is
  `unattested`), not a discovery error.
- Verifies each signature with WebCrypto (`Ed25519` via `crypto.subtle`, public
  key imported raw) against the runtime-side reviewer registry `REVIEWERS`
  (a `REVIEWERS` var in `wrangler-gateway.toml` mapping
  `attester → { public_key: <base64 raw 32 bytes>, registered_at }`). An
  attester not in the registry is ignored; a registered attester whose
  signature fails marks the skill `invalid`.
- Computes a per-skill verdict with precedence **invalid > attested > expired >
  unattested** (`invalid` dominates): a matching attestation from a registered
  reviewer with a valid signature inside its `[signed_on, valid_until]` window
  is `attested`; valid signature outside the window is `expired`; no matching
  attestation is `unattested`.
- Exposes the verdicts two ways: a tag appended to each tool's `description`
  in `tools/list`, and a summary header `X-Gw-Attestations`
  (`attested=N,expired=N,invalid=N,unattested=N`) on every response.

Three modes via `ATTESTATION_MODE`:

- `off` (default when `ATTESTATION_MODE` is unset) — attestations are not
  fetched; behavior is the pre-T25 gateway.
- `advisory` — everything loads; verdicts are visible but do not exclude.
- `enforcing` (deployed since T45) — only `attested` skills load;
  non-`attested` skills are excluded exactly like a `tool_sha256` mismatch
  (logged, not registered).

`scripts/attest.mjs` is the signing tool (Node `node:crypto` Ed25519, no deps):

- `node scripts/attest.mjs keygen` — generates an Ed25519 pair, writes the
  private key to `.attester-key.json` and prints **only the public key** (base64
  raw 32 bytes) for the `REVIEWERS` registry.
- `node scripts/attest.mjs sign <origin> <skill> <valid_until>` — fetches the
  origin's live `llms.txt`, reads the real `tool_sha256` for the skill, signs,
  and prints the attestation object JSON.

The private key lives in `.attester-key.json` and is **local and gitignored** —
never commit it, and it is never printed by the tool. No key material belongs
in this repo or in `REVIEWERS` (only public keys).

Third-party publishers (sites you do not control): see [`ONBOARDING.md`](./ONBOARDING.md)
for the eligibility, review, attestation, activation, and revocation process.

## Quick start

Requirements: Node 18+ and `npm install` (already done in this checkout).

```bash
npm install
npm test      # build + e2e Miniflare for the sync PoC (worker.mjs)
npm run spike # build + e2e Miniflare for the async spike (worker-spike.mjs)
npm run gateway # build + e2e Miniflare for the gateway (worker-gateway.mjs) — hits the live demo site
npm run memspike # build the memory snapshot + memspike worker, then e2e Miniflare against the docs-site origin (host.memorySearch / BM25)
```

`npm run gateway` is documented as-is from `package.json`; it builds the gateway
worker and runs `mf-gateway.mjs` against the real deployed demo site. `npm run
memspike` does the same for the memory capability: `build-memsnapshot.mjs` →
`build-memspike.mjs` → `mf-memspike.mjs`.

### Try the deployed gateway (curl)

The gateway is live at `https://llmstxt-gateway.rckflr.workers.dev`. It is
restricted to origins in its allowlist; the demo site
`https://llmstxt-demo-site.rckflr.workers.dev`, the bookstore
`https://llmstxt-bookstore.rckflr.workers.dev` (D1-backed, includes a write
skill `create_order`), and the docs-site
`https://llmstxt-docs.rckflr.workers.dev` (origin memory / BM25) are allowed.
`origin` is URL-encoded as a query param. **The deployed gateway has auth
enabled:** every request below needs `-H "Authorization: Bearer <AUTH_TOKEN>"`
(the `AUTH_TOKEN` secret; 401 otherwise). The token is a secret — it is not in
this repo. The deployed gateway can also run in **per-client mode** (the
`CLIENTS` secret), in which case each client sends its own
`Authorization: Bearer <client_token>` with the same curl syntax; the response
then carries `X-Gw-Client: <client_id>`.

List the skills the demo site publishes:

```bash
curl -s -X POST \
  "https://llmstxt-gateway.rckflr.workers.dev/mcp?origin=https%3A%2F%2Fllmstxt-demo-site.rckflr.workers.dev" \
  -H "Authorization: Bearer <AUTH_TOKEN>" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Call `sum_numbers` (pure sync tool, runs in the sandbox):

```bash
curl -s -X POST \
  "https://llmstxt-gateway.rckflr.workers.dev/mcp?origin=https%3A%2F%2Fllmstxt-demo-site.rckflr.workers.dev" \
  -H "Authorization: Bearer <AUTH_TOKEN>" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"sum_numbers","arguments":{"a":2,"b":40}}}'
```

Call `server_time` (async tool that calls `host.fetchOrigin("/api/time")` on the
allowed origin):

```bash
curl -s -X POST \
  "https://llmstxt-gateway.rckflr.workers.dev/mcp?origin=https%3A%2F%2Fllmstxt-demo-site.rckflr.workers.dev" \
  -H "Authorization: Bearer <AUTH_TOKEN>" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"server_time","arguments":{}}}'
```

The other deployed workers (their root path returns 404 by design — only
specific routes like `/llms.txt` are served):

- PoC sync host: `https://toolhost-mcp.rckflr.workers.dev` (POST `/mcp`).
- Demo publisher: `https://llmstxt-demo-site.rckflr.workers.dev/llms.txt`.
- Bookstore publisher: `https://llmstxt-bookstore.rckflr.workers.dev/llms.txt`.
- Docs publisher (origin memory): `https://llmstxt-docs.rckflr.workers.dev/llms.txt`.

## Security model (honest)

What it guarantees:

- **Tool-host isolation.** Tool code runs in a QuickJS-wasm context separate
  from the Worker's JS. It sees only `registerTool`, `host`, and what the host
  prelude defines. No `fetch`, no `process`, no globals leak by default.
- **Secrets stay outside the sandbox.** In the sync PoC, the platform secret is
  read from `env.STRIPE_SECRET` on the host side and is never exposed to tool
  code — the tool can only call named internal methods. In the gateway, there
  is no platform secret; the only capabilities are `host.fetchOrigin` and (when
  declared and verified) `host.memorySearch`.
- **SHA-256 content addressing.** The gateway downloads `tool.js` and verifies
  it against the `tool_sha256` declared in `llms.txt` before loading. Mismatched or
  corrupt content is rejected and not cached. The same rule applies to the
  origin-memory snapshot (`snapshot_sha256`): unverified → capability not injected.
- **Skill attestations (third trust ring, spec `ext-skill-attestations` v0.3).**
  See the dedicated section. Publishers may serve signed reviewer attestations;
  the gateway verifies them via WebCrypto against the runtime-side `REVIEWERS`
  registry and exposes per-skill verdicts (`attested`/`expired`/`invalid`/
  `unattested`, `invalid` dominates) in each tool description and the
  `X-Gw-Attestations` header. Modes: `off` (default when unset) / `advisory`
  (everything loads, verdicts visible) / `enforcing` (only `attested` skills
  load; deployed mode since T45). `scripts/attest.mjs` is the signing tool
  (keygen + sign).
- **Origin-scoped fetch.** `host.fetchOrigin` only fetches the single allowed
  origin for the request. Any other origin throws *inside the sandbox* and is
  surfaced as `isError: true`, not a JSON-RPC error.
- **Resource limits (defaults in `host-async.mjs`, applied per request):**
  - memory: 64 MB (`setMemoryLimit`)
  - stack: 1 MB (`setMaxStackSize`)
  - deterministic gas: 20 000 interrupt-handler invocations per
    `callTool` / `loadToolSource` (`setInterruptHandler` with an invocation
    counter). This is the primary cutoff, because `Date.now()` **freezes** in
    Cloudflare Workers during synchronous execution (Spectre mitigation), so a
    pure `while(true){}` never advances the clock. The gas counter does not
    depend on the clock — it counts how many times QuickJS invoked the handler
    (calibrated ~100× over the heaviest legitimate skill; see TAREA12B).
  - wall-clock interrupt deadline: 2000 ms per `callTool` / `loadToolSource`
    (a cheap backstop where the clock does advance — Node/tests).
  - outbound fetch deadline: 10 s per `host.fetchOrigin`
    (`AbortSignal.timeout` + a `Promise.race` backstop that fires even if the
    fetch impl ignores the signal; on firing it throws "fetchOrigin timeout"
    inside the sandbox → `isError: true`, not a gateway crash).
- **Fresh context per request.** A new QuickJS context (and runtime) is built
  per request and disposed at the end; no state survives between requests.
- **Per-skill contexts in the gateway.** Each skill is loaded into its own
  QuickJS context; a skill cannot see or overwrite another skill's
  registration or globals, even within the same origin.
- **Concurrency safety.** The gateway keeps a pool of up to N independent
  instances of the asyncify wasm module per isolate (`WASM_POOL_SIZE`, default
  4, clamped to [1, 8]; the compiled `WebAssembly.Module` is shared, each
  instance has its own memory). Each request acquires one instance exclusively,
  so up to N requests run truly in parallel per isolate and the (N+1)-th waits
  by polling in its own request context (workerd cancels continuations of
  promises resolved from another request context, so a FIFO handoff is not
  viable) — with N=1 this degenerates to the previous per-module mutex (TAREA19).
  Discovery is single-flighted per origin so concurrent cold requests share one
  discovery pass.

What it does **not** guarantee:

- **Auth has three modes, selected by config.** Precedence is per-client
  → legacy shared token → dev open.
  - *Per-client (`CLIENTS` secret, opt-in).* `CLIENTS` is a JSON secret mapping
    `sha256_hex_of_token → { client_id, rpm? }`. Tokens never appear in
    cleartext in config — the key is the lowercase hex SHA-256 of the token's
    UTF-8 bytes. On `POST /mcp` the gateway hashes the `Authorization: Bearer
    <token>` value and does an exact lookup on that hash; the lookup *is* the
    timing-safe mechanism (a fixed digest is compared, never the cleartext
    token against a secret). A known token passes and the response carries
    `X-Gw-Client: <client_id>`; an unknown token, missing header, or malformed
    header yields `401`. `AUTH_TOKEN` is ignored in this mode. If `CLIENTS` is
    set but its JSON is invalid, the gateway **fail-closes** — every `POST /mcp`
    returns `401` rather than opening by config error (signalled on `GET /`).
  - *Legacy shared token (`AUTH_TOKEN` secret).* If `CLIENTS` is unset, the
    `AUTH_TOKEN` secret enables a single shared bearer token (constant-time
    comparison); the deployed gateway has it enabled. Without it the gateway
    runs open (dev mode). The PoC worker remains open.
  - *Per-client rate limiting (opt-in, requires per-client mode).* When
    per-client mode is active, the client's `rpm` is a non-null number, and the
    `RATE_LIMITER` Durable Object binding is present, each `POST /mcp` is
    counted against a **fixed window** of 60 s persisted in the DO's
    SQLite-backed storage (one DO instance per `client_id`, keyed by name).
    Within quota, responses carry `X-Gw-RateLimit-Limit` / `-Remaining` /
    `-Reset`; `Remaining` counts **including the current request** (the
    admitted sequence shows `rpm, rpm-1, … 1`). Over quota the gateway returns
    `429` with `Retry-After` and `Remaining: 0`. Honest edges: a fixed window
    allows a burst of up to `2 × rpm` straddling a window boundary (a client
    can spend a full window's quota at its tail and the next window's at its
    head), and the limiter is per-request, not per-cost — it caps call count,
    not payload size, CPU, or complexity. If the DO itself fails while the
    limiter is active, the gateway **fail-closes** with an observable
    `500 rate_limiter_unavailable` rather than letting the request through
    uncounted. Without the binding (or with no `rpm`), the limiter stays
    inactive and the request path is byte-identical to the prior behavior.
- **Per-skill isolation is context-level, not process-level.** Skills get
  separate QuickJS contexts but share the same wasm module instance and the
  same Worker request; the boundary is the QuickJS API surface, not an OS
  process.
- **One asyncify suspension at a time — per module instance.** QuickJS asyncify
  suspends/resumes a single stack per wasm instance; within one request all
  execution is sequential on its instance. Cross-request parallelism comes from
  the instance pool (up to `WASM_POOL_SIZE` concurrent requests per isolate),
  not from overlapping suspensions on one instance.
- **State is in-memory and per-request.** No persistence, no warm state between
  requests. A tool that accumulates state loses it when the request ends.
- **DoS is bounded, not impossible.** The limits above cap a single call's
  cost; a determined caller can still spend the limits' worth of CPU/memory
  per request. Discovery is cached in two layers: layer 1 caches the parsed
  result per isolate for 60 s, and layer 2 caches the full post-verification
  result in the Cache API per colo for 60 s (observable via the
  `X-Gw-Discovery: hit|l2|miss` response header — `hit` served from layer 1,
  `l2` hydrated cross-isolate from layer 2, `miss` fetched from the origin).
  The layer 2 key carries a config fingerprint (attestation mode + reviewer
  registry + UTC date), so changing the config never serves stale verdicts.
  What is cached is post-verification (the `tool.js` bytes were already
  hash-checked when layer 2 was populated), inside the account's own trust
  domain; the cold path is amortized more, but still not zero. A scheduled
  preheat (cron every minute, `[triggers]` in `wrangler-gateway.toml`) runs
  discovery for every allowlisted origin and instantiates a wasm module, so
  the cron's isolate/colo rarely serves a cold miss — honest caveat: the
  Cache API is per-colo and the cron runs in one location, so other colos
  still pay their first miss.
- **The publisher is trusted for the skill list.** The gateway trusts the
  origin's `/llms.txt` to name skills; it verifies the `tool.js` bytes match
  the declared SHA-256, but it does not vet what the tool does.

## Repository layout

| File / dir | Purpose |
|---|---|
| `host.mjs` | Synchronous `ToolHost`: loads `tool.js` into QuickJS-wasm, injects the `host.callInternal` capability. |
| `host-async.mjs` | `AsyncToolHost`: asyncify variant, async handlers, `host.fetchOrigin` capability, the `extraCapabilities` bridge (`host.memorySearch`), mem/stack/gas hardening. |
| `mcp-core.mjs` | Sync MCP JSON-RPC 2.0 core (`initialize`, `tools/list`, `tools/call`, `ping`). Transport-agnostic. |
| `mcp-core-async.mjs` | Async MCP core; awaits `AsyncToolHost.callTool`. |
| `worker.mjs` | PoC MCP server (sync host, inline tools) deployed at `toolhost-mcp.rckflr.workers.dev`. |
| `worker-spike.mjs` | Async spike (fetch_home/fetch_evil) proving origin-scoped fetch. |
| `worker-gateway.mjs` | The gateway: discover → verify → load → serve MCP, + origin-memory injection and attestations. Deployed at `llmstxt-gateway.rckflr.workers.dev`. |
| `llmstxt-parse.mjs` | Pure parser for the executable-skill lines (and the `skills-memory` line) of `llms.txt`. Also reports prose-only (`nonExecutable`) skills found in `## Skills`. |
| `sigstore-attest.mjs` | `verifySigstoreAttestation` / `buildSigstoreStatement` — Sigstore (keyless) attestation verification. Node-only (see "Sigstore attestations" above); used by `bin/mcpwasm-local.mjs`'s `--require-attestation`, not the gateway. |
| `worker-memspike.mjs` | Memory spike: docs-site origin served through the gateway with `host.memorySearch` over a BM25 snapshot. |
| `internal-logic.mjs` | Demo platform logic for the sync PoC (holds the secret, exposes `createPayment`/`refundPayment`). |
| `tools-inline.mjs` | Inline `tool.js` sources for the sync PoC. |
| `shim.mjs` | `location`/`self` shim needed by the quickjs-emscripten wasm loader in Workers. |
| `build.mjs` / `build-spike.mjs` / `build-gateway.mjs` | esbuild bundlers (conditions `workerd`, external `*.wasm`) for the PoC, spike, and gateway workers. |
| `build-memspike.mjs` / `build-memsnapshot.mjs` | esbuild bundler for the memspike worker, and the snapshot builder for the docs-site BM25 snapshot. |
| `mf-test.mjs` / `mf-spike.mjs` / `mf-gateway.mjs` / `mf-memspike.mjs` | e2e tests with Miniflare v4 against the built workers (PoC, spike, gateway, memspike). |
| `wrangler.toml` | Wrangler config for the PoC (sync) worker. |
| `wrangler-gateway.toml` | Wrangler config for the gateway. Vars: `ALLOWED_ORIGINS` (origin allowlist), `REVIEWERS` (attestation reviewer registry, JSON), `ATTESTATION_MODE` (`off`/`advisory`/`enforcing`). Service bindings `DEMO`, `BOOKSTORE`, `DOCS` (same-account worker-to-worker fetch, bypassing Cloudflare error 1042). `AUTH_TOKEN` and `CLIENTS` are set as secrets, not in this file. Durable Object binding `RATE_LIMITER` (class `RateLimiter`, migration `v1` with `new_sqlite_classes`) deploys with the worker; the limiter stays inactive until a `CLIENTS` registry with `rpm` values exists. |
| `scripts/attest.mjs` | Attestation tool: `keygen` (writes local `.attester-key.json`, prints public key) and `sign <origin> <skill> <valid_until>` (Ed25519 attestation JSON). |
| `bench/` + `BENCHMARK.md` | `bench/run.mjs` (single-client latency harness against the deployed workers) and its raw results; `BENCHMARK.md` is the write-up. |
| `quickjs.wasm` / `quickjs-asyncify.wasm` | Pre-compiled QuickJS binaries imported as static `CompiledWasm` modules. |
| `minimemory_bg.wasm` | Pre-compiled minimemory (BM25) wasm, the engine behind `host.memorySearch`. Imported as a static `CompiledWasm` module by the gateway. |
| `demo-site/` | Demo publisher site (`llms.txt` + `sum_numbers` / `server_time` skills). Deployed at `llmstxt-demo-site.rckflr.workers.dev`. |
| `bookstore/` | Realistic publisher: D1-backed catalog (52 books), read skills + `create_order` write skill, plus permanent robustness fixtures (`corrupt_skill` hash-mismatch, `busy_loop` infinite loop). Deployed at `llmstxt-bookstore.rckflr.workers.dev`. |
| `docs-site/` | Docs publisher: serves the llms-txt-skills spec documents + a `skills-index.snapshot` (BM25, `minimemory-okf-v1`), with `search_spec` (BM25 via `host.memorySearch`), `get_doc`, and `list_docs` skills. Deployed at `llmstxt-docs.rckflr.workers.dev`. |
| `reports/` | Development reports, one `TAREA*-REPORT.md` per milestone (see below), plus the raw MCP-client outputs of T13-T15. |
| `.github/workflows/ci.yml` | GitHub Actions CI: two jobs (`hermetic` gate + `prod-integration` non-blocking) on push and pull_request to `main`. |

## CI

The workflow in `.github/workflows/ci.yml` runs two jobs on every push and
pull_request to `main`, both on `ubuntu-latest` with Node 22 and `npm ci`
(with cache), timing out after 15 minutes.

The `hermetic` job is the gate. It runs five local suites — `npm test`,
`npm run spike`, `npm run memspike`, `npm run gateway:offline`, `npm run
local` — each preceded by its own build. None of these touch the network
beyond `npm` itself: `test`, `spike`, `memspike`, and `local` are fully local
(the last spawns the stdio runtime against an in-process fake publisher on
`127.0.0.1`), and `gateway:offline` is the hermetic mode of the gateway suite
(T35), where the production workers are replaced by in-process fakes served
through the same URL-to-binding map the gateway uses. Hermeticity is enforced
by an outbound fetch interceptor: if anything in the suite tries to leave the
process for the network, the run
fails. This job blocks the merge.

The `prod-integration` job runs `npm run gateway`, the online gateway suite
against the deployed production workers (`*.rckflr.workers.dev`) over the
public internet. This is the only command in CI that reaches production, and
its purpose is to detect drift between the fakes and the real workers. It is
non-blocking (`continue-on-error`): an outage on their side surfaces as a
warning, not a red gate, so a foreign incident cannot block work in this repo.

## Development notes

Each milestone is documented in its `reports/TAREA*-REPORT.md` (TAREA1 through TAREA45;
`TAREA2` and `TAREA30` were skipped in numbering and `TAREA12B` is a
continuation of TAREA12).
The non-obvious bits live there:

- `reports/TAREA4-REPORT.md` — deploying to Cloudflare Workers: the `CompiledWasm` rule
  and why importing the `.wasm` as a static module avoids
  "Wasm code generation disallowed by embedder".
- `reports/TAREA5-REPORT.md` — the asyncify spike: why asyncify is needed for an
  `await`-shaped capability, and the promise-pumping loop in
  `AsyncToolHost.callTool`.
- `reports/TAREA7-REPORT.md` — the gateway: sha256 verification, the Cache API use, and
  the Cloudflare error 1042 (same-account worker-to-worker fetch via
  `workers.dev`) workaround via a service binding.
- `reports/TAREA12-REPORT.md` / `reports/TAREA12B-REPORT.md` — `Date.now()` is frozen in
  Cloudflare Workers during synchronous execution, so a wall-clock deadline
  never cuts a `while(true){}`. Fix: a deterministic gas budget — the interrupt
  handler counts its own invocations and interrupts at 20 000, independent of
  the clock. Calibrated against the heaviest legitimate skill.
- `reports/TAREA14-REPORT.md` — `structuredContent` in an MCP result must be a JSON
  object (MCP-shaped), not a bare scalar/array; the gateway normalizes tool
  output accordingly.
- `reports/TAREA19-REPORT.md` — concurrency: a per-wasm-module mutex on instantiation
  plus single-flight discovery per origin, so parallel cold requests share one
  discovery pass and one module build.
- `reports/TAREA22-REPORT.md` — origin memory: the `skills-memory` line, sha256-verified
  BM25 snapshot, and the `host.memorySearch` capability injected via
  `extraCapabilities`.
- `reports/TAREA25-REPORT.md` — skill attestations (Ed25519, WebCrypto, `REVIEWERS`
  registry, verdicts, advisory/enforcing modes, `scripts/attest.mjs`).
- `reports/TAREA26-REPORT.md` — code-review fixes: `extraCapabilities` now forwards all
  positional args (so `host.memorySearch(q, k)` keeps `k`), and the
  `fetchOrigin` timeout backstop timer is cleared on resolve (no leaked
  timers).

Benchmark headline numbers (full matrix and methodology in
[`BENCHMARK.md`](./BENCHMARK.md), single-client from México to the Workers
edge, not a load test; latest figures from the post-pool+preheat run):
the sandbox itself costs **~2 ms warm** (gateway pure-sandbox `sum_numbers`
p50 ≈ 55 ms vs. the same worker's raw ping p50 ≈ 53 ms), and the full gateway
adds **~6 ms** over calling the publisher's API directly for the same read
(`stock_report` through the gateway p50 = 96 ms vs. direct API p50 = 90 ms).
A cold discovery miss costs ~210–400 ms (compile + sha256 + fetch); the
scheduled preheat (see "Security model" above) keeps the cron's own
isolate/colo mostly out of this cold path.

Run the e2e tests with `npm test` (sync) / `npm run spike` (async) /
`npm run gateway` (gateway against the live demo site) / `npm run memspike`
(memory capability against the docs-site origin).