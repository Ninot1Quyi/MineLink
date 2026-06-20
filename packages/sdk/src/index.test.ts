import { describe, expect, it } from "vitest";
import { Agent } from "./index.js";

describe("Agent SDK", () => {
  it("wraps body operations as dynamic tool executions", async () => {
    const calls: Array<{ name: string; args: unknown }> = [];
    const agent = new Agent(async (name, args) => {
      calls.push({ name, args });
      return { ok: true, result: {} };
    });

    await agent.body.move([1, 0, 0], 200);
    await agent.body.mine("blk_obs_1");
    await agent.body.use("blk_portal_frame", "minecraft:flint_and_steel", "east");
    await agent.body.place("blk_anchor", "up", "minecraft:obsidian");
    await agent.container.open("blk_chest");
    await agent.container.moveStack("slot_from", "slot_to", 3);
    await agent.craft.quickCraft("minecraft:oak_planks", 2);

    expect(calls).toEqual([
      { name: "action.move", args: { vector: [1, 0, 0], durationMs: 200 } },
      {
        name: "action.mine_visible_block",
        args: { block_ref: "blk_obs_1", tool_policy: "best_available" }
      },
      {
        name: "action.use",
        args: { target_ref: "blk_portal_frame", item: "minecraft:flint_and_steel", face: "east" }
      },
      {
        name: "block.place",
        args: { target_ref: "blk_anchor", face: "up", item: "minecraft:obsidian" }
      },
      {
        name: "container.open",
        args: { block_ref: "blk_chest" }
      },
      {
        name: "container.move_stack",
        args: { from_slot_ref: "slot_from", to_slot_ref: "slot_to", count: 3 }
      },
      {
        name: "craft.quick_craft",
        args: { recipe_id: "minecraft:oak_planks", count: 2 }
      }
    ]);
  });
});
