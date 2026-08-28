# Integrating mcpwasm — publish MCP tools from any static site

A practical publisher's guide for [`@rckflr/mcpwasm`](https://www.npmjs.com/package/@rckflr/mcpwasm):
how to turn **any** static site (GitHub Pages, Cloudflare Workers, Netlify,
plain hosting) into an MCP server whose tools your users' AI agents can call —
no backend, no accounts, no server process on either side.

> Reference implementations:
> - Minimal 2-tool demo: [mcpwasm/demo-site](https://github.com/MauricioPerera/mcpwasm/tree/main/demo-site) (`sum_numbers`, `server_time`)
> - Full app: this repo — 6 state tools on the deployed studio + a live host (`packages/modelar-live`)

---

## 1. The concept in one paragraph

Your tools are **files, not servers**. You publish, next to your site's content:

1. `tool.js` — plain JS that calls `registerTool({...})` (one or many)
2. `SKILL.md` — the recipe an agent reads to use the tools well
3. `llms.txt` — a manifest line per skill, carrying the SHA-256 of `tool.js`

The consumer runtime (`npx -y @rckflr/mcpwasm https://your.site`) fetches
`/llms.txt`, **verifies each `tool_sha256` against the served bytes**, loads the
verified code into a QuickJS-WASM sandbox and speaks MCP over stdio. Publishers
need zero infrastructure; tampering with the file breaks the hash and the tool
is rejected.

## 2. Minimum viable publisher (3 files, ~15 minutes)

Pick a skills directory on your site, e.g. `/skills/<skill-name>/`.

### Step 1 — `tool.js`

```js
// /skills/sum_numbers/tool.js — runs inside QuickJS-WASM (see §3 for limits)
registerTool({
  name: "sum_numbers",
  description: "Sum two numbers a and b.",
  inputSchema: {
    type: "object",
    properties: { a: { type: "number" }, b: { type: "number" } },
    required: ["a", "b"],
  },
  handler(args) {
    return Number(args.a) + Number(args.b);
  },
});
```

Rules:

- Plain JavaScript. **No `import`/`require`, no DOM, no Node APIs.**
- The **return value** of `handler` is the tool result (JSON-serialized by the
  host). Throw to return an MCP error result.
- `handler` may be `async` (e.g. to call `host.fetchOrigin`).
- **Multiple `registerTool(...)` calls in one file are fine** — each becomes an
  MCP tool. One file can bundle a whole toolset (Modelar ships 6 tools in one
  `tool.js`).

### Step 2 — `SKILL.md` (the recipe)

```markdown
---
name: sum_numbers
version: 1.0.0
license: MIT
---

# sum_numbers

Sums `a` and `b`.

## Usage

```json
{ "a": 2, "b": 3 }
```

Returns `5`.
```

The runtime serves this file both as an **MCP resource** and through a
`get_skill_guide` tool, so agents read the recipe before using the tool. Keep
it tight: inputs, outputs, one flow example.

### Step 3 — `llms.txt` with the verified skill line

```markdown
# My site

> What this origin publishes.

## Skills

- [sum_numbers](/skills/sum_numbers/SKILL.md): Sum two numbers a and b. <!-- skill: {"version":"1.0.0","sha256":"<SKILL_MD_SHA256>","tool":"/skills/sum_numbers/tool.js","tool_sha256":"<TOOL_JS_SHA256>"} -->
```

Compute the hashes over the **exact UTF-8 bytes you will serve**:

```bash
node -e "const{createHash}=require('crypto');const fs=require('fs');\
console.log(createHash('sha256').update(fs.readFileSync('public/skills/sum_numbers/tool.js')).digest('hex'))"
```

Put that in `tool_sha256` (and the SKILL.md's in `sha256` — recipes are
re-verified on every resource read by the gateway). **The hash must match the
served bytes exactly**: if a host or CDN transforms the file (minification,
rewrites, charset munging), verification fails. Serve `tool.js` as
`application/javascript` and `llms.txt` as `text/plain`.

Automate this in your build (both references do):
[`demo-site/build.mjs`](https://github.com/MauricioPerera/mcpwasm/blob/main/demo-site/build.mjs)
and this repo's `scripts/build-modelar-skills.mjs` — read the tool source,
hash it, generate `llms.txt`, deploy. Never hand-edit the hash.

### Step 4 — consume it

```bash
npx -y @rckflr/mcpwasm https://your.site
```

That process **is** the MCP server for your site (stdio). Wire any client:

```json
{ "mcpServers": { "mysite": {
    "command": "npx",
    "args": ["-y", "@rckflr/mcpwasm", "https://your.site"]
} } }
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.mysite]
command = "cmd"        # Windows; omit on mac/linux
args = ["/c", "npx", "-y", "@rckflr/mcpwasm", "https://your.site"]
startup_timeout_sec = 60
```

### Step 5 — verify

```bash
npx -y @rckflr/mcpwasm https://your.site
# stderr prints discovery: origin → llms.txt → N skills verified (sha256 ✓)
# then it speaks MCP on stdin/stdout — feed it an initialize JSON-RPC line
```

Or in a client: the tools appear like any other MCP server's; SKILL.md recipes
appear as resources. Discovery runs once per process — restart to pick up new
skill versions.

## 3. What tool code can and cannot do (the sandbox)

| Can | Cannot |
|---|---|
| Pure computation, JSON in/out | `import`/`require`, filesystem, timers |
| `host.fetchOrigin(path)` — GET on **your origin only**, returns `{status, body}` | Arbitrary network, other origins |
| `host.memorySearch(query, k?)` — if you publish a `skills-memory` snapshot (BM25 over your static content; see mcpwasm README "Origin memory") | DOM, browser APIs |
| Throw errors (→ MCP `isError`, controlled) | Touch the host's internals — the only bridge is the explicit capability the host injects |

`fetchOrigin` is scoped to the origin (or subpath, for project sites), so a
tool can call your site's own read-only APIs (`server_time` does exactly that)
but not the rest of the internet.

### State patterns (learned from Modelar)

- **Agent-holds-state** (default, zero infrastructure): every tool takes the
  full state document as an argument and returns the updated one in the result.
  The agent carries it between calls. Works with any MCP client; costs tokens
  on big states.
- **Host-held state** (Modelar's live mode): a companion host injects the state
  before every call and strips it from the reply, so prompts stay small; the
  host also serves a visual mirror and pause/undo. See `packages/modelar-live`
  and `scripts/modelar-host.mjs` for the full pattern (MCP stdio **and**
  `POST /mcp` HTTP on one process, WebSocket broadcast, snapshot rollback).

## 4. Hosting notes

- **GitHub Pages user site** (`user.github.io`): `llms.txt` at the root.
- **GitHub Pages project site** (`user.github.io/REPO`): discovered at
  `<base>/llms.txt`; `fetchOrigin` is scoped to the subpath, so one project
  cannot reach another's endpoints on a shared host.
- **Cloudflare Workers**: embed the files byte-exact in the worker (see
  `demo-site/build.mjs` — it serves the *same string* it hashed) or serve from
  static assets like this repo does.
- **Any static host**: as long as bytes are exact and content types are sane
  (`text/plain` for llms.txt, `application/javascript` for tool.js).
- **Local dev loop** without deploying:

  ```bash
  npx -y @rckflr/mcpwasm --serve ./public   # serves ./dist over loopback + connects
  ```

## 5. Hardening options (opt-in)

- **`--lock skills.lock`** — pin-on-first-use: the runtime records the hashes
  it saw and refuses changed content afterwards. Use when you want the
  *consumer* protected against a compromised origin.
- **`index.json` cross-check** — if you also publish
  `/.well-known/agent-skills/index.json` declaring `tool_sha256` per skill, a
  mismatch with `llms.txt` rejects the skill (drift signal). Absence changes
  nothing.
- **Attestations** — Sigstore OIDC identity verification (local runtime,
  `--require-attestation "issuer|identity"`) or pre-registered Ed25519
  (gateway, advisory). See the mcpwasm README "Skill attestations".

## 6. Checklist before publishing

- [ ] `tool.js` has no imports; returns JSON-serializable values; names are unique per origin
- [ ] `tool_sha256` in `llms.txt` = SHA-256 of the *served* bytes (generate in build, never by hand)
- [ ] `SKILL.md` exists at the path in the manifest link and its `sha256` is declared
- [ ] `llms.txt` served at the origin root (or project base) as `text/plain`; the `<!-- skill: {...} -->` JSON is valid (invalid JSON = line silently skipped)
- [ ] CDN/transformations disabled for `tool.js` (minification breaks the hash)
- [ ] `curl` the four paths: `/llms.txt`, `tool.js`, `SKILL.md` (and `index.json` if used)
- [ ] Run `npx -y @rckflr/mcpwasm https://your.site` and watch the discovery log

## 7. Beyond the runtime: embedding the host yourself

`@rckflr/mcpwasm` is also a library — this is what Modelar's live host does:

```js
import { AsyncToolHost } from "@rckflr/mcpwasm/host-async";

const host = new AsyncToolHost({ allowedOrigin: "https://your.site" });
await host.init();
host.loadToolSource(verifiedToolJs); // after your own sha256 check
const tools = host.listTools();
const result = await host.callTool(name, args);
```

Subpath exports: `/host` (sync), `/host-async`, `/mcp-core`, `/mcp-core-async`,
`/llmstxt-parse`, `/shim`. Build your own transports on top (Modelar added
MCP-over-HTTP `POST /mcp`, WebSocket mirroring, pause/rollback and a hosted
state layer in ~270 lines: `scripts/modelar-host.mjs`).

## 8. Interacting with OTHER wasm runtimes (php-wasm, sqlite-wasm, …)

Short answer: **yes — the sandbox and your other wasm runtime are separate
instances; everything crosses as JSON through explicit bridges.** Two verified
patterns (`scripts/spike-wasm-bridge.mjs` runs both against a real SQLite):

**Path A — through your site's HTTP API (zero changes):** if your wasm runtime
backs an endpoint on your origin, tools just call it:

```js
handler: async (args) => {
  const r = await host.fetchOrigin("/api/sql", { method: "POST", body: args.sql });
  return JSON.parse(r.body);
},
```

`fetchOrigin` supports **GET and POST** (body ≤ 16 KB, 10 s timeout); the engine
behind the endpoint (sqlite-wasm, php-wasm, anything) is invisible to mcpwasm.

**Path B — in-process capability (the designed extension point):** embed
`AsyncToolHost` in the process that runs your wasm engine and inject a named
capability — `extraCapabilities: { sqlite: async (argsJson) => resultJson }`.
Tools then call `await host.sqlite({ sql, params })`; the asyncify bridge
suspends the sandbox during the await (the wait consumes no gas), and your
function decides the security policy (read-only, parameterized-only, quotas…).
**No capability, no access** — this is the same bridge the gateway uses for
`fetchOrigin`/`memorySearch`. Contract: the bridge receives
`JSON.stringify([...args])` (an array) and returns a JSON string; the
sandbox-side wrapper already parses the reply.

**First-class shortcut:** since this pattern is exactly how a local consumer
would bridge SQLite, the local runtime now ships it: `--sqlite ./data.db`
(node:sqlite, opt-in, read-only by default, `--sqlite-write` to allow DML —
see the README section "First-class SQLite"). If your engine needs more than
that, `extraCapabilities` is the door.

Sandbox limits that shape the design (from `host-async.mjs`): 64 MB memory,
2 s wall-clock deadline per `callTool` (configurable), deterministic gas
(20 000 interrupt invocations), response cap 4 KB by default
(`maxResponseBytes`). So **run the heavy wasm in the host, not inside the
sandbox**: php-wasm is tens of MB and slow — expose coarse tools
(`run_script`, `query`) bridged to your php-wasm instance; never try to nest
one wasm runtime inside QuickJS (no imports, no nested wasm). If your wasm
runtime lives in the *browser* (e.g. WordPress-Playground-style php-wasm), the
bridge is browser-side — the WebMCP route (like this studio's 18 in-page
tools), or a server that also runs the engine.

## 9. Authenticated, per-user data (token-scoped origins + `--auth`)

The public model has an inverted trust direction compared to a store with
accounts: the consumer chooses the origin; **your server must authenticate
every request**. The sandbox makes this safe by construction — `fetchOrigin`
is base-scoped, so your API is the *only* egress possible and becomes the
single authorization point. Two opt-in patterns, both verified end-to-end:

**Token-as-origin (works today, zero new components).** The user's dashboard
issues a scoped, revocable token; their client config points at
`https://api.yourstore.com/u/<token>`. Rules that make it work:

- `tool.js` paths must be **relative** (`fetchOrigin("api/orders")`) so they
  resolve under the token path — absolute paths resolve to the host root
- Your server validates the bearer on **every** request (hash compare,
  expiry, scope, rate limit, audit) and scopes all data server-side
- Revocation is fail-closed: discovery fails → the runtime exits 1
- One public `tool.js` serves all tenants; the token never appears in it

**`--auth <issuer>` (device flow, RFC 8628 — local runtime).** The config
carries no token at all; on first activation the runtime discovers the
issuer's device/token endpoints (RFC 8414, conventional fallback), prints the
verification URL **by stderr** (stdout is MCP protocol only) and stores the
token locally (`~/.mcpwasm/credentials.json`, 0600). Every fetch carries
`Authorization: Bearer`; `refresh_token` renews silently; a 401 clears the
local credential and re-runs the device flow once; without `--auth` a
protected origin aborts (fail-closed). Related flags: `--auth-client-id`,
`--auth-logout`.

**The boundary rule behind both patterns: credentials never cross the LLM.**
No `login(password)` tools (the conversation is the least trusted storage —
logs, injection, replication), no token-as-tool-argument (confused-deputy +
disclosure). Credentials live in the client config, the runtime process, or
the server. An agent may *start* an auth flow (return a connect URL) and
*report* the result, never *carry* the credential. OAuth itself belongs to
HTTP-transport MCP servers (clients run it natively) or to the `--auth`
device flow — not to in-sandbox tools, which have no human channel.

## 10. Payments and irreversible actions (human-in-the-loop)

Commerce-grade rule: **the agent prepares, the human commits, the agent
verifies.** Money never moves through a tool call:

```
agent:   cart_add → cart_add → order_draft      (token write; server
                                               recomputes prices server-side —
                                               never trust a client-sent total)
server:  DRAFT (pending_payment) + checkout_url bound to the draft
         (one-time, expiring, tied to token/user)
human:   pays in their own browser (3DS/SCA, real session) — card data never
         crosses the agent; the link also arrives by the platform's own
         channel (email), so the agent is a messenger, not the only path
agent:   order_status → "paid ✓" (polls; the state machine lives server-side)
```

Server-side essentials: idempotency keys per draft (agents retry), draft
expiry (unpaid carts die), spend caps and rate limits per token, and full
audit — every `tools/call` is one token-bearing request. The same pattern
covers every irreversible or high-stakes action (cancel order, change
shipping address, delete account): the agent triggers preparation, the human
confirms through a channel your platform controls, the agent verifies. The
agent is one more interface of your store — with the same guarantees as the
web — never a side door around your business rules.

## 11. Where the runtime runs: the ladder (local ⇄ gateway)

"Server" here means an MCP *component*. The whole system is a ladder — start
at the lowest level your case allows, climb one step only when a concrete
feature forces it:

| Level | MCP server? | Enables | Verified by |
|---|---|---|---|
| 0. Static | No | public tools, state travels with the agent, hash verification | this studio (6 tools in production) |
| 0.5. Static + local data | No | consumer mounts their own DB (`--sqlite`) | `test:sqlite` |
| 1. Static + token origin | No — your existing API validates | per-user data, revocable, fail-closed | multi-tenant spike |
| 2. Remote MCP + OAuth | Yes — thin adapter over your API | real identity, native one-click OAuth UX | gateway build |
| 3. Hosted-state MCP | Yes — sessions, mirror | live mirrors, pause/undo, shared state | modelar-live |

The trust mirror: **without a server**, the consumer decides trust (chooses
the origin, pins hashes, mounts their own data); **with a server**, the
server decides (authenticates, scopes, audits every request). Same tools,
same hashes — two trust directions.

**Gateway on Cloudflare** (the same QuickJS sandbox already ships a gateway
build, tested under Miniflare, with service-binding `fetchImpl` routing):
static assets on Pages or Workers Static Assets; a Worker exposing `/mcp`
runs the identical sandbox server-side; D1/KV/Durable Objects replace the
consumer-local file (`--sqlite`) and session state. Clients configure just a
URL and the *client* runs OAuth natively — the "one URL, first-activation
auth, token saved locally" UX, without your own device flow. Worker-side
budgets add to the sandbox ones: ~128 MB isolate, CPU time and subrequests
per plan — keep tools fine-grained and cache catalogs in KV.

**The operational split that falls out of it** (viable and correct): buyers
→ gateway (high volume, low privilege, one-click OAuth, central audit);
admins → local runtime (few users, high privilege: hash-pinned, runs on
their own machine, immune to gateway incidents, `--sqlite` for local
analysis). Same origin, same `tool.js`, same hashes — the *token* decides
which skills each `llms.txt` exposes; never fork the tools, never expose
admin scopes through the gateway. Rule of thumb: high volume + low privilege
→ gateway; high privilege + low volume → local.

## 12. Designing tools: intentions, not endpoints

A tool is an arbitrary async JavaScript function, not an API mirror — one
tool may orchestrate **one or many endpoints** (sequential, parallel via
`Promise.all`, mixed with local capabilities) plus its own logic:

```js
registerTool({
  name: "reorder_last",            // the user's INTENTION, not "GET /orders"
  inputSchema: { type: "object", properties: {} },
  async handler() {
    const r1 = await host.fetchOrigin("wc/v3/orders?per_page=5");
    const last = (JSON.parse(r1.body || "[]")).find(o => o.status === "completed");
    if (!last) return { error: "no completed orders" };
    const r2 = await host.fetchOrigin("assistant/order-draft", {
      method: "POST", contentType: "application/json",
      body: JSON.stringify({ items: last.line_items, note: "reorder of #" + last.id }),
    });
    return JSON.parse(r2.body || "{}");   // { draft_id, checkout_url }
  },
});
```

Why it matters: agents reason over intents (8 semantic tools beat 40 mirrored
endpoints); your API becomes a private implementation detail (refactor freely
— only the hash changes); the flow logic lives in one auditable, public,
hash-verified file. Sandbox budgets cap flow length (~2 s wall-clock, 20k
gas, 4 KB response, 16 KB POST): design 2–5-call flows; hand pagination back
to the agent via cursors (`list_orders(cursor)`) instead of looping.

## 13. Minimum requirements

**Consumer** (runs the agent): Node.js 18+ (22 LTS recommended; `--sqlite`
needs 22.5+ — CI tests 22 and 24), ~150–300 MB RAM, ~10–20 MB disk, any
desktop OS, any stdio MCP client, no admin rights.

**Publisher** (the store): any static host serving `llms.txt` + `tool.js`
(+ optional `SKILL.md`) over HTTPS; zero compute; no database for public
tools; for authenticated patterns, reuse the API/login you already have
(token validation middleware; two tiny device-flow endpoints if you adopt
`--auth`).

**Hard sandbox limits** (from `host-async.mjs`, not negotiable): `tool.js`
≤ 1 MB, `llms.txt` ≤ 256 KB, 64 MB WASM memory per skill, ~2 s wall-clock,
20 000 gas, POST body ≤ 16 KB, fetch timeout 10 s, response cap 4 KB
(`maxResponseBytes`). Design tools as fine-grained calls; paginate
server-side.

What is **not** required — and is the point: no MCP server (ever), no
compute for public tools (CDN only), no accounts for public discovery, and
with `--auth`, no OAuth knowledge on the consumer's side (one URL + one
click). The publisher's marginal cost per tool call is a CDN line; the
sandbox runs on the machine of whoever asked for the execution.

## 14. Security notes (threat model, verified)

Four hostile parties, four sets of controls — each verified empirically, not
by assertion:

| Hostile party | Vector | Control (verified) |
|---|---|---|
| **Publisher** (malicious tools) | hostile `tool.js` | QuickJS sandbox: no imports/DOM/Node, 64 MB / ~2 s / 20k gas; hash in `llms.txt` + `index.json` cross-check + `--lock` pin-on-first-use (anti rug-pull) + optional Sigstore attestations |
| **Publisher** (scope escape) | `../` traversal, absolute paths, full URLs, protocol-relative URLs in tool args | `isUnderBase` + origin check reject all four; a legitimate relative path passes (`test:security`) |
| **Publisher** (exfiltration via redirects) | hostile origin 30x-redirects a tool's fetch cross-origin — undici does **not** strip `Authorization` on cross-origin redirects and 307/308 also forwards the body | redirects followed **manually**, every hop re-validated with the same scope rules; 301/302/303 degrade to GET without body; a third-party capture server receives **zero** requests (`test:security` — this was a real finding, fixed in the runtime) |
| **Consumer** (abusing your API) | replayed tokens, scope creep | token per request validated server-side (hash, expiry, scope, rate limit); revocation is fail-closed; every `tools/call` is one auditable request |
| **Network** | interception | HTTPS; redirect hops re-validated |
| **The LLM itself** (prompt injection) | malicious tool *descriptions* or API *responses* steering the model | structural: credentials never enter the LLM context (config/runtime/server only); the sandbox cannot be injected (fixed code, hash-pinned); scope what tools *return* server-side — the model is the leakiest channel, so it should never hold a secret |

Residual risks worth knowing (mitigable, documented):

- `~/.mcpwasm/credentials.json` is 0600 on POSIX; on Windows `chmod` is a
  no-op — same risk class as `~/.npmrc` (user-session malware, not sandbox
  escape)
- token-as-origin puts the bearer in the URL path → it appears in *your*
  server access logs (scrub them, prefer short-lived tokens, or adopt
  `--auth`, which keeps the token in a header)
- the device-flow verification URL embeds the device code: sharing that URL
  authorizes the runtime — single-use + short expiry cap the damage

## 15. Ephemeral Cloudflare accounts: deploys that die in an hour

Cloudflare's temporary preview accounts (what `wrangler deploy --temporary`
uses, and the workers.new playground behind it) are **pure HTTP with no
login** — verified end-to-end against the live API
(`scripts/spike-ephemeral-cf.mjs`, source of truth: wrangler 4.127.1):

1. `POST /client/v4/provisioning/previews/challenge` with `{}` — no auth —
   returns a proof-of-work challenge (`k=1000` checkpoints × `g=2000` sha256
   steps ≈ 2M hashes ≈ 1.9 s of CPU: the anti-abuse is CPU, not identity)
2. `POST /client/v4/provisioning/previews` with the solved checkpoints and
   `acceptTermsOfService: "yes"` → returns `account {id, name, apiToken,
   expiresAt}` **and** `claim {url, expiresAt}` — the API token for the
   throwaway account rides in the creation response; nothing was ever logged in
3. Deploy is the standard Workers module upload (`PUT
   /accounts/{id}/workers/scripts/{name}`, multipart; the module part's
   filename must equal `main_module`), then enable workers.dev (`POST
   .../scripts/{name}/subdomain {"enabled":true}`) → a live public URL
4. Both `expiresAt` values are server-set: 60 minutes in the spike. The
   **claim URL** is the human-in-the-loop: open it while it lives, log in
   with a real Cloudflare account, and the preview migrates to it

The browser mapping (why this fits mcpwasm): a tool's `fetchOrigin` is
scoped to the publisher origin, and the challenge/creation flow needs **no
Cloudflare identity at all** — so the publisher hosts a thin proxy on their
origin that runs steps 1–2 server-side, keeps the `apiToken` keyed to the
browser session (never in the LLM context — the structural rule of §14),
and returns only what the model may see: the preview URL and the claim URL.
The tool in the browser is one intention — `deploy_preview(code)` →
`{previewUrl, claimUrl, expiresAt}`. One hour later everything is gone
unless a human claimed it: the TTL is the blast radius, the claim is the
commitment, and your real account — on your computer, under your local
runtime — is never touched from the browser. The same trust mirror as §11:
strong credentials where the human executes, disposable identity where an
agent explores. Verified end-to-end: a fresh temporary account hosted the
**complete mcpwasm gateway** (220 KB bundle + QuickJS-WASM + minimemory,
`CompiledWasm` module rules, `nodejs_compat`, no service bindings) —
`initialize` 200, `tools/list` returned the demo site's real tools
(sum_numbers, server_time, get_skill_guide) with hash verification, and
`tools/call sum_numbers {a:2,b:40}` returned **42** from the QuickJS sandbox
running inside the throwaway account
(`scripts/spike-ephemeral-gateway.mjs`). The sandbox fits the free-tier CPU
budget; the TTL makes it a self-cleaning preview environment. The proxy
itself ships as `worker-ephemeral.mjs` (`POST /preview` create-or-reuse with
httpOnly cookie sessions in KV, `GET` status, `DELETE` teardown): the
ephemeral apiToken lives only in the worker's KV — responses carry
`previewUrl`, `claimUrl` and expiry, never the token. Verified hermetically
in `test-ephemeral.mjs` (23 checks: PoW correctness against node:crypto,
session reuse, multi-tenant isolation, no-secret-in-response assertions).
Production needs Workers Paid or extended CPU — the real challenge is
k=1000 × g=2000 (~2M sha256 ≈ 2 s; tests use k=2/g=3).