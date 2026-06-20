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
  });
});
