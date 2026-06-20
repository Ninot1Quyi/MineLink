import { describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { HostController } from "./HostController.js";

describe("HostController", () => {
  it("returns local catalog data before a runtime is connected", async () => {
    const controller = new HostController();
    const result = await controller.toolList({ namespace: "observe" });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).toContain("observe.scene");
    controller.close();
  });

  it("rejects unknown dynamic tools before forwarding", async () => {
    const controller = new HostController();
    const result = await controller.toolQuery({ name: "debug.oracle" });
    expect(result).toMatchObject({ ok: false, reason: "unknown_tool" });
    controller.close();
  });

  it("does not mask connected runtime tool_list failures with local fallback", async () => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 25712 });
    server.on("connection", (socket: WebSocket) => {
      socket.on("message", (raw) => {
        const request = JSON.parse(raw.toString());
        if (request.type === "tool.list") {
          socket.send(
            JSON.stringify({
              id: request.id,
              type: "tool.list.result",
              ok: false,
              reason: "runtime_unavailable",
              message: "catalog unavailable"
            })
          );
          return;
        }
        socket.send(JSON.stringify({ id: request.id, type: `${request.type}.result`, ok: true, owner_id: "owner:test" }));
      });
    });
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));

    const controller = new HostController();
    await controller.connectServer({ endpoint: "ws://127.0.0.1:25712" });
    const result = await controller.toolList({});
    expect(result).toMatchObject({ ok: false, reason: "runtime_unavailable" });
    controller.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
