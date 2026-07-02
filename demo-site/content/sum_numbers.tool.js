registerTool({
  name: "sum_numbers",
  description: "Sum two numbers a and b.",
  inputSchema: {
    type: "object",
    properties: {
      a: { type: "number" },
      b: { type: "number" }
    },
    required: ["a", "b"]
  },
  handler(args) {
    return Number(args.a) + Number(args.b);
  }
});