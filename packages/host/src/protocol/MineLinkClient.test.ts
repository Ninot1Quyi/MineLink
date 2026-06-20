import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { MineLinkClient } from "./MineLinkClient.js";

const servers: WebSocketServer[] = [];

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
});

describe("MineLinkClient", () => {
  it("reconnects when a different endpoint is requested", async () => {
    const first = await testServer(25710, "first");
    const second = await testServer(25711, "second");
    servers.push(first, second);

    const client = new MineLinkClient();
    await client.connect("ws://127.0.0.1:25710");
    expect(client.endpoint).toBe("ws://127.0.0.1:25710");

    await client.connect("ws://127.0.0.1:25711");
    expect(client.endpoint).toBe("ws://127.0.0.1:25711");

    const response = await client.request({ type: "hello" });
    expect(response.marker).toBe("second");
    client.close();
  });
});

async function testServer(port: number, marker: string): Promise<WebSocketServer> {
  const server = new WebSocketServer({ host: "127.0.0.1", port });
  server.on("connection", (socket: WebSocket) => {
    socket.on("message", (raw) => {
      const request = JSON.parse(raw.toString());
      socket.send(JSON.stringify({ id: request.id, type: `${request.type}.result`, ok: true, marker }));
    });
  });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  return server;
}
