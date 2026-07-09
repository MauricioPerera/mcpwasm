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

      "ways.h2": "Three ways to use it today",
      "ways.lede": "All three are real, deployed, and tested — not roadmap.",
      "ways.gatewayTag": "turnkey MCP server",
      "ways.gatewayP": "Point any MCP client at the deployed gateway. It discovers, verifies, and sandboxes a publisher's skills on every request.",
      "ways.localTag": "zero infra, both sides",
      "ways.localP": "Run any origin's skills locally over stdio. No gateway, no server, on either end.",
      "ways.libraryTag": "embed the sandbox",
      "ways.libraryP": "Build your own platform host with the exact isolation the gateway uses.",

      "trust.h2": "Three rings of trust",
      "trust.lede": "None of them alone is enough. Together, they bound what a third-party tool can do — and who vouches for it.",
      "trust.card1H3": "Content integrity",
      "trust.card1P__html": "Every <code>tool.js</code> is pinned by SHA-256 in <code>llms.txt</code>. A single flipped byte and the skill is excluded — not degraded, not executed.",
      "trust.card2H3": "Sandbox isolation",
      "trust.card2P__html": "Each skill runs in its own QuickJS-wasm context: no <code>fetch</code>, no <code>process</code>, no disk. The only bridge out is an explicit, origin-scoped <code>host.fetchOrigin</code>.",
      "trust.card3H3": "Signed attestations",
      "trust.card3P__html": "Ed25519-signed human review with an expiry window. <strong>Honest today:</strong> one registered reviewer. The mechanism scales; the reviewer network hasn't yet.",

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
      "bridge.list1__html": "A publisher serves an <code>llms.txt</code> whose <code>## Skills</code> section lists each executable skill with its <code>tool.js</code> and <code>tool_sha256</code> — mirrored in <code>/.well-known/agent-skills/index.json</code> and signed in <code>attestations.json</code>. This is exactly what the llms-txt-skills spec defines.",
      "bridge.list2__html": "mcpwasm points at that origin, fetches the <code>llms.txt</code>, and verifies every <code>tool.js</code> against its <code>tool_sha256</code> and its attestation — rejecting any mismatch <em>before</em> loading it.",
      "bridge.list3__html": "Each verified skill becomes an <strong>MCP tool</strong>. Your MCP client — Claude, Cursor, any host — lists and calls it like any other tool.",
      "bridge.list4__html": "On a call, mcpwasm executes that <code>tool.js</code> <strong>verbatim</strong> inside a QuickJS-wasm sandbox — no network or filesystem except the host capabilities it grants (a scoped <code>fetchOrigin</code> back to the site, and search over the site's own content). The result returns to the client.",
      "bridge.takeaway__html": "Neither side has to trust the other's prose: mcpwasm re-derives the hash and checks the signature itself. Static hosting + a verifying runtime = an MCP server with <strong>no server to run</strong>.",

      "ecosystem.h2": "Part of a spec, not just a repo",
      "ecosystem.lede__html": "mcpwasm is the reference implementation of two provisional extensions to the <a href=\"https://github.com/MauricioPerera/llms-txt-skills\">llms-txt-skills</a> standard: <strong>Executable Skills</strong> (v0.4, with origin memory) and <strong>Skill Attestations</strong> (v0.3). Every MUST in those specs is field-tested in this code — spec and implementation are kept in sync.",

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

      "ways.h2": "Tres formas de usarlo hoy",
      "ways.lede": "Las tres son reales, están desplegadas y probadas — no es roadmap.",
      "ways.gatewayTag": "servidor MCP listo para usar",
      "ways.gatewayP": "Apuntá cualquier cliente MCP al gateway desplegado. Descubre, verifica, y sandboxea las skills de un publisher en cada request.",
      "ways.localTag": "cero infra, en ambos lados",
      "ways.localP": "Corré las skills de cualquier origin localmente por stdio. Sin gateway, sin servidor, en ningún lado.",
      "ways.libraryTag": "embebé el sandbox",
      "ways.libraryP": "Construí tu propio host de plataforma con el mismo aislamiento que usa el gateway.",

      "trust.h2": "Tres anillos de confianza",
      "trust.lede": "Ninguno alcanza solo. Juntos, acotan lo que una tool de terceros puede hacer — y quién responde por ella.",
      "trust.card1H3": "Integridad de contenido",
      "trust.card1P__html": "Cada <code>tool.js</code> queda fijado por SHA-256 en <code>llms.txt</code>. Un solo byte alterado y la skill queda excluida — no degradada, no ejecutada.",
      "trust.card2H3": "Aislamiento del sandbox",
      "trust.card2P__html": "Cada skill corre en su propio contexto QuickJS-wasm: sin <code>fetch</code>, sin <code>process</code>, sin disco. El único puente hacia afuera es un <code>host.fetchOrigin</code> explícito, restringido al origin.",
      "trust.card3H3": "Atestaciones firmadas",
      "trust.card3P__html": "Revisión humana firmada con Ed25519, con ventana de vencimiento. <strong>Honesto hoy:</strong> un solo revisor registrado. El mecanismo escala; la red de revisores todavía no.",

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
      "bridge.list1__html": "Un publicador sirve un <code>llms.txt</code> cuya sección <code>## Skills</code> lista cada skill ejecutable con su <code>tool.js</code> y su <code>tool_sha256</code> — reflejado en <code>/.well-known/agent-skills/index.json</code> y firmado en <code>attestations.json</code>. Esto es exactamente lo que define la spec llms-txt-skills.",
      "bridge.list2__html": "mcpwasm apunta a ese origen, descarga el <code>llms.txt</code> y verifica cada <code>tool.js</code> contra su <code>tool_sha256</code> y su atestación — rechazando cualquier discrepancia <em>antes</em> de cargarlo.",
      "bridge.list3__html": "Cada skill verificada se vuelve una <strong>herramienta MCP</strong>. Tu cliente MCP — Claude, Cursor, cualquier host — la lista e invoca como cualquier otra herramienta.",
      "bridge.list4__html": "Al invocarla, mcpwasm ejecuta ese <code>tool.js</code> <strong>al pie de la letra</strong> dentro de un sandbox QuickJS-wasm — sin red ni sistema de archivos salvo las capabilities que le concede el host (un <code>fetchOrigin</code> acotado de vuelta al sitio, y búsqueda sobre el propio contenido del sitio). El resultado vuelve al cliente.",
      "bridge.takeaway__html": "Ninguna de las dos partes tiene que confiar en la prosa de la otra: mcpwasm re-deriva el hash y verifica la firma por sí mismo. Hosting estático + un runtime que verifica = un servidor MCP <strong>sin servidor que correr</strong>.",

      "ecosystem.h2": "Parte de una spec, no solo un repo",
      "ecosystem.lede__html": "mcpwasm es la implementación de referencia de dos extensiones provisionales del estándar <a href=\"https://github.com/MauricioPerera/llms-txt-skills\">llms-txt-skills</a>: <strong>Executable Skills</strong> (v0.4, con memoria de origin) y <strong>Skill Attestations</strong> (v0.3). Cada MUST de esas specs está probado en este código — spec e implementación se mantienen sincronizadas.",

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

      "ways.h2": "Três formas de usar hoje",
      "ways.lede": "As três são reais, estão em produção e testadas — não é roadmap.",
      "ways.gatewayTag": "servidor MCP pronto para uso",
      "ways.gatewayP": "Aponte qualquer cliente MCP para o gateway em produção. Ele descobre, verifica, e isola as skills de um publisher a cada requisição.",
      "ways.localTag": "zero infra, dos dois lados",
      "ways.localP": "Rode as skills de qualquer origin localmente via stdio. Sem gateway, sem servidor, em nenhum dos lados.",
      "ways.libraryTag": "embuta o sandbox",
      "ways.libraryP": "Construa seu próprio host de plataforma com o mesmo isolamento que o gateway usa.",

      "trust.h2": "Três anéis de confiança",
      "trust.lede": "Nenhum deles sozinho é suficiente. Juntos, limitam o que uma tool de terceiros pode fazer — e quem responde por ela.",
      "trust.card1H3": "Integridade de conteúdo",
      "trust.card1P__html": "Cada <code>tool.js</code> é fixado por SHA-256 no <code>llms.txt</code>. Um único byte alterado e a skill é excluída — não degradada, não executada.",
      "trust.card2H3": "Isolamento do sandbox",
      "trust.card2P__html": "Cada skill roda em seu próprio contexto QuickJS-wasm: sem <code>fetch</code>, sem <code>process</code>, sem disco. A única ponte para fora é um <code>host.fetchOrigin</code> explícito, restrito à origin.",
      "trust.card3H3": "Atestações assinadas",
      "trust.card3P__html": "Revisão humana assinada com Ed25519, com janela de validade. <strong>Honesto hoje:</strong> um único revisor registrado. O mecanismo escala; a rede de revisores ainda não.",

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
      "bridge.list1__html": "Um publicador serve um <code>llms.txt</code> cuja seção <code>## Skills</code> lista cada skill executável com seu <code>tool.js</code> e seu <code>tool_sha256</code> — espelhado em <code>/.well-known/agent-skills/index.json</code> e assinado em <code>attestations.json</code>. É exatamente o que a spec llms-txt-skills define.",
      "bridge.list2__html": "mcpwasm aponta para essa origem, baixa o <code>llms.txt</code> e verifica cada <code>tool.js</code> contra seu <code>tool_sha256</code> e sua atestação — rejeitando qualquer divergência <em>antes</em> de carregá-lo.",
      "bridge.list3__html": "Cada skill verificada vira uma <strong>ferramenta MCP</strong>. Seu cliente MCP — Claude, Cursor, qualquer host — a lista e chama como qualquer outra ferramenta.",
      "bridge.list4__html": "Ao chamá-la, mcpwasm executa esse <code>tool.js</code> <strong>ao pé da letra</strong> dentro de um sandbox QuickJS-wasm — sem rede nem sistema de arquivos exceto as capabilities que o host concede (um <code>fetchOrigin</code> restrito de volta ao site, e busca sobre o próprio conteúdo do site). O resultado volta ao cliente.",
      "bridge.takeaway__html": "Nenhum dos lados precisa confiar na prosa do outro: mcpwasm re-deriva o hash e verifica a assinatura por conta própria. Hospedagem estática + um runtime que verifica = um servidor MCP <strong>sem servidor para rodar</strong>.",

      "ecosystem.h2": "Parte de uma spec, não só um repositório",
      "ecosystem.lede__html": "mcpwasm é a implementação de referência de duas extensões provisórias do padrão <a href=\"https://github.com/MauricioPerera/llms-txt-skills\">llms-txt-skills</a>: <strong>Executable Skills</strong> (v0.4, com memória de origin) e <strong>Skill Attestations</strong> (v0.3). Todo MUST dessas specs é testado neste código — spec e implementação se mantêm sincronizadas.",

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
