// mcp-core.mjs
// Nucleo MCP JSON-RPC 2.0, agnostico del transporte.
// Recibe un objeto JSON-RPC ya parseado y un ToolHost ya inicializado.
// Devuelve el objeto de respuesta, o null si era una notificacion (sin id).

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "toolhost-mcp", version: "0.1.0" };

function ok(id, result) {
  return { jsonrpc: "2.0", id, result };
}
function err(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

// Spec MCP (2025-06-18): structuredContent debe ser un OBJETO (record).
// Si el handler devuelve un array o un primitivo (numero, string, boolean, null),
// lo envolvemos en { result: <valor> } para conformidad con el SDK del cliente.
// content[0].text sigue siendo JSON.stringify del resultado ORIGINAL sin envolver.
function wrapStructuredContent(result) {
  if (result !== null && typeof result === "object" && !Array.isArray(result)) {
    return result;
  }
  return { result };
}

// host: instancia de ToolHost. msg: objeto JSON-RPC.
export function handleMcpMessage(host, msg) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return err(msg && msg.id !== undefined ? msg.id : null, -32600, "Invalid Request");
  }

  const isNotification = msg.id === undefined || msg.id === null;

  switch (msg.method) {
    case "initialize":
      return ok(msg.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });

    case "notifications/initialized":
      return null; // notificacion, no se responde

    case "ping":
      return ok(msg.id, {});

    case "tools/list": {
      const tools = host.listTools();
      return ok(msg.id, { tools });
    }

    case "tools/call": {
      const params = msg.params || {};
      const name = params.name;
      const args = params.arguments || {};
      if (typeof name !== "string") {
        return err(msg.id, -32602, "params.name requerido");
      }
      try {
        const result = host.callTool(name, args);
        // Formato MCP: content array. Devolvemos el resultado estructurado como texto.
        return ok(msg.id, {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: wrapStructuredContent(result),
          isError: false,
        });
      } catch (e) {
        // Error de la tool -> se reporta como resultado con isError, no como error JSON-RPC.
        return ok(msg.id, {
          content: [{ type: "text", text: "Error en la tool: " + e.message }],
          isError: true,
        });
      }
    }

    default:
      if (isNotification) return null;
      return err(msg.id, -32601, "Method not found: " + msg.method);
  }
}
