// AUTOGENERADO por build.mjs. No editar a mano.
const SUM_TOOL_JS = "registerTool({\n  name: \"sum_numbers\",\n  description: \"Sum two numbers a and b.\",\n  inputSchema: {\n    type: \"object\",\n    properties: {\n      a: { type: \"number\" },\n      b: { type: \"number\" }\n    },\n    required: [\"a\", \"b\"]\n  },\n  handler(args) {\n    return Number(args.a) + Number(args.b);\n  }\n});";
const SERVER_TOOL_JS = "registerTool({\n  name: \"server_time\",\n  description: \"Return the current server time.\",\n  inputSchema: {\n    type: \"object\",\n    properties: {}\n  },\n  handler: async function (args) {\n    const r = await host.fetchOrigin(\"/api/time\");\n    return JSON.parse(r.body);\n  }\n});";
const SUM_SKILL_MD = "---\nname: sum_numbers\nversion: 1.0.0\nlicense: MIT\n---\n\n# sum_numbers\n\nSuma dos números `a` y `b` y devuelve el resultado. Es una skill ejecutable pura:\nel handler es sincrónico y no llama al host.\n\n## Uso\n\n```json\n{ \"a\": 2, \"b\": 3 }\n```\n\nDevuelve `5`.";
const SERVER_SKILL_MD = "---\nname: server_time\nversion: 1.0.0\nlicense: MIT\n---\n\n# server_time\n\nDevuelve la hora actual del servidor consultando `/api/time` vía\n`host.fetchOrigin`. Es una skill ejecutable async: el handler es `async` y\nparsea el JSON devuelto por el origin.\n\n## Respuesta\n\n```json\n{ \"now\": \"2026-07-02T12:00:00.000Z\", \"epoch\": 1788254400000 }\n```";
const LLMS_TXT = "# llms-txt-skills demo site\n\n> Demo site publishing executable skills per the llms-txt-skills standard with a provisional extension for executable skills.\n\n## Skills\n\n- [sum_numbers](/skills/sum_numbers/SKILL.md): Sum two numbers a and b. <!-- skill: {\"version\":\"1.0.0\",\"tool\":\"/skills/sum_numbers/tool.js\",\"tool_sha256\":\"58daf86111bf7278446eb7e0e8c6384713b50cdb6fa97ac039e23846d723dc3e\"} -->\n- [server_time](/skills/server_time/SKILL.md): Return the current server time. <!-- skill: {\"version\":\"1.0.0\",\"tool\":\"/skills/server_time/tool.js\",\"tool_sha256\":\"5b9255eca41a95cc0cf38322dc973062133e1ce1e757da8cab8fdeb16ec934f5\"} -->\n";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/llms.txt") {
      return new Response(LLMS_TXT, { headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    if (path === "/api/time") {
      const now = new Date();
      const body = JSON.stringify({ now: now.toISOString(), epoch: now.getTime() });
      return new Response(body, { headers: { "content-type": "application/json; charset=utf-8" } });
    }
    if (path === "/skills/sum_numbers/SKILL.md") {
      return new Response(SUM_SKILL_MD, { headers: { "content-type": "text/markdown; charset=utf-8" } });
    }
    if (path === "/skills/server_time/SKILL.md") {
      return new Response(SERVER_SKILL_MD, { headers: { "content-type": "text/markdown; charset=utf-8" } });
    }
    if (path === "/skills/sum_numbers/tool.js") {
      return new Response(SUM_TOOL_JS, { headers: { "content-type": "application/javascript; charset=utf-8" } });
    }
    if (path === "/skills/server_time/tool.js") {
      return new Response(SERVER_TOOL_JS, { headers: { "content-type": "application/javascript; charset=utf-8" } });
    }
    return new Response("Not Found", { status: 404 });
  }
};
