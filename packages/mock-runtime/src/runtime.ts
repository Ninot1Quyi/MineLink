import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import {
  DYNAMIC_TOOLS,
  MINELINK_PROTOCOL_VERSION,
  fail,
  type FailureReason,
  filterDynamicTools,
  findDynamicTool,
  type JsonObject
} from "@minelink/protocol";

type Vec3 = [number, number, number];
type FixtureName =
  | "vanilla_tree"
  | "create_smoke"
  | "craft_smoke"
  | "furnace_smoke"
  | "portal_coop"
  | "guard_boundaries"
  | "perception_shapes";
type RuntimeResponse = Record<string, unknown>;
type RuntimeRequest = RuntimeResponse & { id?: string; type?: string };
type RefValidation = { ok: true; ref: VisibleRef } | ({ ok: false } & RuntimeResponse);
type SlotValidation = { ok: true; slot: SlotBinding } | ({ ok: false } & RuntimeResponse);
type ContainerKind = "chest" | "crafting_table" | "furnace";
type SlotArea = "container" | "inventory" | "output";

const LOCAL_CHAT_RADIUS = 16;
const MAX_SOCIAL_EVENTS = 200;
const MAX_AGENTS_PER_OWNER = 3;
const PLAYER_INVENTORY_SLOT_LIMIT = 36;
const PLACEABLE_BLOCK_ITEMS = new Set([
  "create:shaft",
  "create:cogwheel",
  "create:depot",
  "create:mechanical_press",
  "minecraft:obsidian",
  "minecraft:cobblestone",
  "minecraft:dirt",
  "minecraft:stone"
]);
const CREATE_COMPONENT_KINDS = new Set(["shaft", "cogwheel", "large_cogwheel", "depot", "belt", "mechanical_press"]);
const PICKAXE_HARVEST_BLOCKS = new Set([
  "minecraft:stone",
  "minecraft:copper_block",
  "minecraft:diamond_ore"
]);

interface MockRuntimeOptions {
  fixture?: FixtureName;
  port?: number;
  host?: string;
  logDir?: string;
  tracePath?: string;
  onlineMode?: boolean;
  refTtlMs?: number;
}

interface VisibleRef {
  ref: string;
  observationId: string;
  kind: "block" | "entity";
  id: string;
  pos: Vec3;
  tags: string[];
  distance: number;
  expiresAt: number;
  metadata?: RuntimeResponse;
}

interface AgentState {
  agentId: string;
  displayName: string;
  bodyId: string;
  ownerId: string;
  position: Vec3;
  yaw: number;
  pitch: number;
  inventory: Array<ItemStack | null>;
  refs: Map<string, VisibleRef>;
  lookedAtRef?: string;
  queueDepth: number;
  nextActionId: number;
  chatTimestamps: number[];
  openContainer?: OpenContainerState;
}

interface SocialEvent {
  eventId: string;
  type: "chat.local";
  sourceAgentId: string;
  sourceDisplayName: string;
  message: string;
  position: Vec3;
  radius: number;
  createdAt: string;
}

interface BlockState {
  id: string;
  pos: Vec3;
  tags: string[];
  visibleFaces: string[];
  mined?: boolean;
  metadata?: RuntimeResponse;
  container?: ContainerState;
}

interface ItemStack {
  item: string;
  count: number;
}

interface ContainerState {
  kind: ContainerKind;
  slots: Array<ItemStack | null>;
}

interface OpenContainerState {
  containerId: string;
  kind: ContainerKind;
  blockRef: string;
  blockPos: Vec3;
  block?: BlockState;
  slotRefs: Map<string, SlotBinding>;
  output: ItemStack | null;
}

interface SlotBinding {
  ref: string;
  area: SlotArea;
  index: number;
  containerId: string;
}

export class MockRuntimeServer {
  private readonly fixture: FixtureName;
  private readonly port: number;
  private readonly host: string;
  private readonly logDir: string;
  private readonly tracePath: string;
  private readonly onlineMode: boolean;
  private readonly refTtlMs: number;
  private readonly agents = new Map<string, AgentState>();
  private readonly socialEvents: SocialEvent[] = [];
  private readonly blocks: BlockState[];
  private server?: WebSocketServer;
  private seq = 0;
  private eventSeq = 0;

  constructor(options: MockRuntimeOptions = {}) {
    this.fixture = options.fixture ?? "vanilla_tree";
    this.port = options.port ?? 25575;
    this.host = options.host ?? "127.0.0.1";
    this.logDir = options.logDir ?? ".minelink-dev/logs";
    this.tracePath = options.tracePath ?? ".minelink-dev/replays/latest-action-trace.jsonl";
    this.onlineMode = options.onlineMode ?? false;
    this.refTtlMs = Math.max(1, options.refTtlMs ?? 5000);
    this.blocks = createFixtureBlocks(this.fixture);
    mkdirSync(this.logDir, { recursive: true });
    mkdirSync(dirname(this.tracePath), { recursive: true });
    writeFileSync(join(this.logDir, "server.log"), "", { flag: "a" });
    writeFileSync(this.tracePath, "", { flag: "a" });
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server = new WebSocketServer({ host: this.host, port: this.port }, () => resolve());
    });
    this.server?.on("connection", (socket) => this.handleConnection(socket));
    this.log("MineLink mock runtime ready", { fixture: this.fixture, port: this.port });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
    });
  }

  endpoint(): string {
    return `ws://${this.host}:${this.port}`;
  }

  private handleConnection(socket: WebSocket): void {
    this.log("host connected");
    socket.on("message", (raw) => {
      void this.handleMessage(socket, raw.toString());
    });
  }

  private async handleMessage(socket: WebSocket, raw: string): Promise<void> {
    let request: RuntimeRequest;
    try {
      request = JSON.parse(raw);
    } catch {
      this.send(socket, { type: "error", ...runtimeFail("invalid_arguments", "Invalid JSON request.") });
      return;
    }

    const id = request.id;
    const type = request.type;
    if (!type) {
      this.send(socket, { id, type: "error", ...runtimeFail("invalid_arguments", "Missing request type.") });
      return;
    }

    const response = this.dispatch(request);
    this.send(socket, { id, type: `${type}.result`, ...response });
  }

  private dispatch(request: RuntimeRequest): RuntimeResponse {
    switch (request.type) {
      case "hello":
        return {
          ok: true,
          server: {
            minecraft_version: "1.21.1",
            loader: "mock-neoforge",
            minelink_mod_version: "0.1.0",
            online_mode: this.onlineMode
          },
          admission: {
            mode: "open",
            max_agents_per_owner: 3
          },
          capabilities: {
            server_agent: true,
            birth: true,
            visible_surface_scan: true,
            inventory: true,
            container_basic: this.fixture === "craft_smoke",
            crafting_basic: this.fixture === "craft_smoke",
            sleep_basic: this.fixture === "guard_boundaries",
            social_events: true,
            complex_gui: false,
            create_adapter: this.fixture === "create_smoke" ? "mock-partial" : false
          }
        };
      case "connect":
        if (this.onlineMode) {
          return runtimeFail("unsupported_online_auth", "Mock runtime is configured as online-mode=true.");
        }
        return {
          ok: true,
          owner_id: `owner:offline:${((request.owner as JsonObject | undefined)?.name as string) ?? "codex"}`,
          limits: { max_agents: 3, actions_per_second: 5, max_queue_depth: 4 }
        };
      case "agent.birth":
        return this.birth(String(request.owner_id ?? "owner:offline:codex"), String(request.seed_prompt ?? ""));
      case "agent.observe":
        return this.observe(String(request.agent_id ?? ""), request.include as string[] | undefined);
      case "agent.action":
        return this.executeAction(String(request.agent_id ?? ""), request.action as JsonObject);
      case "tool.list":
        return {
          ok: true,
          tools: filterDynamicTools({
            namespace: request.namespace as string | undefined,
            query: request.query as string | undefined,
            tags: request.tags as string[] | undefined,
            limit: (request.limit as number | undefined) ?? 20
          }).map((tool) => ({ name: tool.name, summary: tool.summary, tags: tool.tags })),
          next_cursor: null
        };
      case "tool.query": {
        const tool = findDynamicTool(String(request.name ?? ""));
        return tool ? { ok: true, ...tool } : runtimeFail("unknown_tool", `Unknown tool ${String(request.name)}`);
      }
      case "tool.execute":
        return this.executeTool(
          String(request.agent_id ?? ""),
          String(request.name ?? ""),
          ((request.arguments as JsonObject | undefined) ?? {}) as JsonObject,
          String(request.mode ?? "await_completion")
        );
      default:
        return runtimeFail("invalid_arguments", `Unknown request type ${request.type}`);
    }
  }

  private birth(ownerId: string, seedPrompt: string): RuntimeResponse {
    if (this.agentCountForOwner(ownerId) >= MAX_AGENTS_PER_OWNER) {
      return runtimeFail(
        "agent_quota_exceeded",
        `Owner ${ownerId} already has the maximum ${MAX_AGENTS_PER_OWNER} server_agent bodies.`
      );
    }
    const n = this.agents.size + 1;
    const displayName = n === 1 ? "Elias Reed" : `MineLink Agent ${n}`;
    const agentId = `agent:${displayName.toLowerCase().replaceAll(" ", "_")}`;
    const bodyId = `body:${displayName.toLowerCase().replaceAll(" ", "_")}`;
    const agent: AgentState = {
      agentId,
      displayName,
      bodyId,
      ownerId,
      position: this.fixture === "portal_coop" ? [1.5, 66, -2] : [0, 64, 0],
      yaw: 0,
      pitch: 0,
      inventory: Array.from({ length: PLAYER_INVENTORY_SLOT_LIMIT }, () => null),
      refs: new Map(),
      queueDepth: 0,
      nextActionId: 0,
      chatTimestamps: []
    };
    this.agents.set(agentId, agent);
    this.log("agent born", { agentId, seedPrompt });
    this.trace({ event: "agent.birth", agent_id: agentId, display_name: displayName });
    return {
      ok: true,
      agent_id: agentId,
      display_name: displayName,
      body_id: bodyId,
      spawn: { dimension: "minecraft:overworld", position: agent.position },
      initial_profile: {
        personality: { curiosity: 0.72, risk_tolerance: 0.28 },
        needs: ["food", "shelter", "tools"],
        relationships: {}
      }
    };
  }

  private agentCountForOwner(ownerId: string): number {
    let count = 0;
    for (const agent of this.agents.values()) {
      if (agent.ownerId === ownerId) count += 1;
    }
    return count;
  }

  private observe(agentId: string, include: string[] = ["self", "inventory", "visible_scene"]): RuntimeResponse {
    const agent = this.agents.get(agentId);
    if (!agent) return runtimeFail("agent_not_born", `Unknown agent ${agentId}`);

    const observationId = `obs_${++this.seq}`;
    const expiresAt = Date.now() + this.refTtlMs;
    const visibleBlocks = this.visibleBlocks(agent, observationId, expiresAt);
    const result: RuntimeResponse = {
      ok: true,
      agent_id: agent.agentId,
      observation_id: observationId,
      issued_at: new Date().toISOString(),
      expires_at: new Date(expiresAt).toISOString()
    };

    if (include.includes("self")) {
      result.self = {
        health: 20,
        hunger: 18,
        position: agent.position,
        yaw: agent.yaw,
        pitch: agent.pitch,
        current_action: null,
        capabilities: { screenshot: false, gui_screen: false, mine: true, move: true, chat: true }
      };
    }
    if (include.includes("inventory")) {
      const main = this.inventorySlotEntries(agent);
      result.inventory = {
        hotbar: main.filter((item) => item.slot < 9),
        main,
        equipment: []
      };
    }
    if (include.includes("visible_scene") || include.includes("visible_blocks")) {
      result.visible_scene = {
        mode: "server_computed_visible_surfaces",
        visible_blocks: visibleBlocks,
        entities: []
      };
    }
    if (include.includes("events") || include.includes("chat")) {
      result.events = this.visibleEvents(agent, "", 20);
    }
    this.trace({ event: "agent.observe", agent_id: agentId, observation_id: observationId });
    return result;
  }

  private executeTool(agentId: string, name: string, args: JsonObject, mode: string): RuntimeResponse {
    const tool = findDynamicTool(name);
    if (!tool) return runtimeFail("unknown_tool", `Unknown dynamic tool ${name}`);
    if (mode !== "await_completion" && mode !== "submit") {
      return runtimeFail("invalid_arguments", `Unsupported execute mode ${mode}`);
    }

    if (name === "observe.self") return this.observe(agentId, ["self"]);
    if (name === "observe.scene") return this.observe(agentId, ["self", "visible_scene"]);
    if (name === "observe.inventory") return this.observe(agentId, ["inventory"]);
    if (name === "observe.events") return this.observeEvents(agentId, args);
    if (name === "block.place") {
      return this.placeBlock(
        agentId,
        String(args.target_ref ?? ""),
        String(args.face ?? ""),
        String(args.item ?? ""),
        typeof args.placement_label === "string" ? args.placement_label : undefined
      );
    }
    if (name.startsWith("action.")) {
      return this.executeAction(agentId, { kind: name.replace("action.", ""), ...args }, mode);
    }
    if (name === "chat.say_local") {
      return this.executeAction(agentId, { kind: "chat", ...args }, mode);
    }
    if (name === "create.inspect_component") {
      return this.inspectCreateComponent(agentId, String(args.block_ref ?? ""));
    }
    if (name === "container.open") {
      return this.openContainer(agentId, String(args.block_ref ?? ""));
    }
    if (name === "container.observe") {
      return this.observeContainer(agentId);
    }
    if (name === "container.move_stack") {
      return this.moveStack(
        agentId,
        String(args.from_slot_ref ?? ""),
        String(args.to_slot_ref ?? ""),
        Number(args.count ?? 64)
      );
    }
    if (name === "container.take_output") {
      return this.takeOutput(agentId, typeof args.slot_ref === "string" ? args.slot_ref : undefined);
    }
    if (name === "craft.list_available") {
      return this.listCraftable(agentId, String(args.query ?? ""), Number(args.limit ?? 20));
    }
    if (name === "craft.quick_craft") {
      return this.quickCraft(agentId, String(args.recipe_id ?? ""), Number(args.count ?? 1));
    }
    return runtimeFail("unknown_tool", `Unhandled dynamic tool ${name}`);
  }

  private executeAction(agentId: string, action: JsonObject, mode = "await_completion"): RuntimeResponse {
    const agent = this.agents.get(agentId);
    if (!agent) return runtimeFail("agent_not_born", `Unknown agent ${agentId}`);
    if (agent.queueDepth >= 4) return runtimeFail("backpressure_queue_full", "Agent action queue is full.");

    if (mode === "submit") {
      agent.queueDepth += 1;
      const actionId = `act_${agent.agentId.replace(/[^a-z0-9]/gi, "_")}_${++agent.nextActionId}`;
      setTimeout(() => {
        agent.queueDepth = Math.max(0, agent.queueDepth - 1);
        this.trace({ event: "agent.action_event", action_id: actionId, status: "completed" });
      }, 250);
      this.trace({ event: "agent.action", action_id: actionId, status: "queued", agent_id: agent.agentId });
      return { ok: true, status: "accepted", action_id: actionId };
    }

    agent.queueDepth += 1;
    try {
      const kind = String(action.kind ?? "");
      if (kind === "move") return this.move(agent, action);
      if (kind === "look_at") return this.lookAt(agent, action);
      if (kind === "mine_visible_block") return this.mineVisibleBlock(agent, action);
      if (kind === "use") return this.use(agent, action);
      if (kind === "sleep") return this.sleep(agent, action);
      if (kind === "chat") return this.chat(agent, action);
      return runtimeFail("unsupported_capability", `Unsupported action kind ${kind}`);
    } finally {
      agent.queueDepth -= 1;
    }
  }

  private move(agent: AgentState, action: JsonObject): RuntimeResponse {
    const vector = action.vector as number[] | undefined;
    if (!vector || vector.length !== 3) return runtimeFail("invalid_arguments", "action.move requires vector[3].");
    const maxDistance = Math.min(Number(action.durationMs ?? 250) / 250, 4);
    const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
    const scale = Math.min(length, maxDistance) / length;
    const requested: Vec3 = [vector[0] * scale, vector[1] * scale, vector[2] * scale];
    const movement = this.resolveMove(agent.position, requested);
    const moved = movement.moved;
    agent.position = [
      round(agent.position[0] + moved[0]),
      round(agent.position[1] + moved[1]),
      round(agent.position[2] + moved[2])
    ];
    const movedDistance = round(Math.hypot(...moved));
    const requestedDistance = round(Math.hypot(...requested));
    this.trace({
      event: "agent.action",
      action: "move",
      agent_id: agent.agentId,
      moved,
      position: agent.position,
      collision: movement.collision
    });
    return {
      ok: true,
      status: "completed",
      result: {
        moved_distance: movedDistance,
        requested_distance: requestedDistance,
        collision: movement.collision,
        position: agent.position
      }
    };
  }

  private resolveMove(origin: Vec3, requested: Vec3): { moved: Vec3; collision: boolean } {
    if (this.fixture !== "guard_boundaries") {
      return { moved: requested, collision: false };
    }
    const steps = Math.max(1, Math.ceil(Math.hypot(...requested) / 0.05));
    let safe: Vec3 = [0, 0, 0];
    for (let step = 1; step <= steps; step++) {
      const factor = step / steps;
      const candidateMove: Vec3 = [requested[0] * factor, requested[1] * factor, requested[2] * factor];
      const candidatePosition: Vec3 = [
        origin[0] + candidateMove[0],
        origin[1] + candidateMove[1],
        origin[2] + candidateMove[2]
      ];
      if (this.intersectsBlockingBlock(candidatePosition)) {
        return { moved: safe, collision: true };
      }
      safe = candidateMove;
    }
    return { moved: requested, collision: false };
  }

  private intersectsBlockingBlock(position: Vec3): boolean {
    return this.blocks.some((block) => !block.mined && playerIntersectsBlock(position, block.pos));
  }

  private lookAt(agent: AgentState, action: JsonObject): RuntimeResponse {
    const ref = String(action.block_ref ?? action.entity_ref ?? "");
    if (ref) {
      const refState = this.validateRef(agent, ref);
      if (!refState.ok) return refState;
      agent.lookedAtRef = ref;
    }
    agent.yaw = 90;
    agent.pitch = 0;
    this.trace({ event: "agent.action", action: "look_at", agent_id: agent.agentId, ref });
    return { ok: true, status: "completed", result: { yaw: agent.yaw, pitch: agent.pitch } };
  }

  private mineVisibleBlock(agent: AgentState, action: JsonObject): RuntimeResponse {
    const blockRef = String(action.block_ref ?? "");
    const refState = this.validateRef(agent, blockRef);
    if (!refState.ok) return refState;
    const ref = refState.ref;
    if (ref.kind !== "block") return runtimeFail("unknown_or_unobserved_target", "Ref is not a block.");
    if (ref.distance > 4.5) {
      return runtimeFail("target_too_far", "Target block is visible but outside interaction range.", {
        distance: ref.distance
      });
    }
    if (agent.lookedAtRef !== blockRef) {
      return runtimeFail("must_turn_first", "Agent must look at the block before mining it.");
    }

    const block = this.blocks.find((candidate) => samePos(candidate.pos, ref.pos) && candidate.id === ref.id);
    if (!block || block.mined) {
      return runtimeFail("target_not_visible", "Block is no longer present.");
    }
    if (PICKAXE_HARVEST_BLOCKS.has(block.id) && !hasPickaxe(agent)) {
      return runtimeFail("wrong_tool", "A pickaxe is required to harvest this block.");
    }
    block.mined = true;
    const drop = block.id === "minecraft:oak_log" ? "minecraft:oak_log" : block.id;
    this.addToInventory(agent, { item: drop, count: 1 });
    this.trace({
      event: "agent.action",
      action: "mine_visible_block",
      agent_id: agent.agentId,
      block_ref: blockRef,
      drop
    });
    return {
      ok: true,
      status: "completed",
      result: { changed_block: true, drops_spawned: 1, inventory_delta: [{ item: drop, count: 1 }] }
    };
  }

  private use(agent: AgentState, action: JsonObject): RuntimeResponse {
    const targetRef = String(action.target_ref ?? action.block_ref ?? "");
    const item = String(action.item ?? "");
    if (targetRef) {
      const refState = this.validateRef(agent, targetRef);
      if (!refState.ok) return refState;
      if (refState.ref.distance > 4.5) return runtimeFail("target_too_far", "Target is outside use range.");
      if (item && this.inventoryCount(agent, item) <= 0) {
        return runtimeFail("missing_material", `Agent inventory does not contain ${item}.`);
      }
      if (item === "minecraft:flint_and_steel") {
        if (!this.hasCompletePortalFrame()) {
          return runtimeFail("blocked", "A complete obsidian frame is required before ignition.");
        }
        this.addPortalBlocks();
        this.trace({ event: "agent.action", action: "use", agent_id: agent.agentId, item, activated: "nether_portal" });
        return { ok: true, status: "completed", result: { used: true, item, activated: "minecraft:nether_portal" } };
      }
      if (item === "minecraft:iron_ingot" && refState.ref.id === "create:depot") {
        const block = this.blocks.find((candidate) => samePos(candidate.pos, refState.ref.pos) && candidate.id === refState.ref.id);
        if (!block || block.mined) {
          return runtimeFail("target_not_visible", "Block is no longer present.");
        }
        this.removeFromInventory(agent, item, 1);
        const insertedItem = { item, count: 1 };
        const heldItem = { item: "create:iron_sheet", count: 1 };
        block.metadata = {
          create: createComponentSemantics({
            ...refState.ref,
            metadata: { create: { inventory: { held_item: heldItem } } }
          })
        };
        this.trace({
          event: "agent.action",
          action: "use",
          agent_id: agent.agentId,
          target_ref: targetRef,
          item,
          processed: heldItem
        });
        return {
          ok: true,
          status: "completed",
          result: {
            used: true,
            item,
            hand: "main",
            target_after_use: { held_item: insertedItem },
            placed_on_target: { input: item, held_item: insertedItem },
            processed: { input: item, output: heldItem }
          }
        };
      }
      if (!item && refState.ref.id === "create:depot") {
        const block = this.blocks.find((candidate) => samePos(candidate.pos, refState.ref.pos) && candidate.id === refState.ref.id);
        if (!block || block.mined) {
          return runtimeFail("target_not_visible", "Block is no longer present.");
        }
        const heldItem = createHeldItem(block.metadata);
        if (!heldItem) {
          return runtimeFail("blocked", "The depot does not hold an item that can be picked up.");
        }
        if (!this.addToInventory(agent, heldItem)) {
          return runtimeFail("inventory_full", "No inventory slot is available for the picked up item.", { item: heldItem.item });
        }
        block.metadata = {
          create: createComponentSemantics({
            ...refState.ref,
            metadata: { create: { inventory: { held_item: null } } }
          })
        };
        this.trace({
          event: "agent.action",
          action: "use",
          agent_id: agent.agentId,
          target_ref: targetRef,
          item: "minecraft:air",
          taken: heldItem
        });
        return {
          ok: true,
          status: "completed",
          result: {
            used: true,
            item: "minecraft:air",
            hand: "empty",
            target_after_use: { held_item: null },
            inventory_delta: [heldItem],
            taken: heldItem
          }
        };
      }
    }
    this.trace({ event: "agent.action", action: "use", agent_id: agent.agentId, target_ref: targetRef, item });
    return { ok: true, status: "completed", result: { used: true, item: item || "minecraft:air", hand: item ? "main" : "empty" } };
  }

  private chat(agent: AgentState, action: JsonObject): RuntimeResponse {
    const message = String(action.message ?? "").trim().slice(0, 256);
    if (!message) return runtimeFail("invalid_arguments", "chat.say_local requires message.");
    const now = Date.now();
    agent.chatTimestamps = agent.chatTimestamps.filter((timestamp) => now - timestamp < 10_000);
    if (agent.chatTimestamps.length >= 4) {
      return runtimeFail("backpressure_queue_full", "Local chat rate limit is full for this agent.");
    }
    agent.chatTimestamps.push(now);

    const event: SocialEvent = {
      eventId: `event_${++this.eventSeq}`,
      type: "chat.local",
      sourceAgentId: agent.agentId,
      sourceDisplayName: agent.displayName,
      message,
      position: [...agent.position],
      radius: LOCAL_CHAT_RADIUS,
      createdAt: new Date(now).toISOString()
    };
    this.socialEvents.push(event);
    if (this.socialEvents.length > MAX_SOCIAL_EVENTS) this.socialEvents.shift();
    const recipientCount = this.visibleRecipientCount(event);
    this.trace({
      event: "social.chat.local",
      social_event_id: event.eventId,
      agent_id: agent.agentId,
      message,
      recipient_count: recipientCount
    });
    return {
      ok: true,
      status: "completed",
      result: { delivered: true, event: this.eventPayload(event, agent), recipient_count: recipientCount }
    };
  }

  private observeEvents(agentId: string, args: JsonObject): RuntimeResponse {
    const agent = this.agents.get(agentId);
    if (!agent) return runtimeFail("agent_not_born", `Unknown agent ${agentId}`);
    const afterEventId = typeof args.after_event_id === "string" ? args.after_event_id : "";
    const limit = Math.max(1, Math.min(Number(args.limit ?? 20), 50));
    if (afterEventId && !this.visibleEventCursor(agent, afterEventId)) {
      return runtimeFail("invalid_cursor", "after_event_id is not visible to this agent or has expired.");
    }
    const events = this.visibleEvents(agent, afterEventId, limit);
    this.trace({ event: "observe.events", agent_id: agent.agentId, count: events.length, after_event_id: afterEventId });
    return {
      ok: true,
      status: "completed",
      events,
      next_cursor: events.length ? events[events.length - 1].event_id : afterEventId || null
    };
  }

  private sleep(agent: AgentState, action: JsonObject): RuntimeResponse {
    const targetRef = String(action.target_ref ?? action.block_ref ?? "");
    const refState = this.validateRef(agent, targetRef);
    if (!refState.ok) return refState;
    if (refState.ref.distance > 4.5) return runtimeFail("target_too_far", "Bed is outside sleep interaction range.");
    if (!refState.ref.tags.includes("minelink:bed")) {
      return runtimeFail("unsupported_capability", "The referenced block is not a bed.");
    }
    this.trace({
      event: "agent.action",
      action: "sleep",
      agent_id: agent.agentId,
      target_ref: targetRef,
      sleep_problem: "not_possible_now"
    });
    return runtimeFail("blocked", "Vanilla sleep rules rejected sleeping at this time.", {
      sleep_problem: "not_possible_now"
    });
  }

  private openContainer(agentId: string, blockRef: string): RuntimeResponse {
    const agent = this.agents.get(agentId);
    if (!agent) return runtimeFail("agent_not_born", `Unknown agent ${agentId}`);
    const refState = this.validateRef(agent, blockRef);
    if (!refState.ok) return refState;
    if (refState.ref.distance > 4.5) return runtimeFail("target_too_far", "Container is outside interaction range.");

    const block = this.blocks.find((candidate) => samePos(candidate.pos, refState.ref.pos) && candidate.id === refState.ref.id);
    if (!block?.container) {
      return runtimeFail("unsupported_capability", "The referenced block is not a supported server-side container.");
    }

    const containerId = `container_${++this.seq}`;
    agent.openContainer = {
      containerId,
      kind: block.container.kind,
      blockRef,
      blockPos: block.pos,
      block,
      slotRefs: new Map(),
      output: null
    };
    this.trace({
      event: "container.open",
      agent_id: agent.agentId,
      container_id: containerId,
      kind: block.container.kind,
      block_ref: blockRef
    });
    return { ok: true, status: "completed", result: this.containerSnapshot(agent) };
  }

  private observeContainer(agentId: string): RuntimeResponse {
    const agent = this.agents.get(agentId);
    if (!agent) return runtimeFail("agent_not_born", `Unknown agent ${agentId}`);
    if (!agent.openContainer) return runtimeFail("container_not_open", "No server-side container is currently open.");
    return { ok: true, status: "completed", result: this.containerSnapshot(agent) };
  }

  private moveStack(agentId: string, fromSlotRef: string, toSlotRef: string, requestedCount: number): RuntimeResponse {
    const agent = this.agents.get(agentId);
    if (!agent) return runtimeFail("agent_not_born", `Unknown agent ${agentId}`);
    if (!agent.openContainer) return runtimeFail("container_not_open", "No server-side container is currently open.");

    const from = this.resolveSlot(agent, fromSlotRef);
    const to = this.resolveSlot(agent, toSlotRef);
    if (!from.ok) return from;
    if (!to.ok) return to;
    if (from.slot.area === "output" || to.slot.area === "output") {
      return runtimeFail("invalid_arguments", "Use container.take_output for output slots.");
    }

    const source = this.readSlot(agent, from.slot);
    if (!source || source.count <= 0) return runtimeFail("missing_material", "Source slot is empty.");
    const count = Math.max(1, Math.min(Math.floor(requestedCount || source.count), source.count));
    const destination = this.readSlot(agent, to.slot);
    if (destination && destination.item !== source.item) {
      return runtimeFail("inventory_full", "Destination slot already contains a different item.");
    }
    const slotRuleFailure = this.validateDestinationSlot(agent, to.slot, source);
    if (slotRuleFailure) return slotRuleFailure;
    const destinationRoom = stackMaxCount(destination?.item ?? source.item) - (destination?.count ?? 0);
    if (destinationRoom <= 0) return runtimeFail("inventory_full", "Destination slot cannot accept more of this item.");

    const movedCount = Math.min(count, destinationRoom);
    this.writeSlot(
      agent,
      from.slot,
      source.count === movedCount ? null : { item: source.item, count: source.count - movedCount }
    );
    this.writeSlot(agent, to.slot, { item: source.item, count: (destination?.count ?? 0) + movedCount });
    this.trace({
      event: "container.move_stack",
      agent_id: agent.agentId,
      from_slot_ref: fromSlotRef,
      to_slot_ref: toSlotRef,
      item: source.item,
      count: movedCount
    });
    return {
      ok: true,
      status: "completed",
      result: { moved: { item: source.item, count: movedCount }, container: this.containerSnapshot(agent) }
    };
  }

  private takeOutput(agentId: string, slotRef?: string): RuntimeResponse {
    const agent = this.agents.get(agentId);
    if (!agent) return runtimeFail("agent_not_born", `Unknown agent ${agentId}`);
    if (!agent.openContainer) return runtimeFail("container_not_open", "No server-side container is currently open.");

    if (slotRef) {
      const slot = this.resolveSlot(agent, slotRef);
      if (!slot.ok) return slot;
      if (slot.slot.area !== "output") return runtimeFail("invalid_arguments", "slot_ref does not point at an output slot.");
    }

    const output = this.outputSlot(agent.openContainer);
    if (!output || output.count <= 0) return runtimeFail("missing_material", "No output is available.");
    if (!this.canAcceptInventory(agent, output)) {
      return runtimeFail("inventory_full", "No inventory slot is available for the output.", { item: output.item });
    }
    this.addToInventory(agent, output);
    this.writeOutputSlot(agent.openContainer, null);
    this.trace({ event: "container.take_output", agent_id: agent.agentId, item: output.item, count: output.count });
    return { ok: true, status: "completed", result: { taken: output, inventory: this.inventoryEntries(agent) } };
  }

  private listCraftable(agentId: string, query: string, limit: number): RuntimeResponse {
    const agent = this.agents.get(agentId);
    if (!agent) return runtimeFail("agent_not_born", `Unknown agent ${agentId}`);
    if (!this.hasReachableCraftingStation(agent)) {
      return runtimeFail("station_too_far", "No reachable crafting station is open.");
    }

    const recipes = [
      {
        recipe_id: "minecraft:oak_planks",
        input: [{ item: "minecraft:oak_log", count: 1 }],
        output: { item: "minecraft:oak_planks", count: 4 },
        craftable: this.inventoryCount(agent, "minecraft:oak_log") >= 1
      }
    ].filter((recipe) => !query || recipe.recipe_id.includes(query) || recipe.output.item.includes(query));

    return { ok: true, recipes: recipes.slice(0, Math.max(1, Math.min(limit || 20, 50))) };
  }

  private quickCraft(agentId: string, recipeId: string, requestedCount: number): RuntimeResponse {
    const agent = this.agents.get(agentId);
    if (!agent) return runtimeFail("agent_not_born", `Unknown agent ${agentId}`);
    if (recipeId !== "minecraft:oak_planks") return runtimeFail("invalid_recipe", `Unknown or unavailable recipe ${recipeId}.`);
    if (!this.hasReachableCraftingStation(agent)) {
      return runtimeFail("station_too_far", "Open a reachable crafting station before quick crafting.");
    }

    const count = Math.max(1, Math.floor(requestedCount || 1));
    const neededLogs = count;
    if (agent.openContainer?.output) {
      return runtimeFail("inventory_full", "Take the current crafting output before crafting again.");
    }
    if (this.inventoryCount(agent, "minecraft:oak_log") < neededLogs) {
      return runtimeFail("missing_material", "minecraft:oak_log is required for minecraft:oak_planks.", {
        required: [{ item: "minecraft:oak_log", count: neededLogs }],
        available: this.inventoryCount(agent, "minecraft:oak_log")
      });
    }
    this.removeFromInventory(agent, "minecraft:oak_log", neededLogs);
    const output = { item: "minecraft:oak_planks", count: count * 4 };
    agent.openContainer!.output = output;
    this.trace({
      event: "craft.quick_craft",
      agent_id: agent.agentId,
      recipe_id: recipeId,
      consumed: { item: "minecraft:oak_log", count: neededLogs },
      output
    });
    return {
      ok: true,
      status: "completed",
      result: { recipe_id: recipeId, output, container: this.containerSnapshot(agent) }
    };
  }

  private containerSnapshot(agent: AgentState): RuntimeResponse {
    const open = agent.openContainer;
    if (!open) return runtimeFail("container_not_open", "No server-side container is currently open.");

    this.processFurnace(open);
    open.slotRefs.clear();
    const bind = (area: SlotArea, index: number): string => {
      const ref = `slot_${open.containerId}_${area}_${index}_${++this.seq}`;
      open.slotRefs.set(ref, { ref, area, index, containerId: open.containerId });
      return ref;
    };
    const stackPayload = (stack: ItemStack | null) => ({
      item: stack?.item ?? null,
      count: stack?.count ?? 0
    });

    const containerSlots = (open.block?.container?.slots ?? [])
      .map((stack, index) => ({ stack, index }))
      .filter(({ index }) => !(open.kind === "furnace" && index === 2))
      .map(({ stack, index }) => ({
        slot_ref: bind("container", index),
        area: "container",
        index,
        ...stackPayload(stack)
      }));
    const inventorySlots = Array.from({ length: PLAYER_INVENTORY_SLOT_LIMIT }, (_, index) => ({
      slot_ref: bind("inventory", index),
      area: "inventory",
      index,
      ...stackPayload(agent.inventory[index] ?? null)
    }));
    const output = this.outputSlot(open);
    const outputIndex = open.kind === "furnace" ? 2 : 0;
    const outputSlot = output
      ? {
          slot_ref: bind("output", outputIndex),
          area: "output",
          index: outputIndex,
          ...stackPayload(output)
        }
      : null;

    return {
      container_id: open.containerId,
      kind: open.kind,
      block_ref: open.blockRef,
      block_pos: open.blockPos,
      slots: containerSlots,
      inventory_slots: inventorySlots,
      output_slot: outputSlot
    };
  }

  private resolveSlot(agent: AgentState, ref: string): SlotValidation {
    const open = agent.openContainer;
    if (!open) return runtimeFail("container_not_open", "No server-side container is currently open.") as SlotValidation;
    const slot = open.slotRefs.get(ref);
    if (!slot || slot.containerId !== open.containerId) {
      return runtimeFail("stale_slot_ref", `Slot ref is not valid for the current container: ${ref}`) as SlotValidation;
    }
    return { ok: true, slot };
  }

  private validateDestinationSlot(agent: AgentState, slot: SlotBinding, source: ItemStack): RuntimeResponse | null {
    if (slot.area !== "container") return null;
    const open = agent.openContainer;
    if (!open?.block?.container) return null;
    if (open.kind === "furnace") {
      const accepted =
        (slot.index === 0 && source.item === "minecraft:raw_iron") ||
        (slot.index === 1 && source.item === "minecraft:coal");
      if (!accepted) {
        return runtimeFail("blocked", "Server slot rules rejected this item for the destination slot.");
      }
    }
    return null;
  }

  private readSlot(agent: AgentState, slot: SlotBinding): ItemStack | null {
    const open = agent.openContainer;
    if (!open) return null;
    if (slot.area === "container") {
      return open.block?.container?.slots[slot.index] ?? null;
    }
    if (slot.area === "inventory") {
      return agent.inventory[slot.index] ?? null;
    }
    return this.outputSlot(open);
  }

  private writeSlot(agent: AgentState, slot: SlotBinding, stack: ItemStack | null): void {
    const open = agent.openContainer;
    if (!open) return;
    if (slot.area === "container") {
      if (open.block?.container) open.block.container.slots[slot.index] = stack;
      return;
    }
    if (slot.area === "output") {
      this.writeOutputSlot(open, stack);
      return;
    }

    if (slot.index >= 0 && slot.index < PLAYER_INVENTORY_SLOT_LIMIT) {
      agent.inventory[slot.index] = stack ? { ...stack } : null;
    }
  }

  private outputSlot(open: OpenContainerState): ItemStack | null {
    if (open.kind === "furnace") {
      return open.block?.container?.slots[2] ?? null;
    }
    return open.output;
  }

  private writeOutputSlot(open: OpenContainerState, stack: ItemStack | null): void {
    if (open.kind === "furnace") {
      if (open.block?.container) open.block.container.slots[2] = stack;
      return;
    }
    open.output = stack;
  }

  private processFurnace(open: OpenContainerState): void {
    if (open.kind !== "furnace" || !open.block?.container) return;
    const slots = open.block.container.slots;
    const input = slots[0];
    const fuel = slots[1];
    const output = slots[2];
    if (output || !input || !fuel) return;
    if (input.item !== "minecraft:raw_iron" || fuel.item !== "minecraft:coal") return;
    slots[0] = input.count > 1 ? { item: input.item, count: input.count - 1 } : null;
    slots[1] = fuel.count > 1 ? { item: fuel.item, count: fuel.count - 1 } : null;
    slots[2] = { item: "minecraft:iron_ingot", count: 1 };
  }

  private inventoryEntries(agent: AgentState): ItemStack[] {
    return agent.inventory
      .filter((stack): stack is ItemStack => Boolean(stack && stack.count > 0))
      .map((stack) => ({ ...stack }));
  }

  private inventorySlotEntries(agent: AgentState): Array<ItemStack & { slot: number }> {
    return agent.inventory
      .map((stack, slot) => (stack && stack.count > 0 ? { ...stack, slot } : null))
      .filter((stack): stack is ItemStack & { slot: number } => Boolean(stack));
  }

  private inventoryCount(agent: AgentState, item: string): number {
    return agent.inventory.reduce((total, stack) => total + (stack?.item === item ? stack.count : 0), 0);
  }

  private addToInventory(agent: AgentState, stack: ItemStack): boolean {
    if (!this.canAcceptInventory(agent, stack)) {
      return false;
    }
    let remaining = stack.count;
    for (const existing of agent.inventory) {
      if (!existing || existing.item !== stack.item) continue;
      const room = stackMaxCount(existing.item) - existing.count;
      if (room <= 0) continue;
      const moved = Math.min(room, remaining);
      existing.count += moved;
      remaining -= moved;
      if (remaining <= 0) return true;
    }
    for (let index = 0; index < agent.inventory.length && remaining > 0; index++) {
      if (agent.inventory[index]) continue;
      const moved = Math.min(stackMaxCount(stack.item), remaining);
      agent.inventory[index] = { item: stack.item, count: moved };
      remaining -= moved;
    }
    return remaining <= 0;
  }

  private removeFromInventory(agent: AgentState, item: string, count: number): boolean {
    if (this.inventoryCount(agent, item) < count) {
      return false;
    }
    let remaining = count;
    for (let index = 0; index < agent.inventory.length && remaining > 0; index++) {
      const stack = agent.inventory[index];
      if (!stack || stack.item !== item) continue;
      const removed = Math.min(stack.count, remaining);
      stack.count -= removed;
      remaining -= removed;
      if (stack.count <= 0) {
        agent.inventory[index] = null;
      }
    }
    return remaining <= 0;
  }

  private canAcceptInventory(agent: AgentState, stack: ItemStack): boolean {
    let remaining = stack.count;
    for (const existing of agent.inventory) {
      if (!existing || existing.item !== stack.item) continue;
      remaining -= Math.max(0, stackMaxCount(existing.item) - existing.count);
      if (remaining <= 0) return true;
    }
    for (const existing of agent.inventory) {
      if (!existing) {
        remaining -= stackMaxCount(stack.item);
        if (remaining <= 0) return true;
      }
    }
    return false;
  }

  private hasReachableCraftingStation(agent: AgentState): boolean {
    const open = agent.openContainer;
    if (!open || open.kind !== "crafting_table") return false;
    return distance3(agent.position, open.blockPos) <= 4.5;
  }

  private inspectCreateComponent(agentId: string, blockRef: string): RuntimeResponse {
    const agent = this.agents.get(agentId);
    if (!agent) return runtimeFail("agent_not_born", `Unknown agent ${agentId}`);
    const refState = this.validateRef(agent, blockRef);
    if (!refState.ok) return refState;
    const ref = refState.ref;
    if (distance3(agent.position, ref.pos) > 6) {
      return runtimeFail("target_too_far", "Create component is outside inspect range.");
    }
    if (!ref.tags.includes("create:component")) {
      return runtimeFail("unsupported_capability", "The referenced block is not a supported Create component for this adapter slice.");
    }
    const block = this.blocks.find((candidate) => samePos(candidate.pos, ref.pos) && candidate.id === ref.id && !candidate.mined);
    const currentRef = { ...ref, metadata: block?.metadata ?? ref.metadata };
    const create = createComponentSemantics(currentRef);
    return {
      ok: true,
      status: "completed",
      result: {
        block_ref: blockRef,
        id: ref.id,
        tags: ref.tags,
        create,
        failure_reasons_supported: [
          "unknown_or_unobserved_target",
          "expired_ref",
          "target_too_far",
          "target_not_visible",
          "unsupported_capability"
        ]
      }
    };
  }

  private placeBlock(agentId: string, targetRef: string, faceName: string, item: string, label?: string): RuntimeResponse {
    const agent = this.agents.get(agentId);
    if (!agent) return runtimeFail("agent_not_born", `Unknown agent ${agentId}`);
    const refState = this.validateRef(agent, targetRef);
    if (!refState.ok) return refState;
    if (refState.ref.distance > 4.5) return runtimeFail("target_too_far", "Target is outside placement range.");
    if (!isPlaceableBlockItem(item)) {
      return runtimeFail("unsupported_capability", "block.place requires a placeable block item.");
    }
    if (this.inventoryCount(agent, item) <= 0) {
      return runtimeFail("missing_material", `Agent inventory does not contain ${item}.`);
    }

    const offset = faceOffset(faceName);
    if (!offset) return runtimeFail("invalid_arguments", `Unsupported placement face ${faceName}.`);
    const pos: Vec3 = [
      refState.ref.pos[0] + offset[0],
      refState.ref.pos[1] + offset[1],
      refState.ref.pos[2] + offset[2]
    ];
    if (this.blocks.some((block) => !block.mined && samePos(block.pos, pos))) {
      return runtimeFail("blocked", "The placement target is already occupied.");
    }

    const block = placedBlock(item, pos);
    this.blocks.push(block);
    this.removeFromInventory(agent, item, 1);
    this.trace({
      event: "block.place",
      agent_id: agent.agentId,
      item,
      target_ref: targetRef,
      face: faceName,
      pos,
      placement_label: label
    });
    return {
      ok: true,
      status: "completed",
      result: { placed: { item, id: item, pos, placement_label: label ?? null } }
    };
  }

  private visibleBlocks(agent: AgentState, observationId: string, expiresAt: number): RuntimeResponse[] {
    const visible: RuntimeResponse[] = [];
    for (const block of this.blocks) {
      if (block.mined) continue;
      const distance = round(distance3(agent.position, block.pos));
      if (distance > 16) continue;
      if (!this.isVisibleFromAgent(agent, block)) continue;
      const ref = `blk_${observationId}_${visible.length + 1}`;
      const visibleRef: VisibleRef = {
        ref,
        observationId,
        kind: "block",
        id: block.id,
        pos: block.pos,
        tags: block.tags,
        distance,
        expiresAt,
        metadata: block.metadata
      };
      agent.refs.set(ref, visibleRef);
      visible.push({
        block_ref: ref,
        pos_hint: block.pos,
        id: block.id,
        tags: block.tags,
        visible_faces: block.visibleFaces,
        distance,
        metadata: block.metadata ?? {}
      });
    }
    return visible;
  }

  private isVisibleFromAgent(agent: AgentState, block: BlockState): boolean {
    if (this.fixture !== "guard_boundaries" && this.fixture !== "perception_shapes") {
      return true;
    }
    if (block.id !== "minecraft:diamond_ore") {
      return true;
    }
    return !this.blocks.some((candidate) =>
      !candidate.mined &&
      candidate.id === "minecraft:stone" &&
      candidate.pos[0] > Math.min(agent.position[0], block.pos[0]) &&
      candidate.pos[0] < Math.max(agent.position[0], block.pos[0]) &&
      candidate.pos[1] === block.pos[1] &&
      candidate.pos[2] === block.pos[2]
    );
  }

  private validateRef(agent: AgentState, ref: string): RefValidation {
    const existing = agent.refs.get(ref);
    if (!existing) return runtimeFail("unknown_or_unobserved_target", `Unknown ref ${ref}`) as RefValidation;
    if (Date.now() > existing.expiresAt) return runtimeFail("expired_ref", `Ref expired: ${ref}`) as RefValidation;
    const currentDistance = round(distance3(agent.position, existing.pos));
    existing.distance = currentDistance;
    return { ok: true, ref: existing };
  }

  private hasCompletePortalFrame(): boolean {
    return portalFramePositions().every((pos) =>
      this.blocks.some((block) => !block.mined && block.id === "minecraft:obsidian" && samePos(block.pos, pos))
    );
  }

  private addPortalBlocks(): void {
    for (const pos of portalInteriorPositions()) {
      if (this.blocks.some((block) => !block.mined && samePos(block.pos, pos))) continue;
      this.blocks.push({
        id: "minecraft:nether_portal",
        pos,
        tags: ["minecraft:nether_portal"],
        visibleFaces: ["north", "south"]
      });
    }
  }

  private visibleEvents(agent: AgentState, afterEventId: string, limit: number): RuntimeResponse[] {
    const startIndex = afterEventId
      ? this.socialEvents.findIndex((event) => event.eventId === afterEventId) + 1
      : 0;
    return this.socialEvents
      .slice(Math.max(0, startIndex))
      .filter((event) => this.canObserveEvent(agent, event))
      .slice(-limit)
      .map((event) => this.eventPayload(event, agent));
  }

  private visibleEventCursor(agent: AgentState, eventId: string): boolean {
    const event = this.socialEvents.find((candidate) => candidate.eventId === eventId);
    return Boolean(event && this.canObserveEvent(agent, event));
  }

  private visibleRecipientCount(event: SocialEvent): number {
    return Array.from(this.agents.values()).filter((agent) => this.canObserveEvent(agent, event)).length;
  }

  private canObserveEvent(agent: AgentState, event: SocialEvent): boolean {
    return event.sourceAgentId === agent.agentId || distance3(agent.position, event.position) <= event.radius;
  }

  private eventPayload(event: SocialEvent, observer: AgentState): RuntimeResponse {
    return {
      event_id: event.eventId,
      type: event.type,
      source_agent_id: event.sourceAgentId,
      source_display_name: event.sourceDisplayName,
      message: event.message,
      visibility: event.sourceAgentId === observer.agentId ? "self" : "audible_local",
      distance_band: event.sourceAgentId === observer.agentId ? "self" : "nearby",
      created_at: event.createdAt
    };
  }

  private send(socket: WebSocket, payload: RuntimeResponse): void {
    socket.send(JSON.stringify(payload));
  }

  private log(message: string, fields: Record<string, unknown> = {}): void {
    appendFileSync(
      join(this.logDir, "server.log"),
      `${JSON.stringify({ ts: new Date().toISOString(), message, ...fields })}\n`
    );
  }

  private trace(event: Record<string, unknown>): void {
    appendFileSync(
      this.tracePath,
      `${JSON.stringify({ ts: new Date().toISOString(), source: "mock-runtime", ...event })}\n`
    );
  }
}

function createFixtureBlocks(fixture: FixtureName): BlockState[] {
  if (fixture === "guard_boundaries") {
    return [
      {
        id: "minecraft:oak_log",
        pos: [2, 64, 0],
        tags: ["minecraft:logs", "minecraft:mineable/axe"],
        visibleFaces: ["west", "north", "up"]
      },
      {
        id: "minecraft:oak_log",
        pos: [8, 64, 0],
        tags: ["minecraft:logs", "minecraft:mineable/axe", "minelink:far_fixture"],
        visibleFaces: ["west", "north", "up"]
      },
      {
        id: "minecraft:white_bed",
        pos: [1, 64, 2],
        tags: ["minecraft:beds", "minelink:bed"],
        visibleFaces: ["north", "up"]
      },
      {
        id: "minecraft:stone",
        pos: [3, 64, 0],
        tags: ["minecraft:stone", "minelink:opaque_fixture"],
        visibleFaces: ["west", "north", "up"]
      },
      {
        id: "minecraft:diamond_ore",
        pos: [4, 64, 0],
        tags: ["minecraft:diamond_ore", "minelink:hidden_fixture"],
        visibleFaces: ["west", "north", "up"]
      }
    ];
  }

  if (fixture === "perception_shapes") {
    return [
      {
        id: "minecraft:glass",
        pos: [2, 64, 0],
        tags: ["minecraft:glass", "minelink:vision_translucent"],
        visibleFaces: ["west", "north", "up"]
      },
      {
        id: "minecraft:oak_leaves",
        pos: [2, 65, 0],
        tags: ["minecraft:leaves", "minelink:vision_translucent"],
        visibleFaces: ["west", "north", "up"]
      },
      {
        id: "minecraft:short_grass",
        pos: [0, 64, 2],
        tags: ["minecraft:short_grass", "minelink:vision_decorative"],
        visibleFaces: ["north", "up"]
      },
      {
        id: "minecraft:water",
        pos: [0, 64, 3],
        tags: ["minecraft:water", "minelink:vision_fluid"],
        visibleFaces: ["north", "up"]
      },
      {
        id: "minecraft:oak_fence",
        pos: [0, 64, 4],
        tags: ["minecraft:fences", "minelink:vision_partial_occluder"],
        visibleFaces: ["north", "up"]
      },
      {
        id: "minecraft:stone",
        pos: [3, 64, 0],
        tags: ["minecraft:stone", "minelink:vision_opaque", "minelink:opaque_fixture"],
        visibleFaces: ["west", "north", "up"]
      },
      {
        id: "minecraft:diamond_ore",
        pos: [4, 64, 0],
        tags: ["minecraft:diamond_ore", "minelink:hidden_fixture"],
        visibleFaces: ["west", "north", "up"]
      }
    ];
  }

  if (fixture === "portal_coop") {
    return [
      {
        id: "minecraft:netherrack",
        pos: [0, 63, 0],
        tags: ["minecraft:netherrack", "minelink:portal_anchor"],
        visibleFaces: ["up", "north"]
      },
      {
        id: "minecraft:chest",
        pos: [-2, 64, 0],
        tags: ["minecraft:chest", "minelink:container"],
        visibleFaces: ["north", "up"],
        container: {
          kind: "chest",
          slots: [
            { item: "minecraft:obsidian", count: 5 },
            { item: "minecraft:obsidian", count: 5 },
            { item: "minecraft:obsidian", count: 4 },
            { item: "minecraft:flint_and_steel", count: 1 }
          ]
        }
      }
    ];
  }

  if (fixture === "furnace_smoke") {
    return [
      {
        id: "minecraft:chest",
        pos: [3, 64, 0],
        tags: ["minecraft:chest", "minelink:container"],
        visibleFaces: ["north", "up"],
        container: {
          kind: "chest",
          slots: [
            { item: "minecraft:raw_iron", count: 1 },
            { item: "minecraft:coal", count: 1 },
            { item: "minecraft:dirt", count: 1 }
          ]
        }
      },
      {
        id: "minecraft:furnace",
        pos: [3, 64, 1],
        tags: ["minecraft:furnace", "minelink:container", "minelink:furnace_fixture"],
        visibleFaces: ["north", "up"],
        container: {
          kind: "furnace",
          slots: [null, null, null]
        }
      }
    ];
  }

  if (fixture === "craft_smoke") {
    return [
      {
        id: "minecraft:chest",
        pos: [3, 64, 0],
        tags: ["minecraft:chest", "minelink:container"],
        visibleFaces: ["north", "up"],
        container: {
          kind: "chest",
          slots: [
            { item: "minecraft:oak_log", count: 2 },
            { item: "minecraft:cobblestone", count: 35 },
            { item: "minecraft:dirt", count: 1 },
            { item: "minecraft:stone", count: 1 },
            { item: "minecraft:sand", count: 1 },
            { item: "minecraft:gravel", count: 1 },
            { item: "minecraft:wheat", count: 1 },
            { item: "minecraft:stick", count: 1 }
          ]
        }
      },
      {
        id: "minecraft:crafting_table",
        pos: [4, 64, 0],
        tags: ["minecraft:crafting_table", "minelink:crafting_station", "minelink:container"],
        visibleFaces: ["north", "up"],
        container: {
          kind: "crafting_table",
          slots: []
        }
      }
    ];
  }

  if (fixture === "create_smoke") {
    return [
      {
        id: "minecraft:stone",
        pos: [3, 64, 0],
        tags: ["minecraft:stone", "minelink:create_build_anchor"],
        visibleFaces: ["north", "up"],
        metadata: { fixture: "create_build_anchor" }
      },
      createFixtureComponent("create:cogwheel", [4, 64, 1]),
      createFixtureComponent("create:belt", [5, 64, 1]),
      createFixtureComponent("create:depot", [3, 64, 2]),
      createFixtureComponent("create:mechanical_press", [3, 66, 2]),
      {
        id: "create:creative_motor",
        pos: [2, 66, 2],
        tags: ["create:creative_motor", "minelink:create_fixture"],
        visibleFaces: ["north", "south", "east", "west", "up"]
      },
      {
        id: "minecraft:chest",
        pos: [0, 64, 3],
        tags: ["minecraft:chest", "minelink:container"],
        visibleFaces: ["north", "up"],
        container: {
          kind: "chest",
          slots: [
            { item: "create:shaft", count: 1 },
            { item: "create:wrench", count: 1 },
            { item: "create:cogwheel", count: 1 },
            { item: "create:depot", count: 1 },
            { item: "create:mechanical_press", count: 1 },
            { item: "minecraft:iron_ingot", count: 1 }
          ]
        }
      }
    ];
  }

  return [
    {
      id: "minecraft:oak_log",
      pos: [6, 64, 0],
      tags: ["minecraft:logs", "minecraft:mineable/axe"],
      visibleFaces: ["west", "north", "up"]
    },
    {
      id: "minecraft:oak_leaves",
      pos: [6, 65, 0],
      tags: ["minecraft:leaves", "minelink:vision_translucent"],
      visibleFaces: ["west", "north", "up"]
    }
  ];
}

function distance3(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function samePos(a: Vec3, b: Vec3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function hasPickaxe(agent: AgentState): boolean {
  return agent.inventory.some((stack) => Boolean(stack && stack.item.endsWith("_pickaxe") && stack.count > 0));
}

function playerIntersectsBlock(position: Vec3, block: Vec3): boolean {
  const halfWidth = 0.3;
  const minX = position[0] - halfWidth;
  const maxX = position[0] + halfWidth;
  const minY = position[1];
  const maxY = position[1] + 1.8;
  const minZ = position[2] - halfWidth;
  const maxZ = position[2] + halfWidth;
  return (
    maxX > block[0] &&
    minX < block[0] + 1 &&
    maxY > block[1] &&
    minY < block[1] + 1 &&
    maxZ > block[2] &&
    minZ < block[2] + 1
  );
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function placedBlock(item: string, pos: Vec3): BlockState {
  if (item.startsWith("create:")) {
    return createFixtureComponent(item, pos);
  }
  return {
    id: item,
    pos,
    tags: item === "minecraft:obsidian" ? ["minecraft:obsidian"] : [],
    visibleFaces: ["north", "south", "east", "west", "up"]
  };
}

function createFixtureComponent(id: string, pos: Vec3): BlockState {
  const kind = id.startsWith("create:") ? id.slice("create:".length) : "unknown";
  const tags = CREATE_COMPONENT_KINDS.has(kind) ? ["create:component", `create:${kind}`, id] : [id];
  return {
    id,
    pos,
    tags,
    visibleFaces: ["north", "south", "east", "west", "up"],
    metadata: { create: createComponentSemantics({ id, tags, metadata: {}, distance: 0 } as VisibleRef) }
  };
}

function createComponentSemantics(ref: VisibleRef): RuntimeResponse {
  const kind = ref.id.startsWith("create:") ? ref.id.slice("create:".length) : "unknown";
  const overrides = objectValue(ref.metadata, "create");
  const kineticOverrides = objectValue(overrides, "kinetic");
  const inventoryOverrides = objectValue(overrides, "inventory");
  const pressOverrides = objectValue(overrides, "press");
  return {
    kind,
    adapter: "semantics-partial",
    role: createRole(kind),
    kinetic: { ...createKineticDetails(kind), ...kineticOverrides },
    inventory: { ...createInventoryDetails(kind), ...inventoryOverrides },
    properties: createProperties(kind),
    wrench_relevant_faces: createWrenchFaces(kind),
    supported_interactions: createSupportedInteractions(kind),
    common_blockage_reasons: createCommonBlockageReasons(kind),
    unsupported_client_capabilities: ["create_ponder_overlay", "jei_recipe_overlay", "client_goggle_overlay"],
    ...(kind === "belt"
      ? {
          belt: {
            length: 1,
            index: 0,
            movement_speed: 0,
            direction_aware_movement_speed: 0,
            movement_facing: "east",
            controller: null,
            controller_block: true,
            covered: false
          }
        }
      : {}),
    ...(kind === "mechanical_press"
      ? {
          press: {
            processing: "pressing",
            kinetic_speed: 16,
            can_process_in_bulk: false,
            pressing_behaviour_present: true,
            ...pressOverrides
          }
        }
      : {})
  };
}

function createKineticDetails(kind: string): RuntimeResponse {
  const speed = kind === "mechanical_press" ? 16 : 0;
  return {
    role: createRole(kind),
    rotation_axis: kind === "depot" ? "none" : kind === "mechanical_press" ? "x" : "y",
    speed,
    theoretical_speed: speed,
    generated_speed: 0,
    network_present: kind === "mechanical_press",
    source_present: kind === "mechanical_press",
    overstressed: false,
    stress_impact: kind === "shaft" || kind === "cogwheel" || kind === "large_cogwheel" || kind === "depot" ? 0 : null,
    stress_capacity: 0,
    speed_hint: speed === 0 ? "stopped" : "moving_positive"
  };
}

function createInventoryDetails(kind: string): RuntimeResponse {
  return {
    accepts_loose_items: kind === "depot" || kind === "belt",
    exposes_server_container: false,
    held_item: null
  };
}

function createProperties(kind: string): RuntimeResponse {
  if (kind === "shaft" || kind === "cogwheel" || kind === "large_cogwheel") return { axis: "y" };
  if (kind === "belt") return { slope: "horizontal", part: "start", horizontal_facing: "east" };
  if (kind === "mechanical_press") return { facing: "north" };
  return {};
}

function createRole(kind: string): string {
  switch (kind) {
    case "shaft":
    case "cogwheel":
    case "large_cogwheel":
      return "kinetic_relay";
    case "depot":
      return "item_buffer";
    case "belt":
      return "item_transport";
    case "mechanical_press":
      return "kinetic_processor";
    default:
      return "unknown_component";
  }
}

function createWrenchFaces(kind: string): string[] {
  if (kind === "depot" || kind === "mechanical_press") return ["north", "south", "east", "west", "up"];
  if (kind === "belt") return ["north", "south", "east", "west"];
  return ["north", "south", "east", "west", "up", "down"];
}

function createSupportedInteractions(kind: string): string[] {
  switch (kind) {
    case "shaft":
    case "cogwheel":
    case "large_cogwheel":
      return ["wrench", "place_adjacent_component"];
    case "depot":
      return ["wrench", "insert_or_extract_item"];
    case "belt":
      return ["wrench", "insert_item", "observe_transport"];
    case "mechanical_press":
      return ["wrench", "process_item_when_powered"];
    default:
      return ["wrench"];
  }
}

function createCommonBlockageReasons(kind: string): string[] {
  switch (kind) {
    case "shaft":
    case "cogwheel":
    case "large_cogwheel":
      return ["missing_power_source", "axis_mismatch", "overstressed_network"];
    case "depot":
      return ["held_item_blocks_insert", "missing_processing_machine", "target_not_reachable"];
    case "belt":
      return ["missing_controller", "blocked_output", "missing_power_source", "overstressed_network"];
    case "mechanical_press":
      return ["missing_power_source", "insufficient_rpm", "missing_recipe", "blocked_output", "overstressed_network"];
    default:
      return ["unsupported_component_kind"];
  }
}

function objectValue(value: unknown, key: string): RuntimeResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const child = (value as RuntimeResponse)[key];
  if (!child || typeof child !== "object" || Array.isArray(child)) return {};
  return child as RuntimeResponse;
}

function createHeldItem(metadata: unknown): ItemStack | null {
  const create = objectValue(metadata, "create");
  const inventory = objectValue(create, "inventory");
  const heldItem = inventory.held_item;
  if (!heldItem || typeof heldItem !== "object" || Array.isArray(heldItem)) return null;
  const item = String((heldItem as RuntimeResponse).item ?? "");
  const count = Number((heldItem as RuntimeResponse).count ?? 0);
  return item && count > 0 ? { item, count } : null;
}

function isPlaceableBlockItem(item: string): boolean {
  return PLACEABLE_BLOCK_ITEMS.has(item);
}

function stackMaxCount(item: string): number {
  if (item === "minecraft:flint_and_steel") return 1;
  return 64;
}

export function parseFixture(value: string | undefined): FixtureName {
  if (value === "guard_boundaries") return "guard_boundaries";
  if (value === "perception_shapes") return "perception_shapes";
  if (value === "portal_coop") return "portal_coop";
  if (value === "furnace_smoke") return "furnace_smoke";
  if (value === "create_smoke") return "create_smoke";
  if (value === "craft_smoke") return "craft_smoke";
  return "vanilla_tree";
}

function faceOffset(faceName: string): Vec3 | null {
  switch (faceName) {
    case "up":
      return [0, 1, 0];
    case "down":
      return [0, -1, 0];
    case "north":
      return [0, 0, -1];
    case "south":
      return [0, 0, 1];
    case "east":
      return [1, 0, 0];
    case "west":
      return [-1, 0, 0];
    default:
      return null;
  }
}

function portalFramePositions(): Vec3[] {
  return [
    [0, 64, 0],
    [0, 65, 0],
    [0, 66, 0],
    [0, 67, 0],
    [0, 68, 0],
    [1, 64, 0],
    [2, 64, 0],
    [3, 64, 0],
    [3, 65, 0],
    [3, 66, 0],
    [3, 67, 0],
    [3, 68, 0],
    [1, 68, 0],
    [2, 68, 0]
  ];
}

function portalInteriorPositions(): Vec3[] {
  return [
    [1, 65, 0],
    [2, 65, 0],
    [1, 66, 0],
    [2, 66, 0],
    [1, 67, 0],
    [2, 67, 0]
  ];
}

function runtimeFail(reason: FailureReason, message?: string, extra: RuntimeResponse = {}): RuntimeResponse & { ok: false } {
  return fail(reason, message, extra as JsonObject) as unknown as RuntimeResponse & { ok: false };
}
