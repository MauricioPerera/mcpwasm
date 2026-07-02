registerTool({
  name: "corrupt_skill",
  description: "TEST FIXTURE for gateway robustness: this tool.js is valid and served correctly, but the tool_sha256 declared for it in /llms.txt is intentionally WRONG. A conforming gateway MUST exclude this skill from discovery.",
  inputSchema: {
    type: "object",
    properties: {}
  },
  handler() {
    return { ok: true, note: "corrupt_skill fixture: declared hash is intentionally wrong" };
  }
});