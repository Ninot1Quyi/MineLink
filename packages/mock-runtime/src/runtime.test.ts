import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { MockRuntimeServer } from "./runtime.js";

const servers: MockRuntimeServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

describe("MockRuntimeServer", () => {
  it("refuses online-mode=true during MVP", async () => {
    const server = new MockRuntimeServer({ port: 25675, onlineMode: true });
    servers.push(server);
    await server.start();

    const client = await connect(server.endpoint());
    const response = await request(client, {
      type: "connect",
      server_address: "dev.local",
      owner: { kind: "offline_agent", name: "test" },
      admission_token: null
    });
    expect(response).toMatchObject({ ok: false, reason: "unsupported_online_auth" });
    client.close();
  });

  it("enforces visible ref reachability before mining", async () => {
    const server = new MockRuntimeServer({ port: 25676 });
    servers.push(server);
    await server.start();

    const client = await connect(server.endpoint());
    await request(client, { type: "connect", server_address: "dev.local", owner: { name: "test" } });
    const birth = await request(client, { type: "agent.birth", seed_prompt: "test", body_type: "server_agent" });
    const agentId = String(birth.agent_id);
    const observe = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "observe.scene",
      arguments: {}
    });
    const visibleScene = observe.visible_scene as { visible_blocks: Array<{ block_ref: string; id: string }> };
    const log = visibleScene.visible_blocks.find((block) => block.id === "minecraft:oak_log")!;

    const mine = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "action.mine_visible_block",
      arguments: { block_ref: log.block_ref }
    });
    expect(mine).toMatchObject({ ok: false, reason: "target_too_far" });
    client.close();
  });

  it("rejects unknown and expired refs with structured reasons", async () => {
    const server = new MockRuntimeServer({ port: 25677 });
    servers.push(server);
    await server.start();

    const client = await connect(server.endpoint());
    await request(client, { type: "connect", server_address: "dev.local", owner: { name: "test" } });
    const birth = await request(client, { type: "agent.birth", seed_prompt: "test", body_type: "server_agent" });
    const agentId = String(birth.agent_id);

    const unknown = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "action.mine_visible_block",
      arguments: { block_ref: "blk_unknown" }
    });
    expect(unknown).toMatchObject({ ok: false, reason: "unknown_or_unobserved_target" });

    const observe = await request(client, { type: "tool.execute", agent_id: agentId, name: "observe.scene", arguments: {} });
    const visibleScene = observe.visible_scene as { visible_blocks: Array<{ block_ref: string; id: string }> };
    const log = visibleScene.visible_blocks.find((block) => block.id === "minecraft:oak_log")!;
    await new Promise((resolve) => setTimeout(resolve, 5100));
    const expired = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "action.mine_visible_block",
      arguments: { block_ref: log.block_ref }
    });
    expect(expired).toMatchObject({ ok: false, reason: "expired_ref" });
    client.close();
  });

  it("applies backpressure to concurrent submit-mode actions", async () => {
    const server = new MockRuntimeServer({ port: 25678 });
    servers.push(server);
    await server.start();

    const client = await connect(server.endpoint());
    await request(client, { type: "connect", server_address: "dev.local", owner: { name: "test" } });
    const birth = await request(client, { type: "agent.birth", seed_prompt: "test", body_type: "server_agent" });
    const agentId = String(birth.agent_id);

    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(client, {
          type: "tool.execute",
          agent_id: agentId,
          name: "action.move",
          mode: "submit",
          arguments: { vector: [1, 0, 0], durationMs: 500 }
        })
      )
    );

    expect(responses.some((response) => response.reason === "backpressure_queue_full")).toBe(true);
    client.close();
  });

  it("returns structured Create component observations and valid JSONL traces", async () => {
    const temp = mkdtempSync(join(tmpdir(), "minelink-runtime-test-"));
    const tracePath = join(temp, "latest-action-trace.jsonl");
    const server = new MockRuntimeServer({
      port: 25679,
      fixture: "create_smoke",
      logDir: temp,
      tracePath
    });
    servers.push(server);
    await server.start();

    const client = await connect(server.endpoint());
    await request(client, { type: "connect", server_address: "dev.local", owner: { name: "test" } });
    const birth = await request(client, { type: "agent.birth", seed_prompt: "test", body_type: "server_agent" });
    const agentId = String(birth.agent_id);
    const observe = await request(client, { type: "tool.execute", agent_id: agentId, name: "observe.scene", arguments: {} });
    const visibleScene = observe.visible_scene as { visible_blocks: Array<{ block_ref: string; id: string; tags: string[] }> };
    const depot = visibleScene.visible_blocks.find((block) => block.id === "create:depot")!;
    const inspect = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "create.inspect_component",
      arguments: { block_ref: depot.block_ref }
    });
    expect(inspect).toMatchObject({ ok: true, result: { id: "create:depot" } });

    const lines = readFileSync(tracePath, "utf8").trim().split("\n");
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.map((line) => JSON.parse(line)).some((event) => event.event === "agent.observe")).toBe(true);
    client.close();
  });

  it("moves container stacks and crafts through server-side slot refs", async () => {
    const server = new MockRuntimeServer({ port: 25680, fixture: "craft_smoke" });
    servers.push(server);
    await server.start();

    const client = await connect(server.endpoint());
    await request(client, { type: "connect", server_address: "dev.local", owner: { name: "test" } });
    const birth = await request(client, { type: "agent.birth", seed_prompt: "test", body_type: "server_agent" });
    const agentId = String(birth.agent_id);

    const scene = await request(client, { type: "tool.execute", agent_id: agentId, name: "observe.scene", arguments: {} });
    const visibleScene = scene.visible_scene as { visible_blocks: Array<{ block_ref: string; id: string }> };
    const chest = visibleScene.visible_blocks.find((block) => block.id === "minecraft:chest")!;
    const craftingTable = visibleScene.visible_blocks.find((block) => block.id === "minecraft:crafting_table")!;

    const chestOpen = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "container.open",
      arguments: { block_ref: chest.block_ref }
    });
    const chestSnapshot = chestOpen.result as ContainerSnapshot;
    const logSlot = chestSnapshot.slots.find((slot) => slot.item === "minecraft:oak_log")!;
    const emptyInventorySlot = chestSnapshot.inventory_slots.find((slot) => slot.item === null)!;

    const move = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "container.move_stack",
      arguments: {
        from_slot_ref: logSlot.slot_ref,
        to_slot_ref: emptyInventorySlot.slot_ref,
        count: 1
      }
    });
    expect(move).toMatchObject({ ok: true, result: { moved: { item: "minecraft:oak_log", count: 1 } } });

    const staleMove = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "container.move_stack",
      arguments: {
        from_slot_ref: logSlot.slot_ref,
        to_slot_ref: emptyInventorySlot.slot_ref,
        count: 1
      }
    });
    expect(staleMove).toMatchObject({ ok: false, reason: "stale_slot_ref" });

    const tableOpen = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "container.open",
      arguments: { block_ref: craftingTable.block_ref }
    });
    expect(tableOpen).toMatchObject({ ok: true, result: { kind: "crafting_table" } });

    const recipes = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "craft.list_available",
      arguments: { query: "oak_planks" }
    });
    expect(recipes).toMatchObject({
      ok: true,
      recipes: [{ recipe_id: "minecraft:oak_planks", craftable: true }]
    });

    const craft = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "craft.quick_craft",
      arguments: { recipe_id: "minecraft:oak_planks", count: 1 }
    });
    const craftSnapshot = (craft.result as { container: ContainerSnapshot }).container;
    expect(craftSnapshot.output_slot).toMatchObject({ item: "minecraft:oak_planks", count: 4 });

    const duplicateCraft = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "craft.quick_craft",
      arguments: { recipe_id: "minecraft:oak_planks", count: 1 }
    });
    expect(duplicateCraft).toMatchObject({ ok: false, reason: "inventory_full" });

    const outputSlot = craftSnapshot.output_slot!;
    const take = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "container.take_output",
      arguments: { slot_ref: outputSlot.slot_ref }
    });
    expect(take).toMatchObject({ ok: true, result: { taken: { item: "minecraft:oak_planks", count: 4 } } });

    const inventory = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "observe.inventory",
      arguments: {}
    });
    expect(countItem(inventory, "minecraft:oak_planks")).toBe(4);
    client.close();
  });

  it("returns structured crafting failures before material and station requirements are satisfied", async () => {
    const server = new MockRuntimeServer({ port: 25681, fixture: "craft_smoke" });
    servers.push(server);
    await server.start();

    const client = await connect(server.endpoint());
    await request(client, { type: "connect", server_address: "dev.local", owner: { name: "test" } });
    const birth = await request(client, { type: "agent.birth", seed_prompt: "test", body_type: "server_agent" });
    const agentId = String(birth.agent_id);

    const missingStation = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "craft.quick_craft",
      arguments: { recipe_id: "minecraft:oak_planks", count: 1 }
    });
    expect(missingStation).toMatchObject({ ok: false, reason: "station_too_far" });

    const scene = await request(client, { type: "tool.execute", agent_id: agentId, name: "observe.scene", arguments: {} });
    const visibleScene = scene.visible_scene as { visible_blocks: Array<{ block_ref: string; id: string }> };
    const craftingTable = visibleScene.visible_blocks.find((block) => block.id === "minecraft:crafting_table")!;
    await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "container.open",
      arguments: { block_ref: craftingTable.block_ref }
    });

    const missingMaterial = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "craft.quick_craft",
      arguments: { recipe_id: "minecraft:oak_planks", count: 1 }
    });
    expect(missingMaterial).toMatchObject({ ok: false, reason: "missing_material" });

    const invalidRecipe = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "craft.quick_craft",
      arguments: { recipe_id: "minecraft:diamond_pickaxe", count: 1 }
    });
    expect(invalidRecipe).toMatchObject({ ok: false, reason: "invalid_recipe" });
    client.close();
  });
});

interface SlotSnapshot {
  slot_ref: string;
  area: string;
  index: number;
  item: string | null;
  count: number;
}

interface ContainerSnapshot {
  container_id: string;
  kind: string;
  block_ref: string;
  slots: SlotSnapshot[];
  inventory_slots: SlotSnapshot[];
  output_slot: SlotSnapshot | null;
}

async function connect(endpoint: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(endpoint);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

async function request(socket: WebSocket, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const id = `test_${Math.random().toString(16).slice(2)}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${payload.type}`)), 5000);
    const onMessage = (raw: WebSocket.RawData) => {
      const data = JSON.parse(raw.toString());
      if (data.id !== id) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(data);
    };
    socket.on("message", onMessage);
    socket.send(JSON.stringify({ id, ...payload }));
  });
}

function countItem(inventory: Record<string, unknown>, itemId: string): number {
  const slots = ((inventory.inventory as { main?: Array<{ item?: string; count?: number }> } | undefined)?.main ?? []);
  return slots
    .filter((slot) => slot.item === itemId)
    .reduce((total, slot) => total + Number(slot.count ?? 0), 0);
}
