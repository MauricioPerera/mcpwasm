# mcpwasm

Sandboxed runtime for third-party MCP tools: execute untrusted tool code inside
QuickJS-wasm on top of Cloudflare Workers, plus a gateway that turns any static
site publishing `llms.txt` with executable skills into an MCP server.

Think "php-wasm, but for MCP tools": the platform owner embeds the host, loads
`tool.js` files, and each tool runs isolated in a QuickJS WebAssembly sandbox.
The only bridge from the sandbox to the platform's internals is an explicit
capability the host injects. No capability, no access.

This repo integrates with the [llms-txt-skills](https://github.com/MauricioPerera/llms-txt-skills)
standard via a provisional extension for executable skills (see below).

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
  cap, and a wall-clock interrupt deadline per call.

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
   `tool.js`.
2. On each request the gateway downloads `llms.txt`, parses the executable
   skills, downloads each `tool.js`, verifies SHA-256, and loads the verified
   ones into a fresh `AsyncToolHost` scoped to that origin.
3. Tool code runs inside QuickJS-wasm. It can only call `host.fetchOrigin(path)`,
   which is async from the host side but synchronous-looking inside the sandbox
   (QuickJS asyncify suspends/resumes the wasm stack).
4. The host fetches only the allowed origin; any other origin throws inside the
   sandbox.
5. The gateway maps MCP `tools/list` and `tools/call` over JSON-RPC 2.0 and
   returns the result to the client.

Pieces live in:

- `host.mjs` — synchronous `ToolHost` (sync tools, `host.callInternal` capability).
- `host-async.mjs` — `AsyncToolHost` (async handlers, `host.fetchOrigin` capability, resource hardening).
- `mcp-core.mjs` / `mcp-core-async.mjs` — JSON-RPC 2.0 MCP core (transport-agnostic).
- `worker.mjs` — PoC MCP server (sync host, inline tools).
- `worker-spike.mjs` — async spike (fetchHome/fetchEvil).
- `worker-gateway.mjs` + `llmstxt-parse.mjs` — the gateway.

## The executable-skill line in `llms.txt` (DRAFT — pending RFC)

> **Status: provisional.** This is *not* part of the ratified
> [llms-txt-skills](https://github.com/MauricioPerera/llms-txt-skills) spec. It
> is a draft extension this repo implements so a skill entry can point at
> verifiable executable code. Expect it to change; do not depend on the exact
> shape yet.

Under a `## Skills` section, an executable skill is a normal markdown list item
followed by an HTML comment carrying a JSON object with `version`, `tool` (path
to the `tool.js`), and `sha256` (hex SHA-256 of the `tool.js` bytes):

```
- [sum_numbers](/skills/sum_numbers/SKILL.md): Sum two numbers a and b. <!-- skill: {"version":"1.0.0","tool":"/skills/sum_numbers/tool.js","sha256":"58daf86111bf7278446eb7e0e8c6384713b50cdb6fa97ac039e23846d723dc3e"} -->
```

Parsed by `llmstxt-parse.mjs`:

- The `<!-- skill: {...} -->` comment marks the line as an *executable* skill.
  List items without it are treated as descriptive-only and ignored by the
  gateway.
- `tool` is resolved relative to the origin.
- `sha256` is verified against the fetched `tool.js` bytes before the tool is
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

## Quick start

Requirements: Node 18+ and `npm install` (already done in this checkout).

```bash
npm install
npm test      # build + e2e Miniflare for the sync PoC (worker.mjs)
npm run spike # build + e2e Miniflare for the async spike (worker-spike.mjs)
npm run gateway # build + e2e Miniflare for the gateway (worker-gateway.mjs) — hits the live demo site
```

`npm run gateway` is documented as-is from `package.json`; it builds the gateway
worker and runs `mf-gateway.mjs` against the real deployed demo site.

### Try the deployed gateway (curl)

The gateway is live at `https://llmstxt-gateway.rckflr.workers.dev`. It is
restricted to origins in its allowlist; the demo site
`https://llmstxt-demo-site.rckflr.workers.dev` is allowed. `origin` is
URL-encoded as a query param.

List the skills the demo site publishes:

```bash
curl -s -X POST \
  "https://llmstxt-gateway.rckflr.workers.dev/mcp?origin=https%3A%2F%2Fllmstxt-demo-site.rckflr.workers.dev" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Call `sum_numbers` (pure sync tool, runs in the sandbox):

```bash
curl -s -X POST \
  "https://llmstxt-gateway.rckflr.workers.dev/mcp?origin=https%3A%2F%2Fllmstxt-demo-site.rckflr.workers.dev" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"sum_numbers","arguments":{"a":2,"b":40}}}'
```

Call `server_time` (async tool that calls `host.fetchOrigin("/api/time")` on the
allowed origin):

```bash
curl -s -X POST \
  "https://llmstxt-gateway.rckflr.workers.dev/mcp?origin=https%3A%2F%2Fllmstxt-demo-site.rckflr.workers.dev" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"server_time","arguments":{}}}'
```

The other deployed workers:

- PoC sync host: `https://toolhost-mcp.rckflr.workers.dev` (POST `/mcp`).
- Demo publisher: `https://llmstxt-demo-site.rckflr.workers.dev/llms.txt`
  (the root path returns 404 by design — only specific routes are served).

## Security model (honest)

What it guarantees:

- **Tool-host isolation.** Tool code runs in a QuickJS-wasm context separate
  from the Worker's JS. It sees only `registerTool`, `host`, and what the host
  prelude defines. No `fetch`, no `process`, no globals leak by default.
- **Secrets stay outside the sandbox.** In the sync PoC, the platform secret is
  read from `env.STRIPE_SECRET` on the host side and is never exposed to tool
  code — the tool can only call named internal methods. In the gateway, there
  is no platform secret; the only capability is `host.fetchOrigin`.
- **SHA-256 content addressing.** The gateway downloads `tool.js` and verifies
  it against the `sha256` declared in `llms.txt` before loading. Mismatched or
  corrupt content is rejected and not cached.
- **Origin-scoped fetch.** `host.fetchOrigin` only fetches the single allowed
  origin for the request. Any other origin throws *inside the sandbox* and is
  surfaced as `isError: true`, not a JSON-RPC error.
- **Resource limits (defaults in `host-async.mjs`, applied per request):**
  - memory: 64 MB (`setMemoryLimit`)
  - stack: 1 MB (`setMaxStackSize`)
  - wall-clock interrupt deadline: 2000 ms per `callTool` / `loadToolSource`
    (`setInterruptHandler` comparing `Date.now()` to the deadline)
  - outbound fetch timeout: 5 s (`AbortSignal.timeout`)
- **Fresh context per request.** A new QuickJS context (and runtime) is built
  per request and disposed at the end; no state survives between requests.

What it does **not** guarantee:

- **No auth on the endpoints.** The PoC and gateway accept any caller; there is
  no bearer token, rate limit, or per-client identity. The only access control
  is the gateway's origin allowlist. Put your own auth in front before exposing
  this.
- **No tool-to-tool isolation within one origin.** All skills of the same
  origin share a single QuickJS context for a request. Skills from the same
  publisher can see/interfere with each other. Cross-origin isolation is by
  request, not within a request.
- **One asyncify suspension at a time.** QuickJS asyncify suspends/resumes a
  single stack; concurrent overlapping async capabilities are not supported.
- **State is in-memory and per-request.** No persistence, no warm state between
  requests. A tool that accumulates state loses it when the request ends.
- **DoS is bounded, not impossible.** The limits above cap a single call's
  cost; a determined caller can still spend the limits' worth of CPU/memory
  per request, and the gateway caches `llms.txt` for 60 s and verified
  `tool.js` by `sha` in the Cache API, so cold-path cost is amortized but not
  zero.
- **The publisher is trusted for the skill list.** The gateway trusts the
  origin's `/llms.txt` to name skills; it verifies the `tool.js` bytes match
  the declared SHA-256, but it does not vet what the tool does.

## Repository layout

| File / dir | Purpose |
|---|---|
| `host.mjs` | Synchronous `ToolHost`: loads `tool.js` into QuickJS-wasm, injects the `host.callInternal` capability. |
| `host-async.mjs` | `AsyncToolHost`: asyncify variant, async handlers, `host.fetchOrigin` capability, mem/stack/interrupt hardening. |
| `mcp-core.mjs` | Sync MCP JSON-RPC 2.0 core (`initialize`, `tools/list`, `tools/call`, `ping`). Transport-agnostic. |
| `mcp-core-async.mjs` | Async MCP core; awaits `AsyncToolHost.callTool`. |
| `worker.mjs` | PoC MCP server (sync host, inline tools) deployed at `toolhost-mcp.rckflr.workers.dev`. |
| `worker-spike.mjs` | Async spike (fetch_home/fetch_evil) proving origin-scoped fetch. |
| `worker-gateway.mjs` | The gateway: discover → verify → load → serve MCP. Deployed at `llmstxt-gateway.rckflr.workers.dev`. |
| `llmstxt-parse.mjs` | Pure parser for the executable-skill lines of `llms.txt`. |
| `internal-logic.mjs` | Demo platform logic for the sync PoC (holds the secret, exposes `createPayment`/`refundPayment`). |
| `tools-inline.mjs` | Inline `tool.js` sources for the sync PoC. |
| `shim.mjs` | `location`/`self` shim needed by the quickjs-emscripten wasm loader in Workers. |
| `build.mjs` / `build-spike.mjs` / `build-gateway.mjs` | esbuild bundlers (conditions `workerd`, external `*.wasm`) for each worker. |
| `mf-test.mjs` / `mf-spike.mjs` / `mf-gateway.mjs` | e2e tests with Miniflare v4 against the built workers. |
| `wrangler.toml` | Wrangler config for the PoC (sync) worker. |
| `wrangler-gateway.toml` | Wrangler config for the gateway, incl. `ALLOWED_ORIGINS` var and the `DEMO` service binding (bypasses Cloudflare error 1042 for same-account worker-to-worker fetch). |
| `quickjs.wasm` / `quickjs-asyncify.wasm` | Pre-compiled QuickJS binaries imported as static `CompiledWasm` modules. |
| `demo-site/` | Demo publisher site (`llms.txt` + `sum_numbers` / `server_time` skills). Deployed at `llmstxt-demo-site.rckflr.workers.dev`. |
| `TAREA1-REPORT.md` … `TAREA7-REPORT.md` | Development reports (see below). |

## Development notes

Each milestone is documented in its `TAREA*-REPORT.md`. The non-obvious bits
live there:

- `TAREA4-REPORT.md` — deploying to Cloudflare Workers: the `CompiledWasm` rule
  and why importing the `.wasm` as a static module avoids
  "Wasm code generation disallowed by embedder".
- `TAREA5-REPORT.md` — the asyncify spike: why asyncify is needed for an
  `await`-shaped capability, and the promise-pumping loop in
  `AsyncToolHost.callTool`.
- `TAREA7-REPORT.md` — the gateway: sha256 verification, the Cache API use, and
  the Cloudflare error 1042 (same-account worker-to-worker fetch via
  `workers.dev`) workaround via a service binding.

Run the e2e tests with `npm test` (sync) / `npm run spike` (async) /
`npm run gateway` (gateway against the live demo site).