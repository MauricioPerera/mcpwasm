# Extension: Executable Skills

**Status:** Draft (v0.4)
**Date:** 2026-07-02
**Extends:** [RFC: Publishing Agent Skills through `llms.txt`](./rfc-skills-in-llms-txt.md) (v0.8)

---

## 1. Motivation

The core RFC publishes skills as instructional documents (`SKILL.md`). Section 5.3 of the core RFC identifies the *execution gap*: an agent may read instructions and still improvise, substitute tools, or drift from the published behavior.

This extension closes that gap for publishers who want it: a skill MAY additionally ship an **executable artifact** — a small JavaScript file with a declared input schema — that a conforming runtime executes *verbatim* inside a sandbox, instead of asking a model to improvise from prose.

The result is **Static MCP** — *your tools are files, not servers*: skills published as static, hash-verified content and executed sandboxed on demand. What static site hosting did to web servers ("do not run Apache, publish HTML"), this does to MCP servers: the publisher runs no infrastructure at all; the MCP server is materialized per request from the published files and evaporates after responding (ephemeral instance, durable definition).

Executing third-party code is only acceptable under a strict security model. This extension therefore defines two things, and only two things:

1. The **publication format** for executable skills (publisher side).
2. The **minimum requirements** for a runtime that chooses to execute them (consumer side).

Everything else — transport, agent UX, approval flows — remains governed by the core RFC. A publisher that adopts this extension remains fully conformant with the core RFC: agents that do not understand executable skills simply fall back to `SKILL.md` prose.

## 2. Publication format

### 2.1 Skill entry

An executable skill is declared with two additional keys in the skill entry's JSON comment:

```markdown
- [sum_numbers](/skills/sum_numbers/SKILL.md): Sum two numbers a and b. <!-- skill: {"version":"1.0.0","tool":"/skills/sum_numbers/tool.js","tool_sha256":"58daf86111bf7278446eb7e0e8c6384713b50cdb6fa97ac039e23846d723dc3e"} -->
```

| Key      | Type   | Requirement | Meaning |
|----------|--------|-------------|---------|
| `version`| string | inherited from core RFC | Human-readable hint. |
| `tool`   | string | REQUIRED for executable skills | Path to the executable artifact. MUST be a same-origin path (relative or absolute path, never a full URL to another origin). |
| `tool_sha256` | string | REQUIRED when `tool` is present | Lowercase hex SHA-256 of the exact bytes served at `tool`. |

The key is deliberately **not** `sha256`: the core RFC already uses `sha256` (inline and in `/.well-known/agent-skills/index.json`) for the hash of the fetched `SKILL.md`. The two keys MAY appear on the same skill line and verify different files; runtimes MUST NOT conflate them.

Rationale for staying inline (rather than only in `/.well-known/agent-skills/index.json`): the core standard's value proposition is *one static file, no infrastructure*. Two inline keys preserve that. Publishers who already maintain the well-known index MAY mirror the same `tool`/`tool_sha256` fields there; if both are present and disagree, runtimes MUST refuse the skill.

### 2.2 The artifact (`tool.js`)

The artifact is a single JavaScript file that registers exactly one tool:

```js
registerTool({
  name: "server_time",
  description: "Return the current server time.",
  inputSchema: { type: "object", properties: {} },
  async handler(args) {
    const r = await host.fetchOrigin("/api/time");
    return JSON.parse(r.body);
  }
});
```

Contract:

- The file MUST call `registerTool(def)` exactly once, where `def.name` matches the skill name in `llms.txt`, `def.inputSchema` is a JSON Schema object, and `def.handler` is a function (sync or async).
- The handler receives already-parsed `args` and returns a JSON-serializable value. Throwing reports a tool error to the caller; it MUST NOT crash the runtime.
- The only ambient capability available is `host.fetchOrigin(path, opts?)`: an HTTP fetch **restricted to the publishing origin**, returning `{ status, body }` (body as text, possibly truncated by the runtime). Relative paths are resolved against the publishing origin. `opts` is optional: `{ method?: "GET" | "POST", body?: string, contentType?: string }`. The `method` defaults to `"GET"` if omitted. Only `GET` and `POST` are valid (any other method, or providing a `body` with `GET`, MUST throw); the request body is a string capped by the runtime (reference implementation: 16 KB); `contentType` is the only controllable header (default `application/json` when a body is present). There is no other network, filesystem, timer, or environment access.
- The artifact MUST NOT rely on any global other than `registerTool`, `host`, and standard ECMAScript built-ins. No `fetch`, no `process`, no dynamic import.
- **ECMAScript means ECMAScript.** Web/WHATWG APIs that feel universal do NOT exist in the sandbox: no `URLSearchParams`, no `URL`, no `TextEncoder`/`TextDecoder`, no `atob`/`btoa`, no timers. Build query strings with `encodeURIComponent` by hand. (Field-tested: a published skill using `URLSearchParams` passes hash verification and loads, then fails at call time.)

### 2.3 Versioning and updates

The `tool_sha256` pins the artifact. Publishing a new artifact version means serving new bytes at `tool` and updating both `tool_sha256` and `version` in `llms.txt`. Runtimes cache by hash; a stale hash simply keeps serving the old, verified artifact until the index updates.

### 2.4 Origin memory: search snapshots

A publisher MAY additionally ship a **search snapshot**: a pre-built, hash-pinned full-text index over its own content, so that skills can offer real search over a purely static site — no backend API required. Declared with one origin-level line in `llms.txt` (place it **before** the `## Skills` section — some conformant parsers fold trailing non-list lines into the last skill entry):

```markdown
<!-- skills-memory: {"snapshot":"/skills-index.snapshot","snapshot_sha256":"<hex>","format":"minimemory-okf-v1"} -->
```

| Key | Requirement | Meaning |
|---|---|---|
| `snapshot` | REQUIRED | Same-origin path to the snapshot file. |
| `snapshot_sha256` | REQUIRED | Lowercase hex SHA-256 of the exact bytes served at `snapshot`. (Named to avoid the core RFC's `sha256`, same rationale as `tool_sha256`.) |
| `format` | REQUIRED | Snapshot format identifier. Runtimes MUST ignore a `skills-memory` line whose format they do not support (skills load normally; the capability is simply absent). This draft registers one format: `minimemory-okf-v1` (BM25-only index exported by [minimemory](https://github.com/MauricioPerera/minimemory)'s `WasmOkfIndex`; no embeddings, no query-time model needed). |

When a supported snapshot is declared, verified, and loaded, the runtime injects one additional capability into that origin's skills:

- `await host.memorySearch(query, k?)` -> `{ hits: [{ text, score, title, concept_id }] }` — BM25 search over the origin's own snapshot. `query` MUST be a string; `k` is capped by the runtime (reference implementation: 10). Like `fetchOrigin`, the capability is strictly origin-scoped: a skill can only search the snapshot its own publisher shipped. Skills SHOULD check for the capability before calling it (`typeof host.memorySearch === "function"`) — it is absent when the runtime does not support the declared format or when verification fails.

Updating content means re-exporting the snapshot and updating `snapshot_sha256` — same lifecycle as `tool_sha256` (§2.3).

## 3. Runtime requirements

A runtime that executes skills published under this extension (a *gateway*, an agent-embedded engine, etc.):

1. **Integrity.** MUST fetch the artifact, compute SHA-256 over the exact received bytes, and compare with the declared `tool_sha256`. On mismatch the skill MUST be excluded (not degraded to prose, not executed) and the rejection SHOULD be observable (log or diagnostic surface). This matches the mandatory-refusal language of core RFC §4.
2. **Isolation.** MUST execute artifacts in a sandbox where the host environment is not reachable: no ambient network, no filesystem, no host secrets. Host capabilities are injected explicitly; this extension defines only `host.fetchOrigin`, scoped to the publishing origin. A runtime MUST reject any `fetchOrigin` target that resolves outside that origin.
3. **Resource limits.** SHOULD enforce memory, stack, and execution budgets per invocation, so a hostile or buggy artifact cannot exhaust the runtime. Execution budgets SHOULD be **deterministic** (e.g. counting interrupt-callback invocations) for synchronous execution, not wall-clock: platforms that freeze the clock during synchronous execution (Cloudflare Workers freezes `Date.now()` as a Spectre mitigation) make wall-clock deadlines silently inert against `while(true)` — field-tested: a wall-clock 2 s deadline never fired and the platform killed the request at ~40 s. Deterministic gas does not bound time spent *waiting* on async capabilities, so runtimes SHOULD additionally enforce a wall-clock timeout on each capability call (async waits do advance the clock). (Reference implementation values: 64 MB memory, 1 MB stack, interrupt-count gas budget that cuts an infinite loop in a few seconds, plus a 10 s wall-clock timeout per `fetchOrigin` call.)
4. **Trust domain.** Artifacts from the *same origin* MAY share an execution context; artifacts from *different origins* MUST NOT. Runtimes SHOULD isolate per skill even within one origin (defense in depth).
5. **Memory integrity.** A runtime that supports a declared snapshot format MUST verify `snapshot_sha256` over the exact fetched bytes before loading the index. On mismatch the capability MUST NOT be injected (skills that call it get a controlled tool error, not a crash), and the rejection SHOULD be observable — mirroring the artifact rule in requirement 1. Snapshot bytes are covered by the same network timeout as `fetchOrigin` calls.
6. **Exposure.** How verified skills are exposed to agents is out of scope. The reference implementation exposes them as an MCP server (`tools/list` / `tools/call`), which requires no agent-side changes at all — but any interface satisfying 1–4 conforms. Runtimes exposing skills over MCP MUST return `structuredContent` as an object per the MCP spec: when a handler returns an array or a primitive, wrap it (reference implementation: `{ "result": <value> }`). For backwards compatibility with clients that do not support structured outputs, runtimes SHOULD also return the serialized JSON of the *original* (unwrapped) result in a `content` block as a text item (the reference implementation does). Field-tested: unwrapped arrays pass curl inspection but are rejected by conformant client SDKs (`invalid_type`), making the tool unusable in practice.

## 4. Security considerations

- **What the hash buys:** whoever can edit the site cannot silently swap artifact bytes out from under a cached/pinned hash; and a runtime never executes bytes it did not verify. It does **not** authenticate the publisher — for that, compose with the signature scheme of core RFC §4.6 (signing `llms.txt` transitively pins every declared `tool_sha256`, alongside the core RFC's `sha256` for the prose).
- **What the sandbox buys:** a malicious artifact can, at worst, compute and call its own origin — the same things any visitor's browser can already do to that origin. It cannot reach the runtime's credentials, other tenants, or other origins.
- **Residual risks:** a compromised publisher origin can still publish a *correctly hashed* malicious artifact (garbage in, verified garbage out); `fetchOrigin` responses are attacker-controlled input to the artifact; and resource limits bound, but do not eliminate, denial-of-service pressure on the runtime. Cross-origin user confirmation rules from core RFC §4 apply unchanged.

## 5. Reference implementation

Working end-to-end chain (all deployed):

| Piece | URL |
|---|---|
| Runtime + gateway source (QuickJS-wasm sandbox on Cloudflare Workers) | https://github.com/MauricioPerera/mcpwasm |
| Demo publishing site (`llms.txt` with two executable skills) | https://llmstxt-demo-site.rckflr.workers.dev/llms.txt |
| Realistic publisher (D1-backed bookstore: search/detail/stock/**order** skills, plus permanent robustness fixtures: a deliberately hash-mismatched skill and an infinite-loop skill) | https://llmstxt-bookstore.rckflr.workers.dev/llms.txt |
| Docs publisher (the standard's own docs, searchable via a hash-pinned BM25 snapshot + `search_spec` skill — the spec searches itself) | https://llmstxt-docs.rckflr.workers.dev/llms.txt |
| Gateway exposing them as an MCP server | `POST https://llmstxt-gateway.rckflr.workers.dev/mcp?origin=<url-encoded origin>` |

The gateway demonstrates: discovery from `llms.txt`, per-skill SHA-256 verification with exclusion on mismatch, sandboxed execution (QuickJS-wasm) with async handlers in per-skill contexts, origin-scoped `fetchOrigin` including POST write skills (a real order decrementing D1 stock), deterministic gas interruption of infinite loops, and end-to-end consumption by an unmodified MCP client (headless Claude configured with only the gateway URL).

## 6. Open questions

1. Should `tool`/`tool_sha256` live only in `/.well-known/agent-skills/index.json` instead of inline, keeping the inline comment single-key? (This draft chooses inline for zero-infrastructure parity; feedback welcome.)
2. Artifact size limit (the reference implementation truncates fetched bodies at 4 KB for `fetchOrigin` but does not yet cap artifact size).
3. A declared capability list per skill (e.g. `"capabilities":["fetchOrigin"]`) so runtimes can surface least-privilege prompts before loading.
4. WASM artifacts as a second artifact type (`tool.wasm` + WIT-style interface) for non-JS publishers.

## 7. Changelog

- **v0.4 (2026-07-02):** Origin memory (§2.4): hash-pinned search snapshots (`skills-memory` line, `snapshot_sha256`, pluggable `format`) and the origin-scoped `host.memorySearch` capability; runtime requirement for snapshot integrity. Field-tested: the reference gateway serves BM25 search over the spec's own docs published as a static snapshot (`minimemory-okf-v1`).
- **v0.3 (2026-07-02):** Lessons from a realistic field test (D1-backed bookstore + unmodified MCP client): explicit sandbox-globals note (ECMAScript only, no WHATWG APIs); `fetchOrigin` extended with optional `{method, body, contentType}` (GET/POST only) enabling write skills; resource budgets SHOULD be deterministic gas, not wall-clock (frozen clocks in Workers); MCP exposure MUST wrap non-object results in `structuredContent`.
- **v0.2 (2026-07-02):** Rename `sha256` -> `tool_sha256` to avoid collision with the core RFC's `sha256` (hash of the fetched `SKILL.md`), per review feedback.
- **v0.1 (2026-07-02):** Initial draft, extracted from the mcpwasm reference implementation.
