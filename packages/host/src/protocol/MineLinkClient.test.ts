import { afterEach, describe, expect, it } from "vitest";
import http, { type Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { MineLinkClient } from "./MineLinkClient.js";

const servers: WebSocketServer[] = [];
const httpServers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          for (const client of server.clients) client.terminate();
          server.close(() => resolve());
        })
    )
  );
  await Promise.all(
    httpServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        })
    )
  );
});

describe("MineLinkClient", () => {
  it("reconnects when a different endpoint is requested", async () => {
    const first = await testServer("first");
    const second = await testServer("second");
    servers.push(first, second);

    const client = new MineLinkClient();
    const firstEndpoint = websocketEndpoint(first);
    const secondEndpoint = websocketEndpoint(second);
    await client.connect(firstEndpoint);
    expect(client.endpoint).toBe(firstEndpoint);

    await client.connect(secondEndpoint);
    expect(client.endpoint).toBe(secondEndpoint);

    const response = await client.request({ type: "hello" });
    expect(response.marker).toBe("second");
    client.close();
  });

  it("can call a loopback HTTP MineLink protocol endpoint", async () => {
    const server = await testHttpServer("http-runtime");
    httpServers.push(server);

    const client = new MineLinkClient();
    const endpoint = httpEndpoint(server);
    await client.connect(endpoint);
    expect(client.connected).toBe(true);
    expect(client.endpoint).toBe(endpoint);

    const response = await client.request({ type: "hello" });
    expect(response.marker).toBe("http-runtime");
    client.close();
    expect(client.connected).toBe(false);
  });
});

async function testServer(marker: string): Promise<WebSocketServer> {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  server.on("connection", (socket: WebSocket) => {
    socket.on("message", (raw) => {
      const request = JSON.parse(raw.toString());
      socket.send(JSON.stringify({ id: request.id, type: `${request.type}.result`, ok: true, marker }));
    });
  });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  return server;
}

async function testHttpServer(marker: string): Promise<Server> {
  const server = http.createServer((request, response) => {
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const payload = JSON.parse(body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: payload.id, type: `${payload.type}.result`, ok: true, marker }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  return server;
}

function websocketEndpoint(server: WebSocketServer): string {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("WebSocket server address is unavailable");
  return `ws://127.0.0.1:${address.port}`;
}

function httpEndpoint(server: Server): string {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("HTTP server address is unavailable");
  return `http://127.0.0.1:${address.port}/minelink`;
}
