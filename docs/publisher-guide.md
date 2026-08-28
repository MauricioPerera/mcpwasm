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