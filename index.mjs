// index.mjs — superficie publica del paquete @rckflr/mcpwasm.
// Re-exporta el host embebible (sync y async), los nucleos MCP JSON-RPC 2.0 y
// el parser de skills ejecutables de llms.txt. Los workers de este repo
// (worker*.mjs) NO forman parte del paquete: son la implementacion de
// referencia desplegada; el paquete es lo que un dueño de plataforma embebe.
export { ToolHost } from "./host.mjs";
export { AsyncToolHost } from "./host-async.mjs";
export { handleMcpMessage } from "./mcp-core.mjs";
export { handleMcpMessageAsync } from "./mcp-core-async.mjs";
export { parseLlmsTxt } from "./llmstxt-parse.mjs";
