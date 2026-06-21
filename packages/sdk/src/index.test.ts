import { describe, expect, it } from "vitest";
import { Agent, submittedActionFromResult } from "./index.js";

describe("Agent SDK", () => {
  it("wraps body operations as dynamic tool executions", async () => {
    const calls: Array<{ name: string; args: unknown; options: unknown }> = [];
    const agent = new Agent(async (name, args, options) => {
      calls.push({ name, args, options });
      return { ok: true, result: {} };
    });

    await agent.body.move([1, 0, 0], 200);
    await agent.body.mine("blk_obs_1");
    await agent.body.use("blk_portal_frame", "minecraft:flint_and_steel", "east");
    await agent.body.sleep("blk_bed");
    await agent.body.place("blk_anchor", "up", "minecraft:obsidian");
    await agent.chat.sayLocal("Ready for portal materials.");
    await agent.observe.events({ limit: 10 });
    await agent.container.open("blk_chest");
    await agent.container.moveStack("slot_from", "slot_to", 3);
    await agent.container.clickSlot("slot_grid_1", "secondary");
    await agent.craft.quickCraft("minecraft:oak_planks", 2);

    expect(calls).toEqual([
      { name: "action.move", args: { vector: [1, 0, 0], durationMs: 200 }, options: undefined },
      {
        name: "action.mine_visible_block",
        args: { block_ref: "blk_obs_1", tool_policy: "best_available" },
        options: undefined
      },
      {
        name: "action.use",
        args: { target_ref: "blk_portal_frame", item: "minecraft:flint_and_steel", face: "east" },
        options: undefined
      },
      { name: "action.sleep", args: { target_ref: "blk_bed" }, options: undefined },
      {
        name: "block.place",
        args: { target_ref: "blk_anchor", face: "up", item: "minecraft:obsidian" },
        options: undefined
      },
      {
        name: "chat.say_local",
        args: { message: "Ready for portal materials." },
        options: undefined
      },
      {
        name: "observe.events",
        args: { limit: 10 },
        options: undefined
      },
      {
        name: "container.open",
        args: { block_ref: "blk_chest" },
        options: undefined
      },
      {
        name: "container.move_stack",
        args: { from_slot_ref: "slot_from", to_slot_ref: "slot_to", count: 3 },
        options: undefined
      },
      {
        name: "container.click_slot",
        args: { slot_ref: "slot_grid_1", button: "secondary" },
        options: undefined
      },
      {
        name: "craft.quick_craft",
        args: { recipe_id: "minecraft:oak_planks", count: 2 },
        options: undefined
      }
    ]);
  });

  it("submits queueable actions as action handles", async () => {
    const calls: Array<{ name: string; args: unknown; options: unknown }> = [];
    const agent = new Agent(async (name, args, options) => {
      calls.push({ name, args, options });
      return {
        ok: true,
        status: "accepted",
        action_id: "act_1",
        result: {
          action_id: "act_1",
          status: "accepted",
          lifecycle_status: "queued",
          tool_name: name,
          queue_depth: 1,
          max_queue_depth: 4
        }
      };
    });

    const handle = await agent.body.submitMove([0, 0, 0], 1000);

    expect(calls).toEqual([
      {
        name: "action.move",
        args: { vector: [0, 0, 0], durationMs: 1000 },
        options: { mode: "submit" }
      }
    ]);
    expect(handle).toMatchObject({
      ok: true,
      actionId: "act_1",
      status: "accepted",
      lifecycleStatus: "queued",
      toolName: "action.move",
      queueDepth: 1,
      maxQueueDepth: 4
    });
  });

  it("surfaces submit backpressure without constructing a handle", async () => {
    const agent = new Agent(async () => ({
      ok: false,
      reason: "backpressure_queue_full",
      message: "Agent action queue is full."
    }));

    await expect(agent.chat.submitSayLocal("wait")).resolves.toMatchObject({
      ok: false,
      reason: "backpressure_queue_full",
      message: "Agent action queue is full."
    });
  });

  it("wraps action status and cancel helpers", async () => {
    const calls: Array<{ name: string; args: unknown; options: unknown }> = [];
    const agent = new Agent(async (name, args, options) => {
      calls.push({ name, args, options });
      return {
        ok: true,
        status: "completed",
        result: {
          action_id: "act_1",
          status: name === "action.cancel" ? "cancelled" : "queued",
          lifecycle_status: name === "action.cancel" ? "cancelled" : "queued",
          tool_name: "action.move",
          queue_depth: name === "action.cancel" ? 0 : 1,
          max_queue_depth: 4
        }
      };
    });

    await expect(agent.actionStatus("act_1")).resolves.toMatchObject({
      ok: true,
      actionId: "act_1",
      lifecycleStatus: "queued",
      toolName: "action.move"
    });
    await expect(agent.cancelAction("act_1")).resolves.toMatchObject({
      ok: true,
      actionId: "act_1",
      lifecycleStatus: "cancelled",
      queueDepth: 0
    });

    expect(calls).toEqual([
      { name: "action.status", args: { action_id: "act_1" }, options: undefined },
      { name: "action.cancel", args: { action_id: "act_1" }, options: undefined }
    ]);
  });

  it("rejects malformed submit responses that omit action_id", () => {
    expect(submittedActionFromResult({ ok: true, status: "accepted", result: { status: "accepted" } })).toMatchObject({
      ok: false,
      reason: "missing_action_id"
    });
  });
});
