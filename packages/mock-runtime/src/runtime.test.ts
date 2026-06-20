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

  it("clips movement against visible guard-boundary blocks", async () => {
    const server = new MockRuntimeServer({ port: 25684, fixture: "guard_boundaries" });
    servers.push(server);
    await server.start();

    const client = await connect(server.endpoint());
    await request(client, { type: "connect", server_address: "dev.local", owner: { name: "test" } });
    const birth = await request(client, { type: "agent.birth", seed_prompt: "test", body_type: "server_agent" });
    const agentId = String(birth.agent_id);

    const move = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "action.move",
      arguments: { vector: [4, 0, 0], durationMs: 1000 }
    });
    expect(move).toMatchObject({
      ok: true,
      result: {
        collision: true,
        requested_distance: 4
      }
    });
    const moveResult = move.result as { moved_distance: number; position: [number, number, number] };
    expect(moveResult.moved_distance).toBeLessThan(4);
    expect(moveResult.position[0]).toBeLessThan(2);

    const observe = await request(client, { type: "tool.execute", agent_id: agentId, name: "observe.scene", arguments: {} });
    const visibleScene = observe.visible_scene as { visible_blocks: Array<{ block_ref: string; id: string }> };
    expect(visibleScene.visible_blocks.some((block) => block.id === "minecraft:diamond_ore")).toBe(false);
    const stone = visibleScene.visible_blocks.find((block) => block.id === "minecraft:stone")!;
    await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "action.look_at",
      arguments: { block_ref: stone.block_ref }
    });
    const mineStone = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "action.mine_visible_block",
      arguments: { block_ref: stone.block_ref }
    });
    expect(mineStone).toMatchObject({ ok: false, reason: "wrong_tool" });
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

  it("shares local chat events only with nearby server agents", async () => {
    const server = new MockRuntimeServer({ port: 25683, fixture: "portal_coop" });
    servers.push(server);
    await server.start();

    const clientA = await connect(server.endpoint());
    const clientB = await connect(server.endpoint());
    const hello = await request(clientA, { type: "hello" });
    expect(hello).toMatchObject({ ok: true, capabilities: { social_events: true } });
    await request(clientA, { type: "connect", server_address: "dev.local", owner: { name: "a" } });
    await request(clientB, { type: "connect", server_address: "dev.local", owner: { name: "b" } });
    const birthA = await request(clientA, { type: "agent.birth", seed_prompt: "builder a", body_type: "server_agent" });
    const birthB = await request(clientB, { type: "agent.birth", seed_prompt: "builder b", body_type: "server_agent" });
    const agentA = String(birthA.agent_id);
    const agentB = String(birthB.agent_id);

    const say = await request(clientA, {
      type: "tool.execute",
      agent_id: agentA,
      name: "chat.say_local",
      arguments: { message: "Ready to share obsidian." }
    });
    expect(say).toMatchObject({
      ok: true,
      result: { event: { type: "chat.local", visibility: "self", distance_band: "self" } }
    });
    const sayResult = say.result as { event: Record<string, unknown>; recipient_count?: unknown; recipients?: unknown };
    expect(sayResult).toHaveProperty("recipient_count");
    expect(sayResult).not.toHaveProperty("recipients");
    expect(sayResult.event).not.toHaveProperty("position");
    expect(sayResult.event).not.toHaveProperty("radius");
    expect(sayResult.event).not.toHaveProperty("observer_distance");

    const nearbyEvents = await request(clientB, {
      type: "tool.execute",
      agent_id: agentB,
      name: "observe.events",
      arguments: { limit: 10 }
    });
    const seenEvent = (nearbyEvents.events as Array<Record<string, unknown>>).find(
      (event) => event.source_agent_id === agentA && event.message === "Ready to share obsidian."
    );
    expect(seenEvent).toMatchObject({
      source_agent_id: agentA,
      message: "Ready to share obsidian.",
      visibility: "audible_local",
      distance_band: "nearby"
    });
    expect(seenEvent).not.toHaveProperty("position");
    expect(seenEvent).not.toHaveProperty("radius");
    expect(seenEvent).not.toHaveProperty("observer_distance");
    expect(nearbyEvents.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_agent_id: agentA,
          message: "Ready to share obsidian."
        })
      ])
    );
    const invalidCursor = await request(clientB, {
      type: "tool.execute",
      agent_id: agentB,
      name: "observe.events",
      arguments: { after_event_id: "event_missing" }
    });
    expect(invalidCursor).toMatchObject({ ok: false, reason: "invalid_cursor" });

    for (let step = 0; step < 5; step++) {
      await request(clientB, {
        type: "tool.execute",
        agent_id: agentB,
        name: "action.move",
        arguments: { vector: [4, 0, 0], durationMs: 1000 }
      });
    }
    await request(clientA, {
      type: "tool.execute",
      agent_id: agentA,
      name: "chat.say_local",
      arguments: { message: "This should be too far away." }
    });
    const farEvents = await request(clientB, {
      type: "tool.execute",
      agent_id: agentB,
      name: "observe.events",
      arguments: { limit: 10 }
    });
    expect(JSON.stringify(farEvents.events)).not.toContain("This should be too far away.");
    clientA.close();
    clientB.close();
  });

  it("places, uses, and inspects Create components from chest materials with valid JSONL traces", async () => {
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
    const chest = visibleScene.visible_blocks.find((block) => block.id === "minecraft:chest")!;
    const anchor = visibleScene.visible_blocks.find((block) => block.tags.includes("minelink:create_build_anchor"))!;

    const chestOpen = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "container.open",
      arguments: { block_ref: chest.block_ref }
    });
    const chestSnapshot = chestOpen.result as ContainerSnapshot;
    const shaftSlot = chestSnapshot.slots.find((slot) => slot.item === "create:shaft")!;
    const firstInventorySlot = chestSnapshot.inventory_slots.find((slot) => slot.item === null)!;
    const moveShaft = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "container.move_stack",
      arguments: { from_slot_ref: shaftSlot.slot_ref, to_slot_ref: firstInventorySlot.slot_ref, count: 1 }
    });
    expect(moveShaft).toMatchObject({ ok: true, result: { moved: { item: "create:shaft", count: 1 } } });

    const moveShaftResult = moveShaft.result as { container: ContainerSnapshot };
    const afterShaft = moveShaftResult.container;
    const wrenchSlot = afterShaft.slots.find((slot) => slot.item === "create:wrench")!;
    const secondInventorySlot = afterShaft.inventory_slots.find((slot) => slot.item === null)!;
    const moveWrench = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "container.move_stack",
      arguments: { from_slot_ref: wrenchSlot.slot_ref, to_slot_ref: secondInventorySlot.slot_ref, count: 1 }
    });
    expect(moveWrench).toMatchObject({ ok: true, result: { moved: { item: "create:wrench", count: 1 } } });

    const afterWrench = (moveWrench.result as { container: ContainerSnapshot }).container;
    const cogwheelSlot = afterWrench.slots.find((slot) => slot.item === "create:cogwheel")!;
    const thirdInventorySlot = afterWrench.inventory_slots.find((slot) => slot.item === null)!;
    const moveCogwheel = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "container.move_stack",
      arguments: { from_slot_ref: cogwheelSlot.slot_ref, to_slot_ref: thirdInventorySlot.slot_ref, count: 1 }
    });
    expect(moveCogwheel).toMatchObject({ ok: true, result: { moved: { item: "create:cogwheel", count: 1 } } });

    const afterCogwheel = (moveCogwheel.result as { container: ContainerSnapshot }).container;
    const depotSlot = afterCogwheel.slots.find((slot) => slot.item === "create:depot")!;
    const fourthInventorySlot = afterCogwheel.inventory_slots.find((slot) => slot.item === null)!;
    const moveDepot = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "container.move_stack",
      arguments: { from_slot_ref: depotSlot.slot_ref, to_slot_ref: fourthInventorySlot.slot_ref, count: 1 }
    });
    expect(moveDepot).toMatchObject({ ok: true, result: { moved: { item: "create:depot", count: 1 } } });

    const afterDepot = (moveDepot.result as { container: ContainerSnapshot }).container;
    const pressSlot = afterDepot.slots.find((slot) => slot.item === "create:mechanical_press")!;
    const fifthInventorySlot = afterDepot.inventory_slots.find((slot) => slot.item === null)!;
    const movePress = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "container.move_stack",
      arguments: { from_slot_ref: pressSlot.slot_ref, to_slot_ref: fifthInventorySlot.slot_ref, count: 1 }
    });
    expect(movePress).toMatchObject({ ok: true, result: { moved: { item: "create:mechanical_press", count: 1 } } });

    const afterPress = (movePress.result as { container: ContainerSnapshot }).container;
    const ironSlot = afterPress.slots.find((slot) => slot.item === "minecraft:iron_ingot")!;
    const sixthInventorySlot = afterPress.inventory_slots.find((slot) => slot.item === null)!;
    const moveIron = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "container.move_stack",
      arguments: { from_slot_ref: ironSlot.slot_ref, to_slot_ref: sixthInventorySlot.slot_ref, count: 1 }
    });
    expect(moveIron).toMatchObject({ ok: true, result: { moved: { item: "minecraft:iron_ingot", count: 1 } } });

    const inspectAnchor = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "create.inspect_component",
      arguments: { block_ref: anchor.block_ref }
    });
    expect(inspectAnchor).toMatchObject({ ok: false, reason: "unsupported_capability" });

    const place = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "block.place",
      arguments: { target_ref: anchor.block_ref, face: "up", item: "create:shaft" }
    });
    expect(place).toMatchObject({ ok: true, result: { placed: { id: "create:shaft" } } });

    const afterPlace = await request(client, { type: "tool.execute", agent_id: agentId, name: "observe.scene", arguments: {} });
    const sceneAfterPlace = afterPlace.visible_scene as { visible_blocks: Array<{ block_ref: string; id: string; tags: string[] }> };
    const shaft = sceneAfterPlace.visible_blocks.find((block) => block.id === "create:shaft")!;
    const cogwheel = sceneAfterPlace.visible_blocks.find((block) => block.id === "create:cogwheel")!;
    const depot = sceneAfterPlace.visible_blocks.find((block) => block.id === "create:depot")!;
    const press = sceneAfterPlace.visible_blocks.find((block) => block.id === "create:mechanical_press")!;
    const belt = sceneAfterPlace.visible_blocks.find((block) => block.id === "create:belt")!;
    const inspect = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "create.inspect_component",
      arguments: { block_ref: shaft.block_ref }
    });
    expect(inspect).toMatchObject({
      ok: true,
      result: {
        id: "create:shaft",
        create: {
          kind: "shaft",
          role: "kinetic_relay",
          kinetic: { speed_hint: "stopped" },
          unsupported_client_capabilities: expect.arrayContaining(["create_ponder_overlay", "jei_recipe_overlay"])
        }
      }
    });

    for (const [block, kind] of [
      [cogwheel, "cogwheel"],
      [depot, "depot"],
      [press, "mechanical_press"],
      [belt, "belt"]
    ] as const) {
      const inspected = await request(client, {
        type: "tool.execute",
        agent_id: agentId,
        name: "create.inspect_component",
        arguments: { block_ref: block.block_ref }
      });
      expect(inspected).toMatchObject({
        ok: true,
        result: {
          create: {
            kind,
            kinetic: expect.objectContaining({
              speed_hint: expect.any(String)
            }),
            common_blockage_reasons: expect.any(Array),
            supported_interactions: expect.any(Array),
            wrench_relevant_faces: expect.any(Array),
            unsupported_client_capabilities: expect.arrayContaining(["client_goggle_overlay"])
          }
        }
      });
      const inspectedCreate = (inspected.result as { create: Record<string, unknown> }).create;
      expect(inspectedCreate.kinetic).toHaveProperty("stress_impact");
      expect(inspectedCreate.kinetic).toHaveProperty("stress_capacity");
      if (kind === "mechanical_press") {
        expect(inspectedCreate.kinetic).toMatchObject({ speed: 16, speed_hint: "moving_positive" });
        expect(inspectedCreate.press).toMatchObject({ kinetic_speed: 16, pressing_behaviour_present: true });
      }
    }

    const use = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "action.use",
      arguments: { target_ref: shaft.block_ref, item: "create:wrench", face: "up" }
    });
    expect(use).toMatchObject({ ok: true, result: { used: true } });

    const pressInput = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "action.use",
      arguments: { target_ref: depot.block_ref, item: "minecraft:iron_ingot", face: "up" }
    });
    expect(pressInput).toMatchObject({
      ok: true,
      result: { used: true, processed: { input: "minecraft:iron_ingot", output: { item: "create:iron_sheet", count: 1 } } }
    });

    const inspectProcessedDepot = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "create.inspect_component",
      arguments: { block_ref: depot.block_ref }
    });
    expect(inspectProcessedDepot).toMatchObject({
      ok: true,
      result: {
        create: {
          kind: "depot",
          inventory: { held_item: { item: "create:iron_sheet", count: 1 } }
        }
      }
    });

    const pickupSheet = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "action.use",
      arguments: { target_ref: depot.block_ref, face: "up" }
    });
    expect(pickupSheet).toMatchObject({
      ok: true,
      result: { used: true, hand: "empty", taken: { item: "create:iron_sheet", count: 1 } }
    });

    const inventoryAfterPickup = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "observe.inventory",
      arguments: {}
    });
    expect(inventoryAfterPickup).toMatchObject({
      inventory: {
        main: expect.arrayContaining([expect.objectContaining({ item: "create:iron_sheet", count: 1 })])
      }
    });

    for (let step = 0; step < 3; step++) {
      await request(client, {
        type: "tool.execute",
        agent_id: agentId,
        name: "action.move",
        arguments: { vector: [4, 0, 0], durationMs: 1000 }
      });
    }
    const farInspect = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "create.inspect_component",
      arguments: { block_ref: shaft.block_ref }
    });
    expect(farInspect).toMatchObject({ ok: false, reason: "target_too_far" });

    const lines = readFileSync(tracePath, "utf8").trim().split("\n");
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.map((line) => JSON.parse(line)).some((event) => event.event === "agent.observe")).toBe(true);
    client.close();
  });

  it("rejects non-block Create items during mock placement", async () => {
    const server = new MockRuntimeServer({ port: 25682, fixture: "create_smoke" });
    servers.push(server);
    await server.start();

    const client = await connect(server.endpoint());
    await request(client, { type: "connect", server_address: "dev.local", owner: { name: "test" } });
    const birth = await request(client, { type: "agent.birth", seed_prompt: "test", body_type: "server_agent" });
    const agentId = String(birth.agent_id);
    const observe = await request(client, { type: "tool.execute", agent_id: agentId, name: "observe.scene", arguments: {} });
    const visibleScene = observe.visible_scene as { visible_blocks: Array<{ block_ref: string; id: string; tags: string[] }> };
    const chest = visibleScene.visible_blocks.find((block) => block.id === "minecraft:chest")!;
    const anchor = visibleScene.visible_blocks.find((block) => block.tags.includes("minelink:create_build_anchor"))!;

    const chestOpen = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "container.open",
      arguments: { block_ref: chest.block_ref }
    });
    const chestSnapshot = chestOpen.result as ContainerSnapshot;
    const wrenchSlot = chestSnapshot.slots.find((slot) => slot.item === "create:wrench")!;
    const inventorySlot = chestSnapshot.inventory_slots.find((slot) => slot.item === null)!;
    const moveWrench = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "container.move_stack",
      arguments: { from_slot_ref: wrenchSlot.slot_ref, to_slot_ref: inventorySlot.slot_ref, count: 1 }
    });
    expect(moveWrench).toMatchObject({ ok: true, result: { moved: { item: "create:wrench", count: 1 } } });

    const placeWrench = await request(client, {
      type: "tool.execute",
      agent_id: agentId,
      name: "block.place",
      arguments: { target_ref: anchor.block_ref, face: "up", item: "create:wrench" }
    });
    expect(placeWrench).toMatchObject({ ok: false, reason: "unsupported_capability" });
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
