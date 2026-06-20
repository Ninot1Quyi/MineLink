import type { JsonObject, ToolResult } from "@minelink/protocol";

export type MineLinkToolExecutor = (name: string, args?: JsonObject) => Promise<ToolResult>;

export class Agent {
  readonly observe: ObserveApi;
  readonly body: BodyApi;
  readonly chat: ChatApi;
  readonly create: CreateApi;
  readonly container: ContainerApi;
  readonly craft: CraftApi;

  constructor(private readonly execute: MineLinkToolExecutor) {
    this.observe = new ObserveApi(execute);
    this.body = new BodyApi(execute);
    this.chat = new ChatApi(execute);
    this.create = new CreateApi(execute);
    this.container = new ContainerApi(execute);
    this.craft = new CraftApi(execute);
  }

  toolExecute(name: string, args: JsonObject = {}): Promise<ToolResult> {
    return this.execute(name, args);
  }
}

export class ObserveApi {
  constructor(private readonly execute: MineLinkToolExecutor) {}

  self(): Promise<ToolResult> {
    return this.execute("observe.self");
  }

  scene(args: JsonObject = {}): Promise<ToolResult> {
    return this.execute("observe.scene", args);
  }

  inventory(): Promise<ToolResult> {
    return this.execute("observe.inventory");
  }

  events(args: JsonObject = {}): Promise<ToolResult> {
    return this.execute("observe.events", args);
  }
}

export class BodyApi {
  constructor(private readonly execute: MineLinkToolExecutor) {}

  move(vector: [number, number, number], durationMs = 250): Promise<ToolResult> {
    return this.execute("action.move", { vector, durationMs });
  }

  lookAt(blockRef: string): Promise<ToolResult> {
    return this.execute("action.look_at", { block_ref: blockRef });
  }

  mine(blockRef: string): Promise<ToolResult> {
    return this.execute("action.mine_visible_block", { block_ref: blockRef, tool_policy: "best_available" });
  }

  use(targetRef?: string, item?: string, face?: string): Promise<ToolResult> {
    return this.execute("action.use", {
      ...(targetRef ? { target_ref: targetRef } : {}),
      ...(item ? { item } : {}),
      ...(face ? { face } : {})
    });
  }

  sleep(targetRef: string): Promise<ToolResult> {
    return this.execute("action.sleep", { target_ref: targetRef });
  }

  place(targetRef: string, face: string, item: string, placementLabel?: string): Promise<ToolResult> {
    return this.execute("block.place", {
      target_ref: targetRef,
      face,
      item,
      ...(placementLabel ? { placement_label: placementLabel } : {})
    });
  }
}

export class ChatApi {
  constructor(private readonly execute: MineLinkToolExecutor) {}

  sayLocal(message: string): Promise<ToolResult> {
    return this.execute("chat.say_local", { message });
  }
}

export class CreateApi {
  constructor(private readonly execute: MineLinkToolExecutor) {}

  inspectComponent(blockRef: string): Promise<ToolResult> {
    return this.execute("create.inspect_component", { block_ref: blockRef });
  }
}

export class ContainerApi {
  constructor(private readonly execute: MineLinkToolExecutor) {}

  open(blockRef: string): Promise<ToolResult> {
    return this.execute("container.open", { block_ref: blockRef });
  }

  observe(): Promise<ToolResult> {
    return this.execute("container.observe");
  }

  moveStack(fromSlotRef: string, toSlotRef: string, count?: number): Promise<ToolResult> {
    return this.execute("container.move_stack", {
      from_slot_ref: fromSlotRef,
      to_slot_ref: toSlotRef,
      ...(count === undefined ? {} : { count })
    });
  }

  takeOutput(slotRef?: string): Promise<ToolResult> {
    return this.execute("container.take_output", slotRef ? { slot_ref: slotRef } : {});
  }
}

export class CraftApi {
  constructor(private readonly execute: MineLinkToolExecutor) {}

  listAvailable(query?: string, limit?: number): Promise<ToolResult> {
    return this.execute("craft.list_available", {
      ...(query === undefined ? {} : { query }),
      ...(limit === undefined ? {} : { limit })
    });
  }

  quickCraft(recipeId: string, count = 1): Promise<ToolResult> {
    return this.execute("craft.quick_craft", { recipe_id: recipeId, count });
  }
}
