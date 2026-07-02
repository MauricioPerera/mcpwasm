# mcpwasm — Static MCP

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
skills** (v0.4, with *origin memory*) and **skill attestations** (v0.2). See
the dedicated sections below.

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

> Spec: [Skill Attestations v0.2](https://github.com/MauricioPerera/llms-txt-skills/blob/master/docs/ext-skill-attestations.md).

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

- `off` — attestations are not fetched; behavior is the pre-T25 gateway.
- `advisory` (default, deployed) — everything loads; verdicts are visible but
  do not exclude.
- `enforcing` — only `attested` skills load; non-`attested` skills are excluded
  exactly like a `tool_sha256` mismatch (logged, not registered).

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
this repo.

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
- **Skill attestations (third trust ring, spec `ext-skill-attestations` v0.2).**
  See the dedicated section. Publishers may serve signed reviewer attestations;
  the gateway verifies them via WebCrypto against the runtime-side `REVIEWERS`
  registry and exposes per-skill verdicts (`attested`/`expired`/`invalid`/
  `unattested`, `invalid` dominates) in each tool description and the
  `X-Gw-Attestations` header. Modes: `off` / `advisory` (default: everything
  loads, verdicts visible) / `enforcing` (only `attested` skills load).
  `scripts/attest.mjs` is the signing tool (keygen + sign).
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
- **Concurrency safety.** The wasm module is instantiated once per isolate and
  guarded by a per-module mutex; discovery is single-flighted per origin so
  concurrent cold requests share one discovery pass (see TAREA19).

What it does **not** guarantee:

- **Auth is a single shared bearer token, optional by config.** If the
  `AUTH_TOKEN` secret is set, the gateway requires
  `Authorization: Bearer <token>` on `POST /mcp` (401 otherwise); the deployed
  gateway has it enabled. Without the secret it runs open (dev mode). There is
  still no per-client identity or rate limiting. The PoC worker remains open.
- **Per-skill isolation is context-level, not process-level.** Skills get
  separate QuickJS contexts but share the same wasm module instance and the
  same Worker request; the boundary is the QuickJS API surface, not an OS
  process.
- **One asyncify suspension at a time.** QuickJS asyncify suspends/resumes a
  single stack; concurrent overlapping async capabilities are not supported.
- **State is in-memory and per-request.** No persistence, no warm state between
  requests. A tool that accumulates state loses it when the request ends.
- **DoS is bounded, not impossible.** The limits above cap a single call's
  cost; a determined caller can still spend the limits' worth of CPU/memory
  per request, and the gateway caches discovery per isolate for 60 s (observable
  via the `X-Gw-Discovery: hit|miss` response header) plus `llms.txt` / verified
  `tool.js` in the Cache API, so cold-path cost is amortized but not zero.
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
| `llmstxt-parse.mjs` | Pure parser for the executable-skill lines (and the `skills-memory` line) of `llms.txt`. |
| `worker-memspike.mjs` | Memory spike: docs-site origin served through the gateway with `host.memorySearch` over a BM25 snapshot. |
| `internal-logic.mjs` | Demo platform logic for the sync PoC (holds the secret, exposes `createPayment`/`refundPayment`). |
| `tools-inline.mjs` | Inline `tool.js` sources for the sync PoC. |
| `shim.mjs` | `location`/`self` shim needed by the quickjs-emscripten wasm loader in Workers. |
| `build.mjs` / `build-spike.mjs` / `build-gateway.mjs` | esbuild bundlers (conditions `workerd`, external `*.wasm`) for the PoC, spike, and gateway workers. |
| `build-memspike.mjs` / `build-memsnapshot.mjs` | esbuild bundler for the memspike worker, and the snapshot builder for the docs-site BM25 snapshot. |
| `mf-test.mjs` / `mf-spike.mjs` / `mf-gateway.mjs` / `mf-memspike.mjs` | e2e tests with Miniflare v4 against the built workers (PoC, spike, gateway, memspike). |
| `wrangler.toml` | Wrangler config for the PoC (sync) worker. |
| `wrangler-gateway.toml` | Wrangler config for the gateway. Vars: `ALLOWED_ORIGINS` (origin allowlist), `REVIEWERS` (attestation reviewer registry, JSON), `ATTESTATION_MODE` (`off`/`advisory`/`enforcing`). Service bindings `DEMO`, `BOOKSTORE`, `DOCS` (same-account worker-to-worker fetch, bypassing Cloudflare error 1042). `AUTH_TOKEN` is set as a secret, not in this file. |
| `scripts/attest.mjs` | Attestation tool: `keygen` (writes local `.attester-key.json`, prints public key) and `sign <origin> <skill> <valid_until>` (Ed25519 attestation JSON). |
| `bench/` + `BENCHMARK.md` | `bench/run.mjs` (single-client latency harness against the deployed workers) and its raw results; `BENCHMARK.md` is the write-up. |
| `quickjs.wasm` / `quickjs-asyncify.wasm` | Pre-compiled QuickJS binaries imported as static `CompiledWasm` modules. |
| `minimemory_bg.wasm` | Pre-compiled minimemory (BM25) wasm, the engine behind `host.memorySearch`. Imported as a static `CompiledWasm` module by the gateway. |
| `demo-site/` | Demo publisher site (`llms.txt` + `sum_numbers` / `server_time` skills). Deployed at `llmstxt-demo-site.rckflr.workers.dev`. |
| `bookstore/` | Realistic publisher: D1-backed catalog (52 books), read skills + `create_order` write skill, plus permanent robustness fixtures (`corrupt_skill` hash-mismatch, `busy_loop` infinite loop). Deployed at `llmstxt-bookstore.rckflr.workers.dev`. |
| `docs-site/` | Docs publisher: serves the llms-txt-skills spec documents + a `skills-index.snapshot` (BM25, `minimemory-okf-v1`), with `search_spec` (BM25 via `host.memorySearch`), `get_doc`, and `list_docs` skills. Deployed at `llmstxt-docs.rckflr.workers.dev`. |
| `TAREA*-REPORT.md` (one per milestone) | Development reports (see below). |

## Development notes

Each milestone is documented in its `TAREA*-REPORT.md` (TAREA1 through TAREA27;
`TAREA2` was skipped in numbering and `TAREA12B` is a continuation of TAREA12).
The non-obvious bits live there:

- `TAREA4-REPORT.md` — deploying to Cloudflare Workers: the `CompiledWasm` rule
  and why importing the `.wasm` as a static module avoids
  "Wasm code generation disallowed by embedder".
- `TAREA5-REPORT.md` — the asyncify spike: why asyncify is needed for an
  `await`-shaped capability, and the promise-pumping loop in
  `AsyncToolHost.callTool`.
- `TAREA7-REPORT.md` — the gateway: sha256 verification, the Cache API use, and
  the Cloudflare error 1042 (same-account worker-to-worker fetch via
  `workers.dev`) workaround via a service binding.
- `TAREA12-REPORT.md` / `TAREA12B-REPORT.md` — `Date.now()` is frozen in
  Cloudflare Workers during synchronous execution, so a wall-clock deadline
  never cuts a `while(true){}`. Fix: a deterministic gas budget — the interrupt
  handler counts its own invocations and interrupts at 20 000, independent of
  the clock. Calibrated against the heaviest legitimate skill.
- `TAREA14-REPORT.md` — `structuredContent` in an MCP result must be a JSON
  object (MCP-shaped), not a bare scalar/array; the gateway normalizes tool
  output accordingly.
- `TAREA19-REPORT.md` — concurrency: a per-wasm-module mutex on instantiation
  plus single-flight discovery per origin, so parallel cold requests share one
  discovery pass and one module build.
- `TAREA22-REPORT.md` — origin memory: the `skills-memory` line, sha256-verified
  BM25 snapshot, and the `host.memorySearch` capability injected via
  `extraCapabilities`.
- `TAREA25-REPORT.md` — skill attestations (Ed25519, WebCrypto, `REVIEWERS`
  registry, verdicts, advisory/enforcing modes, `scripts/attest.mjs`).
- `TAREA26-REPORT.md` — code-review fixes: `extraCapabilities` now forwards all
  positional args (so `host.memorySearch(q, k)` keeps `k`), and the
  `fetchOrigin` timeout backstop timer is cleared on resolve (no leaked
  timers).

Benchmark headline numbers (full matrix and methodology in
[`BENCHMARK.md`](./BENCHMARK.md), single-client from México to the Workers
edge, not a load test): the sandbox adds ~5–10 ms over a direct call (PoC
sandbox `tools/call` p50 ≈ 63 ms vs. direct API p50 ≈ 101 ms; gateway warm
pure-sandbox `sum_numbers` p50 ≈ 65 ms), and a warm gateway read with
`fetchOrigin` + D1 sits around p50 ≈ 110 ms (`stock_report` p50 = 113 ms).
A cold discovery miss costs ~250–400 ms (compile + sha256 + fetch).

Run the e2e tests with `npm test` (sync) / `npm run spike` (async) /
`npm run gateway` (gateway against the live demo site) / `npm run memspike`
(memory capability against the docs-site origin).