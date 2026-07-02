# RFC: Publishing Agent Skills through `llms.txt`

- **Status:** Draft (v0.8)
- **Date:** 2026-06-02
- **Author:** automators.work
- **Depends on:** [llmstxt.org](https://llmstxt.org/) spec, [Agent Skills](https://agentskills.io) (`SKILL.md`)
- **Reference implementation:** [img.automators.work](https://img.automators.work)

---

## TL;DR

Añade una sección `## Skills` a tu `llms.txt`. Cada entrada es un link a un `SKILL.md` remoto. Los agentes descubren skills en el mismo documento que ya leen para entender tu sitio. Sin servidor, sin proceso persistente, sin autenticación extra.

---

## 1. The Problem

### 1.1 Two ecosystems that do not talk to each other

`llms.txt` tells LLMs what a domain *is*. Agent Skills (`SKILL.md`) tell an agent *how to use* that domain. Both exist. Neither knows about the other.

The result: a site describes itself in `llms.txt`, and it publishes a `SKILL.md` somewhere, but there is **no standardized way** for the site to say *"here is the skill you need to work with me"* — and no standardized way for an agent to discover it.

**Concrete example:** `img.automators.work` serves an SVG placeholder image API. It has a `llms.txt` that documents the API. It also has a `SKILL.md` that teaches agents how to build placeholder URLs. But an agent that reads `llms.txt` has **no signal** that the `SKILL.md` exists. The user must know the URL in advance.

### 1.2 Existing alternatives require infrastructure most sites do not have

| Mechanism | What it requires | Works for a static blog? |
|---|---|---|
| **MCP** | A persistent server process, transport layer, endpoint | **No** |
| **A2A** | A persistent server process, agent-to-agent protocol | **No** |
| **`/.well-known/skills/`** | Static file serving only | **Yes, but only one skill** |

MCP and A2A are the right tools for complex, stateful integrations. They are overkill for:

- **Static sites** (Cloudflare Pages, GitHub Pages, Netlify, Vercel) — no server process exists.
- **Existing APIs** that want to teach agents which endpoints to call, not reimplement their surface.
- **Documentation sites** that want to describe interaction patterns once, not maintain a daemon.

The reference implementation for this RFC (`img.automators.work`) is a **Cloudflare Pages static site**. It cannot run an MCP server. It *can* serve a text file.

### 1.3 The well-known convention is limited

The emerging `/.well-known/skills/default/skill.md` convention (proposed by Cloudflare, adopted by Mintlify) works when:
- The agent knows the domain in advance.
- The agent is configured to probe `.well-known` paths.

It fails when:
- The site wants to declare **multiple** skills for different use cases.
- The agent encounters the site for the first time via `llms.txt`.
- The site wants to co-locate skill discovery with the rest of its agent-facing context.

**Co-location matters.** An agent that reads `llms.txt` to understand a site already has the right document open. If skill discovery requires a separate probe, that is extra latency and a second source of truth.

### 1.4 Why structured over prose

`llms.txt` is free-form markdown. A site could write skill discovery as prose:

> "To use this API from an agent, load the skill at /skills/api-client/SKILL.md."

This works for an LLM reading the document. It does not work for:

- **LLM-free parsing.** A regex parser can extract `## Skills` entries without invoking a model. Prose requires inference to normalize ("here's a skill:", "you can use:", "for API access:") — every site phrases it differently.
- **Non-LLM tooling.** Validators, CI linters, skill crawlers, and IDE integrations need a fixed schema to function. Prose is unparseable without a model in the loop.
- **Runtime auto-discovery.** An agent runtime can implement native `## Skills` support with a deterministic code path. With prose, the runtime needs per-site prompt engineering to extract the same signal.
- **Cross-domain indexing.** A skills directory can index published skills across all domains by crawling `## Skills` sections. This is not possible with ad-hoc prose.

The structure adds zero friction for publishers (two lines of markdown) and enables the tooling layer above it.

---

## 2. Proposal

Add an optional `## Skills` section to `llms.txt`. Each entry is a link to a remote `SKILL.md` (or a skill bundle archive) that conforms to the Agent Skills spec.

### 2.1 Syntax

```markdown
## Skills

- [skill-name](https://example.com/skills/skill-name/SKILL.md): description of when to use this skill.
- [bundle-name](https://example.com/skills/bundle-name.zip): description. <!-- skill: {"version":"1.0.0"} -->
```

Rules:

1. The section heading MUST be exactly `## Skills` (case-insensitive).
2. Each list item MUST follow the standard `llms.txt` link convention: `- [title](URL): description`.
3. The URL MUST resolve to either:
   - A raw `SKILL.md` document (`Content-Type: text/markdown`), OR
   - An archive ending in `.zip` or `.tar.gz` containing `SKILL.md` at the archive root.
4. The remote `SKILL.md` MUST be a valid Agent Skill (YAML frontmatter + body per the Agent Skills spec).
5. The URL SHOULD be same-origin as the `llms.txt`. Cross-origin URLs are permitted but carry additional security implications (see §4).
6. The description SHOULD match or summarize the `description` field in the skill's frontmatter.

### 2.2 Optional inline metadata

A skill entry MAY carry a version hint as a trailing HTML comment:

```markdown
- [pay-with-x402](/skills/x402/SKILL.md): make x402 payments. <!-- skill: {"version":"1.2.0"} -->
```

The only recognized key is `version`. It is a human-readable hint for quick identification, not a security mechanism. Agents that do not understand the comment MUST ignore it.

**For integrity verification and full metadata** (sha256, license, cost estimates, requirements), agents SHOULD fetch `/.well-known/agent-skills/index.json` if available. That document is the canonical metadata source. The `## Skills` entry is the discovery pointer; `.well-known` is the verification and metadata layer.

### 2.3 Discovery flow

```
1. Agent encounters a domain (via user instruction, URL in context, or search result)
2. Agent fetches https://example.com/llms.txt
3. Agent parses the ## Skills section
4. Agent surfaces available skills to the user
5. User opts in to one or more skills
6. Agent fetches the SKILL.md, verifies sha256 if declared, loads it
7. Agent caches the skill per HTTP cache semantics of the SKILL.md response
```

Step 5 is mandatory. Agents MUST NOT auto-install or auto-activate skills without explicit user approval (see §4).

### 2.4 Two primary use cases

**Pattern A — API wrapping.** The site has a public HTTP API. The skill teaches the agent how to authenticate and which endpoints to call. The agent executes calls directly against the API.

*Example:* `img.automators.work` teaches agents to call `/{width}x{height}?bg={hex}` to generate placeholder images.

*Example:* [DemoShop](https://demoshop-88e.pages.dev) publishes three skills (product-search, cart-add, checkout-complete) that teach agents to browse a catalog, add items to a cart, and complete a purchase via its public HTTP API — all without authentication or server-side sessions.

**Pattern B — Interaction instructions.** The site has no dedicated API but wants to describe how an agent should interact with it. The skill contains heuristics, preferred phrasing, or task decomposition patterns.

*Example:* A documentation site teaches agents to quote specific sections when answering questions about its content.

---

## 3. Ecosystem Comparison

| Dimension | MCP | A2A | `/.well-known/skills/` | **`## Skills` in `llms.txt`** |
|---|---|---|---|---|
| Requires server process | Yes | Yes | **No** | **No** |
| Works on static hosts | No | No | **Yes** | **Yes** |
| Multi-skill per domain | Yes | Yes | **No** (fixed path) | **Yes** |
| Co-located with `llms.txt` | No | No | No | **Yes** |
| Zero infrastructure beyond static files | No | No | **Yes** | **Yes** |
| Complex / stateful integrations | **Yes** | **Yes** | No | No |
| Simple API wrapping | Overkill | Overkill | Limited | **Designed for this** |
| Version metadata inline | N/A | N/A | No | **Yes** |
| User opt-in required | Runtime-dependent | Runtime-dependent | Runtime-dependent | **Mandatory** |

**This RFC does not replace MCP or A2A.** It fills the gap below them: the case where a site wants to publish a skill for a simple API or interaction pattern, without running a server.

### 3.1 Relationship to adjacent protocols

The core idea here — *a Markdown manifest hosted at your domain that agents read, with no server process* — is being arrived at independently by others, which is a useful signal that the pattern is sound.

**[auth.md](https://github.com/workos/auth.md) (WorkOS).** A protocol where a service hosts an `AUTH.md` describing how an agent can register and authenticate on the user's behalf, discovered via `/.well-known/oauth-authorization-server` metadata. It is **complementary, not competing**, with this RFC:

- **Different layer.** `auth.md` answers *"how does an agent authenticate to this service?"*; `## Skills` answers *"what can an agent do here, and how?"*. This RFC's example skills are deliberately auth-free; `auth.md` is exactly the missing authentication layer. A fully agent-ready domain can serve **both**: `## Skills` for capability discovery and `AUTH.md` for credential acquisition.
- **Discovery alignment.** `auth.md` is discovered through a `.well-known` pointer that carries a `skill` field referencing the manifest — the same shape as this RFC's `/.well-known/agent-skills/index.json` metadata layer (§8, Open Question 5). The two `.well-known` documents can coexist.
- **Terminology overlap.** `auth.md` uses the word "skill" for its auth manifest, distinct from an [Agent Skills](https://agentskills.io) `SKILL.md`. Implementers should not conflate the two.

**General principle.** As more agent-facing Markdown conventions appear (`llms.txt`, `## Skills`, `AUTH.md`, `.well-known/*`), the risk is fragmentation. This RFC's position: `llms.txt` is the natural **co-located discovery layer** — an agent already reading it to understand a domain should find capability and pointer information there in one fetch, with `.well-known` and protocol-specific manifests (like `AUTH.md`) as the verification and specialized layers beneath it.

### 3.2 Relationship to `agents.txt` (the action layer)

**[agents.txt](https://agents-txt.com).** A capability-declaration file (`/agents.txt` + optional `/agents.json`) that advertises which agent-facing protocols a site supports — payments (x402, MPP, AP2), authorization (agent-auth, OAuth2), MCP, A2A, UCP, WebMCP, and **Skills**. It positions itself as "Layer 4 (action)" above `robots.txt` (access) and `llms.txt` (content). Its `Skills:` directive and its `/.well-known/agent-skills/index.json` both build on the [Agent Skills](https://agentskills.io) `discovery/0.2.0` index schema.

This RFC and `agents.txt` are **complementary along two axes**:

- **Discovery surface.** `agents.txt` answers *"which capability families does this site expose?"* across many protocols at once; `## Skills` in `llms.txt` is the co-located, content-adjacent surface for the Skills family specifically. A site can serve both: a `Skills:` line in `agents.txt` and a `## Skills` section in `llms.txt`, pointing at the **same** `SKILL.md` artifacts.
- **Trust.** `agents.txt`'s Skills layer carries discovery and integrity (`digest`) but **explicitly leaves authenticity out** ("prioritize discovery simplicity over trust verification"). That is exactly the gap this RFC's Tier 2 closes (§4.6): offline-key ed25519 signatures + agent-side key pinning. The two stack cleanly — `agents.txt`/agentskills.io for discovery and integrity, this RFC for authenticity.

**Concrete interoperability (implemented).** The reference generator emits `/.well-known/agent-skills/index.json` as a **superset of the agentskills.io `discovery/0.2.0` schema**: every skill carries the fields that schema expects (`name`, `type: "skill-md"`, `description`, `url`, `digest: "sha256:…"`) *plus* this RFC's extensions (`version`, `license`, `homepage`, raw `sha256`, ed25519 `signature`, and a top-level `signing_key`). One file therefore satisfies both an `agents.txt`/agentskills.io consumer (discovery + integrity) and a Tier-2 consumer (authenticity) — the publisher maintains no second artifact. The redundant `digest` (prefixed form) and `sha256` (raw hex) fields are kept in parallel so existing consumers that read raw `sha256` are not broken.

### 3.3 Skills as the *recipe* layer over tool discovery

A growing body of work attacks **tool-definition bloat** — the cost of injecting every tool's schema into the model context up front. It comes in two camps:

- **Model/client-side.** Anthropic's [Tool Search Tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool) (`defer_loading`) loads only the few relevant tools on demand (reported ~85% fewer tool-definition tokens). Tool-retrieval / "tool RAG" (LangChain toolkits, Gorilla) does the same via embeddings.
- **Server-side.** The MCP [progressive-disclosure SEP](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1888) proposes a server capability that exposes one meta-tool with `searchTools` modes instead of registering hundreds.

**This RFC is complementary, and sits at a third place: publisher-side, and one level up.** Two differences matter:

1. **Search finds; a skill *prescribes*.** Tool search reduces the token cost of *having* many tools, but it does not tell the agent the *order* to use them in, the dependencies, or what to do on error — the agent must still formulate a query (a cold-start problem) and discover the procedure, sometimes by failing. A published skill carries the **recipe**: the procedure at the level of intent. (n8n's own MCP concedes this — it ships an `instructions` blob telling the agent the call order, because the tool list alone is insufficient.)
2. **Trust + curation.** None of the above says *who* published a capability or verifies it; this RFC adds offline-key signatures + pinning (§4.6) and a human-curated procedure tier.

So `llms.txt` Skills can be the **server-less catalog** these consumer-side mechanisms need a source for — Tool Search needs a catalog; the SEP needs the server to implement it; a `## Skills` section is that catalog, owned by the domain, with the recipe and the signature attached.

**Evidence (reference POC, [`evals/poc_orchestration/`](../evals/poc_orchestration/README.md)).** Against a live n8n MCP server (which exposes **25 tools** to build a workflow), a small local model was driven through a real agentic loop in five arms spanning *how much capability sits in context as tool schemas vs. as skill prose*:

| arm | tool defs in context | result |
|---|---:|---|
| raw MCP (n8n's own setup) | 25 | at a 4k context, the tools **do not even fit** (overflow before turn 1) |
| skill + declared tool segment | 8 | runs; same task, −68% tool surface |
| skill + 1 generic MCP passthrough | **1** | runs the full recipe, keeps node introspection |
| skill + 1 generic HTTP tool (REST, no MCP) | **1** | builds and `POST`s the workflow in a single call |

The same workflow gets built with **one tool definition in context instead of 25**. The decisive, model-independent result is the 4k overflow: the raw tool list is *unusable* on a small model, while a skill's declared segment is not. (Honest scoping: once the tools *fit*, the orchestration gap among the MCP arms is marginal on an easy task with a capable model; and the leanest REST arm trades the SDK's parameter validation for speed. It is a single-model POC, not a benchmark — see its README.)

This is the same pattern already live on the reference site **[demoshop](https://demoshop-88e.pages.dev)**, whose skills (`product-search`, `cart-add`) teach an agent to call one REST endpoint directly — zero tools in context — for *simple* capabilities. The n8n POC shows the pattern **scales to a complex, tool-heavy capability**, and maps the cost of each rung.

**Reproducing the server, not just shrinking it.** A companion experiment ([`n8n-skills-sdk`](https://github.com/MauricioPerera/n8n-skills-sdk)) takes the last rung — *no MCP at all*. The n8n MCP's build path turns out to be a thin wrapper over the [`@n8n/workflow-sdk`](https://www.npmjs.com/package/@n8n/workflow-sdk) package (local code→JSON parse + `validateWorkflow`) plus one REST call (`POST /workflows`): `get_sdk_reference`, `validate_workflow`, and `create_workflow_from_code` map onto the package's own exports and the public API. Delivered as a published `SKILL.md` + three local tools (`reference`/`validate`/`create`), a local model built, validated, and created the same workflows the MCP does — in **~3 tool calls vs. the MCP's 6–7**, with **validation preserved** (unlike a naive REST call) and only **3 tool definitions in context**. Two capable ~8–9B models (Qwen, Granite) succeeded cleanly; a 3B model hit a code-writing floor (a property of the model, not the delivery mechanism). The lesson for this RFC: when a capability's "tools" are really *a procedure over a library plus an API*, a **published skill can carry the procedure** and the library/API do the work — the server becomes optional.

---

## 4. Security

1. **No auto-installation.** Agents MUST NOT activate a discovered skill without explicit user opt-in.
2. **Same-origin preference.** Agents SHOULD treat same-origin skills as lower friction than cross-origin skills.
3. **Content verification.** If `sha256` is declared in the inline metadata, agents MUST verify the hash of the fetched file and refuse to load on mismatch.
4. **Cross-origin skills require elevated confirmation.** If a skill URL is on a different origin from the `llms.txt` that references it, agents SHOULD require additional user confirmation beyond the base opt-in. This prevents a compromised `llms.txt` from silently delegating trust to a third-party host.
5. **Least privilege.** Skills loaded from a domain operate within the permission scope of that domain. They cannot request filesystem access, network calls to unrelated origins, or other capabilities not stated in the skill's frontmatter without explicit user re-confirmation.

### 4.6 Signing and authenticity (resolves Open Question 4)

**Threat model.** A `sha256` declared in `## Skills` or in `index.json` provides **integrity** — the content was not corrupted in transit or by a CDN. It does **not** provide **authenticity**, because the same document that points to the skill also asserts its hash. A party that can modify the `llms.txt` or the index can rewrite the pointer and the hash together. Defending against a *compromised or malicious publisher* requires a signature whose trust is not rooted solely in the live document.

**Two-tier model:**

- **Tier 1 — Integrity (`sha256`).** MUST be verified when declared. Cheap, offline, no key management. Already specified in §2.2 and §4.3.
- **Tier 2 — Authenticity (signature).** OPTIONAL. The publisher signs each `SKILL.md` with a private key kept **offline, off the web server**. The public key is published (e.g., `/.well-known/agent-skills/signing-key.pub`, and/or a `signing_key` field in `index.json`). Agents verify the signature over the skill content.

**What the signature actually buys you.** Publishing the public key on the same origin does not, by itself, defeat a fully compromised origin: an attacker who controls the server can swap key, signatures, and content together. The value is:

1. **Offline key.** Because the private key is not on the server, a server compromise *alone* (without the key) cannot forge valid signatures. The attacker can only serve unsigned or invalid-signature content, which a verifying agent rejects.
2. **Agent-side key pinning (TOFU).** The agent pins the origin's public key on first use and warns / requires re-confirmation if it later changes. This detects silent key or skill swaps across sessions — the gap that plain `sha256` cannot close.

**Higher assurance.** For identity-bound provenance, publishers SHOULD consider **keyless signing via a transparency log** (e.g., Sigstore): the artifact is signed by an OIDC identity — such as the CI workflow that built it — and recorded in a public log, so verification asserts *who* produced the artifact, not merely that *some* key did. Trade-off: verification needs network access to the transparency log, which sandboxed agents may lack; same-origin ed25519 + pinning works fully offline.

**Reference implementation.** `scripts/generate.py` signs with ed25519 (deterministic, RFC 8032); `scripts/verify_signatures.py` verifies each `SKILL.md` against the published public key.

---

## 5. On Agent-Side Discovery Triggers

This RFC defines the *publishing* side of the protocol. It does not mandate when or how agents decide to read `llms.txt`.

Today, most agents read `llms.txt` only when the user explicitly directs them to a URL or instructs them to research a site. Proactive, background skill discovery does not yet occur in mainstream runtimes.

This is not a defect of the proposal — it is the current state of the ecosystem. MCP, A2A, and `/.well-known/skills/` face the same trigger problem: all require the user or agent to know the site exists before discovery begins.

**What this RFC adds, even today:** when an agent does encounter a site — via user instruction, a URL in context, or a tool result — a `## Skills` section gives it an unambiguous, machine-readable signal that purpose-built skills are available. That is more than any site can currently express through `llms.txt` alone.

As agent runtimes evolve toward more proactive web discovery, the `## Skills` section provides the declaration primitive those systems will need.

### 5.1 Proactive Discovery Mechanisms

To reduce the friction of skill discovery from "user must know to ask" to "agent finds it automatically", this RFC proposes four optional mechanisms that sites MAY implement and agents MAY support. None are required for compliance, but each lowers the barrier for the agent side.

#### Mechanism A — HTTP `Link` header

Every HTTP response from the domain MAY include a `Link` header pointing to `llms.txt`:

```
Link: </llms.txt>; rel="llms.txt"
```

**Why it matters:** When the agent makes its *first* request to the domain (e.g., loading the homepage or calling an API endpoint), it receives this header for free. No extra round-trip is needed to probe for `llms.txt`. The agent parses the header, fetches `llms.txt`, and discovers skills before the user even asks.

**Reference implementation:** [DemoShop](https://demoshop-88e.pages.dev) sends this header on every API response.

#### Mechanism B — DNS TXT record

The domain MAY publish a DNS TXT record:

```
demoshop-88e.pages.dev. 300 IN TXT "llms-txt=https://demoshop-88e.pages.dev/llms.txt"
```

**Why it matters:** DNS resolution is often faster than HTTP and can be cached at the resolver. The agent can discover the `llms.txt` URL *before* making any HTTP request, allowing it to preload skills or show them to the user at the exact moment the domain is mentioned.

**Limitation:** DNS TXT records are limited to ~255 bytes per string and require DNS access, which sandboxed agents may not have.

#### Mechanism C — HTML `<meta>` tag

In addition to the existing `link rel="alternate"`, the site MAY include a visible `<meta>` tag in the HTML `<head>`:

```html
<meta name="llms-txt" content="/llms.txt">
```

**Why it matters:** It is more discoverable by HTML parsers than `rel="alternate"` (which some agents ignore). It also signals to developers inspecting the page source that the site exposes agent-facing resources.

#### Mechanism D — The `/llms.txt` convention probe

Similar to `robots.txt` or `favicon.ico`, agents MAY adopt the convention:

> "On first encounter with any new domain, attempt `HEAD /llms.txt`. If it returns 200, read it. If 404, assume no skills are published and proceed normally."

**Why it matters:** It requires zero cooperation from the site (the file either exists or it doesn't). It costs one cheap HEAD request (~200 bytes). It works for every domain on the web, not just those that implement headers or DNS records.

**Trade-off:** It adds one round-trip per new domain. Agents SHOULD cache negative responses (404) to avoid repeated probes.

### 5.2 Recommended Agent Behavior (Non-Normative)

When an agent runtime decides to implement proactive discovery, this is the recommended flow:

```
1. Agent encounters a domain (user instruction, URL in context, search result)
2. Check local cache for llms.txt of this domain
   2a. Hit -> skip to step 5
   2b. Miss -> continue
3. Probe for llms.txt using any available mechanism:
   3a. Check HTTP Link header of the first request already made
   3b. Check DNS TXT record (if DNS available)
   3c. HEAD /llms.txt (fallback, cache 404 for 24h)
4. If llms.txt found, parse and cache it
5. If ## Skills exists, surface skills to the user
6. User opts in explicitly to one or more skills
7. Agent fetches SKILL.md, verifies sha256 if declared, loads it
8. Agent caches the skill per HTTP cache semantics
```

**Key principle:** The user opt-in (step 6) remains mandatory. Even with automatic discovery, agents MUST NOT auto-install skills without explicit approval.

**Cache strategy:**
- `llms.txt`: cache per HTTP `Cache-Control` (typically short TTL, e.g., 5 minutes).
- Negative 404: cache for 24 hours to avoid repeated probes.
- `SKILL.md`: cache per HTTP `Cache-Control` (can be long, e.g., immutable).

### 5.3 Observed Execution Gap

Discovery (Section 5) is only half the problem. Even when an agent successfully finds and reads a `SKILL.md`, there is no guarantee it will *execute* the skill according to its instructions.

**Empirical evidence from DemoShop:** In a live test, an agent:
1. Discovered the `cart-add` skill via `llms.txt`.
2. Downloaded and read `SKILL.md`, which specified a Python `urllib` pattern with explicit headers and error handling.
3. Ignored the prescribed pattern and used its generic PowerShell `Invoke-WebRequest` tool instead.

The skill was treated as "interesting documentation" rather than as a "behavioral contract" that overrides the agent's default tools. The API call succeeded, but the agent did not follow the skill's intent: it used different tooling, different error handling, and different conventions than those the site designed.

**Why this happens:**
- Agent runtimes do not have a "skill execution mode" that suspends generic tools and forces compliance with a downloaded `SKILL.md`.
- Skills are not sandboxed or enforced; they are suggestions that the model may or may not follow.
- The reward function of the agent ("complete the user's task") does not penalize tool substitution if the outcome is similar.

**Implications:**
- A publisher cannot assume that publishing a skill guarantees the agent will use it as written.
- The RFC defines *what* to publish and *where* to find it, but not *how* the runtime must enforce execution.
- This is intentionally out of scope (Section 7), but it is a real, observable gap that future work should address.

### 5.4 Discovery from User Instructions

A related but distinct gap occurs when the user includes a domain in their prompt, but the agent does not associate that URL with the need to discover skills.

**Empirical evidence from img.automators.work:** A user asked:

> "crea una imagen de 600 x 50 px de color verde https://img.automators.work/"

The agent:
1. Did not fetch `https://img.automators.work/llms.txt`.
2. Did not discover the `placeholder` skill.
3. Did not learn that the site generates SVG placeholder images via `/600x50?bg=22c55e`.
4. Instead, created a local PNG with Python/PIL, ignoring the URL entirely.

**Why this happens:**
- The agent interpreted the URL as a decorative reference, not as a service endpoint.
- The runtime has no rule that says: "when a user mentions a domain, check `/llms.txt` before acting."
- The default behavior is "do what the user asked with local tools" rather than "delegate to the domain's published skills."

**Implications:**
- Skill discovery is not triggered by implicit references in user prompts.
- Even Mechanism D (the `/llms.txt` convention probe) only works if the agent is already navigating the domain, not when the domain is merely mentioned in text.
- This suggests that either:
  - Agents need a pre-action step: "before answering any task involving a domain, probe its `llms.txt`", or
  - User instructions need an explicit signal (e.g., "use the skill at...") to trigger discovery.

---

## 6. Why This Is Worth Doing

- **Deployable on any static host.** A Cloudflare Pages site, a GitHub Pages repo, a Netlify deploy — any host that can serve a text file can publish skills through this mechanism. No server process required.
- **Self-describing at the source.** A site ships its API *and* the skill for consuming it in the same deploy. No third-party marketplace required.
- **Version-locked to the API.** When the API changes, the skill changes in the same commit. No drift between capability and documentation.
- **Co-located discovery.** An agent reading `llms.txt` finds skills in the same document, in one fetch, with no additional probing.
- **Multi-skill support.** A single domain can publish skills for different use cases (e.g., read-only queries, authenticated writes, admin operations) as separate entries.
- **No gatekeeper.** Publishing a skill is a `git push`. No approval process, no marketplace submission.

---

## 7. Non-Goals

- Replacing local skill filesystems or marketplaces — both remain valid distribution modes.
- Defining a new skill format — this RFC reuses the Agent Skills `SKILL.md` spec as-is.
- Mandating skill *execution* behavior — that is the agent runtime's responsibility.
- Replacing MCP or A2A for complex, stateful integrations — this RFC targets the simpler, static-hosting case.

---

## 8. Open Questions

1. **Should `llms.txt` grow parallel `## MCP` and `## Agents` sections**, making it the single discovery document for a domain's full agent surface? Or should each standard manage its own discovery separately?
2. **Cross-origin skill trust model.** Should cross-origin skills be disallowed entirely, allowed with elevated confirmation, or allowed freely? Current proposal: allowed with elevated confirmation (§4.4).
3. **Archive format.** Should `.zip` be the only mandated archive format, or should `.tar.gz` remain in scope? `.zip` is more universally supported; `.tar.gz` is more natural for git-hosted skill bundles.
4. **Signature scheme beyond `sha256`.** Resolved (§4.6): a two-tier model — `sha256` for integrity (required when declared), plus optional ed25519 signatures over an offline key combined with agent-side key pinning for authenticity. Sigstore is recommended for identity-bound provenance where network-based verification is acceptable.
5. **Relationship to `/.well-known/skills/`.** Resolved: sites SHOULD serve both. The two mechanisms have distinct, non-overlapping roles:

   | Layer | Mechanism | Role |
   |---|---|---|
   | Discovery | `## Skills` in `llms.txt` | Passive, co-located with domain context; zero extra fetch |
   | Metadata & verification | `.well-known/agent-skills/index.json` | sha256, version, license, cost estimates |
   | Active install | `.well-known/skills/default/skill.md` | Single-skill convention probe |

   URLs in `## Skills` MAY mirror those already declared in `.well-known/agent-skills/index.json`, reusing the same artifacts without duplication. Agents that support both get redundant coverage at zero extra cost for publishers.

---

## 9. Reference Implementation

[`img.automators.work`](https://img.automators.work) is a live Cloudflare Pages static site — no server process, no MCP server, no A2A endpoint.

- [`/llms.txt`](https://img.automators.work/llms.txt) — contains a `## Skills` section
- [`/skills/placeholder/SKILL.md`](https://img.automators.work/skills/placeholder/SKILL.md) — the skill itself
- [`/docs/rfc-skills-in-llms-txt.md`](https://img.automators.work/docs/rfc-skills-in-llms-txt.md) — this document
- [`/scripts/parse_llms_txt_skills.py`](https://img.automators.work/scripts/parse_llms_txt_skills.py) — reference parser
- [`/scripts/validate.py`](https://img.automators.work/scripts/validate.py) — validator
- [`/schema/llms-txt-skills.schema.json`](https://img.automators.work/schema/llms-txt-skills.schema.json) — JSON schema

---

## 10. Changelog

- **v0.8 (2026-06-02):** Extended §3.3 with the `n8n-skills-sdk` companion experiment — reproducing the n8n MCP's build path entirely with a published skill + `@n8n/workflow-sdk` (local parse/validate) + the REST API (no MCP): a local model builds+validates+creates the same workflows in ~3 tool calls (vs the MCP's 6–7), validation preserved, 3 tool defs in context; cross-model (8–9B succeed, 3B hits a code-writing floor).
- **v0.7 (2026-06-02):** Added §3.3 "Skills as the recipe layer over tool discovery" positioning this RFC against tool-bloat work (Anthropic Tool Search / `defer_loading`, MCP progressive-disclosure SEP #1888, tool RAG) as the publisher-side, recipe-bearing layer those consumer/server-side mechanisms need a catalog for; added a reference POC (`evals/poc_orchestration/`) driving a live n8n MCP (25 tools) through five arms (25→1 tool defs in context), with demoshop as the simple-capability anchor.
- **v0.6 (2026-06-02):** Added §3.2 "Relationship to `agents.txt` (the action layer)" positioning agents.txt as a complementary discovery layer and this RFC as the authenticity layer it omits; the reference generator now emits `/.well-known/agent-skills/index.json` as a superset of the agentskills.io `discovery/0.2.0` schema (`type` + `digest`) so one file serves both agents.txt/agentskills.io consumers and Tier-2 signature verifiers.
- **v0.5 (2026-06-01):** Added §4.6 "Signing and authenticity" with a two-tier trust model (sha256 integrity + optional ed25519 signatures over an offline key, plus agent-side key pinning); resolved Open Question 4; added a reference signing implementation (`scripts/generate.py`, `scripts/verify_signatures.py`); added §3.1 "Relationship to adjacent protocols" positioning auth.md (WorkOS) as a complementary authentication layer.
- **v0.4 (2026-05-19):** Added §1.4 "Why structured over prose" addressing the free-form equivalence objection; simplified §2.2 inline metadata to version-only hint, delegating sha256/license/cost to `.well-known/agent-skills/index.json`; resolved Open Question 5 with explicit layer table for `## Skills` vs `.well-known`; fixed duplicate §6 heading.
- **v0.3 (2026-05-19):** Expanded agent-side discovery triggers with four mechanisms (HTTP Link header, DNS TXT, HTML meta tag, convention probe); added recommended agent behavior flow; added cache strategy; updated examples with DemoShop.
- **v0.2 (2026-04-21):** Added §3 ecosystem comparison; expanded §4 with cross-origin security rule; added §5 on discovery triggers; added §1.2 infrastructure barrier argument; refined two use-case patterns in §2.4; updated open questions.
- **v0.1 (2026-04-20):** Initial draft.

