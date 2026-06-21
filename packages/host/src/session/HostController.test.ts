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
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
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
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("WebSocket server address is unavailable");

    const controller = new HostController();
    await controller.connectServer({ endpoint: `ws://127.0.0.1:${address.port}` });
    const result = await controller.toolList({});
    expect(result).toMatchObject({ ok: false, reason: "runtime_unavailable" });
    controller.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("forwards connected tool_query to the runtime catalog", async () => {
    let queriedName = "";
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    server.on("connection", (socket: WebSocket) => {
      socket.on("message", (raw) => {
        const request = JSON.parse(raw.toString());
        if (request.type === "tool.query") {
          queriedName = String(request.name);
          socket.send(
            JSON.stringify({
              id: request.id,
              type: "tool.query.result",
              ok: true,
              name: request.name,
              summary: "Runtime-only tool",
              description: "Schema owned by the connected runtime.",
              tags: ["runtime"],
              input_schema: { type: "object", properties: { value: { type: "string" } } }
            })
          );
          return;
        }
        socket.send(JSON.stringify({ id: request.id, type: `${request.type}.result`, ok: true, owner_id: "owner:test" }));
      });
    });
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("WebSocket server address is unavailable");

    const controller = new HostController();
    await controller.connectServer({ endpoint: `ws://127.0.0.1:${address.port}` });
    const result = await controller.toolQuery({ name: "runtime.extended_tool" });
    expect(queriedName).toBe("runtime.extended_tool");
    expect(result).toMatchObject({
      ok: true,
      result: { name: "runtime.extended_tool", input_schema: { type: "object" } }
    });
    controller.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("forwards submit mode and returns accepted action handles", async () => {
    let forwardedToolExecute: Record<string, unknown> | undefined;
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    server.on("connection", (socket: WebSocket) => {
      socket.on("message", (raw) => {
        const request = JSON.parse(raw.toString());
        if (request.type === "hello") {
          socket.send(JSON.stringify({ id: request.id, type: "hello.result", ok: true, capabilities: {} }));
          return;
        }
        if (request.type === "connect") {
          socket.send(JSON.stringify({ id: request.id, type: "connect.result", ok: true, owner_id: "owner:test" }));
          return;
        }
        if (request.type === "agent.birth") {
          socket.send(
            JSON.stringify({ id: request.id, type: "agent.birth.result", ok: true, agent_id: "agent_1", display_name: "agent" })
          );
          return;
        }
        if (request.type === "tool.execute") {
          forwardedToolExecute = request;
          socket.send(
            JSON.stringify({
              id: request.id,
              type: "tool.execute.result",
              ok: true,
              status: "accepted",
              action_id: "act_1",
              result: {
                action_id: "act_1",
                lifecycle_status: "queued",
                tool_name: request.name
              }
            })
          );
        }
      });
    });
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("WebSocket server address is unavailable");

    const controller = new HostController();
    await controller.connectServer({ endpoint: `ws://127.0.0.1:${address.port}` });
    await controller.birth({ seedPrompt: "submit test", bodyType: "server_agent" });
    const result = await controller.toolExecute({
      name: "action.move",
      mode: "submit",
      arguments: { vector: [0, 0, 0], durationMs: 1000 }
    });

    expect(forwardedToolExecute).toMatchObject({
      type: "tool.execute",
      agent_id: "agent_1",
      name: "action.move",
      mode: "submit",
      arguments: { vector: [0, 0, 0], durationMs: 1000 }
    });
    expect(result).toMatchObject({
      ok: true,
      result: {
        status: "accepted",
        action_id: "act_1",
        result: { lifecycle_status: "queued", tool_name: "action.move" }
      }
    });
    controller.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("forwards runtime extension tool_execute calls after birth", async () => {
    let forwardedToolExecute: Record<string, unknown> | undefined;
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    server.on("connection", (socket: WebSocket) => {
      socket.on("message", (raw) => {
        const request = JSON.parse(raw.toString());
        if (request.type === "hello") {
          socket.send(JSON.stringify({ id: request.id, type: "hello.result", ok: true, capabilities: {} }));
          return;
        }
        if (request.type === "connect") {
          socket.send(JSON.stringify({ id: request.id, type: "connect.result", ok: true, owner_id: "owner:test" }));
          return;
        }
        if (request.type === "agent.birth") {
          socket.send(
            JSON.stringify({ id: request.id, type: "agent.birth.result", ok: true, agent_id: "agent_1", display_name: "agent" })
          );
          return;
        }
        if (request.type === "tool.execute") {
          forwardedToolExecute = request;
          socket.send(
            JSON.stringify({
              id: request.id,
              type: "tool.execute.result",
              ok: true,
              status: "completed",
              result: { tool_name: request.name, runtime_authoritative: true }
            })
          );
        }
      });
    });
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("WebSocket server address is unavailable");

    const controller = new HostController();
    await controller.connectServer({ endpoint: `ws://127.0.0.1:${address.port}` });
    await controller.birth({ seedPrompt: "runtime extension", bodyType: "server_agent" });
    const result = await controller.toolExecute({
      name: "runtime.extended_tool",
      mode: "await_completion",
      arguments: { value: "ok" }
    });

    expect(forwardedToolExecute).toMatchObject({
      type: "tool.execute",
      agent_id: "agent_1",
      name: "runtime.extended_tool",
      arguments: { value: "ok" }
    });
    expect(result).toMatchObject({
      ok: true,
      result: {
        status: "completed",
        result: { tool_name: "runtime.extended_tool", runtime_authoritative: true }
      }
    });
    controller.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
