/**
 * The MCP server that gives Claude Code the renderer's tools (no Electron
 * imports, no dependencies).
 *
 * A minimal MCP Streamable-HTTP endpoint on 127.0.0.1 at a random port,
 * started on first use and shared by every run. Each run registers a session:
 * a fresh bearer token (only its SHA-256 is kept), the tools the request
 * offered and the handler that sends a call to the renderer. The session is
 * removed when the run ends, so the token stops working with it.
 *
 * Only plain JSON responses: no GET/SSE stream (405), no resources, prompts or
 * sampling. Requests from a browser page are refused: any Origin header, or a
 * Host header other than this address (DNS rebinding), gets 403.
 */
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

import type { CliToolDefinition } from "./request.js";
import type { ToolOutcome } from "./toolBridge.js";

export const MCP_SERVER_NAME = "societyer";
const MAX_BODY_BYTES = 1024 * 1024;
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

export type McpSessionHandler = {
  tools: CliToolDefinition[];
  call(name: string, args: string): Promise<ToolOutcome>;
};

export type McpRegistration = { url: string; token: string; dispose(): void };

type JsonRpcId = string | number;
type JsonRpcMessage = { jsonrpc?: unknown; id?: JsonRpcId | null; method?: unknown; params?: unknown };

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: JsonRpcId | null, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export class McpToolServer {
  private server: http.Server | null = null;
  private starting: Promise<number> | null = null;
  private port = 0;
  private readonly sessions = new Map<string, McpSessionHandler>();

  get sessionCount() {
    return this.sessions.size;
  }

  private start(): Promise<number> {
    this.starting ??= new Promise<number>((resolve, reject) => {
      const server = http.createServer((request, response) => {
        void this.handle(request, response).catch(() => {
          if (!response.headersSent) response.writeHead(500).end();
          else response.end();
        });
      });
      server.on("error", (error) => {
        this.starting = null;
        reject(error);
      });
      server.listen(0, "127.0.0.1", () => {
        this.port = (server.address() as AddressInfo).port;
        // Never keeps the app (or a test) alive on its own.
        server.unref();
        this.server = server;
        resolve(this.port);
      });
    });
    return this.starting;
  }

  /** A session for one run; `dispose` revokes the token. */
  async register(handler: McpSessionHandler): Promise<McpRegistration> {
    const port = await this.start();
    const token = randomBytes(32).toString("base64url");
    const key = hashToken(token);
    this.sessions.set(key, handler);
    return { url: `http://127.0.0.1:${port}/mcp`, token, dispose: () => this.sessions.delete(key) };
  }

  async close() {
    this.sessions.clear();
    const server = this.server;
    this.server = null;
    this.starting = null;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async handle(request: http.IncomingMessage, response: http.ServerResponse) {
    const send = (status: number, payload?: unknown, headers: Record<string, string> = {}) => {
      if (payload === undefined) {
        response.writeHead(status, headers).end();
        return;
      }
      const text = JSON.stringify(payload);
      response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers }).end(text);
    };
    const host = request.headers.host ?? "";
    if (request.headers.origin !== undefined || (host !== `127.0.0.1:${this.port}` && host !== `localhost:${this.port}`)) {
      send(403, rpcError(null, -32000, "Forbidden"));
      return;
    }
    const pathname = (request.url ?? "").split("?")[0];
    if (pathname !== "/mcp") {
      send(404, rpcError(null, -32000, "Not found"));
      return;
    }
    if (request.method !== "POST") {
      send(405, rpcError(null, -32000, "Method not allowed"), { allow: "POST" });
      return;
    }
    const authorization = request.headers.authorization ?? "";
    const token = /^Bearer\s+(\S+)$/i.exec(authorization)?.[1];
    const session = token ? this.sessions.get(hashToken(token)) : undefined;
    if (!session) {
      send(401, rpcError(null, -32000, "Unauthorized"), { "www-authenticate": "Bearer" });
      return;
    }
    const declared = Number(request.headers["content-length"] ?? "0");
    if (declared > MAX_BODY_BYTES) {
      send(413, rpcError(null, -32000, "Request too large"));
      request.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const piece of request) {
      const buffer = piece as Buffer;
      size += buffer.byteLength;
      if (size > MAX_BODY_BYTES) {
        send(413, rpcError(null, -32000, "Request too large"));
        request.destroy();
        return;
      }
      chunks.push(buffer);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      send(400, rpcError(null, -32700, "Parse error"));
      return;
    }
    const batch = Array.isArray(parsed);
    const messages = (batch ? parsed : [parsed]) as JsonRpcMessage[];
    const replies: unknown[] = [];
    for (const message of messages) {
      const reply = await this.dispatch(record(message) as JsonRpcMessage, session);
      if (reply) replies.push(reply);
    }
    if (!replies.length) send(202);
    else send(200, batch ? replies : replies[0]);
  }

  private async dispatch(message: JsonRpcMessage, session: McpSessionHandler) {
    const { id, method } = message;
    // Notifications (notifications/initialized, cancelled) and stray responses need no reply.
    if (typeof id !== "string" && typeof id !== "number") return null;
    if (typeof method !== "string") return rpcError(id, -32600, "Invalid request");
    const params = record(message.params);
    switch (method) {
      case "initialize": {
        const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
        return rpcResult(id, {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: MCP_SERVER_NAME, version: "1.0.0" },
        });
      }
      case "ping":
        return rpcResult(id, {});
      case "tools/list":
        return rpcResult(id, { tools: session.tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })) });
      case "tools/call": {
        const name = typeof params.name === "string" ? params.name : "";
        if (!session.tools.some((tool) => tool.name === name)) return rpcError(id, -32602, `Unknown tool: ${name.slice(0, 80)}`);
        const args = params.arguments === undefined ? "{}" : JSON.stringify(params.arguments);
        try {
          const outcome = await session.call(name, args);
          return rpcResult(id, { content: [{ type: "text", text: outcome.content }], isError: outcome.isError });
        } catch {
          return rpcResult(id, { content: [{ type: "text", text: "The request was stopped." }], isError: true });
        }
      }
      default:
        return rpcError(id, -32601, "Method not found");
    }
  }
}

/** The one server the app shares. */
export const mcpToolServer = new McpToolServer();
