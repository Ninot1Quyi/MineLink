import { afterEach, describe, expect, it } from "vitest";
import { startHttpMcpServer, type RunningHttpMcpServer } from "./httpServer.js";

const servers: RunningHttpMcpServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("Streamable HTTP MCP Gateway", () => {
  it("serves health and MCP tool calls over HTTP", async () => {
    const server = await startHttpMcpServer({ port: 0 });
    servers.push(server);

    const health = await fetch(`http://${server.host}:${server.port}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({
      ok: true,
      transport: "streamable-http",
      auth_required: false,
      rate_limit: { window_ms: 60000, max_requests: 120 }
    });

    const initialized = await mcpPost(server.url, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "minelink-http-test", version: "0.1.0" }
      }
    });
    expect(initialized.status).toBe(200);
    expect(initialized.body.result.serverInfo).toMatchObject({ name: "minelink-host" });
    const sessionId = initialized.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();

    const pong = await mcpPost(
      server.url,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "minelink.ping",
          arguments: {}
        }
      },
      sessionId ?? undefined
    );
    expect(pong.status).toBe(200);
    const payload = JSON.parse(pong.body.result.content[0].text);
    expect(payload).toMatchObject({ ok: true, result: { host: "minelink-host" } });
  });

  it("rejects MCP requests without the negotiated session id", async () => {
    const server = await startHttpMcpServer({ port: 0 });
    servers.push(server);

    await initialize(server.url, 1, "minelink-http-test");

    const missingSession = await mcpPost(server.url, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "minelink.ping", arguments: {} }
    });
    expect(missingSession.status).toBe(400);
    expect(missingSession.body.error.message).toContain("Mcp-Session-Id");
  });

  it("returns a JSON-RPC parse error for invalid HTTP JSON", async () => {
    const server = await startHttpMcpServer({ port: 0 });
    servers.push(server);

    const response = await fetch(server.url, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json"
      },
      body: "{"
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: -32700 } });
  });

  it("keeps multiple initialized HTTP MCP sessions isolated", async () => {
    const server = await startHttpMcpServer({ port: 0 });
    servers.push(server);

    const first = await initialize(server.url, 1, "client-one");
    const second = await initialize(server.url, 2, "client-two");
    expect(first.headers.get("mcp-session-id")).toBeTruthy();
    expect(second.headers.get("mcp-session-id")).toBeTruthy();
    expect(first.headers.get("mcp-session-id")).not.toEqual(second.headers.get("mcp-session-id"));

    const firstPong = await mcpPost(
      server.url,
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "minelink.ping", arguments: {} }
      },
      first.headers.get("mcp-session-id") ?? undefined
    );
    const secondPong = await mcpPost(
      server.url,
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "minelink.ping", arguments: {} }
      },
      second.headers.get("mcp-session-id") ?? undefined
    );
    expect(firstPong.status).toBe(200);
    expect(secondPong.status).toBe(200);
  });

  it("requires a Bearer token when gateway admission is configured", async () => {
    const server = await startHttpMcpServer({ port: 0, gatewayToken: "test-token" });
    servers.push(server);

    const health = await fetch(`http://${server.host}:${server.port}/healthz`);
    expect(await health.json()).toMatchObject({ ok: true, auth_required: true });

    const rejected = await mcpPost(server.url, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "missing-token", version: "0.1.0" }
      }
    });
    expect(rejected.status).toBe(401);
    expect(rejected.body.error.message).toContain("Unauthorized");

    const accepted = await mcpPost(
      server.url,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "with-token", version: "0.1.0" }
        }
      },
      undefined,
      "test-token"
    );
    expect(accepted.status).toBe(200);
    expect(accepted.headers.get("mcp-session-id")).toBeTruthy();
  });

  it("refuses non-loopback binding without an explicit gateway token", async () => {
    await expect(
      startHttpMcpServer({ host: "0.0.0.0", port: 0, allowUnauthenticatedPublicGateway: false })
    ).rejects.toThrow(/refuses non-loopback binding/);
  });

  it("rate limits HTTP MCP requests before session creation", async () => {
    const server = await startHttpMcpServer({ port: 0, rateLimitMaxRequests: 1, rateLimitWindowMs: 60_000 });
    servers.push(server);

    const first = await initialize(server.url, 1, "first-client");
    expect(first.status).toBe(200);

    const limited = await initialize(server.url, 2, "second-client");
    expect(limited.status).toBe(429);
    expect(limited.body.error.message).toContain("rate limit");
  });

  it("caps active HTTP MCP sessions", async () => {
    const server = await startHttpMcpServer({ port: 0, maxSessions: 1, rateLimitMaxRequests: 10 });
    servers.push(server);

    const first = await initialize(server.url, 1, "first-client");
    expect(first.status).toBe(200);
    expect(first.headers.get("mcp-session-id")).toBeTruthy();

    const second = await initialize(server.url, 2, "second-client");
    expect(second.status).toBe(429);
    expect(second.body.error.message).toContain("session limit");
  });
});

async function initialize(url: string, id: number, name: string) {
  return mcpPost(url, {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name, version: "0.1.0" }
    }
  });
}

async function mcpPost(
  url: string,
  body: Record<string, unknown>,
  sessionId?: string,
  bearerToken?: string
): Promise<{ status: number; headers: Headers; body: any }> {
  const headers: Record<string, string> = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json"
  };
  if (sessionId) {
    headers["mcp-session-id"] = sessionId;
    headers["mcp-protocol-version"] = "2025-11-25";
  }
  if (bearerToken) {
    headers.authorization = `Bearer ${bearerToken}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  return {
    status: response.status,
    headers: response.headers,
    body: await response.json()
  };
}
