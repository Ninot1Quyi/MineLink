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
type FixtureName = "vanilla_tree" | "create_smoke" | "craft_smoke" | "portal_coop";
type RuntimeResponse = Record<string, unknown>;
type RuntimeRequest = RuntimeResponse & { id?: string; type?: string };
type RefValidation = { ok: true; ref: VisibleRef } | ({ ok: false } & RuntimeResponse);
type SlotValidation = { ok: true; slot: SlotBinding } | ({ ok: false } & RuntimeResponse);
type ContainerKind = "chest" | "crafting_table";
type SlotArea = "container" | "inventory" | "output";

interface MockRuntimeOptions {
  fixture?: FixtureName;
  port?: number;
  host?: string;
  logDir?: string;
  tracePath?: string;
  onlineMode?: boolean;
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
  position: Vec3;
  yaw: number;
  pitch: number;
  inventory: Record<string, number>;
  refs: Map<string, VisibleRef>;
  lookedAtRef?: string;
  queueDepth: number;
  nextActionId: number;
  chat: string[];
  openContainer?: OpenContainerState;
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
  private readonly agents = new Map<string, AgentState>();
  private readonly blocks: BlockState[];
  private server?: WebSocketServer;
  private seq = 0;

  constructor(options: MockRuntimeOptions = {}) {
    this.fixture = options.fixture ?? "vanilla_tree";
    this.port = options.port ?? 25575;
    this.host = options.host ?? "127.0.0.1";
    this.logDir = options.logDir ?? ".minelink-dev/logs";
    this.tracePath = options.tracePath ?? ".minelink-dev/replays/latest-action-trace.jsonl";
    this.onlineMode = options.onlineMode ?? false;
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
        return this.birth(String(request.seed_prompt ?? ""));
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

  private birth(seedPrompt: string): RuntimeResponse {
    const n = this.agents.size + 1;
    const displayName = n === 1 ? "Elias Reed" : `MineLink Agent ${n}`;
    const agentId = `agent:${displayName.toLowerCase().replaceAll(" ", "_")}`;
    const bodyId = `body:${displayName.toLowerCase().replaceAll(" ", "_")}`;
    const agent: AgentState = {
      agentId,
      displayName,
      bodyId,
      position: this.fixture === "portal_coop" ? [1.5, 66, -2] : [0, 64, 0],
      yaw: 0,
      pitch: 0,
      inventory: {},
      refs: new Map(),
      queueDepth: 0,
      nextActionId: 0,
      chat: []
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

  private observe(agentId: string, include: string[] = ["self", "inventory", "visible_scene"]): RuntimeResponse {
    const agent = this.agents.get(agentId);
    if (!agent) return runtimeFail("agent_not_born", `Unknown agent ${agentId}`);

    const observationId = `obs_${++this.seq}`;
    const expiresAt = Date.now() + 5000;
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
      result.inventory = {
        hotbar: [],
        main: Object.entries(agent.inventory).map(([item, count]) => ({ item, count })),
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
    if (include.includes("chat")) {
      result.chat = agent.chat.slice(-20);
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
    const moved: Vec3 = [vector[0] * scale, vector[1] * scale, vector[2] * scale];
    agent.position = [
      round(agent.position[0] + moved[0]),
      round(agent.position[1] + moved[1]),
      round(agent.position[2] + moved[2])
    ];
    this.trace({ event: "agent.action", action: "move", agent_id: agent.agentId, moved, position: agent.position });
    return { ok: true, status: "completed", result: { moved_distance: round(Math.hypot(...moved)), collision: false } };
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
    block.mined = true;
    const drop = block.id === "minecraft:oak_log" ? "minecraft:oak_log" : block.id;
    agent.inventory[drop] = (agent.inventory[drop] ?? 0) + 1;
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
      if (item === "minecraft:flint_and_steel") {
        if ((agent.inventory[item] ?? 0) <= 0) {
          return runtimeFail("missing_material", `Agent inventory does not contain ${item}.`);
        }
        if (!this.hasCompletePortalFrame()) {
          return runtimeFail("blocked", "A complete obsidian frame is required before ignition.");
        }
        this.addPortalBlocks();
        this.trace({ event: "agent.action", action: "use", agent_id: agent.agentId, item, activated: "nether_portal" });
        return { ok: true, status: "completed", result: { used: true, item, activated: "minecraft:nether_portal" } };
      }
    }
    this.trace({ event: "agent.action", action: "use", agent_id: agent.agentId, target_ref: targetRef, item });
    return { ok: true, status: "completed", result: { used: true } };
  }

  private chat(agent: AgentState, action: JsonObject): RuntimeResponse {
    const message = String(action.message ?? "").slice(0, 256);
    if (!message) return runtimeFail("invalid_arguments", "chat.say_local requires message.");
    agent.chat.push(`${agent.displayName}: ${message}`);
    this.trace({ event: "agent.action", action: "chat", agent_id: agent.agentId, message });
    return { ok: true, status: "completed", result: { delivered: true, message } };
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

    this.writeSlot(agent, from.slot, source.count === count ? null : { item: source.item, count: source.count - count });
    this.writeSlot(agent, to.slot, { item: source.item, count: (destination?.count ?? 0) + count });
    this.trace({
      event: "container.move_stack",
      agent_id: agent.agentId,
      from_slot_ref: fromSlotRef,
      to_slot_ref: toSlotRef,
      item: source.item,
      count
    });
    return {
      ok: true,
      status: "completed",
      result: { moved: { item: source.item, count }, container: this.containerSnapshot(agent) }
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

    const output = agent.openContainer.output;
    if (!output || output.count <= 0) return runtimeFail("missing_material", "No output is available.");
    if (!this.canAcceptInventory(agent, output)) {
      return runtimeFail("inventory_full", "No inventory slot is available for the output.", { item: output.item });
    }
    agent.inventory[output.item] = (agent.inventory[output.item] ?? 0) + output.count;
    agent.openContainer.output = null;
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
        craftable: (agent.inventory["minecraft:oak_log"] ?? 0) >= 1
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
    if ((agent.inventory["minecraft:oak_log"] ?? 0) < neededLogs) {
      return runtimeFail("missing_material", "minecraft:oak_log is required for minecraft:oak_planks.", {
        required: [{ item: "minecraft:oak_log", count: neededLogs }],
        available: agent.inventory["minecraft:oak_log"] ?? 0
      });
    }
    agent.inventory["minecraft:oak_log"] -= neededLogs;
    if (agent.inventory["minecraft:oak_log"] <= 0) delete agent.inventory["minecraft:oak_log"];
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

    const containerSlots = (open.block?.container?.slots ?? []).map((stack, index) => ({
      slot_ref: bind("container", index),
      area: "container",
      index,
      ...stackPayload(stack)
    }));
    const inventoryEntries = this.inventoryEntries(agent);
    const inventorySlots = Array.from({ length: 8 }, (_, index) => ({
      slot_ref: bind("inventory", index),
      area: "inventory",
      index,
      ...stackPayload(inventoryEntries[index] ?? null)
    }));
    const outputSlot = open.output
      ? {
          slot_ref: bind("output", 0),
          area: "output",
          index: 0,
          ...stackPayload(open.output)
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

  private readSlot(agent: AgentState, slot: SlotBinding): ItemStack | null {
    const open = agent.openContainer;
    if (!open) return null;
    if (slot.area === "container") {
      return open.block?.container?.slots[slot.index] ?? null;
    }
    if (slot.area === "inventory") {
      return this.inventoryEntries(agent)[slot.index] ?? null;
    }
    return open.output;
  }

  private writeSlot(agent: AgentState, slot: SlotBinding, stack: ItemStack | null): void {
    const open = agent.openContainer;
    if (!open) return;
    if (slot.area === "container") {
      if (open.block?.container) open.block.container.slots[slot.index] = stack;
      return;
    }
    if (slot.area === "output") {
      open.output = stack;
      return;
    }

    const entries = this.inventoryEntries(agent);
    const existing = entries[slot.index];
    if (existing) {
      delete agent.inventory[existing.item];
    }
    if (stack) {
      agent.inventory[stack.item] = (agent.inventory[stack.item] ?? 0) + stack.count;
    }
  }

  private inventoryEntries(agent: AgentState): ItemStack[] {
    return Object.entries(agent.inventory)
      .filter(([, count]) => count > 0)
      .map(([item, count]) => ({ item, count }));
  }

  private canAcceptInventory(agent: AgentState, stack: ItemStack): boolean {
    return Boolean(agent.inventory[stack.item] || this.inventoryEntries(agent).length < 8);
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
    if (!ref.tags.includes("create:component")) {
      return runtimeFail("unsupported_capability", "The referenced block is not a Create component.");
    }
    return {
      ok: true,
      status: "completed",
      result: {
        block_ref: blockRef,
        id: ref.id,
        create: ref.metadata?.create ?? { kind: "unknown", stress: "unknown" },
        failure_reasons_supported: ["target_too_far", "target_not_visible", "unsupported_capability"]
      }
    };
  }

  private placeBlock(agentId: string, targetRef: string, faceName: string, item: string, label?: string): RuntimeResponse {
    const agent = this.agents.get(agentId);
    if (!agent) return runtimeFail("agent_not_born", `Unknown agent ${agentId}`);
    const refState = this.validateRef(agent, targetRef);
    if (!refState.ok) return refState;
    if (refState.ref.distance > 4.5) return runtimeFail("target_too_far", "Target is outside placement range.");
    if ((agent.inventory[item] ?? 0) <= 0) {
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

    const block = {
      id: item,
      pos,
      tags: item === "minecraft:obsidian" ? ["minecraft:obsidian"] : [],
      visibleFaces: ["north", "south", "east", "west", "up"]
    };
    this.blocks.push(block);
    agent.inventory[item] -= 1;
    if (agent.inventory[item] <= 0) delete agent.inventory[item];
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
            { item: "minecraft:cobblestone", count: 1 },
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
        id: "create:depot",
        pos: [3, 64, 0],
        tags: ["create:component", "create:depot"],
        visibleFaces: ["north", "up"],
        metadata: { create: { kind: "depot", stress: "none", blocked: false } }
      },
      {
        id: "create:belt",
        pos: [4, 64, 0],
        tags: ["create:component", "create:belt"],
        visibleFaces: ["north", "up"],
        metadata: { create: { kind: "belt", speed: 0, direction: "east" } }
      },
      {
        id: "minecraft:oak_log",
        pos: [7, 64, 0],
        tags: ["minecraft:logs", "minecraft:mineable/axe"],
        visibleFaces: ["west", "north", "up"]
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

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function parseFixture(value: string | undefined): FixtureName {
  if (value === "portal_coop") return "portal_coop";
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
