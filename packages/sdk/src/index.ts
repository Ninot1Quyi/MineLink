import type { JsonObject, ToolResult } from "@minelink/protocol";

export type ToolExecutionMode = "await_completion" | "submit";

export interface ToolExecuteOptions {
  mode?: ToolExecutionMode;
}

export type MineLinkToolExecutor = (name: string, args?: JsonObject, options?: ToolExecuteOptions) => Promise<ToolResult>;

export interface SubmittedActionOk {
  ok: true;
  actionId: string;
  status: string;
  lifecycleStatus?: string;
  toolName?: string;
  queueDepth?: number;
  maxQueueDepth?: number;
  raw: ToolResult;
}

export interface SubmittedActionError {
  ok: false;
  reason: string;
  message?: string;
  raw: ToolResult;
}

export type SubmittedAction = SubmittedActionOk | SubmittedActionError;

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

  toolExecute(name: string, args: JsonObject = {}, options?: ToolExecuteOptions): Promise<ToolResult> {
    return this.execute(name, args, options);
  }

  async submitToolExecute(name: string, args: JsonObject = {}): Promise<SubmittedAction> {
    return submitAction(this.execute, name, args);
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

  move(vector: [number, number, number], durationMs = 250, options?: ToolExecuteOptions): Promise<ToolResult> {
    return this.execute("action.move", { vector, durationMs }, options);
  }

  submitMove(vector: [number, number, number], durationMs = 250): Promise<SubmittedAction> {
    return submitAction(this.execute, "action.move", { vector, durationMs });
  }

  lookAt(blockRef: string, options?: ToolExecuteOptions): Promise<ToolResult> {
    return this.execute("action.look_at", { block_ref: blockRef }, options);
  }

  submitLookAt(blockRef: string): Promise<SubmittedAction> {
    return submitAction(this.execute, "action.look_at", { block_ref: blockRef });
  }

  mine(blockRef: string, options?: ToolExecuteOptions): Promise<ToolResult> {
    return this.execute("action.mine_visible_block", { block_ref: blockRef, tool_policy: "best_available" }, options);
  }

  submitMine(blockRef: string): Promise<SubmittedAction> {
    return submitAction(this.execute, "action.mine_visible_block", {
      block_ref: blockRef,
      tool_policy: "best_available"
    });
  }

  use(targetRef?: string, item?: string, face?: string, options?: ToolExecuteOptions): Promise<ToolResult> {
    return this.execute(
      "action.use",
      {
        ...(targetRef ? { target_ref: targetRef } : {}),
        ...(item ? { item } : {}),
        ...(face ? { face } : {})
      },
      options
    );
  }

  submitUse(targetRef?: string, item?: string, face?: string): Promise<SubmittedAction> {
    return submitAction(this.execute, "action.use", {
      ...(targetRef ? { target_ref: targetRef } : {}),
      ...(item ? { item } : {}),
      ...(face ? { face } : {})
    });
  }

  sleep(targetRef: string, options?: ToolExecuteOptions): Promise<ToolResult> {
    return this.execute("action.sleep", { target_ref: targetRef }, options);
  }

  submitSleep(targetRef: string): Promise<SubmittedAction> {
    return submitAction(this.execute, "action.sleep", { target_ref: targetRef });
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

  sayLocal(message: string, options?: ToolExecuteOptions): Promise<ToolResult> {
    return this.execute("chat.say_local", { message }, options);
  }

  submitSayLocal(message: string): Promise<SubmittedAction> {
    return submitAction(this.execute, "chat.say_local", { message });
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

  clickSlot(slotRef: string, button?: "primary" | "secondary" | "left" | "right"): Promise<ToolResult> {
    return this.execute("container.click_slot", {
      slot_ref: slotRef,
      ...(button === undefined ? {} : { button })
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

export async function submitAction(
  execute: MineLinkToolExecutor,
  name: string,
  args: JsonObject = {}
): Promise<SubmittedAction> {
  return submittedActionFromResult(await execute(name, args, { mode: "submit" }));
}

export function submittedActionFromResult(raw: ToolResult): SubmittedAction {
  if (!raw.ok) {
    return {
      ok: false,
      reason: String(raw.reason),
      ...(typeof raw.message === "string" ? { message: raw.message } : {}),
      raw
    };
  }

  const payload = actionPayload(raw);
  const actionId = stringField(payload, "action_id");
  if (!actionId) {
    return {
      ok: false,
      reason: "missing_action_id",
      message: "Submit-mode MineLink action did not return an action_id.",
      raw
    };
  }

  return {
    ok: true,
    actionId,
    status: stringField(payload, "status") ?? "accepted",
    ...(stringField(payload, "lifecycle_status") ? { lifecycleStatus: stringField(payload, "lifecycle_status") } : {}),
    ...(stringField(payload, "tool_name") ? { toolName: stringField(payload, "tool_name") } : {}),
    ...(numberField(payload, "queue_depth") === undefined ? {} : { queueDepth: numberField(payload, "queue_depth") }),
    ...(numberField(payload, "max_queue_depth") === undefined
      ? {}
      : { maxQueueDepth: numberField(payload, "max_queue_depth") }),
    raw
  };
}

function actionPayload(raw: ToolResult): JsonObject {
  const topLevel = asObject(raw) ?? {};
  const result = asObject(raw.result) ?? {};
  const nestedResult = asObject(result.result) ?? {};
  return {
    ...topLevel,
    ...result,
    ...nestedResult,
    action_id: topLevel.action_id ?? result.action_id ?? nestedResult.action_id,
    status: topLevel.status ?? result.status ?? nestedResult.status
  };
}

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function stringField(value: JsonObject | undefined, key: string): string | undefined {
  const field = value?.[key];
  return typeof field === "string" ? field : undefined;
}

function numberField(value: JsonObject | undefined, key: string): number | undefined {
  const field = value?.[key];
  return typeof field === "number" ? field : undefined;
}
