import { describe, expect, it } from "vitest";
import { DYNAMIC_TOOLS, filterDynamicTools, findDynamicTool, ToolExecuteArgsSchema } from "./index.js";

describe("protocol catalog", () => {
  it("finds lazy dynamic tools by namespace and query", () => {
    expect(filterDynamicTools({ namespace: "action" }).map((tool) => tool.name)).toContain(
      "action.mine_visible_block"
    );
    expect(filterDynamicTools({ query: "Create" }).map((tool) => tool.name)).toEqual([
      "create.inspect_component"
    ]);
  });

  it("keeps dynamic tool definitions queryable", () => {
    const tool = findDynamicTool("observe.scene");
    expect(tool?.input_schema).toMatchObject({ type: "object" });
    expect(findDynamicTool("action.sleep")?.preconditions).toContain(
      "target_ref comes from a recent observe.scene result"
    );
  });

  it("keeps notice board tools bounded to observed refs", () => {
    const names = filterDynamicTools({ query: "notice board" }).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["notice.post", "notice.observe"]));
    expect(findDynamicTool("notice.post")?.input_schema).toMatchObject({
      required: ["board_ref", "message"]
    });
    expect(findDynamicTool("notice.observe")?.failure_reasons).toEqual(
      expect.arrayContaining(["unknown_or_unobserved_target", "expired_ref", "unsupported_capability"])
    );
    expect(DYNAMIC_TOOLS.map((tool) => tool.name)).not.toContain("notice.list_all");
  });

  it("keeps Create tools bounded to visible component inspection", () => {
    expect(DYNAMIC_TOOLS.map((tool) => tool.name)).not.toContain("create.auto_build_factory");
    expect(findDynamicTool("create.inspect_component")?.failure_reasons).toEqual(
      expect.arrayContaining(["unknown_or_unobserved_target", "expired_ref", "target_too_far"])
    );
  });

  it("normalizes tool_execute mode", () => {
    expect(ToolExecuteArgsSchema.parse({ name: "observe.self", arguments: {} }).mode).toBe(
      "await_completion"
    );
    expect(ToolExecuteArgsSchema.parse({ name: "action.move", mode: "submit", arguments: {} }).mode).toBe("submit");
    expect(() =>
      ToolExecuteArgsSchema.parse({ name: "action.move", mode: "fire_and_forget", arguments: {} })
    ).toThrow();
  });
});
