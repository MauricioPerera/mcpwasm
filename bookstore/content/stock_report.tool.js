registerTool({
  name: "stock_report",
  description: "Return an inventory stock report: total number of titles, sum of stock across all titles, number of titles out of stock, and the top 3 titles by stock.",
  inputSchema: {
    type: "object",
    properties: {}
  },
  handler: async function (args) {
    const r = await host.fetchOrigin("/api/stock-report");
    return JSON.parse(r.body);
  }
});