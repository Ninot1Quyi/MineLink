import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { HostController } from "../session/HostController.js";
import { createMineLinkMcpServer } from "./server.js";

export interface HttpMcpServerOptions {
  host?: string;
  port?: number;
  path?: string;
  controllerFactory?: () => HostController;
}

export interface RunningHttpMcpServer {
  host: string;
  port: number;
  path: string;
  url: string;
  close: () => Promise<void>;
}

interface HttpMcpSession {
  id?: string;
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  controller: HostController;
}

export async function startHttpMcpServer(options: HttpMcpServerOptions = {}): Promise<RunningHttpMcpServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8765;
  const path = options.path ?? "/mcp";
  const sessions = new Map<string, HttpMcpSession>();

  const httpServer = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);

      if (url.pathname === "/healthz") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, service: "minelink-host", transport: "streamable-http" }));
        return;
      }

      if (url.pathname !== path) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: false, reason: "not_found" }));
        return;
      }

      const sessionId = headerValue(request.headers["mcp-session-id"]);
      if (sessionId) {
        const session = sessions.get(sessionId);
        if (!session) {
          writeJsonRpcError(response, 404, -32001, "Session not found");
          return;
        }
        await session.transport.handleRequest(request, response);
        return;
      }

      if (request.method !== "POST") {
        writeJsonRpcError(response, 400, -32000, "Bad Request: Mcp-Session-Id header is required");
        return;
      }

      let parsedBody: unknown;
      try {
        parsedBody = await readJsonBody(request);
      } catch {
        writeJsonRpcError(response, 400, -32700, "Parse error: Invalid JSON");
        return;
      }

      if (!isInitializeRequestBody(parsedBody)) {
        writeJsonRpcError(response, 400, -32000, "Bad Request: Mcp-Session-Id header is required", requestId(parsedBody));
        return;
      }

      const session = await createSession();
      await session.transport.handleRequest(request, response, parsedBody);
      if (!session.id) {
        await closeSession(session);
      }
    } catch (error) {
      if (!response.headersSent) {
        response.writeHead(500, { "content-type": "application/json" });
      }
      response.end(
        JSON.stringify({
          ok: false,
          reason: "http_gateway_error",
          message: error instanceof Error ? error.message : String(error)
        })
      );
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => {
      httpServer.off("error", reject);
      resolve();
    });
  });

  const address = httpServer.address();
  const actualPort = typeof address === "object" && address ? address.port : port;

  return {
    host,
    port: actualPort,
    path,
    url: `http://${host}:${actualPort}${path}`,
    close: async () => {
      await Promise.allSettled(Array.from(sessions.values()).map((session) => closeSession(session)));
      await closeHttpServer(httpServer);
    }
  };

  async function createSession(): Promise<HttpMcpSession> {
    const controller = options.controllerFactory?.() ?? new HostController();
    const session: HttpMcpSession = {
      controller,
      server: createMineLinkMcpServer(controller),
      transport: new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (id) => {
          session.id = id;
          sessions.set(id, session);
        },
        onsessionclosed: async (id) => {
          const closedSession = sessions.get(id);
          if (closedSession) {
            await closeSession(closedSession);
          }
        }
      })
    };

    await session.server.connect(session.transport);
    return session;
  }

  async function closeSession(session: HttpMcpSession): Promise<void> {
    if (session.id && sessions.get(session.id) === session) {
      sessions.delete(session.id);
    }
    await session.server.close().catch(() => undefined);
    session.controller.close();
  }
}

function closeHttpServer(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function writeJsonRpcError(
  response: ServerResponse,
  status: number,
  code: number,
  message: string,
  id: string | number | null = null
): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code, message },
      id
    })
  );
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function isInitializeRequestBody(body: unknown): boolean {
  const messages = Array.isArray(body) ? body : [body];
  return messages.some(
    (message) => typeof message === "object" && message !== null && "method" in message && message.method === "initialize"
  );
}

function requestId(body: unknown): string | number | null {
  if (Array.isArray(body)) return null;
  if (typeof body !== "object" || body === null || !("id" in body)) return null;
  const id = body.id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}
