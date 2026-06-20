import { describe, expect, it } from "vitest";
import { filterDynamicTools, findDynamicTool, ToolExecuteArgsSchema } from "./index.js";

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
  });

  it("normalizes tool_execute mode", () => {
    expect(ToolExecuteArgsSchema.parse({ name: "observe.self", arguments: {} }).mode).toBe(
      "await_completion"
    );
  });
});
