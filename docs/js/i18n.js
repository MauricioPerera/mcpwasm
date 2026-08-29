// docs/js/i18n.js — EN/ES/PT dictionary + apply/detect logic for the landing
// page. Pure progressive enhancement: the HTML already contains the English
// (default) text as its literal content, so a client with JS disabled (or
// this script failing to load) sees the same fully-formed English page as
// before — this file only SWAPS text after the fact, never gates visibility.
//
// Technical terms are left untranslated on purpose, consistently across the
// three languages: MCP, SHA-256, QuickJS-wasm, JSON-RPC, sandbox, gateway,
// host.fetchOrigin, tool.js, llms.txt, SKILL.md, and the three product/
// component labels used as diagram box titles and card headings (Gateway,
// Sandbox, Local runtime, Library, Publisher site, MCP client, mcpwasm) —
// same convention this repo's own Spanish-language conversations already use
// for these words.
//
// Keys marked in TRANSLATIONS with a "__html" suffix are applied via
// innerHTML (their value legitimately contains inline markup — <code>, <a>,
// <strong> — authored entirely by this file, never from user input); every
// other key is applied via textContent.
(function () {
  "use strict";

  var TRANSLATIONS = {
    en: {
      "common.copy": "Copy",
      "common.copied": "Copied",

      "meta.title": "mcpwasm — Static MCP: your tools are files, not servers",
      "meta.description": "A sandboxed runtime for third-party MCP tools: publish a static llms.txt + tool.js, run it hash-verified inside QuickJS-wasm. Gateway, local stdio runtime, or embeddable library.",

      "hero.h1": "Static MCP: your tools are files, not servers.",
      "hero.lede": "Publish an MCP tool as a static, hash-verified file. Run it sandboxed, on demand, with zero infrastructure — the way static site hosting did to web servers: don't run Apache, publish HTML.",
      "hero.ctaTry": "Try it now",
      "hero.ctaGithub": "View on GitHub",

      "problem.h2": "Running someone else's tool code is a trust decision",
      "problem.lede": "MCP clients like Claude or Cursor can call arbitrary third-party tools. Executing that code directly in your backend means it can read your secrets, hit your database, phone home, or loop forever. You either trust the author fully, or you don't run the tool.",
      "problem.typicalH3": "Typical MCP server",
      "problem.typicalLi1": "Someone has to run a process, 24/7",
      "problem.typicalLi2": "Third-party code shares your runtime",
      "problem.typicalLi3": "Trust the author, or don't install",
      "problem.mcpwasmLi1": "The tool is a file. No process to run.",
      "problem.mcpwasmLi2": "Code executes isolated in QuickJS-wasm",
      "problem.mcpwasmLi3": "SHA-256 pinned; a flipped byte excludes it",

      "how.h2": "How it works",
      "how.lede": "Five steps, all sandboxed, no state kept between requests.",
      "how.svgTitle": "A publisher site ships llms.txt and tool.js; the gateway fetches and verifies them by SHA-256, loads the tool into a QuickJS-wasm sandbox, the sandbox calls host.fetchOrigin back to the publisher, and the MCP client gets a JSON-RPC response.",
      "how.boxPublisherSub1": "static: R2 / Pages / any host",
      "how.boxPublisherSub2": "serves /llms.txt + tool.js",
      "how.boxGatewaySub1": "discover → verify sha256",
      "how.boxGatewaySub2": "load into sandbox",
      "how.boxClientSub1": "Claude, Cursor, ...",
      "how.boxClientSub2": "POST /mcp (JSON-RPC 2.0)",
      "how.boxSandboxSub": "QuickJS-wasm, per skill",
      "how.step1": "publish",
      "how.step2": "verify sha256",
      "how.step3": "load",
      "how.list1__html": "A publisher site ships <code>/llms.txt</code> plus per-skill <code>tool.js</code> and <code>SKILL.md</code>.",
      "how.list2__html": "The gateway downloads <code>llms.txt</code>, fetches each <code>tool.js</code>, and verifies its SHA-256.",
      "how.list3__html": "Verified tools load into a fresh QuickJS-wasm context, one per skill.",
      "how.list4__html": "Tool code calls <code>host.fetchOrigin</code> — scoped to the publishing origin only; anything else throws inside the sandbox.",
      "how.list5__html": "The gateway maps MCP <code>tools/list</code> / <code>tools/call</code> over JSON-RPC 2.0 back to the client.",

      "ways.h2": "Four ways to use it today",
      "ways.lede": "All four are real, deployed, and tested — not roadmap.",
      "ways.gatewayTag": "turnkey MCP server",
      "ways.gatewayP": "Point any MCP client at the deployed gateway. It discovers, verifies, and sandboxes a publisher's skills on every request.",
      "ways.localTag": "zero infra, both sides",
      "ways.localP": "Run any origin's skills locally over stdio — including origin memory (verified BM25 search, 0.4.0), each skill's SKILL.md recipe served as an MCP resource (0.5.0), and multi-project origins via scopes: kdd__search_knowledge with per-scope memory (new in 0.6.0). No gateway, no server, on either end.",
      "ways.browserTag": "no Node either",
      "ways.browserP": "The whole runtime in a browser tab (new in 0.7.0): discovery, byte-for-byte SHA-256 verification, one QuickJS-wasm sandbox per tool, scopes and per-scope memory. The publisher only needs CORS — GitHub Pages already sends it. No server on their side, no Node on yours.",
      "ways.browserDemo": "Open the live demo",
      "ways.browserAgent": "Full-stack agent demo",
      "compare.h2": "Where this fits: four ways an agent gets a third-party tool",
      "compare.lede": "Same underlying question — \"can an agent safely run someone else's tool code?\" — four different answers.",
      "compare.mcpH3": "Traditional MCP server",
      "compare.mcpLi1": "Client: install & configure a full MCP client",
      "compare.mcpLi2": "Isolation: tool code runs with the server's full privileges",
      "compare.mcpLi3": "Integrity: none — you trust the server's response completely",
      "compare.mcpLi4__html": "Discovery: a separate <code>tools/list</code> RPC, before any call",
      "compare.mcpLi5": "To publish: a live process, running 24/7, somewhere",
      "compare.webmcpTag": "in-page, unsandboxed",
      "compare.webmcpLi1": "Client: none — a browser API or the page's own bridge",
      "compare.webmcpLi2": "Isolation: none — runs in-page with full page privileges",
      "compare.webmcpLi3": "Integrity: none — trust whatever the page currently serves",
      "compare.webmcpLi4": "Discovery: tools register as a side effect of the page loading",
      "compare.webmcpLi5": "To publish: whatever hosts your page — can be fully static",
      "compare.withClientTag": "npx, zero config",
      "compare.withClientLi1__html": "Client: <code>npx @rckflr/mcpwasm &lt;origin&gt;</code> — one command",
      "compare.withClientLi2__html": "Isolation: QuickJS-wasm sandbox, only a scoped <code>host.fetchOrigin</code> out",
      "compare.withClientLi3": "Integrity: SHA-256 pinned in llms.txt, verified before running",
      "compare.withClientLi4": "Discovery: running the verified file registers its tools",
      "compare.withClientLi5": "To publish: 100% static — the client does the work",
      "compare.noClientTag": "no client at all",
      "compare.noClientLi1__html": "Client: none — <code>connectStaticSkills()</code> runs it in your own process",
      "compare.noClientLi2": "Isolation: same sandbox, same verification, zero extra process",
      "compare.noClientLi3": "Integrity: same SHA-256 pin, checked in your own runtime",
      "compare.noClientLi4": "Discovery: same mechanism — but nothing nudges an agent to look",
      "compare.noClientLi5": "To publish: static hosting + CORS — GitHub Pages qualifies",
      "compare.caseH3": "Verified live, not just claimed",
      "compare.caseP__html": "<a href=\"https://mauricioperera.github.io/mcpwasm-pages-test/\">margin-demo</a> is a no-client skill (<code>create_document</code> / <code>decode_document</code>) hosted on plain GitHub Pages — no backend at all. Given only its URL, an unmodified agent (Codex) treated it as a regular web page and never found the tools on its own. Adding three explicit discovery layers — a visible \"for agents\" note, an <code>agent-setup/prompt.md</code> (the same pattern <a href=\"https://developers.cloudflare.com/agent-setup/prompt.md\">Cloudflare uses</a>), and a one-click \"copy prompt for agent\" button — closed the gap: the same agent then found and called the tools on the first try, including a full read-modify-write cycle (<code>decode_document</code> → edit → <code>create_document</code>) from a single copied prompt. <strong>Discoverability, for any of the four approaches above, isn't automatic — it has to be engineered in.</strong>",
      "compare.caseCta": "Read the full write-up",

      "tabagent.h2": "The whole stack, as one personal agent",
      "tabagent.lede__html": "<a href=\"https://github.com/MauricioPerera/tab-agent\">tab-agent</a> is a personal AI agent that is nothing but static files + your browser: shared <strong>memory</strong> (the cq-git commons over the GitHub API), <strong>verified tools</strong> (this runtime, hash-pinned &amp; sandboxed), and a <strong>model you own</strong> — the provider credential is never exposed (run it in-tab via WebGPU, your endpoint, or an operator proxy). It answers the personal-agent supply-chain problem by inverting it: tools are verified, not screened.",
      "tabagent.cta": "Open tab-agent",
      "ways.libraryTag": "embed the sandbox",
      "ways.libraryP": "Build your own platform host with the exact isolation the gateway uses.",

      "trust.h2": "Four rings of trust",
      "trust.lede__html": "None of them alone is enough. Together they bound what a published skill can claim — the same four rings <a href=\"https://mauricioperera.github.io/static-agent-web/\">the whole ecosystem</a> uses, for any runtime that implements the spec.",
      "trust.card1H3": "Integrity",
      "trust.card1P__html": "Every <code>tool.js</code> is pinned by SHA-256 in <code>llms.txt</code>. A single flipped byte and the skill is excluded — not degraded, not executed.",
      "trust.card2H3": "Authenticity",
      "trust.card2P__html": "Signed human review — pre-registered Ed25519 keys or keyless <strong>Sigstore</strong> identities (the spec's recommended default since v0.4). <strong>Honest today:</strong> one registered reviewer. The mechanism scales; the reviewer network hasn't yet.",
      "trust.card3H3": "Freshness",
      "trust.card3P__html": "An attestation isn't a one-time stamp: it carries an expiry window and voids itself the moment the attested file changes — \"still true\" has a shelf life, not a permanent seal.",
      "trust.card4H3": "Stability",
      "trust.card4P__html": "A consumer <a href=\"https://github.com/MauricioPerera/mcpwasm#consumer-lockfile---lock--what-if-the-publisher-is-the-attacker\"><code>--lock</code></a> lockfile pins each skill's hash on first use — a later change is rejected loudly, not applied silently, even if it's the publisher's own account that changed it. Local runtime today; gateway and browser don't support it yet.",
      "trust.runtimeNote__html": "These four rings describe the published <strong>skill itself</strong> — verifiable by any runtime that implements the spec, independent of who's running it. mcpwasm adds one more layer when it actually <strong>executes</strong> a verified skill: each one runs isolated in its own QuickJS-wasm context — no <code>fetch</code>, no <code>process</code>, no disk, only an explicit, origin-scoped <code>host.fetchOrigin</code> out.",

      "benchmark.h2": "What it costs",
      "benchmark.lede": "Real numbers from the deployed gateway, not synthetic estimates.",
      "benchmark.stat1Label": "sandbox overhead, warm",
      "benchmark.stat1Sub": "55ms sandboxed vs 53ms raw ping",
      "benchmark.stat2Label": "full gateway overhead",
      "benchmark.stat2Sub": "96ms via gateway vs 90ms direct API",
      "benchmark.stat3Label": "p95, 10 concurrent requests",
      "benchmark.stat3Sub": "before → after the instance pool + preheat",
      "benchmark.stat4Label": "cold discovery miss",
      "benchmark.stat4Sub": "~210–400ms range, compile + sha256 + fetch",
      "benchmark.disclaimer__html": "Single-client benchmark from México to the Cloudflare Workers edge — this is latency of one observer, <strong>not a load test</strong>. Full matrix, methodology, and raw data are in <a href=\"https://github.com/MauricioPerera/mcpwasm/blob/main/BENCHMARK.md\">BENCHMARK.md</a>.",

      "quickstart.h2": "Try it now",
      "quickstart.sub1": "Run any origin's skills locally, no gateway",
      "quickstart.sub2": "MCP client configuration",
      "quickstart.sub3": "Or call the live demo gateway directly",
      "quickstart.disclaimer__html": "The deployed gateway requires a bearer token (not published here). Full curl walkthrough — including the open demo, bookstore, and docs publishers — is in the <a href=\"https://github.com/MauricioPerera/mcpwasm#readme\">README</a>.",

      "bridge.h2": "From a static site to a live MCP server",
      "bridge.lede__html": "<a href=\"https://github.com/MauricioPerera/llms-txt-skills\">llms-txt-skills</a> is the <strong>format</strong>; <a href=\"https://github.com/MauricioPerera/mcpwasm\">mcpwasm</a> is a <strong>runtime</strong> for it. A publisher serves hash-pinned, attested skills once, the standard way — the runtime discovers, verifies, and runs each as an MCP tool. The whole contract between them is one <code>tool_sha256</code> and its attestation.",
      "bridge.svgTitle": "A static publisher site serves llms.txt skills and tool.js; mcpwasm fetches and verifies them, then exposes each as an MCP tool that a client can call, running the tool.js sandboxed.",
      "bridge.boxSiteTitle": "Static site",
      "bridge.boxSiteSub1": "llms.txt · ## Skills · tool.js",
      "bridge.boxSiteSub2": "index.json · attestations.json",
      "bridge.boxRuntimeTitle": "mcpwasm runtime",
      "bridge.boxRuntimeSub1": "gateway (Workers) or npx local",
      "bridge.boxRuntimeSub2": "verify + QuickJS sandbox",
      "bridge.boxClientTitle": "MCP client",
      "bridge.boxClientSub1": "Claude, Cursor, any MCP host",
      "bridge.boxClientSub2": "lists and calls the tools",
      "bridge.step1": "fetch + verify",
      "bridge.step2": "serve as MCP tools",
      "bridge.step3": "call tool(args)",
      "bridge.step4": "sandboxed tool.js",
      "bridge.list1__html": "A publisher serves an <code>llms.txt</code> whose <code>## Skills</code> section lists each executable skill with its <code>tool.js</code> and <code>tool_sha256</code> — mirrored in <code>/.well-known/agent-skills/index.json</code> and signed in <code>attestations.json</code>. Optionally, a hash-pinned BM25 snapshot (one <code>llms-skills memory</code> command over an OKF bundle) adds serverless search over the site's own knowledge. This is exactly what the llms-txt-skills spec defines. Since llms-skills 0.4.0, the bundle can also carry <em>signed freshness</em>: a reviewer attests “still true”, voided on edit, expiring on a date.",
      "bridge.list2__html": "mcpwasm points at that origin, fetches the <code>llms.txt</code>, and verifies every <code>tool.js</code> against its <code>tool_sha256</code> and its attestation — rejecting any mismatch <em>before</em> loading it.",
      "bridge.list3__html": "Each verified skill becomes an <strong>MCP tool</strong>, and its <code>SKILL.md</code> recipe is served alongside as an MCP <strong>resource</strong> (with a <code>get_skill_guide</code> fallback) — the agent gets the manual, not just the hammer. Claude, Cursor, any MCP host list and call it like any other tool.",
      "bridge.list4__html": "On a call, mcpwasm executes that <code>tool.js</code> <strong>verbatim</strong> inside a QuickJS-wasm sandbox — no network or filesystem except the host capabilities it grants (a scoped <code>fetchOrigin</code> back to the site, and search over the site's own content). The result returns to the client.",
      "bridge.takeaway__html": "Neither side has to trust the other's prose: mcpwasm re-derives the hash and checks the signature itself. Static hosting + a verifying runtime = an MCP server with <strong>no server to run</strong>.",
      "bridge.template__html": "Want to be the publisher side? Start from the <a href=\"https://github.com/MauricioPerera/llms-skills-template\">GitHub template</a> — a working publisher out of the box (example knowledge bundle, generated skills, validation CI) that this runtime consumes as-is.",

      "ecosystem.h2": "Part of a spec, not just a repo",
      "ecosystem.lede__html": "mcpwasm is the reference implementation of two provisional extensions to the <a href=\"https://github.com/MauricioPerera/llms-txt-skills\">llms-txt-skills</a> standard: <strong>Executable Skills</strong> (v0.5, with origin memory and scopes) and <strong>Skill Attestations</strong> (v0.4). Every MUST in those specs is field-tested in this code — spec and implementation are kept in sync.",

      "footer.onboard": "Onboard a publisher",
      "footer.license": "MIT License",
    },

    es: {
      "common.copy": "Copiar",
      "common.copied": "Copiado",

      "meta.title": "mcpwasm — Static MCP: tus tools son archivos, no servidores",
      "meta.description": "Un runtime sandboxeado para tools de MCP de terceros: publicá un llms.txt + tool.js estático, corrélo verificado por hash dentro de QuickJS-wasm. Gateway, runtime local por stdio, o librería embebible.",

      "hero.h1": "Static MCP: tus tools son archivos, no servidores.",
      "hero.lede": "Publicá una tool de MCP como un archivo estático verificado por hash. Ejecutala sandboxeada, bajo demanda, con cero infraestructura — lo que el hosting estático le hizo a los servidores web: no corras Apache, publicá HTML.",
      "hero.ctaTry": "Probalo ahora",
      "hero.ctaGithub": "Ver en GitHub",

      "problem.h2": "Correr el código de una tool ajena es una decisión de confianza",
      "problem.lede": "Clientes MCP como Claude o Cursor pueden llamar tools arbitrarias de terceros. Ejecutar ese código directo en tu backend significa que puede leer tus secretos, tocar tu base de datos, llamar a casa, o quedarse en un loop infinito. O confiás en el autor por completo, o no corrés la tool.",
      "problem.typicalH3": "Servidor MCP típico",
      "problem.typicalLi1": "Alguien tiene que correr un proceso, 24/7",
      "problem.typicalLi2": "El código de terceros comparte tu runtime",
      "problem.typicalLi3": "Confiá en el autor, o no lo instales",
      "problem.mcpwasmLi1": "La tool es un archivo. Ningún proceso que correr.",
      "problem.mcpwasmLi2": "El código se ejecuta aislado en QuickJS-wasm",
      "problem.mcpwasmLi3": "Fijado por SHA-256; un byte alterado lo excluye",

      "how.h2": "Cómo funciona",
      "how.lede": "Cinco pasos, todos sandboxeados, sin estado entre requests.",
      "how.svgTitle": "Un sitio publisher publica llms.txt y tool.js; el gateway los descarga y verifica por SHA-256, carga la tool en un sandbox QuickJS-wasm, el sandbox llama a host.fetchOrigin de vuelta al publisher, y el cliente MCP recibe una respuesta JSON-RPC.",
      "how.boxPublisherSub1": "estático: R2 / Pages / cualquier host",
      "how.boxPublisherSub2": "sirve /llms.txt + tool.js",
      "how.boxGatewaySub1": "descubre → verifica sha256",
      "how.boxGatewaySub2": "carga en el sandbox",
      "how.boxClientSub1": "Claude, Cursor, ...",
      "how.boxClientSub2": "POST /mcp (JSON-RPC 2.0)",
      "how.boxSandboxSub": "QuickJS-wasm, por skill",
      "how.step1": "publicar",
      "how.step2": "verificar sha256",
      "how.step3": "cargar",
      "how.list1__html": "Un sitio publisher publica <code>/llms.txt</code> más <code>tool.js</code> y <code>SKILL.md</code> por cada skill.",
      "how.list2__html": "El gateway descarga <code>llms.txt</code>, obtiene cada <code>tool.js</code>, y verifica su SHA-256.",
      "how.list3__html": "Las tools verificadas cargan en un contexto QuickJS-wasm nuevo, uno por skill.",
      "how.list4__html": "El código de la tool llama a <code>host.fetchOrigin</code> — restringido solo al origin del publisher; cualquier otro origin lanza una excepción dentro del sandbox.",
      "how.list5__html": "El gateway mapea <code>tools/list</code> / <code>tools/call</code> de MCP sobre JSON-RPC 2.0 de vuelta al cliente.",

      "ways.h2": "Cuatro formas de usarlo hoy",
      "ways.lede": "Las cuatro son reales, están desplegadas y probadas — no es roadmap.",
      "ways.gatewayTag": "servidor MCP listo para usar",
      "ways.gatewayP": "Apuntá cualquier cliente MCP al gateway desplegado. Descubre, verifica, y sandboxea las skills de un publisher en cada request.",
      "ways.localTag": "cero infra, en ambos lados",
      "ways.localP": "Corré las skills de cualquier origin localmente por stdio — incluidas la memoria de origin (búsqueda BM25 verificada, 0.4.0), la receta SKILL.md de cada skill servida como resource MCP (0.5.0) y origins multi-proyecto vía scopes: kdd__search_knowledge con memoria por scope (nuevo en 0.6.0). Sin gateway, sin servidor, en ningún lado.",
      "ways.browserTag": "tampoco Node",
      "ways.browserP": "El runtime completo en una pestaña del navegador (nuevo en 0.7.0): descubrimiento, verificación SHA-256 byte a byte, un sandbox QuickJS-wasm por tool, scopes y memoria por scope. El publicador solo necesita CORS — GitHub Pages ya lo manda. Sin servidor de su lado, sin Node del tuyo.",
      "ways.browserDemo": "Abrir la demo en vivo",
      "ways.browserAgent": "Demo del agente full-stack",
      "compare.h2": "Dónde encaja esto: cuatro formas de que un agente use una tool de un tercero",
      "compare.lede": "La misma pregunta de fondo — \"¿puede un agente correr con seguridad el código de la tool de otro?\" — cuatro respuestas distintas.",
      "compare.mcpH3": "Servidor MCP tradicional",
      "compare.mcpLi1": "Cliente: instalar y configurar un cliente MCP completo",
      "compare.mcpLi2": "Aislamiento: el código de la tool corre con todos los privilegios del servidor",
      "compare.mcpLi3": "Integridad: ninguna — confiás ciegamente en la respuesta del servidor",
      "compare.mcpLi4__html": "Descubrimiento: un RPC <code>tools/list</code> separado, antes de cualquier llamada",
      "compare.mcpLi5": "Para publicar: un proceso vivo, corriendo 24/7, en algún lado",
      "compare.webmcpTag": "en la página, sin sandbox",
      "compare.webmcpLi1": "Cliente: ninguno — una API del navegador o el bridge propio de la página",
      "compare.webmcpLi2": "Aislamiento: ninguno — corre en la página con todos sus privilegios",
      "compare.webmcpLi3": "Integridad: ninguna — confiás en lo que la página sirva en ese momento",
      "compare.webmcpLi4": "Descubrimiento: las tools se registran como efecto colateral de cargar la página",
      "compare.webmcpLi5": "Para publicar: lo que hostee tu página — puede ser 100% estático",
      "compare.withClientTag": "npx, sin configurar",
      "compare.withClientLi1__html": "Cliente: <code>npx @rckflr/mcpwasm &lt;origin&gt;</code> — un comando",
      "compare.withClientLi2__html": "Aislamiento: sandbox QuickJS-wasm, solo sale por <code>host.fetchOrigin</code> acotado",
      "compare.withClientLi3": "Integridad: SHA-256 fijado en llms.txt, verificado antes de correr",
      "compare.withClientLi4": "Descubrimiento: correr el archivo verificado registra sus tools",
      "compare.withClientLi5": "Para publicar: 100% estático — el cliente hace el trabajo",
      "compare.noClientTag": "sin cliente alguno",
      "compare.noClientLi1__html": "Cliente: ninguno — <code>connectStaticSkills()</code> lo corre en tu propio proceso",
      "compare.noClientLi2": "Aislamiento: mismo sandbox, misma verificación, cero proceso extra",
      "compare.noClientLi3": "Integridad: mismo hash SHA-256, verificado en tu propio runtime",
      "compare.noClientLi4": "Descubrimiento: mismo mecanismo — pero nada empuja a un agente a buscarlo",
      "compare.noClientLi5": "Para publicar: hosting estático + CORS — GitHub Pages alcanza",
      "compare.caseH3": "Verificado en vivo, no solo afirmado",
      "compare.caseP__html": "<a href=\"https://mauricioperera.github.io/mcpwasm-pages-test/\">margin-demo</a> es un skill sin cliente (<code>create_document</code> / <code>decode_document</code>) alojado en GitHub Pages puro — sin backend alguno. Dándole solo la URL, un agente sin modificar (Codex) la trató como una página web cualquiera y nunca encontró las tools por su cuenta. Agregar tres capas explícitas de descubrimiento — una nota visible \"para agentes\", un <code>agent-setup/prompt.md</code> (el mismo patrón que <a href=\"https://developers.cloudflare.com/agent-setup/prompt.md\">usa Cloudflare</a>), y un botón de un clic \"copiar prompt para agente\" — cerró la brecha: el mismo agente encontró y usó las tools a la primera, incluyendo un ciclo completo de lectura-modificación-escritura (<code>decode_document</code> → editar → <code>create_document</code>) a partir de un solo prompt copiado. <strong>El descubrimiento, en cualquiera de los cuatro enfoques de arriba, no es automático — hay que construirlo a propósito.</strong>",
      "compare.caseCta": "Leer el análisis completo",

      "tabagent.h2": "Todo el stack, como un agente personal",
      "tabagent.lede__html": "<a href=\"https://github.com/MauricioPerera/tab-agent\">tab-agent</a> es un agente personal que es solo archivos estáticos + tu navegador: <strong>memoria</strong> compartida (el commons cq-git vía la API de GitHub), <strong>tools verificadas</strong> (este runtime, fijadas por hash y en sandbox) y un <strong>modelo que es tuyo</strong> — la credencial del proveedor nunca se expone (correlo en la pestaña vía WebGPU, tu endpoint, o un proxy de operador). Responde al problema de supply-chain de los agentes personales invirtiéndolo: las tools se verifican, no se escanean.",
      "tabagent.cta": "Abrir tab-agent",
      "ways.libraryTag": "embebé el sandbox",
      "ways.libraryP": "Construí tu propio host de plataforma con el mismo aislamiento que usa el gateway.",

      "trust.h2": "Cuatro anillos de confianza",
      "trust.lede__html": "Ninguno alcanza solo. Juntos acotan lo que una skill publicada puede afirmar — los mismos cuatro anillos que usa <a href=\"https://mauricioperera.github.io/static-agent-web/\">todo el ecosistema</a>, para cualquier runtime que implemente la spec.",
      "trust.card1H3": "Integridad",
      "trust.card1P__html": "Cada <code>tool.js</code> queda fijado por SHA-256 en <code>llms.txt</code>. Un solo byte alterado y la skill queda excluida — no degradada, no ejecutada.",
      "trust.card2H3": "Autenticidad",
      "trust.card2P__html": "Revisión humana firmada — claves Ed25519 pre-registradas o identidades <strong>Sigstore</strong> keyless (el default recomendado por la spec desde v0.4). <strong>Honesto hoy:</strong> un solo revisor registrado. El mecanismo escala; la red de revisores todavía no.",
      "trust.card3H3": "Vigencia",
      "trust.card3P__html": "Una atestación no es un sello de una sola vez: tiene ventana de vencimiento y se anula sola en el momento en que el archivo atestado cambia — \"sigue siendo verdad\" tiene fecha de vencimiento, no es un sello permanente.",
      "trust.card4H3": "Estabilidad",
      "trust.card4P__html": "Un lockfile del consumidor (<a href=\"https://github.com/MauricioPerera/mcpwasm#consumer-lockfile---lock--what-if-the-publisher-is-the-attacker\"><code>--lock</code></a>) fija el hash de cada skill al primer uso — un cambio posterior se rechaza en voz alta, no se aplica en silencio, ni siquiera si es la propia cuenta del publicador la que cambió. Runtime local hoy; gateway y browser todavía no lo soportan.",
      "trust.runtimeNote__html": "Estos cuatro anillos describen la <strong>skill publicada en sí</strong> — verificable por cualquier runtime que implemente la spec, sin importar quién la corra. mcpwasm agrega una capa más cuando efectivamente <strong>ejecuta</strong> una skill verificada: cada una corre aislada en su propio contexto QuickJS-wasm — sin <code>fetch</code>, sin <code>process</code>, sin disco, solo un <code>host.fetchOrigin</code> explícito y restringido al origin.",

      "benchmark.h2": "Lo que cuesta",
      "benchmark.lede": "Números reales del gateway desplegado, no estimaciones sintéticas.",
      "benchmark.stat1Label": "overhead del sandbox, en caliente",
      "benchmark.stat1Sub": "55ms sandboxeado vs 53ms ping directo",
      "benchmark.stat2Label": "overhead del gateway completo",
      "benchmark.stat2Sub": "96ms vía gateway vs 90ms API directa",
      "benchmark.stat3Label": "p95, 10 requests concurrentes",
      "benchmark.stat3Sub": "antes → después del pool de instancias + precalentamiento",
      "benchmark.stat4Label": "miss de descubrimiento en frío",
      "benchmark.stat4Sub": "rango ~210–400ms, compilar + sha256 + fetch",
      "benchmark.disclaimer__html": "Benchmark de un solo cliente desde México hasta el edge de Cloudflare Workers — es latencia de un observador, <strong>no es un load test</strong>. La matriz completa, la metodología, y los datos crudos están en <a href=\"https://github.com/MauricioPerera/mcpwasm/blob/main/BENCHMARK.md\">BENCHMARK.md</a>.",

      "quickstart.h2": "Probalo ahora",
      "quickstart.sub1": "Corré las skills de cualquier origin localmente, sin gateway",
      "quickstart.sub2": "Configuración del cliente MCP",
      "quickstart.sub3": "O llamá directo al gateway de demo en vivo",
      "quickstart.disclaimer__html": "El gateway desplegado requiere un bearer token (no publicado acá). El recorrido completo con curl — incluyendo el demo abierto, el bookstore, y los publishers de docs — está en el <a href=\"https://github.com/MauricioPerera/mcpwasm#readme\">README</a>.",

      "bridge.h2": "De un sitio estático a un servidor MCP vivo",
      "bridge.lede__html": "<a href=\"https://github.com/MauricioPerera/llms-txt-skills\">llms-txt-skills</a> es el <strong>formato</strong>; <a href=\"https://github.com/MauricioPerera/mcpwasm\">mcpwasm</a> es un <strong>runtime</strong> para él. Un publicador sirve una vez sus skills fijadas por hash y atestadas, de la forma estándar — el runtime las descubre, verifica y ejecuta cada una como una herramienta MCP. Todo el contrato entre ambos es un <code>tool_sha256</code> y su atestación.",
      "bridge.svgTitle": "Un sitio publicador estático sirve skills de llms.txt y tool.js; mcpwasm los descarga y verifica, y luego expone cada uno como una herramienta MCP que un cliente puede invocar, ejecutando el tool.js sandboxeado.",
      "bridge.boxSiteTitle": "Sitio estático",
      "bridge.boxSiteSub1": "llms.txt · ## Skills · tool.js",
      "bridge.boxSiteSub2": "index.json · attestations.json",
      "bridge.boxRuntimeTitle": "runtime mcpwasm",
      "bridge.boxRuntimeSub1": "gateway (Workers) o npx local",
      "bridge.boxRuntimeSub2": "verificar + sandbox QuickJS",
      "bridge.boxClientTitle": "Cliente MCP",
      "bridge.boxClientSub1": "Claude, Cursor, cualquier host MCP",
      "bridge.boxClientSub2": "lista e invoca las herramientas",
      "bridge.step1": "descargar + verificar",
      "bridge.step2": "exponer como herramientas MCP",
      "bridge.step3": "invocar tool(args)",
      "bridge.step4": "tool.js sandboxeado",
      "bridge.list1__html": "Un publicador sirve un <code>llms.txt</code> cuya sección <code>## Skills</code> lista cada skill ejecutable con su <code>tool.js</code> y su <code>tool_sha256</code> — reflejado en <code>/.well-known/agent-skills/index.json</code> y firmado en <code>attestations.json</code>. Opcionalmente, un snapshot BM25 fijado por hash (un solo comando <code>llms-skills memory</code> sobre un bundle OKF) agrega búsqueda sin servidor sobre el conocimiento del propio sitio. Esto es exactamente lo que define la spec llms-txt-skills. Desde llms-skills 0.4.0 el bundle puede llevar además <em>vigencia firmada</em>: un revisor atesta “sigue siendo verdad”, se anula al editar y caduca en una fecha.",
      "bridge.list2__html": "mcpwasm apunta a ese origen, descarga el <code>llms.txt</code> y verifica cada <code>tool.js</code> contra su <code>tool_sha256</code> y su atestación — rechazando cualquier discrepancia <em>antes</em> de cargarlo.",
      "bridge.list3__html": "Cada skill verificada se vuelve una <strong>herramienta MCP</strong>, y su receta <code>SKILL.md</code> se sirve al lado como <strong>resource</strong> MCP (con el fallback <code>get_skill_guide</code>) — el agente recibe el manual, no solo el martillo. Claude, Cursor o cualquier host MCP la lista e invoca como cualquier otra herramienta.",
      "bridge.list4__html": "Al invocarla, mcpwasm ejecuta ese <code>tool.js</code> <strong>al pie de la letra</strong> dentro de un sandbox QuickJS-wasm — sin red ni sistema de archivos salvo las capabilities que le concede el host (un <code>fetchOrigin</code> acotado de vuelta al sitio, y búsqueda sobre el propio contenido del sitio). El resultado vuelve al cliente.",
      "bridge.takeaway__html": "Ninguna de las dos partes tiene que confiar en la prosa de la otra: mcpwasm re-deriva el hash y verifica la firma por sí mismo. Hosting estático + un runtime que verifica = un servidor MCP <strong>sin servidor que correr</strong>.",
      "bridge.template__html": "¿Querés estar del lado publicador? Arrancá de la <a href=\"https://github.com/MauricioPerera/llms-skills-template\">plantilla de GitHub</a> — un publicador funcional desde el minuto cero (bundle de conocimiento de ejemplo, skills generadas, CI de validación) que este runtime consume tal cual.",

      "ecosystem.h2": "Parte de una spec, no solo un repo",
      "ecosystem.lede__html": "mcpwasm es la implementación de referencia de dos extensiones provisionales del estándar <a href=\"https://github.com/MauricioPerera/llms-txt-skills\">llms-txt-skills</a>: <strong>Executable Skills</strong> (v0.5, con memoria de origin y scopes) y <strong>Skill Attestations</strong> (v0.4). Cada MUST de esas specs está probado en este código — spec e implementación se mantienen sincronizadas.",

      "footer.onboard": "Sumar un publisher",
      "footer.license": "Licencia MIT",
    },

    pt: {
      "common.copy": "Copiar",
      "common.copied": "Copiado",

      "meta.title": "mcpwasm — Static MCP: suas tools são arquivos, não servidores",
      "meta.description": "Um runtime isolado para tools de MCP de terceiros: publique um llms.txt + tool.js estático, execute-o verificado por hash dentro do QuickJS-wasm. Gateway, runtime local por stdio, ou biblioteca embutível.",

      "hero.h1": "Static MCP: suas tools são arquivos, não servidores.",
      "hero.lede": "Publique uma tool de MCP como um arquivo estático verificado por hash. Execute-a isolada, sob demanda, com zero infraestrutura — o que a hospedagem estática fez aos servidores web: não rode Apache, publique HTML.",
      "hero.ctaTry": "Experimente agora",
      "hero.ctaGithub": "Ver no GitHub",

      "problem.h2": "Rodar o código de uma tool de terceiros é uma decisão de confiança",
      "problem.lede": "Clientes MCP como Claude ou Cursor podem chamar tools arbitrárias de terceiros. Executar esse código direto no seu backend significa que ele pode ler seus segredos, acessar seu banco de dados, ligar para casa, ou entrar em loop infinito. Ou você confia totalmente no autor, ou não roda a tool.",
      "problem.typicalH3": "Servidor MCP típico",
      "problem.typicalLi1": "Alguém precisa rodar um processo, 24/7",
      "problem.typicalLi2": "O código de terceiros compartilha seu runtime",
      "problem.typicalLi3": "Confie no autor, ou não instale",
      "problem.mcpwasmLi1": "A tool é um arquivo. Nenhum processo para rodar.",
      "problem.mcpwasmLi2": "O código executa isolado no QuickJS-wasm",
      "problem.mcpwasmLi3": "Fixado por SHA-256; um byte alterado a exclui",

      "how.h2": "Como funciona",
      "how.lede": "Cinco passos, todos isolados, sem estado entre requisições.",
      "how.svgTitle": "Um site publisher publica llms.txt e tool.js; o gateway busca e verifica por SHA-256, carrega a tool em um sandbox QuickJS-wasm, o sandbox chama host.fetchOrigin de volta ao publisher, e o cliente MCP recebe uma resposta JSON-RPC.",
      "how.boxPublisherSub1": "estático: R2 / Pages / qualquer host",
      "how.boxPublisherSub2": "serve /llms.txt + tool.js",
      "how.boxGatewaySub1": "descobre → verifica sha256",
      "how.boxGatewaySub2": "carrega no sandbox",
      "how.boxClientSub1": "Claude, Cursor, ...",
      "how.boxClientSub2": "POST /mcp (JSON-RPC 2.0)",
      "how.boxSandboxSub": "QuickJS-wasm, por skill",
      "how.step1": "publicar",
      "how.step2": "verificar sha256",
      "how.step3": "carregar",
      "how.list1__html": "Um site publisher publica <code>/llms.txt</code> mais <code>tool.js</code> e <code>SKILL.md</code> por skill.",
      "how.list2__html": "O gateway baixa o <code>llms.txt</code>, busca cada <code>tool.js</code>, e verifica seu SHA-256.",
      "how.list3__html": "As tools verificadas carregam em um contexto QuickJS-wasm novo, um por skill.",
      "how.list4__html": "O código da tool chama <code>host.fetchOrigin</code> — restrito apenas à origin do publisher; qualquer outra origin lança uma exceção dentro do sandbox.",
      "how.list5__html": "O gateway mapeia <code>tools/list</code> / <code>tools/call</code> do MCP sobre JSON-RPC 2.0 de volta ao cliente.",

      "ways.h2": "Quatro formas de usar hoje",
      "ways.lede": "As quatro são reais, estão em produção e testadas — não é roadmap.",
      "ways.gatewayTag": "servidor MCP pronto para uso",
      "ways.gatewayP": "Aponte qualquer cliente MCP para o gateway em produção. Ele descobre, verifica, e isola as skills de um publisher a cada requisição.",
      "ways.localTag": "zero infra, dos dois lados",
      "ways.localP": "Rode as skills de qualquer origin localmente via stdio — incluindo a memória de origin (busca BM25 verificada, 0.4.0), a receita SKILL.md de cada skill servida como resource MCP (0.5.0) e origins multi-projeto via scopes: kdd__search_knowledge com memória por scope (novo na 0.6.0). Sem gateway, sem servidor, em nenhum dos lados.",
      "ways.browserTag": "nem Node",
      "ways.browserP": "O runtime completo numa aba do navegador (novo na 0.7.0): descoberta, verificação SHA-256 byte a byte, um sandbox QuickJS-wasm por tool, scopes e memória por scope. O publicador só precisa de CORS — o GitHub Pages já o envia. Sem servidor do lado dele, sem Node do seu.",
      "ways.browserDemo": "Abrir a demo ao vivo",
      "ways.browserAgent": "Demo do agente full-stack",
      "compare.h2": "Onde isso se encaixa: quatro formas de um agente usar uma tool de terceiros",
      "compare.lede": "A mesma pergunta de fundo — \"um agente pode rodar com segurança o código da tool de outra pessoa?\" — quatro respostas diferentes.",
      "compare.mcpH3": "Servidor MCP tradicional",
      "compare.mcpLi1": "Cliente: instalar e configurar um cliente MCP completo",
      "compare.mcpLi2": "Isolamento: o código da tool roda com todos os privilégios do servidor",
      "compare.mcpLi3": "Integridade: nenhuma — você confia cegamente na resposta do servidor",
      "compare.mcpLi4__html": "Descoberta: um RPC <code>tools/list</code> separado, antes de qualquer chamada",
      "compare.mcpLi5": "Para publicar: um processo vivo, rodando 24/7, em algum lugar",
      "compare.webmcpTag": "na página, sem sandbox",
      "compare.webmcpLi1": "Cliente: nenhum — uma API do navegador ou o bridge próprio da página",
      "compare.webmcpLi2": "Isolamento: nenhum — roda na página com todos os seus privilégios",
      "compare.webmcpLi3": "Integridade: nenhuma — você confia no que a página servir naquele momento",
      "compare.webmcpLi4": "Descoberta: as tools se registram como efeito colateral do carregamento da página",
      "compare.webmcpLi5": "Para publicar: o que hospedar sua página — pode ser 100% estático",
      "compare.withClientTag": "npx, sem configurar",
      "compare.withClientLi1__html": "Cliente: <code>npx @rckflr/mcpwasm &lt;origin&gt;</code> — um comando",
      "compare.withClientLi2__html": "Isolamento: sandbox QuickJS-wasm, só sai por <code>host.fetchOrigin</code> restrito",
      "compare.withClientLi3": "Integridade: SHA-256 fixado no llms.txt, verificado antes de rodar",
      "compare.withClientLi4": "Descoberta: rodar o arquivo verificado registra suas tools",
      "compare.withClientLi5": "Para publicar: 100% estático — o cliente faz o trabalho",
      "compare.noClientTag": "sem cliente nenhum",
      "compare.noClientLi1__html": "Cliente: nenhum — <code>connectStaticSkills()</code> roda no seu próprio processo",
      "compare.noClientLi2": "Isolamento: mesmo sandbox, mesma verificação, zero processo extra",
      "compare.noClientLi3": "Integridade: mesmo hash SHA-256, verificado no seu próprio runtime",
      "compare.noClientLi4": "Descoberta: mesmo mecanismo — mas nada empurra um agente a procurar",
      "compare.noClientLi5": "Para publicar: hospedagem estática + CORS — GitHub Pages basta",
      "compare.caseH3": "Verificado ao vivo, não só afirmado",
      "compare.caseP__html": "<a href=\"https://mauricioperera.github.io/mcpwasm-pages-test/\">margin-demo</a> é uma skill sem cliente (<code>create_document</code> / <code>decode_document</code>) hospedada em GitHub Pages puro — sem backend nenhum. Recebendo só a URL, um agente sem modificação (Codex) tratou como uma página comum e nunca encontrou as tools sozinho. Adicionar três camadas explícitas de descoberta — uma nota visível \"para agentes\", um <code>agent-setup/prompt.md</code> (o mesmo padrão que <a href=\"https://developers.cloudflare.com/agent-setup/prompt.md\">a Cloudflare usa</a>), e um botão de um clique \"copiar prompt para agente\" — fechou a lacuna: o mesmo agente encontrou e usou as tools de primeira, incluindo um ciclo completo de leitura-modificação-escrita (<code>decode_document</code> → editar → <code>create_document</code>) a partir de um único prompt copiado. <strong>A descoberta, em qualquer uma das quatro abordagens acima, não é automática — precisa ser projetada.</strong>",
      "compare.caseCta": "Ler a análise completa",

      "tabagent.h2": "Todo o stack, como um agente pessoal",
      "tabagent.lede__html": "<a href=\"https://github.com/MauricioPerera/tab-agent\">tab-agent</a> é um agente pessoal que é apenas arquivos estáticos + seu navegador: <strong>memória</strong> compartilhada (o commons cq-git via API do GitHub), <strong>tools verificadas</strong> (este runtime, fixadas por hash e em sandbox) e um <strong>modelo que é seu</strong> — a credencial do provedor nunca é exposta (rode na aba via WebGPU, seu endpoint, ou um proxy de operador). Responde ao problema de supply-chain dos agentes pessoais invertendo-o: as tools são verificadas, não escaneadas.",
      "tabagent.cta": "Abrir tab-agent",
      "ways.libraryTag": "embuta o sandbox",
      "ways.libraryP": "Construa seu próprio host de plataforma com o mesmo isolamento que o gateway usa.",

      "trust.h2": "Quatro anéis de confiança",
      "trust.lede__html": "Nenhum deles sozinho é suficiente. Juntos, limitam o que uma skill publicada pode afirmar — os mesmos quatro anéis que <a href=\"https://mauricioperera.github.io/static-agent-web/\">todo o ecossistema</a> usa, para qualquer runtime que implemente a spec.",
      "trust.card1H3": "Integridade",
      "trust.card1P__html": "Cada <code>tool.js</code> é fixado por SHA-256 no <code>llms.txt</code>. Um único byte alterado e a skill é excluída — não degradada, não executada.",
      "trust.card2H3": "Autenticidade",
      "trust.card2P__html": "Revisão humana assinada — chaves Ed25519 pré-registradas ou identidades <strong>Sigstore</strong> keyless (o padrão recomendado pela spec desde a v0.4). <strong>Honesto hoje:</strong> um único revisor registrado. O mecanismo escala; a rede de revisores ainda não.",
      "trust.card3H3": "Vigência",
      "trust.card3P__html": "Uma atestação não é um selo único: ela tem uma janela de validade e se anula sozinha no momento em que o arquivo atestado muda — \"continua verdadeiro\" tem prazo de validade, não é um selo permanente.",
      "trust.card4H3": "Estabilidade",
      "trust.card4P__html": "Um lockfile do consumidor (<a href=\"https://github.com/MauricioPerera/mcpwasm#consumer-lockfile---lock--what-if-the-publisher-is-the-attacker\"><code>--lock</code></a>) fixa o hash de cada skill no primeiro uso — uma mudança posterior é rejeitada em voz alta, não aplicada em silêncio, mesmo que seja a própria conta do publicador que mudou. Runtime local hoje; gateway e browser ainda não suportam.",
      "trust.runtimeNote__html": "Esses quatro anéis descrevem a <strong>skill publicada em si</strong> — verificável por qualquer runtime que implemente a spec, independente de quem a executa. O mcpwasm adiciona mais uma camada quando de fato <strong>executa</strong> uma skill verificada: cada uma roda isolada em seu próprio contexto QuickJS-wasm — sem <code>fetch</code>, sem <code>process</code>, sem disco, só um <code>host.fetchOrigin</code> explícito e restrito à origin.",

      "benchmark.h2": "Quanto custa",
      "benchmark.lede": "Números reais do gateway em produção, não estimativas sintéticas.",
      "benchmark.stat1Label": "overhead do sandbox, aquecido",
      "benchmark.stat1Sub": "55ms isolado vs 53ms ping direto",
      "benchmark.stat2Label": "overhead do gateway completo",
      "benchmark.stat2Sub": "96ms via gateway vs 90ms API direta",
      "benchmark.stat3Label": "p95, 10 requisições concorrentes",
      "benchmark.stat3Sub": "antes → depois do pool de instâncias + pré-aquecimento",
      "benchmark.stat4Label": "miss de descoberta a frio",
      "benchmark.stat4Sub": "faixa ~210–400ms, compilar + sha256 + fetch",
      "benchmark.disclaimer__html": "Benchmark de um único cliente do México até o edge do Cloudflare Workers — é latência de um observador, <strong>não é um teste de carga</strong>. A matriz completa, a metodologia, e os dados brutos estão em <a href=\"https://github.com/MauricioPerera/mcpwasm/blob/main/BENCHMARK.md\">BENCHMARK.md</a>.",

      "quickstart.h2": "Experimente agora",
      "quickstart.sub1": "Rode as skills de qualquer origin localmente, sem gateway",
      "quickstart.sub2": "Configuração do cliente MCP",
      "quickstart.sub3": "Ou chame direto o gateway de demonstração ao vivo",
      "quickstart.disclaimer__html": "O gateway em produção exige um bearer token (não publicado aqui). O passo a passo completo com curl — incluindo o demo aberto, o bookstore, e os publishers de docs — está no <a href=\"https://github.com/MauricioPerera/mcpwasm#readme\">README</a>.",

      "bridge.h2": "De um site estático a um servidor MCP ativo",
      "bridge.lede__html": "<a href=\"https://github.com/MauricioPerera/llms-txt-skills\">llms-txt-skills</a> é o <strong>formato</strong>; <a href=\"https://github.com/MauricioPerera/mcpwasm\">mcpwasm</a> é um <strong>runtime</strong> para ele. Um publicador serve uma vez suas skills fixadas por hash e atestadas, da forma padrão — o runtime as descobre, verifica e executa cada uma como uma ferramenta MCP. Todo o contrato entre os dois é um <code>tool_sha256</code> e sua atestação.",
      "bridge.svgTitle": "Um site publicador estático serve skills de llms.txt e tool.js; o mcpwasm os baixa e verifica, e então expõe cada um como uma ferramenta MCP que um cliente pode chamar, executando o tool.js isolado.",
      "bridge.boxSiteTitle": "Site estático",
      "bridge.boxSiteSub1": "llms.txt · ## Skills · tool.js",
      "bridge.boxSiteSub2": "index.json · attestations.json",
      "bridge.boxRuntimeTitle": "runtime mcpwasm",
      "bridge.boxRuntimeSub1": "gateway (Workers) ou npx local",
      "bridge.boxRuntimeSub2": "verificar + sandbox QuickJS",
      "bridge.boxClientTitle": "Cliente MCP",
      "bridge.boxClientSub1": "Claude, Cursor, qualquer host MCP",
      "bridge.boxClientSub2": "lista e chama as ferramentas",
      "bridge.step1": "baixar + verificar",
      "bridge.step2": "expor como ferramentas MCP",
      "bridge.step3": "chamar tool(args)",
      "bridge.step4": "tool.js isolado",
      "bridge.list1__html": "Um publicador serve um <code>llms.txt</code> cuja seção <code>## Skills</code> lista cada skill executável com seu <code>tool.js</code> e seu <code>tool_sha256</code> — espelhado em <code>/.well-known/agent-skills/index.json</code> e assinado em <code>attestations.json</code>. Opcionalmente, um snapshot BM25 fixado por hash (um único comando <code>llms-skills memory</code> sobre um bundle OKF) adiciona busca sem servidor sobre o conhecimento do próprio site. É exatamente o que a spec llms-txt-skills define. Desde o llms-skills 0.4.0 o bundle também pode carregar <em>vigência assinada</em>: um revisor atesta “continua verdadeiro”, anulada ao editar e expirando numa data.",
      "bridge.list2__html": "mcpwasm aponta para essa origem, baixa o <code>llms.txt</code> e verifica cada <code>tool.js</code> contra seu <code>tool_sha256</code> e sua atestação — rejeitando qualquer divergência <em>antes</em> de carregá-lo.",
      "bridge.list3__html": "Cada skill verificada vira uma <strong>ferramenta MCP</strong>, e sua receita <code>SKILL.md</code> é servida ao lado como <strong>resource</strong> MCP (com o fallback <code>get_skill_guide</code>) — o agente recebe o manual, não só o martelo. Claude, Cursor ou qualquer host MCP a lista e chama como qualquer outra ferramenta.",
      "bridge.list4__html": "Ao chamá-la, mcpwasm executa esse <code>tool.js</code> <strong>ao pé da letra</strong> dentro de um sandbox QuickJS-wasm — sem rede nem sistema de arquivos exceto as capabilities que o host concede (um <code>fetchOrigin</code> restrito de volta ao site, e busca sobre o próprio conteúdo do site). O resultado volta ao cliente.",
      "bridge.takeaway__html": "Nenhum dos lados precisa confiar na prosa do outro: mcpwasm re-deriva o hash e verifica a assinatura por conta própria. Hospedagem estática + um runtime que verifica = um servidor MCP <strong>sem servidor para rodar</strong>.",
      "bridge.template__html": "Quer estar do lado publicador? Comece pelo <a href=\"https://github.com/MauricioPerera/llms-skills-template\">template do GitHub</a> — um publicador funcional desde o primeiro minuto (bundle de conhecimento de exemplo, skills geradas, CI de validação) que este runtime consome como está.",

      "ecosystem.h2": "Parte de uma spec, não só um repositório",
      "ecosystem.lede__html": "mcpwasm é a implementação de referência de duas extensões provisórias do padrão <a href=\"https://github.com/MauricioPerera/llms-txt-skills\">llms-txt-skills</a>: <strong>Executable Skills</strong> (v0.5, com memória de origin e scopes) e <strong>Skill Attestations</strong> (v0.4). Todo MUST dessas specs é testado neste código — spec e implementação se mantêm sincronizadas.",

      "footer.onboard": "Cadastrar um publisher",
      "footer.license": "Licença MIT",
    },
  };

  var SUPPORTED = ["en", "es", "pt"];
  var STORAGE_KEY = "mcpwasm-lang";

  function detectLang() {
    try {
      var saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved && SUPPORTED.indexOf(saved) !== -1) return saved;
    } catch {
      // localStorage unavailable (private mode, disabled): fall through to browser detection.
    }
    var langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "en"];
    for (var i = 0; i < langs.length; i++) {
      var prefix = String(langs[i]).slice(0, 2).toLowerCase();
      if (SUPPORTED.indexOf(prefix) !== -1) return prefix;
    }
    return "en";
  }

  function t(lang, key) {
    var dict = TRANSLATIONS[lang] || TRANSLATIONS.en;
    return Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : TRANSLATIONS.en[key];
  }

  // Aplica el idioma: recorre [data-i18n], setea textContent o innerHTML segun
  // el sufijo "__html" de la key (ese sufijo NUNCA se muestra: solo decide el
  // metodo de asignacion). Actualiza tambien <html lang>, document.title, y
  // meta[name=description].
  function applyLang(lang) {
    document.documentElement.setAttribute("lang", lang);
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      var isHtml = key.slice(-6) === "__html";
      var value = t(lang, key);
      if (value === undefined) return;
      if (isHtml) el.innerHTML = value;
      else el.textContent = value;
    });
    var titleText = t(lang, "meta.title");
    if (titleText) document.title = titleText;
    var descEl = document.querySelector('meta[name="description"]');
    var descText = t(lang, "meta.description");
    if (descEl && descText) descEl.setAttribute("content", descText);
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // best-effort: switching still works within this page load without storage.
    }
  }

  // Construye el selector de idioma (fixed, esquina superior derecha) y lo
  // inyecta via JS: si este script no corre, no aparece ningun control
  // no-funcional en el no-JS baseline.
  function buildSwitcher(current) {
    var wrap = document.createElement("div");
    wrap.className = "lang-switch";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Language");
    SUPPORTED.forEach(function (code) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = code.toUpperCase();
      btn.setAttribute("aria-pressed", String(code === current));
      if (code === current) btn.classList.add("is-active");
      btn.addEventListener("click", function () {
        applyLang(code);
        wrap.querySelectorAll("button").forEach(function (b) {
          var active = b === btn;
          b.classList.toggle("is-active", active);
          b.setAttribute("aria-pressed", String(active));
        });
      });
      wrap.appendChild(btn);
    });
    document.body.appendChild(wrap);
  }

  function init() {
    var lang = detectLang();
    applyLang(lang);
    buildSwitcher(lang);
  }

  window.MCPWASM_I18N = { init: init, t: t, applyLang: applyLang, detectLang: detectLang };
})();
