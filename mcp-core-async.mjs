// mcp-core-async.mjs
// Nucleo MCP JSON-RPC 2.0 para el spike TAREA5. Adaptacion ASINCRONA de mcp-core.mjs.
// No edita mcp-core.mjs (sincrono, productivo): copia la parte necesaria y awaita
// host.callTool, que en AsyncToolHost es async (handlers async + capability fetchOrigin).
//
// host: instancia de AsyncToolHost. msg: objeto JSON-RPC.
// Devuelve el objeto de respuesta, o null si era una notificacion (sin id).

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "toolhost-mcp-spike-async", version: "0.1.0" };

function ok(id, result) {
  return { jsonrpc: "2.0", id, result };
}
function err(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

// Spec MCP (2025-06-18): structuredContent debe ser un OBJETO (record).
// Si el handler devuelve un array o un primitivo, lo envolvemos en { result: <valor> }.
// content[0].text sigue siendo JSON.stringify del resultado ORIGINAL sin envolver.
function wrapStructuredContent(result) {
  if (result !== null && typeof result === "object" && !Array.isArray(result)) {
    return result;
  }
  return { result };
}

export async function handleMcpMessageAsync(host, msg) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return err(msg && msg.id !== undefined ? msg.id : null, -32600, "Invalid Request");
  }

  const isNotification = msg.id === undefined || msg.id === null;

  switch (msg.method) {
    case "initialize": {
      // `resources` se anuncia solo si el host las implementa: los hosts de los
      // runtimes exponen los SKILL.md verificados como resources (la mitad
      // "receta" de una skill ejecutable); el PoC/spike no las tiene.
      const capabilities = { tools: { listChanged: false } };
      if (typeof host.listResources === "function") {
        capabilities.resources = { listChanged: false };
      }
      return ok(msg.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities,
        serverInfo: SERVER_INFO,
      });
    }

    case "notifications/initialized":
      return null;

    case "ping":
      return ok(msg.id, {});

    case "tools/list": {
      const tools = host.listTools();
      return ok(msg.id, { tools });
    }

    case "resources/list": {
      if (typeof host.listResources !== "function") {
        return err(msg.id, -32601, "Method not found: resources/list");
      }
      return ok(msg.id, { resources: host.listResources() });
    }

    case "resources/read": {
      if (typeof host.readResource !== "function") {
        return err(msg.id, -32601, "Method not found: resources/read");
      }
      const uri = msg.params && msg.params.uri;
      if (typeof uri !== "string") {
        return err(msg.id, -32602, "params.uri requerido");
      }
      const contents = host.readResource(uri);
      if (contents === null) {
        return err(msg.id, -32002, "Resource not found: " + uri);
      }
      return ok(msg.id, { contents });
    }

    case "tools/call": {
      const params = msg.params || {};
      const name = params.name;
      const args = params.arguments || {};
      if (typeof name !== "string") {
        return err(msg.id, -32602, "params.name requerido");
      }
      try {
        const result = await host.callTool(name, args);
        return ok(msg.id, {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: wrapStructuredContent(result),
          isError: false,
        });
      } catch (e) {
        // Error de la tool (incluido "origin no permitido") -> isError, no error JSON-RPC.
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