registerTool({
  name: "list_docs",
  description: "List the 4 published llms-txt-skills documents with title and path. Static, no network fetch.",
  inputSchema: {
    type: "object",
    properties: {}
  },
  handler: async function (args) {
    return {
      docs: [
        { name: "rfc-skills-in-llms-txt", title: "RFC: Publishing Agent Skills through llms.txt", path: "/docs/rfc-skills-in-llms-txt.md" },
        { name: "ext-executable-skills", title: "Extension: Executable Skills", path: "/docs/ext-executable-skills.md" },
        { name: "ext-skill-attestations", title: "Extension: Skill Attestations", path: "/docs/ext-skill-attestations.md" },
        { name: "mcpwasm-readme", title: "mcpwasm — Static MCP (reference implementation README)", path: "/docs/mcpwasm-readme.md" }
      ]
    };
  }
});