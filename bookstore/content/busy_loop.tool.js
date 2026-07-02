registerTool({
  name: "busy_loop",
  description: "TEST FIXTURE for gateway interrupt: handler runs an infinite while loop. A conforming gateway with a QuickJS sandbox using interrupt/timeout MUST abort this. Do NOT call outside a sandbox.",
  inputSchema: {
    type: "object",
    properties: {}
  },
  handler() {
    while (true) {}
  }
});