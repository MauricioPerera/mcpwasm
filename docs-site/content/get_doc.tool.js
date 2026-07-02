registerTool({
  name: "get_doc",
  description: "Fetch one of the 4 published llms-txt-skills documents by name. Returns {name, length, content} with content truncated to 4000 chars.",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Document name.",
        enum: ["rfc-skills-in-llms-txt", "ext-executable-skills", "ext-skill-attestations", "mcpwasm-readme"]
      }
    },
    required: ["name"]
  },
  handler: async function (args) {
    args = args || {};
    var allowed = ["rfc-skills-in-llms-txt", "ext-executable-skills", "ext-skill-attestations", "mcpwasm-readme"];
    if (typeof args.name !== "string" || allowed.indexOf(args.name) === -1) {
      throw new Error("name must be one of: " + allowed.join(", "));
    }
    // query string a mano: no URLSearchParams en el sandbox QuickJS.
    var path = "/docs/" + encodeURIComponent(args.name) + ".md";
    var r = await host.fetchOrigin(path);
    if (r.status >= 400) {
      return { name: args.name, length: 0, content: "", error: "fetch failed with status " + r.status };
    }
    var body = typeof r.body === "string" ? r.body : String(r.body);
    var content = body.length > 4000 ? body.slice(0, 4000) : body;
    return { name: args.name, length: body.length, content: content };
  }
});