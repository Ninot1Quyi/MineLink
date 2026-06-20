import { z } from "zod";

export const MINELINK_PROTOCOL_VERSION = "0.1";
export const MINELINK_HOST_VERSION = "0.1.0";

export const FAILURE_REASONS = [
  "unsupported_online_auth",
  "not_connected",
  "agent_not_born",
  "unknown_tool",
  "invalid_arguments",
  "unknown_or_unobserved_target",
  "expired_ref",
  "target_too_far",
  "target_not_visible",
  "target_not_visible_from_current_view",
  "must_turn_first",
  "blocked",
  "wrong_tool",
  "backpressure_queue_full",
  "action_timeout",
  "runtime_unavailable",
  "unsupported_capability",
  "container_not_open",
  "stale_slot_ref",
  "missing_material",
  "invalid_recipe",
  "inventory_full",
  "station_too_far"
] as const;

export type FailureReason = (typeof FAILURE_REASONS)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const JsonObjectSchema: z.ZodType<JsonObject> = z.record(
  z.string(),
  z.lazy((): z.ZodType<JsonValue> =>
    z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValueSchema), JsonObjectSchema])
  )
);

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValueSchema), JsonObjectSchema])
);

export const MineLinkEnvelopeSchema = z
  .object({
    id: z.string().optional(),
    type: z.string().min(1)
  })
  .passthrough();

export const ConnectServerArgsSchema = z.object({
  endpoint: z.string().min(1).default("ws://127.0.0.1:25575"),
  serverAddress: z.string().min(1).default("dev.local"),
  ownerName: z.string().min(1).max(64).default("codex_workspace_01"),
  admissionToken: z.string().nullable().optional()
});

export type ConnectServerArgs = z.infer<typeof ConnectServerArgsSchema>;

export const BirthArgsSchema = z.object({
  seedPrompt: z.string().max(2000).default("A cautious but curious newcomer."),
  bodyType: z.literal("server_agent").default("server_agent")
});

export type BirthArgs = z.infer<typeof BirthArgsSchema>;

export const ToolListArgsSchema = z.object({
  namespace: z.string().optional(),
  query: z.string().optional(),
  tags: z.array(z.string()).optional(),
  cursor: z.string().nullable().optional(),
  limit: z.number().int().min(1).max(50).default(20)
});

export type ToolListArgs = z.infer<typeof ToolListArgsSchema>;

export const ToolQueryArgsSchema = z.object({
  name: z.string().min(1)
});

export type ToolQueryArgs = z.infer<typeof ToolQueryArgsSchema>;

export const ToolExecuteArgsSchema = z.object({
  name: z.string().min(1),
  mode: z.enum(["await_completion", "submit"]).default("await_completion"),
  arguments: JsonObjectSchema.default({})
});

export type ToolExecuteArgs = z.infer<typeof ToolExecuteArgsSchema>;

export interface DynamicToolDefinition {
  name: string;
  summary: string;
  description: string;
  tags: string[];
  input_schema: JsonObject;
  preconditions?: string[];
  failure_reasons?: FailureReason[];
}

export const DYNAMIC_TOOLS: DynamicToolDefinition[] = [
  {
    name: "observe.self",
    summary: "Observe the active server_agent body state.",
    description: "Returns health, hunger, position, yaw, pitch, current action, and body capability flags.",
    tags: ["observe", "self", "survival"],
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "observe.scene",
    summary: "Observe visible nearby surfaces and entities from the current body.",
    description: "Returns a bounded visible scene with short-lived refs. It is not a chunk oracle.",
    tags: ["observe", "scene", "perception"],
    input_schema: {
      type: "object",
      properties: {
        radius: { type: "number", minimum: 1, maximum: 32, default: 16 },
        include: {
          type: "array",
          items: { type: "string" },
          default: ["visible_blocks", "nearby_entities"]
        }
      }
    },
    failure_reasons: ["runtime_unavailable"]
  },
  {
    name: "observe.inventory",
    summary: "Observe the active server_agent inventory.",
    description: "Returns hotbar, main inventory, selected slot, and equipment known to the server.",
    tags: ["observe", "inventory"],
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "action.move",
    summary: "Move the active body using legal motor primitives.",
    description: "Moves by a small vector/duration and returns collision and moved distance feedback.",
    tags: ["action", "movement"],
    input_schema: {
      type: "object",
      required: ["vector", "durationMs"],
      properties: {
        vector: { type: "array", minItems: 3, maxItems: 3, items: { type: "number" } },
        durationMs: { type: "number", minimum: 50, maximum: 5000 }
      }
    },
    failure_reasons: ["blocked", "backpressure_queue_full"]
  },
  {
    name: "action.look_at",
    summary: "Turn toward a visible ref or point.",
    description: "Updates the body orientation. Refs must come from a current observation.",
    tags: ["action", "look"],
    input_schema: {
      type: "object",
      properties: {
        block_ref: { type: "string" },
        entity_ref: { type: "string" },
        point: { type: "array", minItems: 3, maxItems: 3, items: { type: "number" } }
      }
    },
    failure_reasons: ["unknown_or_unobserved_target", "expired_ref"]
  },
  {
    name: "action.mine_visible_block",
    summary: "Mine a currently visible block ref.",
    description: "Mines through server-side guard checks. It never accepts hidden ore coordinates as authority.",
    tags: ["action", "mine", "survival"],
    input_schema: {
      type: "object",
      required: ["block_ref"],
      properties: {
        block_ref: { type: "string" },
        tool_policy: { type: "string", default: "best_available" }
      }
    },
    preconditions: ["block_ref comes from a recent observe.scene result", "target is visible and reachable"],
    failure_reasons: ["unknown_or_unobserved_target", "expired_ref", "target_too_far", "target_not_visible", "wrong_tool"]
  },
  {
    name: "action.use",
    summary: "Use the selected item or a visible target.",
    description: "Runs a server-side use/interact action when allowed.",
    tags: ["action", "use"],
    input_schema: {
      type: "object",
      properties: {
        target_ref: { type: "string" },
        item: { type: "string" },
        face: { type: "string", enum: ["up", "down", "north", "south", "east", "west"] }
      }
    },
    failure_reasons: ["unsupported_capability", "target_too_far", "target_not_visible", "missing_material", "blocked"]
  },
  {
    name: "block.place",
    summary: "Place a block from inventory against a visible target.",
    description: "Places only through server-side reach, visibility, inventory, and occupancy checks.",
    tags: ["action", "build", "survival"],
    input_schema: {
      type: "object",
      required: ["target_ref", "face", "item"],
      properties: {
        target_ref: { type: "string" },
        face: { type: "string", enum: ["up", "down", "north", "south", "east", "west"] },
        item: { type: "string" },
        placement_label: { type: "string" }
      }
    },
    failure_reasons: [
      "unknown_or_unobserved_target",
      "expired_ref",
      "target_too_far",
      "target_not_visible",
      "missing_material",
      "blocked",
      "unsupported_capability",
      "invalid_arguments"
    ]
  },
  {
    name: "chat.say_local",
    summary: "Say a local chat message from the active server_agent.",
    description: "Sends a bounded local chat/social event with normal rate limits.",
    tags: ["chat", "social"],
    input_schema: {
      type: "object",
      required: ["message"],
      properties: { message: { type: "string", minLength: 1, maxLength: 256 } }
    }
  },
  {
    name: "container.open",
    summary: "Open a visible server-side container block.",
    description: "Opens a reachable container using server interaction rules.",
    tags: ["container"],
    input_schema: { type: "object", required: ["block_ref"], properties: { block_ref: { type: "string" } } },
    failure_reasons: [
      "unknown_or_unobserved_target",
      "expired_ref",
      "target_too_far",
      "target_not_visible",
      "unsupported_capability"
    ]
  },
  {
    name: "container.observe",
    summary: "Observe the currently open server-side container.",
    description: "Returns server slot refs for the currently opened container.",
    tags: ["container", "observe"],
    input_schema: { type: "object", properties: {} },
    failure_reasons: ["container_not_open"]
  },
  {
    name: "container.move_stack",
    summary: "Move items between server container slots.",
    description: "Moves item stacks through normal slot/menu rules.",
    tags: ["container"],
    input_schema: {
      type: "object",
      required: ["from_slot_ref", "to_slot_ref"],
      properties: {
        from_slot_ref: { type: "string" },
        to_slot_ref: { type: "string" },
        count: { type: "number", minimum: 1 }
      }
    },
    failure_reasons: ["container_not_open", "stale_slot_ref", "missing_material", "inventory_full", "invalid_arguments"]
  },
  {
    name: "container.take_output",
    summary: "Take output from an open crafting or processing container.",
    description: "Takes output through real server slot rules.",
    tags: ["container", "craft"],
    input_schema: { type: "object", properties: { slot_ref: { type: "string" } } },
    failure_reasons: ["container_not_open", "stale_slot_ref", "missing_material", "inventory_full", "invalid_arguments"]
  },
  {
    name: "craft.list_available",
    summary: "List recipes craftable from current inventory and reachable stations.",
    description: "Returns recipe summaries, not every recipe in the registry.",
    tags: ["craft", "recipe"],
    input_schema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } } },
    failure_reasons: ["station_too_far"]
  },
  {
    name: "craft.quick_craft",
    summary: "Craft an item through server recipe/container rules.",
    description: "Crafts only when ingredients and station rules are satisfied.",
    tags: ["craft", "recipe"],
    input_schema: {
      type: "object",
      required: ["recipe_id", "count"],
      properties: {
        recipe_id: { type: "string" },
        count: { type: "number", minimum: 1 }
      }
    },
    failure_reasons: ["station_too_far", "missing_material", "invalid_recipe", "inventory_full"]
  },
  {
    name: "create.inspect_component",
    summary: "Inspect a visible Create-like component.",
    description: "Returns structured Create adapter data when the runtime supports it, otherwise a structured unsupported reason.",
    tags: ["create", "observe"],
    input_schema: { type: "object", required: ["block_ref"], properties: { block_ref: { type: "string" } } },
    failure_reasons: ["unsupported_capability", "target_not_visible", "target_too_far"]
  }
];

export function findDynamicTool(name: string): DynamicToolDefinition | undefined {
  return DYNAMIC_TOOLS.find((tool) => tool.name === name);
}

export function filterDynamicTools(args: Partial<ToolListArgs> = {}): DynamicToolDefinition[] {
  const query = args.query?.toLowerCase();
  const namespace = args.namespace?.toLowerCase();
  const tags = new Set(args.tags ?? []);
  const limit = args.limit ?? 20;

  return DYNAMIC_TOOLS.filter((tool) => {
    if (namespace && !tool.name.toLowerCase().startsWith(`${namespace}.`)) return false;
    if (query && !`${tool.name} ${tool.summary} ${tool.description}`.toLowerCase().includes(query)) return false;
    for (const tag of tags) {
      if (!tool.tags.includes(tag)) return false;
    }
    return true;
  }).slice(0, limit);
}

export interface ToolResultOk {
  ok: true;
  status?: string;
  result?: JsonValue;
  [key: string]: JsonValue | undefined;
}

export interface ToolResultError {
  ok: false;
  reason: FailureReason;
  message?: string;
  [key: string]: JsonValue | undefined;
}

export type ToolResult = ToolResultOk | ToolResultError;

export function ok(result: JsonValue = {}): ToolResultOk {
  return { ok: true, result };
}

export function fail(reason: FailureReason, message?: string, extra: JsonObject = {}): ToolResultError {
  return { ok: false, reason, ...(message ? { message } : {}), ...extra };
}

export function jsonText(payload: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };
}
