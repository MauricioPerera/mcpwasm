registerTool({
  name: "server_time",
  description: "Return the current server time.",
  inputSchema: {
    type: "object",
    properties: {}
  },
  handler: async function (args) {
    const r = await host.fetchOrigin("/api/time");
    return JSON.parse(r.body);
  }
});