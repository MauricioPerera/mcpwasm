#!/usr/bin/env node
// bin/mcpwasm-local.mjs — runtime MCP LOCAL (stdio) para skills ejecutables.
//
// "Static MCP sin gateway": lee /llms.txt de UN origin (p.ej. un GitHub Pages),
// verifica tool_sha256 sobre los bytes exactos, carga cada skill verificada en
// su PROPIO contexto QuickJS-wasm (mismo modelo de aislamiento que el gateway)
// y expone MCP por stdio (JSON-RPC 2.0, un mensaje JSON por linea) — el
// transporte que consumen Claude Code / Cursor / etc. sin cambios.
//
// Uso:            mcpwasm <origin>
//   p.ej.:        npx @rckflr/mcpwasm https://usuario.github.io
//
// Config de cliente MCP tipica:
//   {"mcpServers":{"misitio":{"command":"npx","args":["-y","@rckflr/mcpwasm","https://usuario.github.io"]}}}
//
// Reglas de canal: stdout es EXCLUSIVO del protocolo MCP; todo diagnostico
// (skills cargadas/rechazadas, errores de descubrimiento) sale por stderr.
//
// Limites v1, explicitos:
//  - Sin origin-memory: host.memorySearch NO se inyecta aunque el origin
//    declare skills-memory (conforme a la spec: capability ausente => la skill
//    que la use falla controlado dentro del sandbox, isError:true).
//  - Sin atestaciones: en el runtime local la decision de confianza es del
//    usuario que ELIGE el origin; la verificacion sha256 sigue siendo MUST.
//  - Descubrimiento UNA vez al arrancar (proceso local efimero): reiniciar el
//    proceso refresca las skills.
//  - Caps de tamano post-descarga (llms 256KB, tool.js 1MB): proceso local con
//    origin elegido por el usuario; el streaming defensivo byte-a-byte queda
//    en el gateway (T42), aqui el chequeo es sobre el texto ya recibido.

import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { newQuickJSAsyncWASMModuleFromVariant, newVariant } from "quickjs-emscripten-core";
import baseAsyncifyVariant from "@jitl/quickjs-wasmfile-release-asyncify";
import { AsyncToolHost } from "../host-async.mjs";
import { handleMcpMessageAsync } from "../mcp-core-async.mjs";
import { parseLlmsTxt } from "../llmstxt-parse.mjs";

const PKG = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const MAX_LLMS_BYTES = 262144; // 256 KB (mismos defaults que el gateway)
const MAX_TOOL_BYTES = 1048576; // 1 MB
const FETCH_TIMEOUT_MS = 10000;

function err(msg) {
  process.stderr.write("[mcpwasm-local] " + msg + "\n");
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

const originArg = process.argv[2];
if (!originArg) {
  err("uso: mcpwasm <origin>   (ej: npx @rckflr/mcpwasm https://usuario.github.io)");
  process.exit(2);
}
let origin;
try {
  origin = new URL(originArg).origin;
} catch {
  err("origin invalido: " + originArg);
  process.exit(2);
}

async function fetchText(url, maxBytes) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "follow",
  });
  const text = await res.text();
  if (text.length > maxBytes) {
    throw new Error("body excede el cap (" + maxBytes + " bytes): " + url);
  }
  return { status: res.status, text };
}

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// Descubrimiento: llms.txt -> skills ejecutables -> fetch + verify sha256.
// Mismatch/HTTP != 200/cap excedido => skill rechazada (stderr), las demas cargan.
async function discover() {
  const r = await fetchText(origin + "/llms.txt", MAX_LLMS_BYTES);
  if (r.status !== 200) {
    throw new Error("llms.txt: HTTP " + r.status);
  }
  const { skills: parsed, memory } = parseLlmsTxt(r.text);
  if (parsed.length === 0) {
    throw new Error("llms.txt sin skills ejecutables (lineas <!-- skill: {...} -->)");
  }
  if (memory) {
    err("origin declara skills-memory: NO soportada en el runtime local v1 -> host.memorySearch ausente (las skills que la usen fallan controlado)");
  }
  const verified = [];
  for (const s of parsed) {
    const toolUrl = new URL(s.toolPath, origin).href;
    let tr;
    try {
      tr = await fetchText(toolUrl, MAX_TOOL_BYTES);
    } catch (e) {
      err("skill rechazada: " + s.name + " -> fetch tool.js fallo: " + (e && e.message));
      continue;
    }
    if (tr.status !== 200) {
      err("skill rechazada: " + s.name + " -> tool.js HTTP " + tr.status);
      continue;
    }
    const hash = sha256Hex(tr.text);
    if (hash !== s.sha256) {
      err(
        "skill rechazada: " + s.name + " -> sha256 mismatch (declarado " +
          s.sha256.slice(0, 12) + "…, obtenido " + hash.slice(0, 12) + "…)"
      );
      continue;
    }
    verified.push({ name: s.name, code: tr.text });
  }
  if (verified.length === 0) {
    throw new Error("ninguna skill verificada para " + origin);
  }
  return verified;
}

// Un contexto QuickJS por skill (aislamiento tool<->tool, como el gateway),
// compartiendo UN modulo asyncify: valido porque el loop de mensajes procesa
// las requests EN SERIE (cola de promesas) => nunca hay dos suspensiones
// asyncify simultaneas sobre el mismo modulo.
class LocalPerSkillHost {
  constructor(quickjs, skills) {
    this._quickjs = quickjs;
    this._skills = skills;
    this._byName = new Map();
    this._order = [];
  }

  async init() {
    for (const s of this._skills) {
      const h = new AsyncToolHost({ quickjs: this._quickjs, allowedOrigin: origin });
      await h.init();
      h.loadToolSource(s.code);
      this._byName.set(s.name, h);
      this._order.push(s.name);
    }
  }

  listTools() {
    const all = [];
    for (const name of this._order) {
      for (const t of this._byName.get(name).listTools()) all.push(t);
    }
    return all;
  }

  async callTool(name, args) {
    const h = this._byName.get(name);
    if (!h) throw new Error("tool no encontrada: " + name);
    return await h.callTool(name, args);
  }

  dispose() {
    for (const h of this._byName.values()) {
      try {
        h.dispose();
      } catch {
        // best-effort
      }
    }
  }
}

let host = null;

async function start() {
  err("descubriendo skills de " + origin + " …");
  const skills = await discover();
  const quickjs = await newQuickJSAsyncWASMModuleFromVariant(newVariant(baseAsyncifyVariant, {}));
  host = new LocalPerSkillHost(quickjs, skills);
  await host.init();
  err("listo: " + skills.length + " skill(s) verificadas y cargadas (" + skills.map((s) => s.name).join(", ") + ")");
}

async function handleLine(line) {
  const t = line.trim();
  if (!t) return;
  let msg;
  try {
    msg = JSON.parse(t);
  } catch {
    out({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  let resp;
  try {
    resp = await handleMcpMessageAsync(host, msg);
  } catch (e) {
    resp = {
      jsonrpc: "2.0",
      id: msg && msg.id !== undefined ? msg.id : null,
      error: { code: -32603, message: String((e && e.message) || e) },
    };
  }
  if (resp === null) return; // notificacion: sin respuesta
  // serverInfo propio del runtime local (el core generico trae el del spike).
  if (msg && msg.method === "initialize" && resp.result) {
    resp.result.serverInfo = { name: "mcpwasm-local", version: PKG.version };
  }
  out(resp);
}

// El descubrimiento corre primero; las lineas que lleguen mientras tanto se
// ENCOLAN detras de la promesa de arranque (los clientes MCP mandan initialize
// inmediatamente). La cola tambien serializa los mensajes entre si (asyncify:
// una suspension a la vez sobre el modulo compartido). Un mensaje que falle no
// envenena la cola (handleLine captura y responde error JSON-RPC).
const startP = start().catch((e) => {
  err("descubrimiento fallo: " + String((e && e.message) || e));
  process.exit(1);
});
let chain = startP;

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  chain = chain.then(() => handleLine(line));
});
rl.on("close", () => {
  chain.finally(() => {
    if (host) host.dispose();
    process.exit(0);
  });
});
