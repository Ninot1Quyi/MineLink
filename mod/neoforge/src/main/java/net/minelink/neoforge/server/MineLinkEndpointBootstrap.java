package net.minelink.neoforge.server;

import com.mojang.authlib.GameProfile;
import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Properties;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.recipebook.PlaceRecipe;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.tags.BlockTags;
import net.minecraft.tags.TagKey;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.Container;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.crafting.CraftingInput;
import net.minecraft.world.item.crafting.CraftingRecipe;
import net.minecraft.world.item.crafting.Ingredient;
import net.minecraft.world.item.crafting.RecipeHolder;
import net.minecraft.world.item.crafting.RecipeType;
import net.minecraft.world.entity.MoverType;
import net.minecraft.world.entity.player.Player.BedSleepingProblem;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.ClickType;
import net.minecraft.world.inventory.ContainerLevelAccess;
import net.minecraft.world.inventory.CraftingMenu;
import net.minecraft.world.inventory.FurnaceMenu;
import net.minecraft.world.inventory.ResultSlot;
import net.minecraft.world.inventory.SimpleContainerData;
import net.minecraft.world.inventory.Slot;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.BedBlock;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.BedPart;
import net.minecraft.world.level.block.state.properties.Property;
import net.minecraft.world.level.GameType;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;
import net.minelink.neoforge.MineLinkMod;
import net.neoforged.neoforge.common.util.FakePlayer;
import net.neoforged.neoforge.common.util.FakePlayerFactory;

public final class MineLinkEndpointBootstrap {
    private static final Gson GSON = new Gson();
    private static final String PROTOCOL_VERSION = "0.1";
    private static final int DEFAULT_PORT = 25575;
    private static final int REQUEST_TIMEOUT_SECONDS = 10;
    private static final double LOCAL_CHAT_RADIUS = 16.0D;
    private static final int MAX_SOCIAL_EVENTS = 200;
    private static final int MAX_NOTICE_ENTRIES = 200;
    private static final int MAX_AGENTS_PER_OWNER = 3;
    private static final String NOTICE_BOARD_TAG = "minelink:notice_board";
    private static final int MAX_ACTION_QUEUE_DEPTH = 4;
    private static final long SUBMITTED_ACTION_HOLD_MS = 1_000L;
    private static final long SUBMITTED_ACTION_START_DELAY_MS = 250L;
    private static final long SUBMITTED_ACTION_TTL_MS = 5_000L;
    private static final int MAX_SYNC_MINING_TICKS = 600;
    private static final int PLAYER_INVENTORY_SLOT_LIMIT = 36;
    private static final int CONTAINER_INVENTORY_SLOT_LIMIT = PLAYER_INVENTORY_SLOT_LIMIT;
    private static final int CRAFTING_GRID_SLOT_START = 1;
    private static final int CRAFTING_GRID_SLOT_END = 10;

    private final MinecraftServer server;
    private final RuntimeState runtimeState = new RuntimeState();
    private HttpServer httpServer;

    public MineLinkEndpointBootstrap(MinecraftServer server) {
        this.server = server;
    }

    public void start() {
        if (httpServer != null) {
            return;
        }

        String host = setting("MINELINK_HOST", "minelink.host", "127.0.0.1");
        int port = parsePort(setting("MINELINK_PORT", "minelink.port", String.valueOf(DEFAULT_PORT)));
        try {
            httpServer = HttpServer.create(new InetSocketAddress(host, port), 16);
            httpServer.createContext("/healthz", this::handleHealth);
            httpServer.createContext("/minelink", this::handleProtocol);
            httpServer.setExecutor(Executors.newFixedThreadPool(4, runnable -> {
                Thread thread = new Thread(runnable, "minelink-http");
                thread.setDaemon(true);
                return thread;
            }));
            httpServer.start();
            MineLinkMod.LOGGER.info("MineLink ready: HTTP protocol endpoint listening at http://{}:{}/minelink", host, port);
        } catch (IOException error) {
            throw new IllegalStateException("Unable to start MineLink HTTP endpoint", error);
        }
    }

    public void stop() {
        if (httpServer == null) {
            return;
        }
        httpServer.stop(1);
        httpServer = null;
        MineLinkMod.LOGGER.info("MineLink HTTP protocol endpoint stopped");
    }

    private void handleHealth(HttpExchange exchange) throws IOException {
        if (!"GET".equals(exchange.getRequestMethod())) {
            write(exchange, 405, "method_not_allowed");
            return;
        }
        JsonObject response = new JsonObject();
        response.addProperty("ok", true);
        response.addProperty("server", "minelink-neoforge");
        response.addProperty("protocol_version", PROTOCOL_VERSION);
        writeJson(exchange, 200, response);
    }

    private void handleProtocol(HttpExchange exchange) throws IOException {
        if (!"POST".equals(exchange.getRequestMethod())) {
            write(exchange, 405, "method_not_allowed");
            return;
        }

        JsonObject request;
        try {
            request = JsonParser.parseString(readBody(exchange)).getAsJsonObject();
        } catch (RuntimeException error) {
            JsonObject response = failure(null, "invalid_arguments", "Request body must be a JSON object.");
            writeJson(exchange, 400, response);
            return;
        }

        if (!authorized(exchange, request)) {
            writeJson(exchange, 401, failure(request, "not_connected", "Missing or invalid MineLink endpoint token."));
            return;
        }

        CompletableFuture<JsonObject> future = new CompletableFuture<>();
        server.execute(() -> {
            try {
                future.complete(route(request));
            } catch (RuntimeException error) {
                MineLinkMod.LOGGER.error("MineLink protocol request failed", error);
                future.complete(failure(request, "runtime_unavailable", error.getMessage()));
            }
        });

        try {
            writeJson(exchange, 200, future.get(REQUEST_TIMEOUT_SECONDS, TimeUnit.SECONDS));
        } catch (Exception error) {
            MineLinkMod.LOGGER.error("MineLink protocol request timed out", error);
            writeJson(exchange, 504, failure(request, "action_timeout", "Timed out waiting for the Minecraft server thread."));
        }
    }

    private JsonObject route(JsonObject request) {
        String type = stringValue(request, "type", "");
        return switch (type) {
            case "hello" -> hello(request);
            case "connect" -> connect(request);
            case "agent.birth" -> birth(request);
            case "tool.list" -> toolList(request);
            case "tool.query" -> toolQuery(request);
            case "tool.execute" -> toolExecute(request);
            default -> failure(request, "unknown_tool", "Unsupported MineLink protocol request: " + type);
        };
    }

    private JsonObject hello(JsonObject request) {
        JsonObject response = baseResponse(request, "hello_result");
        JsonObject serverInfo = new JsonObject();
        serverInfo.addProperty("minecraft_version", server.getServerVersion());
        serverInfo.addProperty("loader", "neoforge");
        serverInfo.addProperty("minelink_mod_version", "0.1.0");
        serverInfo.addProperty("online_mode", onlineMode());
        response.add("server", serverInfo);

        JsonObject admission = new JsonObject();
        admission.addProperty("mode", endpointToken().isPresent() ? "token" : "open");
        admission.addProperty("max_agents_per_owner", MAX_AGENTS_PER_OWNER);
        response.add("admission", admission);

        JsonObject capabilities = new JsonObject();
        capabilities.addProperty("server_agent", true);
        capabilities.addProperty("birth", true);
        capabilities.addProperty("body_lifecycle", "same-process");
        capabilities.addProperty("visible_surface_scan", true);
        capabilities.addProperty("inventory", true);
        capabilities.addProperty("container_basic", true);
        capabilities.addProperty("crafting_basic", true);
        capabilities.addProperty("block_place", true);
        capabilities.addProperty("item_use", true);
        capabilities.addProperty("social_events", true);
        capabilities.addProperty("notice_board", true);
        if (createAdapterAvailable()) {
            capabilities.addProperty("create_adapter", "registry-partial");
        } else {
            capabilities.addProperty("create_adapter", false);
        }
        response.add("capabilities", capabilities);
        return response;
    }

    private JsonObject connect(JsonObject request) {
        if (onlineMode()) {
            return failure(request, "unsupported_online_auth", "MineLink dev server_agent birth requires online-mode=false.");
        }

        JsonObject owner = objectValue(request, "owner");
        String ownerName = stringValue(owner, "name", "codex_workspace_01");
        String ownerId = "owner_" + sanitize(ownerName);
        runtimeState.ownerId = ownerId;

        JsonObject response = baseResponse(request, "connect_result");
        response.addProperty("owner_id", ownerId);
        response.addProperty("auth_mode", "minecraft_offline");
        return response;
    }

    private JsonObject birth(JsonObject request) {
        String ownerId = stringValue(request, "owner_id", runtimeState.ownerId);
        if (ownerId.isBlank()) {
            return failure(request, "not_connected", "Call connect before agent.birth.");
        }
        if (runtimeState.agentCountForOwner(ownerId) >= MAX_AGENTS_PER_OWNER) {
            return failure(
                request,
                "agent_quota_exceeded",
                "Owner " + ownerId + " already has the maximum " + MAX_AGENTS_PER_OWNER + " server_agent bodies."
            );
        }
        String seedPrompt = stringValue(request, "seed_prompt", "A cautious but curious newcomer.");
        AgentBody agent = runtimeState.birth(server.overworld(), ownerId, seedPrompt);

        JsonObject response = baseResponse(request, "agent.birth_result");
        response.addProperty("agent_id", agent.agentId);
        response.addProperty("display_name", agent.displayName);
        response.addProperty("body_id", agent.bodyId());
        response.addProperty("body_status", "active");
        response.addProperty("body_type", "server_agent.command_body");
        response.add("position", vector(agent.position()));
        response.add("initial_needs", stringArray("food", "shelter", "tools"));
        response.add("capabilities", stringArray(
            "observe.self",
            "observe.scene",
            "observe.inventory",
            "observe.events",
            "body.freeze",
            "body.restore",
            "body.remove",
            "action.move",
            "action.look_at",
            "action.mine_visible_block",
            "action.use",
            "block.place",
            "chat.say_local",
            "notice.post",
            "notice.observe",
            "container.open",
            "container.observe",
            "container.move_stack",
            "container.click_slot",
            "container.take_output",
            "craft.list_available",
            "craft.quick_craft",
            "create.inspect_component"
        ));
        return response;
    }

    private JsonObject toolList(JsonObject request) {
        JsonObject response = baseResponse(request, "tool.list_result");
        JsonArray tools = new JsonArray();
        for (ToolDefinition tool : filteredToolDefinitions(request)) {
            tools.add(tool.summaryJson());
        }
        response.add("tools", tools);
        response.add("next_cursor", null);
        return response;
    }

    private JsonObject toolQuery(JsonObject request) {
        String name = stringValue(request, "name", "");
        Optional<ToolDefinition> tool = toolDefinitions().stream().filter(candidate -> candidate.name.equals(name)).findFirst();
        if (tool.isEmpty()) {
            return failure(request, "unknown_tool", "Unknown dynamic tool: " + name);
        }

        JsonObject response = baseResponse(request, "tool.query_result");
        response.addProperty("name", tool.get().name);
        response.addProperty("summary", tool.get().summary);
        response.addProperty("description", tool.get().description);
        response.add("tags", stringArray(tool.get().tags.toArray(String[]::new)));
        response.add("input_schema", tool.get().inputSchema);
        if (!tool.get().preconditions.isEmpty()) {
            response.add("preconditions", stringArray(tool.get().preconditions.toArray(String[]::new)));
        }
        if (!tool.get().failureReasons.isEmpty()) {
            response.add("failure_reasons", stringArray(tool.get().failureReasons.toArray(String[]::new)));
        }
        return response;
    }

    private JsonObject toolExecute(JsonObject request) {
        AgentBody agent = runtimeState.agent(stringValue(request, "agent_id", ""));
        if (agent == null) {
            return failure(request, "agent_not_born", "Call agent.birth before executing tools.");
        }

        String name = stringValue(request, "name", "");
        if (!knownDynamicTool(name)) {
            return failure(request, "unknown_tool", "Unknown dynamic tool: " + name);
        }
        String mode = stringValue(request, "mode", "await_completion");
        if (!mode.equals("await_completion") && !mode.equals("submit")) {
            return failure(request, "invalid_arguments", "tool.execute mode must be await_completion or submit.");
        }
        JsonObject arguments = objectValue(request, "arguments");
        if (name.equals("body.freeze")) {
            return freezeBody(request, agent, arguments);
        }
        if (name.equals("body.restore")) {
            return restoreBody(request, agent);
        }
        if (name.equals("body.remove")) {
            return removeBody(request, agent, arguments);
        }
        if (agent.frozen() && !toolAllowedWhileFrozen(name)) {
            return failure(request, "body_frozen", "The active server_agent body is frozen until body.restore succeeds.");
        }
        if (mode.equals("submit") && queueableTool(name)) {
            return submitQueuedAction(request, agent, name, arguments);
        }

        return switch (name) {
            case "observe.self" -> observeSelf(request, agent);
            case "observe.scene" -> observeScene(request, agent, arguments);
            case "observe.inventory" -> observeInventory(request, agent);
            case "observe.events" -> observeEvents(request, agent, arguments);
            case "action.move" -> move(request, agent, arguments);
            case "action.look_at" -> lookAt(request, agent, arguments);
            case "action.mine_visible_block" -> mineVisibleBlock(request, agent, arguments);
            case "action.use" -> use(request, agent, arguments);
            case "action.sleep" -> sleep(request, agent, arguments);
            case "action.status" -> actionStatus(request, agent, arguments);
            case "action.cancel" -> cancelAction(request, agent, arguments);
            case "block.place" -> placeBlock(request, agent, arguments);
            case "chat.say_local" -> sayLocal(request, agent, arguments);
            case "notice.post" -> postNotice(request, agent, arguments);
            case "notice.observe" -> observeNoticeBoard(request, agent, arguments);
            case "container.open" -> openContainer(request, agent, arguments);
            case "container.observe" -> observeContainer(request, agent);
            case "container.move_stack" -> moveStack(request, agent, arguments);
            case "container.click_slot" -> clickSlot(request, agent, arguments);
            case "container.take_output" -> takeOutput(request, agent, arguments);
            case "craft.list_available" -> listCraftable(request, agent, arguments);
            case "craft.quick_craft" -> quickCraft(request, agent, arguments);
            case "create.inspect_component" -> inspectCreateComponent(request, agent, arguments);
            default -> failure(request, "unknown_tool", "Unknown dynamic tool: " + name);
        };
    }

    private JsonObject freezeBody(JsonObject request, AgentBody agent, JsonObject arguments) {
        int cancelledActions = agent.freeze(stringValue(arguments, "reason", "server_agent body was frozen."));
        JsonObject response = toolCompleted(request);
        response.add("result", bodyLifecyclePayload(agent, "frozen", cancelledActions));
        return response;
    }

    private JsonObject restoreBody(JsonObject request, AgentBody agent) {
        boolean restored = agent.restore();
        JsonObject payload = bodyLifecyclePayload(agent, "active", 0);
        payload.addProperty("restored", restored);
        payload.addProperty("restore_scope", "same_process");
        payload.addProperty("persistent_restore", false);
        JsonObject response = toolCompleted(request);
        response.add("result", payload);
        return response;
    }

    private JsonObject removeBody(JsonObject request, AgentBody agent, JsonObject arguments) {
        int cancelledActions = agent.prepareRemove(stringValue(arguments, "reason", "server_agent body was removed."));
        String ownerId = agent.ownerId;
        String agentId = agent.agentId;
        String bodyId = agent.bodyId();
        runtimeState.removeAgent(agentId);

        JsonObject payload = new JsonObject();
        payload.addProperty("agent_id", agentId);
        payload.addProperty("body_id", bodyId);
        payload.addProperty("body_status", "removed");
        payload.addProperty("removed", true);
        payload.addProperty("cancelled_actions", cancelledActions);
        payload.addProperty("owner_active_bodies", runtimeState.agentCountForOwner(ownerId));
        payload.addProperty("max_owner_bodies", MAX_AGENTS_PER_OWNER);

        JsonObject response = toolCompleted(request);
        response.add("result", payload);
        return response;
    }

    private JsonObject bodyLifecyclePayload(AgentBody agent, String status, int cancelledActions) {
        JsonObject payload = new JsonObject();
        payload.addProperty("agent_id", agent.agentId);
        payload.addProperty("body_id", agent.bodyId());
        payload.addProperty("body_status", status);
        payload.addProperty("frozen", agent.frozen());
        payload.addProperty("cancelled_actions", cancelledActions);
        payload.addProperty("owner_active_bodies", runtimeState.agentCountForOwner(agent.ownerId));
        payload.addProperty("max_owner_bodies", MAX_AGENTS_PER_OWNER);
        return payload;
    }

    private JsonObject submitQueuedAction(JsonObject request, AgentBody agent, String name, JsonObject arguments) {
        ActionLifecycle action = agent.submitQueuedAction(name, arguments);
        if (action == null) {
            return failure(request, "backpressure_queue_full", "Agent action queue is full.");
        }
        long holdMs = submittedActionHoldMs(arguments);
        long startDelayMs = Math.min(Math.max(1L, holdMs - 1L), SUBMITTED_ACTION_START_DELAY_MS);
        CompletableFuture.delayedExecutor(startDelayMs, TimeUnit.MILLISECONDS).execute(() ->
            server.execute(() -> startQueuedAction(agent.agentId, action.actionId))
        );
        CompletableFuture.delayedExecutor(holdMs, TimeUnit.MILLISECONDS).execute(() ->
            server.execute(() -> finishQueuedAction(agent.agentId, action.actionId))
        );

        action.recordAccepted();
        JsonObject result = actionPayload(agent, action, "accepted");

        JsonObject response = baseResponse(request, "tool.execute_result");
        response.addProperty("status", "accepted");
        response.addProperty("action_id", action.actionId);
        response.add("result", result);
        return response;
    }

    private void startQueuedAction(String agentId, String actionId) {
        AgentBody liveAgent = runtimeState.agent(agentId);
        if (liveAgent != null) {
            liveAgent.startQueuedAction(actionId);
        }
    }

    private void finishQueuedAction(String agentId, String actionId) {
        AgentBody liveAgent = runtimeState.agent(agentId);
        if (liveAgent == null) {
            return;
        }
        liveAgent.refreshActions();
        ActionLifecycle action = liveAgent.action(actionId);
        if (action == null || !action.active()) {
            return;
        }
        liveAgent.startQueuedAction(actionId);
        if (!action.active()) {
            return;
        }
        JsonObject executionRequest = new JsonObject();
        executionRequest.addProperty("id", "queued-" + action.actionId);
        JsonObject execution = executeQueuedTool(executionRequest, liveAgent, action);
        if (isFailureResponse(execution)) {
            liveAgent.failQueuedAction(
                actionId,
                responseString(execution, "reason", "failed"),
                responseString(execution, "message", "Submitted action failed.")
            );
            return;
        }
        liveAgent.completeQueuedAction(actionId, responseResult(execution));
    }

    private JsonObject executeQueuedTool(JsonObject request, AgentBody agent, ActionLifecycle action) {
        return switch (action.toolName) {
            case "action.move" -> move(request, agent, action.arguments);
            case "action.look_at" -> lookAt(request, agent, action.arguments);
            case "action.mine_visible_block" -> mineVisibleBlock(request, agent, action.arguments);
            case "action.use" -> use(request, agent, action.arguments);
            case "action.sleep" -> sleep(request, agent, action.arguments);
            case "chat.say_local" -> sayLocal(request, agent, action.arguments);
            default -> failure(request, "unsupported_capability", "Unsupported queued action: " + action.toolName);
        };
    }

    private JsonObject actionStatus(JsonObject request, AgentBody agent, JsonObject arguments) {
        String actionId = stringValue(arguments, "action_id", "");
        if (actionId.isBlank()) {
            return failure(request, "invalid_arguments", "action.status requires action_id.");
        }
        agent.refreshActions();
        ActionLifecycle action = agent.action(actionId);
        if (action == null) {
            return failure(request, "unknown_action", "Unknown action handle: " + actionId);
        }
        JsonObject response = toolCompleted(request);
        response.add("result", actionPayload(agent, action, action.lifecycleStatus));
        return response;
    }

    private JsonObject cancelAction(JsonObject request, AgentBody agent, JsonObject arguments) {
        String actionId = stringValue(arguments, "action_id", "");
        if (actionId.isBlank()) {
            return failure(request, "invalid_arguments", "action.cancel requires action_id.");
        }
        agent.refreshActions();
        ActionLifecycle action = agent.action(actionId);
        if (action == null) {
            return failure(request, "unknown_action", "Unknown action handle: " + actionId);
        }
        if (!agent.cancelAction(actionId)) {
            return failure(request, "action_already_finished", "Action " + actionId + " is already " + action.lifecycleStatus + ".");
        }
        JsonObject response = toolCompleted(request);
        response.add("result", actionPayload(agent, action, "cancelled"));
        return response;
    }

    private JsonObject actionPayload(AgentBody agent, ActionLifecycle action, String status) {
        JsonObject payload = new JsonObject();
        payload.addProperty("action_id", action.actionId);
        payload.addProperty("status", status);
        payload.addProperty("lifecycle_status", action.lifecycleStatus);
        payload.addProperty("tool_name", action.toolName);
        payload.addProperty("queue_depth", agent.queueDepth());
        payload.addProperty("max_queue_depth", MAX_ACTION_QUEUE_DEPTH);
        payload.addProperty("submitted_at_ms", action.submittedAt);
        payload.addProperty("updated_at_ms", action.updatedAt);
        payload.addProperty("expires_at_ms", action.expiresAt);
        if (action.failureReason != null) {
            payload.addProperty("failure_reason", action.failureReason);
        }
        if (action.failureMessage != null) {
            payload.addProperty("failure_message", action.failureMessage);
        }
        if (action.result != null) {
            payload.add("action_result", action.result.deepCopy());
        }
        return payload;
    }

    private static boolean queueableTool(String name) {
        return switch (name) {
            case "action.move", "action.look_at", "action.mine_visible_block", "action.use", "action.sleep", "chat.say_local" -> true;
            default -> false;
        };
    }

    private static boolean knownDynamicTool(String name) {
        return toolDefinitions().stream().anyMatch(tool -> tool.name.equals(name));
    }

    private static boolean toolAllowedWhileFrozen(String name) {
        return name.startsWith("observe.")
            || name.equals("action.status")
            || name.equals("action.cancel")
            || name.equals("body.freeze")
            || name.equals("body.restore")
            || name.equals("body.remove");
    }

    private static long submittedActionHoldMs(JsonObject arguments) {
        int durationMs = intValue(arguments, "durationMs", 0);
        if (durationMs <= 0) {
            return SUBMITTED_ACTION_HOLD_MS;
        }
        return Math.min((long) durationMs + SUBMITTED_ACTION_HOLD_MS, 60_000L);
    }

    private static boolean isFailureResponse(JsonObject response) {
        JsonElement ok = response.get("ok");
        return ok != null && ok.isJsonPrimitive() && !ok.getAsBoolean();
    }

    private static JsonObject responseResult(JsonObject response) {
        JsonElement result = response.get("result");
        if (result != null && result.isJsonObject()) {
            return result.getAsJsonObject().deepCopy();
        }
        return response.deepCopy();
    }

    private static String responseString(JsonObject response, String name, String defaultValue) {
        JsonElement value = response.get(name);
        return value == null || value.isJsonNull() ? defaultValue : value.getAsString();
    }

    private JsonObject observeSelf(JsonObject request, AgentBody agent) {
        JsonObject response = baseResponse(request, "tool.execute_result");
        response.addProperty("status", "completed");
        response.addProperty("agent_id", agent.agentId);
        response.addProperty("body_type", "server_agent.command_body");
        response.addProperty("body_id", agent.bodyId());
        response.addProperty("body_status", agent.frozen() ? "frozen" : "active");
        response.add("position", vector(agent.position()));
        response.addProperty("health", 20);
        response.addProperty("hunger", 20);
        JsonObject self = new JsonObject();
        self.addProperty("body_id", agent.bodyId());
        self.addProperty("body_status", agent.frozen() ? "frozen" : "active");
        self.add("position", vector(agent.position()));
        response.add("self", self);
        return response;
    }

    private JsonObject observeScene(JsonObject request, AgentBody agent, JsonObject arguments) {
        int radius = Math.min(Math.max(intValue(arguments, "radius", 16), 1), 24);
        JsonArray blocks = new JsonArray();
        ServerLevel level = server.overworld();
        BlockPos origin = agent.blockPosition();
        agent.refs.clear();
        Set<BlockPos> included = new HashSet<>();

        for (BlockPos fixturePos : agent.smokeFixturePositions()) {
            BlockState state = level.getBlockState(fixturePos);
            if (!state.isAir()) {
                if (!agent.canSee(fixturePos, state, origin)) {
                    continue;
                }
                addVisibleBlock(blocks, agent, fixturePos, state, origin);
                included.add(fixturePos);
            }
        }

        int scanned = 0;
        for (BlockPos pos : BlockPos.betweenClosed(origin.offset(-radius, -2, -radius), origin.offset(radius, radius, radius))) {
            BlockPos immutablePos = pos.immutable();
            if (included.contains(immutablePos)) {
                continue;
            }
            BlockState state = level.getBlockState(pos);
            if (state.isAir()) {
                continue;
            }
            String id = blockId(state);
            if (id.equals("minecraft:grass_block") || id.equals("minecraft:dirt") || id.equals("minecraft:stone")) {
                continue;
            }
            if (!agent.canSee(immutablePos, state, origin)) {
                continue;
            }
            addVisibleBlock(blocks, agent, immutablePos, state, origin);
            included.add(immutablePos);
            scanned++;
            if (scanned >= 48) {
                break;
            }
        }

        JsonObject visibleScene = new JsonObject();
        visibleScene.add("visible_blocks", blocks);
        visibleScene.add("nearby_entities", new JsonArray());

        JsonObject response = baseResponse(request, "tool.execute_result");
        response.addProperty("status", "completed");
        response.add("visible_scene", visibleScene);
        response.add("self", vector(agent.position()));
        response.addProperty("ref_ttl_ms", agent.refTtlMs());
        return response;
    }

    private static void addVisibleBlock(JsonArray blocks, AgentBody agent, BlockPos pos, BlockState state, BlockPos origin) {
        String id = blockId(state);
        String ref = agent.addRef(pos.immutable(), id);
        JsonObject block = new JsonObject();
        block.addProperty("block_ref", ref);
        block.addProperty("id", id);
        block.add("position", blockPosition(pos));
        block.addProperty("distance", Math.sqrt(pos.distSqr(origin)));
        JsonArray tagArray = tags(state);
        for (String tag : agent.extraTags(pos, state)) {
            tagArray.add(tag);
        }
        block.add("tags", tagArray);
        blocks.add(block);
    }

    private JsonObject observeInventory(JsonObject request, AgentBody agent) {
        JsonObject response = baseResponse(request, "tool.execute_result");
        response.addProperty("status", "completed");
        response.add("inventory", inventoryPayload(agent));
        return response;
    }

    private JsonObject observeEvents(JsonObject request, AgentBody agent, JsonObject arguments) {
        String afterEventId = stringValue(arguments, "after_event_id", "");
        int limit = Math.min(Math.max(intValue(arguments, "limit", 20), 1), 50);
        if (!afterEventId.isBlank() && !runtimeState.visibleEventCursor(agent, afterEventId)) {
            return failure(request, "invalid_cursor", "after_event_id is not visible to this agent or has expired.");
        }

        JsonObject response = toolCompleted(request);
        JsonArray events = runtimeState.visibleEvents(agent, afterEventId, limit);
        response.add("events", events);
        if (events.size() == 0) {
            response.add("next_cursor", afterEventId.isBlank() ? JsonNull.INSTANCE : GSON.toJsonTree(afterEventId));
        } else {
            response.addProperty("next_cursor", events.get(events.size() - 1).getAsJsonObject().get("event_id").getAsString());
        }
        return response;
    }

    private JsonObject sayLocal(JsonObject request, AgentBody agent, JsonObject arguments) {
        String message = stringValue(arguments, "message", "").trim();
        if (message.isBlank()) {
            return failure(request, "invalid_arguments", "chat.say_local requires message.");
        }
        if (message.length() > 256) {
            message = message.substring(0, 256);
        }
        if (!agent.acceptChatNow()) {
            return failure(request, "backpressure_queue_full", "Local chat rate limit is full for this agent.");
        }

        SocialEvent event = runtimeState.addLocalChat(agent, message);
        JsonObject result = new JsonObject();
        result.addProperty("delivered", true);
        result.add("event", event.payloadFor(agent));
        result.addProperty("recipient_count", runtimeState.visibleRecipientCount(event));

        JsonObject response = toolCompleted(request);
        response.add("result", result);
        return response;
    }

    private JsonObject postNotice(JsonObject request, AgentBody agent, JsonObject arguments) {
        NoticeBoardTarget target = validateNoticeBoardRef(request, agent, stringValue(arguments, "board_ref", ""));
        if (target.failure != null) {
            return target.failure;
        }
        String message = stringValue(arguments, "message", "").trim();
        if (message.isBlank()) {
            return failure(request, "invalid_arguments", "notice.post requires message.");
        }
        if (message.length() > 256) {
            message = message.substring(0, 256);
        }
        if (!agent.acceptChatNow()) {
            return failure(request, "backpressure_queue_full", "Notice write rate limit is full for this agent.");
        }

        NoticeEntry entry = runtimeState.addNotice(agent, target.boardId, message);
        JsonObject result = new JsonObject();
        result.addProperty("posted", true);
        result.add("board", noticeBoardPayload(target.ref, target.blockRef, target.boardId));
        result.add("notice", entry.payloadFor(agent));

        JsonObject response = toolCompleted(request);
        response.add("result", result);
        return response;
    }

    private JsonObject observeNoticeBoard(JsonObject request, AgentBody agent, JsonObject arguments) {
        NoticeBoardTarget target = validateNoticeBoardRef(request, agent, stringValue(arguments, "board_ref", ""));
        if (target.failure != null) {
            return target.failure;
        }
        String afterNoticeId = stringValue(arguments, "after_notice_id", "");
        int limit = Math.min(Math.max(intValue(arguments, "limit", 20), 1), 50);
        if (!afterNoticeId.isBlank() && !runtimeState.visibleNoticeCursor(target.boardId, afterNoticeId)) {
            return failure(request, "invalid_cursor", "after_notice_id is not present on this visible notice board or has expired.");
        }

        JsonObject response = toolCompleted(request);
        JsonArray entries = runtimeState.visibleNotices(agent, target.boardId, afterNoticeId, limit);
        response.add("board", noticeBoardPayload(target.ref, target.blockRef, target.boardId));
        response.add("entries", entries);
        if (entries.size() == 0) {
            response.add("next_cursor", afterNoticeId.isBlank() ? JsonNull.INSTANCE : GSON.toJsonTree(afterNoticeId));
        } else {
            response.addProperty("next_cursor", entries.get(entries.size() - 1).getAsJsonObject().get("notice_id").getAsString());
        }
        return response;
    }

    private JsonObject move(JsonObject request, AgentBody agent, JsonObject arguments) {
        JsonArray vector = arrayValue(arguments, "vector");
        if (vector.size() != 3) {
            return failure(request, "invalid_arguments", "action.move requires a 3-number vector.");
        }
        double dx = clamp(vector.get(0).getAsDouble(), -4.0, 4.0);
        double dy = clamp(vector.get(1).getAsDouble(), -2.0, 2.0);
        double dz = clamp(vector.get(2).getAsDouble(), -4.0, 4.0);
        Vec3 current = agent.position();
        Vec3 requested = new Vec3(dx, dy, dz);
        agent.entity.move(MoverType.SELF, requested);
        Vec3 actual = agent.position().subtract(current);
        double requestedDistance = requested.length();
        double movedDistance = actual.length();
        boolean collision = movedDistance + 0.001D < requestedDistance;

        JsonObject response = baseResponse(request, "tool.execute_result");
        response.addProperty("status", "completed");
        response.addProperty("moved", movedDistance > 0.001D);
        response.addProperty("moved_distance", movedDistance);
        response.addProperty("requested_distance", requestedDistance);
        response.addProperty("collision", collision);
        response.add("position", vector(agent.position()));
        JsonObject result = new JsonObject();
        result.addProperty("moved_distance", movedDistance);
        result.addProperty("requested_distance", requestedDistance);
        result.addProperty("collision", collision);
        result.add("position", vector(agent.position()));
        response.add("result", result);
        return response;
    }

    private JsonObject lookAt(JsonObject request, AgentBody agent, JsonObject arguments) {
        String ref = stringValue(arguments, "block_ref", "");
        BlockRef blockRef = agent.ref(ref);
        if (blockRef == null) {
            return failure(request, "unknown_or_unobserved_target", "Block ref is not from the latest observation.");
        }
        if (blockRef.expired()) {
            return failure(request, "expired_ref", "Block ref has expired.");
        }

        JsonObject response = baseResponse(request, "tool.execute_result");
        response.addProperty("status", "completed");
        response.addProperty("target", ref);
        return response;
    }

    private JsonObject mineVisibleBlock(JsonObject request, AgentBody agent, JsonObject arguments) {
        String ref = stringValue(arguments, "block_ref", "");
        String toolPolicy = stringValue(arguments, "tool_policy", "best_available");
        BlockRef blockRef = agent.ref(ref);
        if (blockRef == null) {
            return failure(request, "unknown_or_unobserved_target", "Block ref is not from the latest observation.");
        }
        if (blockRef.expired()) {
            return failure(request, "expired_ref", "Block ref has expired.");
        }
        if (Math.sqrt(blockRef.pos.distSqr(agent.blockPosition())) > 6.0) {
            return failure(request, "target_too_far", "The block is outside the current server_agent reach.");
        }

        ServerLevel level = server.overworld();
        BlockState state = level.getBlockState(blockRef.pos);
        if (state.isAir() || !blockId(state).equals(blockRef.blockId)) {
            return failure(request, "target_not_visible", "The observed block is no longer present.");
        }
        if (!level.mayInteract(agent.entity, blockRef.pos)) {
            return failure(request, "blocked", "The server rejected interaction with this block.");
        }
        if (!agent.entity.canInteractWithBlock(blockRef.pos, 1.0D)) {
            return failure(request, "target_too_far", "The block is outside vanilla interaction range.");
        }

        String selectedItemId = selectMiningItem(agent, state, toolPolicy);
        ItemStack miningStack = prepareMainHand(agent, selectedItemId);
        if (selectedItemId.isBlank() && !miningStack.isEmpty()) {
            return failure(request, "blocked", "The active server_agent cannot make its main hand empty.");
        }
        if (state.getDestroySpeed(level, blockRef.pos) < 0.0F) {
            return failure(request, "blocked", "The observed block is unbreakable.");
        }
        if (!state.canHarvestBlock(level, blockRef.pos, agent.entity)) {
            return failure(request, "wrong_tool", "The active server_agent does not have a tool that can harvest this block.");
        }
        float progressPerTick = state.getDestroyProgress(agent.entity, level, blockRef.pos);
        if (progressPerTick <= 0.0F) {
            return failure(request, "blocked", "The observed block cannot be broken by the active server_agent.");
        }
        int estimatedTicks = Math.max(1, (int)Math.ceil(1.0F / progressPerTick));
        if (estimatedTicks > MAX_SYNC_MINING_TICKS) {
            return failure(request, "wrong_tool", "No available tool can mine this block within the synchronous action budget.");
        }

        Map<String, Integer> beforeInventory = inventoryCounts(agent);
        AABB pickupArea = new AABB(blockRef.pos).inflate(1.5D);
        Set<Integer> existingDropIds = itemEntityIds(level, pickupArea);
        boolean destroyed = agent.entity.gameMode.destroyBlock(blockRef.pos);
        collectNewNearbyDrops(level, agent, pickupArea, existingDropIds);
        syncInventoryMirrorFromPlayer(agent);

        BlockState afterState = level.getBlockState(blockRef.pos);
        if (!destroyed || !afterState.isAir()) {
            return failure(request, "blocked", "Vanilla mining did not remove the observed block.");
        }
        JsonArray pickedUp = positiveInventoryDelta(beforeInventory, inventoryCounts(agent));

        JsonObject response = baseResponse(request, "tool.execute_result");
        response.addProperty("status", "completed");
        response.addProperty("mined", blockRef.blockId);
        response.addProperty("selected_item", selectedItemId.isBlank() ? "minecraft:air" : selectedItemId);
        response.addProperty("estimated_mining_ticks", estimatedTicks);
        response.add("drops", pickedUp);
        response.add("drop", pickedUp.size() == 0 ? JsonNull.INSTANCE : pickedUp.get(0).getAsJsonObject());
        JsonObject result = new JsonObject();
        result.addProperty("mined", blockRef.blockId);
        result.addProperty("selected_item", selectedItemId.isBlank() ? "minecraft:air" : selectedItemId);
        result.addProperty("estimated_mining_ticks", estimatedTicks);
        result.add("drops", pickedUp.deepCopy());
        response.add("result", result);
        return response;
    }

    private JsonObject placeBlock(JsonObject request, AgentBody agent, JsonObject arguments) {
        String ref = stringValue(arguments, "target_ref", "");
        Direction face = Direction.byName(stringValue(arguments, "face", ""));
        String itemId = stringValue(arguments, "item", "");
        String label = stringValue(arguments, "placement_label", "");
        if (face == null || itemId.isBlank()) {
            return failure(request, "invalid_arguments", "block.place requires target_ref, face, and item.");
        }

        InteractionTarget target = validateInteractionRef(request, agent, ref);
        if (target.failure != null) {
            return target.failure;
        }
        BlockRef blockRef = target.ref;

        Item item = itemById(itemId);
        if (item == Items.AIR || !(item instanceof BlockItem)) {
            return failure(request, "unsupported_capability", "block.place requires a placeable block item.");
        }
        if (inventoryCounts(agent).getOrDefault(itemId, 0) <= 0) {
            return failure(request, "missing_material", "Agent inventory does not contain " + itemId + ".");
        }

        ServerLevel level = server.overworld();
        BlockPos placementPos = blockRef.pos.relative(face);
        if (placementPos.getY() < level.getMinBuildHeight() || placementPos.getY() >= level.getMaxBuildHeight()) {
            return failure(request, "blocked", "The placement target is outside the build height.");
        }
        if (!level.getBlockState(placementPos).canBeReplaced()) {
            return failure(request, "blocked", "The placement target is already occupied.");
        }

        ItemStack beforeStack = prepareMainHand(agent, itemId);
        BlockHitResult hit = hitResult(blockRef.pos, face);
        InteractionResult interactionResult = agent.entity.gameMode.useItemOn(agent.entity, level, beforeStack, InteractionHand.MAIN_HAND, hit);
        if (interactionResult.shouldSwing()) {
            agent.entity.swing(InteractionHand.MAIN_HAND, true);
        }
        syncInventoryMirrorFromPlayer(agent);

        BlockState placedState = level.getBlockState(placementPos);
        if (!interactionResult.consumesAction() || placedState.isAir()) {
            return failure(request, "blocked", "Vanilla placement did not consume the action or place a block.");
        }

        JsonObject placed = new JsonObject();
        placed.addProperty("item", itemId);
        placed.addProperty("id", blockId(placedState));
        placed.add("position", blockPosition(placementPos));
        placed.add("pos", blockPosition(placementPos));
        placed.addProperty("placement_label", label.isBlank() ? null : label);

        JsonObject result = new JsonObject();
        result.add("placed", placed);
        result.addProperty("interaction_result", interactionResult.name().toLowerCase());

        JsonObject response = toolCompleted(request);
        response.add("result", result);
        return response;
    }

    private JsonObject use(JsonObject request, AgentBody agent, JsonObject arguments) {
        String ref = stringValue(arguments, "target_ref", stringValue(arguments, "block_ref", ""));
        String itemId = stringValue(arguments, "item", "");
        Direction face = Direction.byName(stringValue(arguments, "face", "up"));
        if (face == null) {
            return failure(request, "invalid_arguments", "action.use face must be one of up, down, north, south, east, west.");
        }
        if (!itemId.isBlank() && inventoryCounts(agent).getOrDefault(itemId, 0) <= 0) {
            return failure(request, "missing_material", "Agent inventory does not contain " + itemId + ".");
        }

        Item item = itemById(itemId);
        if (!itemId.isBlank() && item == Items.AIR) {
            return failure(request, "unsupported_capability", "Unknown item: " + itemId + ".");
        }

        ServerLevel level = server.overworld();
        BlockRef blockRef = null;
        if (!ref.isBlank()) {
            InteractionTarget target = validateInteractionRef(request, agent, ref);
            if (target.failure != null) {
                return target.failure;
            }
            blockRef = target.ref;
        }
        Map<String, Integer> beforeInventory = inventoryCounts(agent);
        JsonElement beforeHeldItem = blockRef == null ? JsonNull.INSTANCE : createHeldItem(level, blockRef.pos);
        ItemStack beforeStack = prepareMainHand(agent, itemId);
        if (itemId.isBlank() && !beforeStack.isEmpty()) {
            return failure(request, "blocked", "The active server_agent cannot make its main hand empty.");
        }
        InteractionResult interactionResult;
        if (ref.isBlank()) {
            interactionResult = agent.entity.gameMode.useItem(agent.entity, level, beforeStack, InteractionHand.MAIN_HAND);
        } else {
            interactionResult = agent.entity.gameMode.useItemOn(agent.entity, level, beforeStack, InteractionHand.MAIN_HAND, hitResult(blockRef.pos, face));
        }
        if (interactionResult.shouldSwing()) {
            agent.entity.swing(InteractionHand.MAIN_HAND, true);
        }
        syncInventoryMirrorFromPlayer(agent);
        Map<String, Integer> afterInventory = inventoryCounts(agent);
        JsonElement afterHeldItem = blockRef == null ? JsonNull.INSTANCE : createHeldItem(level, blockRef.pos);

        if (!interactionResult.consumesAction()) {
            return failure(request, "blocked", "Vanilla use did not consume the action.");
        }

        JsonObject result = new JsonObject();
        result.addProperty("used", true);
        result.addProperty("item", itemId.isBlank() ? "minecraft:air" : itemId);
        result.addProperty("hand", itemId.isBlank() ? "empty" : "main");
        result.addProperty("interaction_result", interactionResult.name().toLowerCase());
        if (blockRef != null) {
            JsonObject targetAfterUse = new JsonObject();
            targetAfterUse.add("held_item", afterHeldItem.deepCopy());
            result.add("target_after_use", targetAfterUse);
        }
        JsonArray inventoryDelta = positiveInventoryDelta(beforeInventory, afterInventory);
        if (inventoryDelta.size() > 0) {
            result.add("inventory_delta", inventoryDelta.deepCopy());
            if (itemId.isBlank()) {
                result.add("taken", inventoryDelta.get(0).deepCopy());
            }
        }
        if (!itemId.isBlank() && jsonItemPresent(afterHeldItem) && !sameJsonItem(beforeHeldItem, afterHeldItem)) {
            JsonObject placedOnTarget = new JsonObject();
            placedOnTarget.addProperty("input", itemId);
            placedOnTarget.add("held_item", afterHeldItem.deepCopy());
            result.add("placed_on_target", placedOnTarget);
            String outputItem = jsonItemId(afterHeldItem);
            if (!outputItem.isBlank() && !outputItem.equals(itemId)) {
                JsonObject processed = new JsonObject();
                processed.addProperty("input", itemId);
                processed.add("output", afterHeldItem.deepCopy());
                result.add("processed", processed);
            }
        }
        if (portalActivatedNear(level, agent.fixtureBase)) {
            result.addProperty("activated", "minecraft:nether_portal");
        }

        JsonObject response = toolCompleted(request);
        response.add("result", result);
        return response;
    }

    private JsonObject sleep(JsonObject request, AgentBody agent, JsonObject arguments) {
        String ref = stringValue(arguments, "target_ref", stringValue(arguments, "block_ref", ""));
        InteractionTarget target = validateInteractionRef(request, agent, ref);
        if (target.failure != null) {
            return target.failure;
        }

        ServerLevel level = server.overworld();
        BlockState state = level.getBlockState(target.ref.pos);
        if (!state.is(BlockTags.BEDS)) {
            return failure(request, "unsupported_capability", "The referenced block is not a supported bed.");
        }

        var sleepResult = agent.entity.startSleepInBed(target.ref.pos);
        if (sleepResult.right().isPresent()) {
            agent.entity.stopSleepInBed(false, true);
            JsonObject result = new JsonObject();
            result.addProperty("slept", true);
            result.add("position", blockPosition(target.ref.pos));
            JsonObject response = toolCompleted(request);
            response.add("result", result);
            return response;
        }

        BedSleepingProblem problem = sleepResult.left().orElse(BedSleepingProblem.OTHER_PROBLEM);
        if (problem == BedSleepingProblem.TOO_FAR_AWAY) {
            return failure(request, "target_too_far", "Vanilla sleep rules reported the bed is too far away.");
        }
        return failure(request, "blocked", "Vanilla sleep rules rejected sleeping: " + problem.name().toLowerCase());
    }

    private JsonObject openContainer(JsonObject request, AgentBody agent, JsonObject arguments) {
        String ref = stringValue(arguments, "block_ref", "");
        InteractionTarget target = validateInteractionRef(request, agent, ref);
        if (target.failure != null) {
            return target.failure;
        }
        BlockRef blockRef = target.ref;

        ServerLevel level = server.overworld();
        BlockState state = level.getBlockState(blockRef.pos);
        String blockId = blockId(state);
        Container container = null;
        String kind;
        if (blockId.equals("minecraft:chest")) {
            BlockEntity blockEntity = level.getBlockEntity(blockRef.pos);
            if (!(blockEntity instanceof Container blockContainer)) {
                return failure(request, "unsupported_capability", "The referenced chest does not expose a server container.");
            }
            container = blockContainer;
            kind = "chest";
        } else if (blockId.equals("minecraft:furnace")) {
            BlockEntity blockEntity = level.getBlockEntity(blockRef.pos);
            if (!(blockEntity instanceof Container blockContainer)) {
                return failure(request, "unsupported_capability", "The referenced furnace does not expose a server container.");
            }
            container = blockContainer;
            kind = "furnace";
        } else if (blockId.equals("minecraft:crafting_table")) {
            kind = "crafting_table";
        } else {
            return failure(request, "unsupported_capability", "The referenced block is not a supported smoke fixture container.");
        }

        agent.entity.closeContainer();
        var previousMenu = agent.entity.containerMenu;
        ItemStack beforeStack = agent.entity.getItemInHand(InteractionHand.MAIN_HAND);
        InteractionResult interactionResult = agent.entity.gameMode.useItemOn(
            agent.entity,
            level,
            beforeStack,
            InteractionHand.MAIN_HAND,
            hitResult(blockRef.pos, Direction.UP)
        );
        if (interactionResult.shouldSwing()) {
            agent.entity.swing(InteractionHand.MAIN_HAND, true);
        }
        if (!interactionResult.consumesAction()) {
            return failure(request, "blocked", "Vanilla container interaction did not consume the action.");
        }
        var openedMenu = agent.entity.containerMenu;
        boolean menuOpened = openedMenu != previousMenu && openedMenu != agent.entity.inventoryMenu;
        AbstractContainerMenu nativeMenu = menuOpened ? openedMenu : null;
        if (nativeMenu == null && kind.equals("crafting_table")) {
            nativeMenu = new CraftingMenu(-1, agent.entity.getInventory(), ContainerLevelAccess.create(level, blockRef.pos));
        }
        String menuType = nativeMenu == null ? "" : nativeMenu.getClass().getName();
        String menuSource = nativeMenu == null
            ? "none"
            : menuOpened ? "server_player_container_menu" : "constructed_server_crafting_menu_after_use_item_on";

        agent.openContainer = new OpenContainer(
            "container:" + agent.agentId + ":" + (++agent.containerSeq),
            kind,
            ref,
            blockRef.pos,
            container,
            true,
            interactionResult.name().toLowerCase(),
            menuOpened,
            menuType,
            menuSource,
            nativeMenu
        );
        JsonObject response = toolCompleted(request);
        response.add("result", containerSnapshot(agent));
        return response;
    }

    private JsonObject observeContainer(JsonObject request, AgentBody agent) {
        if (agent.openContainer == null) {
            return failure(request, "container_not_open", "No server-side container is currently open.");
        }
        JsonObject response = toolCompleted(request);
        response.add("result", containerSnapshot(agent));
        return response;
    }

    private JsonObject moveStack(JsonObject request, AgentBody agent, JsonObject arguments) {
        if (agent.openContainer == null) {
            return failure(request, "container_not_open", "No server-side container is currently open.");
        }
        SlotRef from = slotRef(agent, stringValue(arguments, "from_slot_ref", ""));
        if (from == null) {
            return failure(request, "stale_slot_ref", "from_slot_ref is not valid for the current container snapshot.");
        }
        SlotRef to = slotRef(agent, stringValue(arguments, "to_slot_ref", ""));
        if (to == null) {
            return failure(request, "stale_slot_ref", "to_slot_ref is not valid for the current container snapshot.");
        }
        if (from.area.equals("output") || to.area.equals("output")) {
            return failure(request, "invalid_arguments", "Use container.take_output for output slots.");
        }

        Slot sourceSlot = serverSlot(agent, from);
        Slot destinationSlot = serverSlot(agent, to);
        if (sourceSlot == null || destinationSlot == null) {
            return failure(request, "blocked", "The requested slot is not available through server slot hooks.");
        }

        ItemStack source = sourceSlot.getItem().copy();
        if (source.isEmpty()) {
            return failure(request, "missing_material", "Source slot is empty.");
        }
        if (!sourceSlot.mayPickup(agent.entity)) {
            return failure(request, "blocked", "Server slot rules rejected taking from the source slot.");
        }
        ItemStack destination = destinationSlot.getItem().copy();
        if (!destination.isEmpty() && !ItemStack.isSameItemSameComponents(destination, source)) {
            return failure(request, "inventory_full", "Destination slot already contains a different item.");
        }
        if (!destinationSlot.mayPlace(source.copyWithCount(1))) {
            return failure(request, "blocked", "Server slot rules rejected this item for the destination slot.");
        }

        int requestedCount = Math.max(1, intValue(arguments, "count", source.getCount()));
        int destinationLimit = destinationSlot.getMaxStackSize(source);
        int destinationRoom = destinationLimit - (destination.isEmpty() ? 0 : destination.getCount());
        if (destinationRoom <= 0) {
            return failure(request, "inventory_full", "Destination slot cannot accept more of this item.");
        }
        int count = Math.min(Math.min(requestedCount, source.getCount()), destinationRoom);

        ItemStack extracted = sourceSlot.safeTake(count, count, agent.entity);
        if (extracted.isEmpty()) {
            return failure(request, "blocked", "Server slot rules rejected taking from the source slot.");
        }
        int extractedCount = extracted.getCount();
        ItemStack remaining = destinationSlot.safeInsert(extracted.copy(), extractedCount);
        int movedCount = extractedCount - remaining.getCount();
        if (movedCount <= 0) {
            sourceSlot.safeInsert(extracted, extracted.getCount());
            return failure(request, "blocked", "Server slot rules rejected inserting into the destination slot.");
        }
        if (!remaining.isEmpty()) {
            sourceSlot.safeInsert(remaining, remaining.getCount());
        }
        sourceSlot.setChanged();
        destinationSlot.setChanged();
        if (agent.openContainer.container != null) {
            agent.openContainer.container.setChanged();
        }
        syncInventoryMirrorFromPlayer(agent);

        JsonObject result = new JsonObject();
        ItemStack moved = source.copyWithCount(movedCount);
        JsonObject movedPayload = stackPayload(moved);
        result.add("moved", movedPayload);
        result.add("slot_transfer", slotTransferPayload(
            "slot.safe_take_safe_insert",
            from,
            to,
            sourceSlot,
            destinationSlot,
            moved
        ));
        result.add("container", containerSnapshot(agent));

        JsonObject response = toolCompleted(request);
        response.add("result", result);
        return response;
    }

    private JsonObject clickSlot(JsonObject request, AgentBody agent, JsonObject arguments) {
        if (agent.openContainer == null) {
            return failure(request, "container_not_open", "No server-side container is currently open.");
        }
        AbstractContainerMenu menu = agent.openContainer.nativeMenu;
        if (menu == null) {
            return failure(request, "unsupported_capability", "The opened container does not expose a native server menu.");
        }
        if (!agent.openContainer.kind.equals("crafting_table")) {
            return failure(request, "unsupported_capability", "Native slot clicking is currently supported for crafting table menus only.");
        }
        SlotRef slot = slotRef(agent, stringValue(arguments, "slot_ref", ""));
        if (slot == null) {
            return failure(request, "stale_slot_ref", "slot_ref is not valid for the current container snapshot.");
        }
        if (slot.area.equals("output")) {
            return failure(request, "invalid_arguments", "Use container.take_output for output slots.");
        }
        int button = clickButton(arguments);
        if (button < 0) {
            return failure(request, "invalid_arguments", "button must be primary, secondary, left, or right.");
        }
        int menuSlot = menuSlotIndex(agent.openContainer, slot);
        if (menuSlot < 0 || menuSlot >= menu.slots.size()) {
            return failure(request, "blocked", "The requested slot is not available in the native server menu.");
        }

        Slot nativeSlot = menu.slots.get(menuSlot);
        ItemStack beforeSlot = nativeSlot.getItem().copy();
        ItemStack beforeCursor = menu.getCarried().copy();
        try {
            menu.clicked(menuSlot, button, ClickType.PICKUP, agent.entity);
        } catch (RuntimeException error) {
            MineLinkMod.LOGGER.warn("Native container click failed for {} slot {}", agent.openContainer.kind, menuSlot, error);
            return failure(request, "blocked", "Native server menu rejected the slot click.");
        }
        ItemStack afterSlot = nativeSlot.getItem().copy();
        ItemStack afterCursor = menu.getCarried().copy();
        if (ItemStack.matches(beforeSlot, afterSlot) && ItemStack.matches(beforeCursor, afterCursor)) {
            return failure(request, "blocked", "Native server menu did not accept the slot click.");
        }
        if (agent.openContainer.container != null) {
            agent.openContainer.container.setChanged();
        }
        syncInventoryMirrorFromPlayer(agent);

        JsonObject result = new JsonObject();
        result.add("slot_click", slotClickPayload(agent.openContainer, slot, nativeSlot, menuSlot, button, beforeSlot, afterSlot, beforeCursor, afterCursor));
        result.add("container", containerSnapshot(agent));

        JsonObject response = toolCompleted(request);
        response.add("result", result);
        return response;
    }

    private JsonObject takeOutput(JsonObject request, AgentBody agent, JsonObject arguments) {
        if (agent.openContainer == null) {
            return failure(request, "container_not_open", "No server-side container is currently open.");
        }
        String slotRef = stringValue(arguments, "slot_ref", "");
        if (!slotRef.isBlank()) {
            SlotRef slot = slotRef(agent, slotRef);
            if (slot == null) {
                return failure(request, "stale_slot_ref", "slot_ref is not valid for the current container snapshot.");
            }
            if (!slot.area.equals("output")) {
                return failure(request, "invalid_arguments", "slot_ref does not point at an output slot.");
            }
        }

        Slot outputSlot = serverSlot(agent, new SlotRef(agent.openContainer.containerId, "output", outputIndex(agent.openContainer)));
        ItemStack output = outputSlot == null ? outputStack(agent.openContainer) : outputSlot.getItem().copy();
        if (output.isEmpty()) {
            return failure(request, "missing_material", "No output is available.");
        }
        if (!canAcceptInventory(agent, output)) {
            return failure(request, "inventory_full", "No inventory slot is available for the output.");
        }

        ItemStack takenStack;
        if (outputSlot != null) {
            if (!outputSlot.mayPickup(agent.entity)) {
                return failure(request, "blocked", "Server slot rules rejected taking from the output slot.");
            }
            takenStack = outputSlot.safeTake(output.getCount(), output.getCount(), agent.entity);
            if (takenStack.isEmpty()) {
                return failure(request, "blocked", "Server slot rules rejected taking from the output slot.");
            }
        } else {
            takenStack = output.copy();
        }

        if (!addToPlayerInventoryThroughSlotHooks(agent, takenStack)) {
            if (outputSlot == null) {
                writeOutputStack(agent.openContainer, output);
            }
            return failure(request, "inventory_full", "No inventory slot is available for the output.");
        }
        JsonObject taken = stackPayload(takenStack);
        if (outputSlot == null) {
            writeOutputStack(agent.openContainer, ItemStack.EMPTY);
        } else {
            outputSlot.setChanged();
            if (agent.openContainer.container != null) {
                agent.openContainer.container.setChanged();
            }
        }

        JsonObject result = new JsonObject();
        result.add("taken", taken);
        result.add("slot_transfer", outputTransferPayload(agent.openContainer, outputSlot, takenStack));
        result.add("inventory", inventoryPayload(agent));
        result.add("container", containerSnapshot(agent));

        JsonObject response = toolCompleted(request);
        response.add("result", result);
        return response;
    }

    private JsonObject listCraftable(JsonObject request, AgentBody agent, JsonObject arguments) {
        if (!hasReachableCraftingStation(agent)) {
            return failure(request, "station_too_far", "Open a reachable crafting table before listing craftable recipes.");
        }
        String query = stringValue(arguments, "query", "").toLowerCase();
        int limit = Math.min(Math.max(intValue(arguments, "limit", 20), 1), 50);
        JsonArray recipes = new JsonArray();
        for (RecipeHolder<CraftingRecipe> recipe : server.getRecipeManager().getAllRecipesFor(RecipeType.CRAFTING)) {
            ItemStack result = recipe.value().getResultItem(server.registryAccess());
            if (result.isEmpty()) {
                continue;
            }
            String recipeId = recipe.id().toString();
            String outputId = stackItemId(result);
            if (!query.isBlank() && !recipeId.toLowerCase().contains(query) && !outputId.toLowerCase().contains(query)) {
                continue;
            }
            JsonObject entry = new JsonObject();
            entry.addProperty("recipe_id", recipeId);
            entry.add("output", stackPayload(result));
            entry.addProperty("craftable", craftPlan(recipe, 1, agent).isPresent());
            recipes.add(entry);
            if (recipes.size() >= limit) {
                break;
            }
        }

        JsonObject response = baseResponse(request, "tool.execute_result");
        response.addProperty("status", "completed");
        response.add("recipes", recipes);
        return response;
    }

    private JsonObject quickCraft(JsonObject request, AgentBody agent, JsonObject arguments) {
        if (!hasReachableCraftingStation(agent)) {
            return failure(request, "station_too_far", "Open a reachable crafting table before quick crafting.");
        }
        String recipeId = stringValue(arguments, "recipe_id", "");
        int count = Math.min(Math.max(intValue(arguments, "count", 1), 1), 64);
        ResourceLocation recipeLocation;
        try {
            recipeLocation = ResourceLocation.parse(recipeId);
        } catch (RuntimeException error) {
            return failure(request, "invalid_recipe", "recipe_id must be a valid resource location.");
        }

        Optional<RecipeHolder<?>> maybeRecipe = server.getRecipeManager().byKey(recipeLocation);
        if (maybeRecipe.isEmpty() || !(maybeRecipe.get().value() instanceof CraftingRecipe craftingRecipe)) {
            return failure(request, "invalid_recipe", "Unknown or unavailable crafting recipe: " + recipeId);
        }
        RecipeHolder<CraftingRecipe> recipe = new RecipeHolder<>(maybeRecipe.get().id(), craftingRecipe);
        Optional<CraftPlan> plan = craftPlan(recipe, count, agent);
        if (plan.isEmpty()) {
            return failure(request, "missing_material", "Current agent inventory cannot satisfy the requested recipe.");
        }

        CraftingMenu craftingMenu = craftingMenu(agent.openContainer);
        if (craftingMenu == null) {
            return failure(request, "blocked", "The opened crafting station did not expose a native CraftingMenu.");
        }
        Slot resultSlot = craftingResultSlot(agent.openContainer);
        if (resultSlot == null) {
            return failure(request, "blocked", "The opened crafting station did not expose a native result slot.");
        }
        if (!resultSlot.getItem().isEmpty()) {
            return failure(request, "inventory_full", "Take the current crafting output before crafting again.");
        }
        if (!craftingGridIsEmpty(craftingMenu)) {
            return failure(request, "inventory_full", "Clear the current crafting grid before crafting again.");
        }
        JsonObject gridFailure = fillNativeCraftingGrid(request, agent, craftingMenu, plan.get());
        if (gridFailure != null) {
            return gridFailure;
        }
        try {
            craftingMenu.finishPlacingRecipe(recipe);
        } catch (RuntimeException error) {
            MineLinkMod.LOGGER.warn("Native crafting menu failed to refresh result slot for {}", recipeId, error);
            returnCraftingGridToInventory(agent, craftingMenu);
            return failure(request, "blocked", "Native crafting menu rejected refreshing the result slot.");
        }
        ItemStack nativeOutput = resultSlot.getItem().copy();
        if (nativeOutput.isEmpty()) {
            returnCraftingGridToInventory(agent, craftingMenu);
            return failure(request, "invalid_recipe", "Native crafting menu did not produce an output for the requested recipe.");
        }
        syncInventoryMirrorFromPlayer(agent);

        JsonObject result = new JsonObject();
        result.addProperty("recipe_id", recipeId);
        result.addProperty("requested_count", count);
        result.add("planned_output", stackPayload(plan.get().plannedOutput()));
        result.add("output", stackPayload(nativeOutput));
        result.add("crafting_transfer", craftingTransferPayload(agent.openContainer, resultSlot, plan.get()));
        result.add("container", containerSnapshot(agent));

        JsonObject response = toolCompleted(request);
        response.add("result", result);
        return response;
    }

    private JsonObject inspectCreateComponent(JsonObject request, AgentBody agent, JsonObject arguments) {
        String ref = stringValue(arguments, "block_ref", stringValue(arguments, "target_ref", ""));
        InteractionTarget target = validateInteractionRef(request, agent, ref);
        if (target.failure != null) {
            return target.failure;
        }

        ServerLevel level = server.overworld();
        BlockState state = level.getBlockState(target.ref.pos);
        String id = blockId(state);
        if (!isCreateComponent(id)) {
            return failure(request, "unsupported_capability", "The referenced block is not a supported Create component for this adapter slice.");
        }

        JsonObject properties = new JsonObject();
        state.getValues().forEach((property, value) -> properties.addProperty(property.getName(), String.valueOf(value)));

        BlockEntity blockEntity = level.getBlockEntity(target.ref.pos);
        String kind = createKind(id);
        JsonObject create = new JsonObject();
        create.addProperty("kind", kind);
        create.addProperty("adapter", "semantics-partial");
        create.addProperty("role", createRole(kind));
        create.add("kinetic", createKineticDetails(state, blockEntity, kind, properties));
        create.add("inventory", createInventoryDetails(blockEntity, kind));
        create.add("properties", properties);
        create.add("wrench_relevant_faces", createWrenchFaces(kind));
        create.add("supported_interactions", createSupportedInteractions(kind));
        create.add("common_blockage_reasons", createCommonBlockageReasons(kind));
        create.add("unsupported_client_capabilities", stringArray(
            "create_ponder_overlay",
            "jei_recipe_overlay",
            "client_goggle_overlay"
        ));
        if (kind.equals("belt")) {
            create.add("belt", createBeltDetails(blockEntity));
        } else if (kind.equals("mechanical_press")) {
            create.add("press", createPressDetails(blockEntity));
        }

        JsonObject result = new JsonObject();
        result.addProperty("block_ref", ref);
        result.addProperty("id", id);
        result.add("position", blockPosition(target.ref.pos));
        result.add("tags", tags(state));
        if (blockEntity == null) {
            result.add("block_entity", JsonNull.INSTANCE);
        } else {
            result.addProperty("block_entity", BuiltInRegistries.BLOCK_ENTITY_TYPE.getKey(blockEntity.getType()).toString());
        }
        result.add("create", create);
        result.add("failure_reasons_supported", stringArray("unknown_or_unobserved_target", "expired_ref", "target_too_far", "target_not_visible", "unsupported_capability"));

        JsonObject response = toolCompleted(request);
        response.add("result", result);
        return response;
    }

    private static JsonObject createKineticDetails(BlockState state, BlockEntity blockEntity, String kind, JsonObject properties) {
        JsonObject kinetic = new JsonObject();
        kinetic.addProperty("role", createRole(kind));
        kinetic.addProperty("rotation_axis", propertyOrUnknown(properties, "axis"));
        kinetic.add("speed", reflectedValue(blockEntity, "getSpeed"));
        kinetic.add("theoretical_speed", reflectedValue(blockEntity, "getTheoreticalSpeed"));
        kinetic.add("generated_speed", reflectedValue(blockEntity, "getGeneratedSpeed"));
        kinetic.add("network_present", reflectedValue(blockEntity, "hasNetwork"));
        kinetic.add("source_present", reflectedValue(blockEntity, "hasSource"));
        kinetic.add("overstressed", reflectedValue(blockEntity, "isOverStressed"));
        kinetic.add("stress_impact", reflectedStaticValue(
            "com.simibubi.create.api.stress.BlockStressValues",
            "getImpact",
            new Class<?>[] { Block.class },
            state.getBlock()
        ));
        kinetic.add("stress_capacity", reflectedStaticValue(
            "com.simibubi.create.api.stress.BlockStressValues",
            "getCapacity",
            new Class<?>[] { Block.class },
            state.getBlock()
        ));
        kinetic.addProperty("speed_hint", speedHint(kinetic.get("speed")));
        return kinetic;
    }

    private static JsonObject createInventoryDetails(BlockEntity blockEntity, String kind) {
        JsonObject inventory = new JsonObject();
        inventory.addProperty("accepts_loose_items", kind.equals("depot") || kind.equals("belt"));
        inventory.addProperty("exposes_server_container", false);
        if (kind.equals("depot")) {
            inventory.add("held_item", reflectedValue(blockEntity, "getHeldItem"));
        } else {
            inventory.add("held_item", JsonNull.INSTANCE);
        }
        return inventory;
    }

    private static JsonElement createHeldItem(ServerLevel level, BlockPos pos) {
        BlockState state = level.getBlockState(pos);
        if (!createKind(blockId(state)).equals("depot")) {
            return JsonNull.INSTANCE;
        }
        return reflectedValue(level.getBlockEntity(pos), "getHeldItem");
    }

    private static boolean jsonItemPresent(JsonElement value) {
        return !jsonItemId(value).isBlank();
    }

    private static boolean sameJsonItem(JsonElement left, JsonElement right) {
        String leftItem = jsonItemId(left);
        String rightItem = jsonItemId(right);
        return !leftItem.isBlank()
            && leftItem.equals(rightItem)
            && jsonItemCount(left) == jsonItemCount(right);
    }

    private static String jsonItemId(JsonElement value) {
        if (value == null || value.isJsonNull() || !value.isJsonObject()) {
            return "";
        }
        JsonElement item = value.getAsJsonObject().get("item");
        return item == null || item.isJsonNull() ? "" : item.getAsString();
    }

    private static int jsonItemCount(JsonElement value) {
        if (value == null || value.isJsonNull() || !value.isJsonObject()) {
            return 0;
        }
        JsonElement count = value.getAsJsonObject().get("count");
        return count == null || count.isJsonNull() ? 0 : count.getAsInt();
    }

    private static JsonObject createBeltDetails(BlockEntity blockEntity) {
        JsonObject belt = new JsonObject();
        belt.add("length", reflectedFieldValue(blockEntity, "beltLength"));
        belt.add("index", reflectedFieldValue(blockEntity, "index"));
        belt.add("movement_speed", reflectedValue(blockEntity, "getBeltMovementSpeed"));
        belt.add("direction_aware_movement_speed", reflectedValue(blockEntity, "getDirectionAwareBeltMovementSpeed"));
        belt.add("movement_facing", reflectedValue(blockEntity, "getMovementFacing"));
        belt.add("controller", reflectedValue(blockEntity, "getController"));
        belt.add("controller_block", reflectedValue(blockEntity, "isController"));
        belt.add("covered", reflectedFieldValue(blockEntity, "covered"));
        return belt;
    }

    private static JsonObject createPressDetails(BlockEntity blockEntity) {
        JsonObject press = new JsonObject();
        press.addProperty("processing", "pressing");
        press.add("kinetic_speed", reflectedValue(blockEntity, "getKineticSpeed"));
        press.add("can_process_in_bulk", reflectedValue(blockEntity, "canProcessInBulk"));
        press.add("pressing_behaviour_present", reflectedValue(blockEntity, "getPressingBehaviour").isJsonNull() ? GSON.toJsonTree(false) : GSON.toJsonTree(true));
        return press;
    }

    private static String createRole(String kind) {
        return switch (kind) {
            case "shaft", "cogwheel", "large_cogwheel" -> "kinetic_relay";
            case "depot" -> "item_buffer";
            case "belt" -> "item_transport";
            case "mechanical_press" -> "kinetic_processor";
            default -> "unknown_component";
        };
    }

    private static JsonArray createWrenchFaces(String kind) {
        return switch (kind) {
            case "shaft", "cogwheel", "large_cogwheel" -> stringArray("north", "south", "east", "west", "up", "down");
            case "depot", "mechanical_press" -> stringArray("north", "south", "east", "west", "up");
            case "belt" -> stringArray("north", "south", "east", "west");
            default -> stringArray("north", "south", "east", "west", "up", "down");
        };
    }

    private static JsonArray createSupportedInteractions(String kind) {
        return switch (kind) {
            case "shaft", "cogwheel", "large_cogwheel" -> stringArray("wrench", "place_adjacent_component");
            case "depot" -> stringArray("wrench", "insert_or_extract_item");
            case "belt" -> stringArray("wrench", "insert_item", "observe_transport");
            case "mechanical_press" -> stringArray("wrench", "process_item_when_powered");
            default -> stringArray("wrench");
        };
    }

    private static JsonArray createCommonBlockageReasons(String kind) {
        return switch (kind) {
            case "shaft", "cogwheel", "large_cogwheel" -> stringArray("missing_power_source", "axis_mismatch", "overstressed_network");
            case "depot" -> stringArray("held_item_blocks_insert", "missing_processing_machine", "target_not_reachable");
            case "belt" -> stringArray("missing_controller", "blocked_output", "missing_power_source", "overstressed_network");
            case "mechanical_press" -> stringArray("missing_power_source", "insufficient_rpm", "missing_recipe", "blocked_output", "overstressed_network");
            default -> stringArray("unsupported_component_kind");
        };
    }

    private static String propertyOrUnknown(JsonObject properties, String name) {
        JsonElement element = properties.get(name);
        return element == null || element.isJsonNull() ? "unknown" : element.getAsString();
    }

    private static String speedHint(JsonElement value) {
        if (value == null || value.isJsonNull() || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) {
            return "unknown";
        }
        double speed = value.getAsDouble();
        if (speed == 0.0D) {
            return "stopped";
        }
        return speed > 0.0D ? "moving_positive" : "moving_negative";
    }

    private static JsonElement reflectedValue(Object target, String methodName) {
        if (target == null) {
            return JsonNull.INSTANCE;
        }
        try {
            Method method = target.getClass().getMethod(methodName);
            method.setAccessible(true);
            return toJsonElement(method.invoke(target));
        } catch (ReflectiveOperationException | RuntimeException error) {
            return JsonNull.INSTANCE;
        }
    }

    private static JsonElement reflectedStaticValue(String className, String methodName, Class<?>[] parameterTypes, Object... args) {
        try {
            Class<?> type = Class.forName(className);
            Method method = type.getMethod(methodName, parameterTypes);
            method.setAccessible(true);
            return toJsonElement(method.invoke(null, args));
        } catch (ReflectiveOperationException | RuntimeException error) {
            return JsonNull.INSTANCE;
        }
    }

    private static JsonElement reflectedFieldValue(Object target, String fieldName) {
        if (target == null) {
            return JsonNull.INSTANCE;
        }
        try {
            Field field = target.getClass().getField(fieldName);
            field.setAccessible(true);
            return toJsonElement(field.get(target));
        } catch (ReflectiveOperationException | RuntimeException error) {
            return JsonNull.INSTANCE;
        }
    }

    private static JsonElement toJsonElement(Object value) {
        if (value == null) {
            return JsonNull.INSTANCE;
        }
        if (value instanceof Number number) {
            return GSON.toJsonTree(number);
        }
        if (value instanceof Boolean bool) {
            return GSON.toJsonTree(bool);
        }
        if (value instanceof String text) {
            return GSON.toJsonTree(text);
        }
        if (value instanceof Enum<?> enumValue) {
            return GSON.toJsonTree(enumValue.name().toLowerCase());
        }
        if (value instanceof ItemStack stack) {
            return stack.isEmpty() ? JsonNull.INSTANCE : stackPayload(stack);
        }
        if (value instanceof BlockPos pos) {
            return blockPosition(pos);
        }
        return GSON.toJsonTree(String.valueOf(value));
    }

    private JsonObject toolCompleted(JsonObject request) {
        JsonObject response = baseResponse(request, "tool.execute_result");
        response.addProperty("status", "completed");
        return response;
    }

    private InteractionTarget validateInteractionRef(JsonObject request, AgentBody agent, String ref) {
        BlockRef blockRef = agent.ref(ref);
        if (blockRef == null) {
            return new InteractionTarget(null, failure(request, "unknown_or_unobserved_target", "Block ref is not from the latest observation."));
        }
        if (blockRef.expired()) {
            return new InteractionTarget(null, failure(request, "expired_ref", "Block ref has expired."));
        }
        ServerLevel level = server.overworld();
        if (!agent.entity.canInteractWithBlock(blockRef.pos, 1.0)) {
            return new InteractionTarget(null, failure(request, "target_too_far", "The block is outside the vanilla interaction range."));
        }
        BlockState state = level.getBlockState(blockRef.pos);
        if (state.isAir() || !blockId(state).equals(blockRef.blockId)) {
            return new InteractionTarget(null, failure(request, "target_not_visible", "The observed block is no longer present."));
        }
        if (blockRef.pos.getY() >= level.getMaxBuildHeight() || !level.mayInteract(agent.entity, blockRef.pos)) {
            return new InteractionTarget(null, failure(request, "blocked", "The server rejected interaction with the target block."));
        }
        agent.entity.moveTo(agent.position().x, agent.position().y, agent.position().z, faceYaw(blockRef.pos, agent.position()), agent.entity.getXRot());
        return new InteractionTarget(blockRef, null);
    }

    private NoticeBoardTarget validateNoticeBoardRef(JsonObject request, AgentBody agent, String blockRefValue) {
        InteractionTarget target = validateInteractionRef(request, agent, blockRefValue);
        if (target.failure != null) {
            return new NoticeBoardTarget(null, "", "", target.failure);
        }
        BlockState state = server.overworld().getBlockState(target.ref.pos);
        if (!isNoticeBoard(state)) {
            return new NoticeBoardTarget(null, "", "", failure(request, "unsupported_capability", "The referenced block is not a supported notice board."));
        }
        return new NoticeBoardTarget(target.ref, blockRefValue, runtimeState.noticeBoardId(target.ref.pos), null);
    }

    private static JsonObject noticeBoardPayload(BlockRef ref, String blockRefValue, String boardId) {
        JsonObject board = new JsonObject();
        board.addProperty("board_id", boardId);
        board.addProperty("block_ref", blockRefValue);
        if (ref != null) {
            board.addProperty("id", ref.blockId);
        }
        return board;
    }

    private static boolean isNoticeBoard(BlockState state) {
        String id = blockId(state);
        return id.equals("minecraft:lectern") || id.endsWith("_sign");
    }

    private ItemStack prepareMainHand(AgentBody agent, String itemId) {
        agent.entity.getInventory().selected = 0;
        if (itemId.isBlank()) {
            int emptyHotbarSlot = firstEmptyPlayerSlot(agent, 0, Math.min(9, playerInventorySize(agent)));
            if (emptyHotbarSlot >= 0) {
                agent.entity.getInventory().selected = emptyHotbarSlot;
                return agent.entity.getItemInHand(InteractionHand.MAIN_HAND);
            }
            int emptyMainInventorySlot = firstEmptyPlayerSlot(agent, 9, playerInventorySize(agent));
            if (emptyMainInventorySlot >= 0) {
                var playerInventory = agent.entity.getInventory();
                ItemStack selected = playerInventory.getItem(0).copy();
                playerInventory.setItem(0, ItemStack.EMPTY);
                playerInventory.setItem(emptyMainInventorySlot, selected);
            }
            return agent.entity.getItemInHand(InteractionHand.MAIN_HAND);
        }
        var playerInventory = agent.entity.getInventory();
        int itemSlot = firstPlayerSlotWithItem(agent, itemId);
        if (itemSlot < 0) {
            return ItemStack.EMPTY;
        }
        if (itemSlot >= 0 && itemSlot < 9) {
            playerInventory.selected = itemSlot;
        } else {
            ItemStack selected = playerInventory.getItem(0).copy();
            ItemStack target = playerInventory.getItem(itemSlot).copy();
            playerInventory.setItem(0, target);
            playerInventory.setItem(itemSlot, selected);
            playerInventory.selected = 0;
        }
        return agent.entity.getItemInHand(InteractionHand.MAIN_HAND);
    }

    private void syncInventoryMirrorFromPlayer(AgentBody agent) {
        agent.inventory.clear();
        var playerInventory = agent.entity.getInventory();
        int size = playerInventorySize(agent);
        for (int slot = 0; slot < size; slot++) {
            ItemStack stack = playerInventory.getItem(slot);
            if (stack.isEmpty()) {
                continue;
            }
            agent.addInventory(stackItemId(stack), stack.getCount());
        }
    }

    private static int playerInventorySize(AgentBody agent) {
        return Math.min(PLAYER_INVENTORY_SLOT_LIMIT, agent.entity.getInventory().getContainerSize());
    }

    private static ItemStack playerInventoryStack(AgentBody agent, int slot) {
        if (slot < 0 || slot >= playerInventorySize(agent)) {
            return ItemStack.EMPTY;
        }
        return agent.entity.getInventory().getItem(slot).copy();
    }

    private static int firstPlayerSlotWithItem(AgentBody agent, String itemId) {
        int size = playerInventorySize(agent);
        for (int slot = 0; slot < size; slot++) {
            ItemStack stack = agent.entity.getInventory().getItem(slot);
            if (!stack.isEmpty() && stackItemId(stack).equals(itemId)) {
                return slot;
            }
        }
        return -1;
    }

    private static int firstPlayerSlotMatching(AgentBody agent, ItemStack wanted) {
        int size = playerInventorySize(agent);
        for (int slot = 0; slot < size; slot++) {
            ItemStack stack = agent.entity.getInventory().getItem(slot);
            if (!stack.isEmpty() && ItemStack.isSameItemSameComponents(stack, wanted)) {
                return slot;
            }
        }
        return -1;
    }

    private static int firstEmptyPlayerSlot(AgentBody agent, int startInclusive, int endExclusive) {
        int end = Math.min(endExclusive, playerInventorySize(agent));
        for (int slot = Math.max(0, startInclusive); slot < end; slot++) {
            if (agent.entity.getInventory().getItem(slot).isEmpty()) {
                return slot;
            }
        }
        return -1;
    }

    private boolean addToPlayerInventory(AgentBody agent, ItemStack stack) {
        if (!canAcceptInventory(agent, stack)) {
            return false;
        }
        ItemStack remaining = stack.copy();
        var playerInventory = agent.entity.getInventory();
        int size = playerInventorySize(agent);
        for (int slot = 0; slot < size && !remaining.isEmpty(); slot++) {
            ItemStack existing = playerInventory.getItem(slot);
            if (existing.isEmpty() || !ItemStack.isSameItemSameComponents(existing, remaining)) {
                continue;
            }
            int limit = Math.min(existing.getMaxStackSize(), playerInventory.getMaxStackSize());
            int room = Math.max(0, limit - existing.getCount());
            if (room <= 0) {
                continue;
            }
            int moved = Math.min(room, remaining.getCount());
            existing.grow(moved);
            remaining.shrink(moved);
            playerInventory.setItem(slot, existing);
        }
        for (int slot = 0; slot < size && !remaining.isEmpty(); slot++) {
            if (!playerInventory.getItem(slot).isEmpty()) {
                continue;
            }
            int moved = Math.min(remaining.getMaxStackSize(), remaining.getCount());
            playerInventory.setItem(slot, remaining.copyWithCount(moved));
            remaining.shrink(moved);
        }
        syncInventoryMirrorFromPlayer(agent);
        return remaining.isEmpty();
    }

    private boolean addToPlayerInventoryThroughSlotHooks(AgentBody agent, ItemStack stack) {
        if (!canAcceptInventory(agent, stack)) {
            return false;
        }
        ItemStack remaining = stack.copy();
        int size = playerInventorySize(agent);
        for (int index = 0; index < size && !remaining.isEmpty(); index++) {
            ItemStack existing = agent.entity.getInventory().getItem(index);
            if (existing.isEmpty() || !ItemStack.isSameItemSameComponents(existing, remaining)) {
                continue;
            }
            Slot slot = new Slot(agent.entity.getInventory(), index, 0, 0);
            remaining = slot.safeInsert(remaining, remaining.getCount());
            slot.setChanged();
        }
        for (int index = 0; index < size && !remaining.isEmpty(); index++) {
            if (!agent.entity.getInventory().getItem(index).isEmpty()) {
                continue;
            }
            Slot slot = new Slot(agent.entity.getInventory(), index, 0, 0);
            remaining = slot.safeInsert(remaining, remaining.getCount());
            slot.setChanged();
        }
        syncInventoryMirrorFromPlayer(agent);
        return remaining.isEmpty();
    }

    private boolean removeFromPlayerInventory(AgentBody agent, String itemId, int count) {
        if (inventoryCounts(agent).getOrDefault(itemId, 0) < count) {
            return false;
        }
        int remaining = count;
        var playerInventory = agent.entity.getInventory();
        int size = playerInventorySize(agent);
        for (int slot = 0; slot < size && remaining > 0; slot++) {
            ItemStack stack = playerInventory.getItem(slot);
            if (stack.isEmpty() || !stackItemId(stack).equals(itemId)) {
                continue;
            }
            int removed = Math.min(remaining, stack.getCount());
            stack.shrink(removed);
            playerInventory.setItem(slot, stack.isEmpty() ? ItemStack.EMPTY : stack);
            remaining -= removed;
        }
        syncInventoryMirrorFromPlayer(agent);
        return remaining == 0;
    }

    private String selectMiningItem(AgentBody agent, BlockState state, String toolPolicy) {
        if (toolPolicy.equals("empty_hand")) {
            return "";
        }
        if (!toolPolicy.isBlank() && !toolPolicy.equals("best_available")) {
            return inventoryCounts(agent).getOrDefault(toolPolicy, 0) > 0 ? toolPolicy : "";
        }

        String selected = "";
        float bestSpeed = 1.0F;
        boolean bestHarvests = false;
        for (Map.Entry<String, Integer> entry : inventoryCounts(agent).entrySet()) {
            if (entry.getValue() <= 0) {
                continue;
            }
            Item item = itemById(entry.getKey());
            if (item == Items.AIR) {
                continue;
            }
            ItemStack stack = new ItemStack(item, 1);
            float speed = stack.getDestroySpeed(state);
            boolean harvests = stack.isCorrectToolForDrops(state);
            if ((harvests && !bestHarvests) || (harvests == bestHarvests && speed > bestSpeed)) {
                selected = entry.getKey();
                bestSpeed = speed;
                bestHarvests = harvests;
            }
        }
        return selected;
    }

    private Set<Integer> itemEntityIds(ServerLevel level, AABB area) {
        Set<Integer> ids = new HashSet<>();
        for (ItemEntity itemEntity : level.getEntitiesOfClass(ItemEntity.class, area, entity -> entity.isAlive())) {
            ids.add(itemEntity.getId());
        }
        return ids;
    }

    private void collectNewNearbyDrops(ServerLevel level, AgentBody agent, AABB area, Set<Integer> existingDropIds) {
        for (ItemEntity itemEntity : level.getEntitiesOfClass(ItemEntity.class, area, entity ->
            entity.isAlive() && !entity.getItem().isEmpty() && !existingDropIds.contains(entity.getId())
        )) {
            itemEntity.setNoPickUpDelay();
            itemEntity.playerTouch(agent.entity);
        }
    }

    private static Map<String, Integer> inventoryCounts(AgentBody agent) {
        Map<String, Integer> counts = new LinkedHashMap<>();
        var playerInventory = agent.entity.getInventory();
        int size = playerInventorySize(agent);
        for (int slot = 0; slot < size; slot++) {
            ItemStack stack = playerInventory.getItem(slot);
            if (!stack.isEmpty()) {
                counts.merge(stackItemId(stack), stack.getCount(), Integer::sum);
            }
        }
        return counts;
    }

    private static JsonArray positiveInventoryDelta(Map<String, Integer> before, Map<String, Integer> after) {
        Set<String> itemIds = new HashSet<>();
        itemIds.addAll(before.keySet());
        itemIds.addAll(after.keySet());

        JsonArray delta = new JsonArray();
        for (String itemId : itemIds) {
            int count = after.getOrDefault(itemId, 0) - before.getOrDefault(itemId, 0);
            if (count <= 0) {
                continue;
            }
            JsonObject payload = new JsonObject();
            payload.addProperty("item", itemId);
            payload.addProperty("count", count);
            delta.add(payload);
        }
        return delta;
    }

    private static BlockHitResult hitResult(BlockPos pos, Direction face) {
        Vec3 center = Vec3.atCenterOf(pos);
        Vec3 hit = center.add(face.getStepX() * 0.5D, face.getStepY() * 0.5D, face.getStepZ() * 0.5D);
        return new BlockHitResult(hit, face, pos, false);
    }

    private static float faceYaw(BlockPos pos, Vec3 from) {
        double dx = pos.getX() + 0.5D - from.x;
        double dz = pos.getZ() + 0.5D - from.z;
        return (float)(Math.toDegrees(Math.atan2(dz, dx)) - 90.0D);
    }

    private static boolean portalActivatedNear(ServerLevel level, BlockPos anchor) {
        for (BlockPos pos : portalInteriorPositions(anchor)) {
            if (level.getBlockState(pos).is(Blocks.NETHER_PORTAL)) {
                return true;
            }
        }
        return false;
    }

    private boolean hasReachableCraftingStation(AgentBody agent) {
        OpenContainer open = agent.openContainer;
        return open != null
            && open.kind.equals("crafting_table")
            && Math.sqrt(open.blockPos.distSqr(agent.blockPosition())) <= 6.0;
    }

    private JsonObject containerSnapshot(AgentBody agent) {
        OpenContainer open = agent.openContainer;
        if (open == null) {
            return failure(null, "container_not_open", "No server-side container is currently open.");
        }
        open.slotRefs.clear();

        JsonObject snapshot = new JsonObject();
        snapshot.addProperty("container_id", open.containerId);
        snapshot.addProperty("kind", open.kind);
        snapshot.addProperty("block_ref", open.blockRef);
        snapshot.add("block_pos", blockPosition(open.blockPos));
        JsonObject nativeInteraction = new JsonObject();
        nativeInteraction.addProperty("method", "server_player_game_mode.use_item_on");
        nativeInteraction.addProperty("server_container_available", open.serverContainerAvailable);
        nativeInteraction.addProperty("interaction_result", open.nativeInteractionResult);
        nativeInteraction.addProperty("menu_opened", open.nativeMenuOpened);
        nativeInteraction.addProperty("body_ui", "headless_server_agent");
        nativeInteraction.addProperty("menu_type", open.nativeMenuType);
        nativeInteraction.addProperty("menu_source", open.nativeMenuSource);
        snapshot.add("native_interaction", nativeInteraction);
        if (open.nativeMenu != null) {
            snapshot.add("cursor", stackPayloadOrNull(open.nativeMenu.getCarried()));
        } else {
            snapshot.add("cursor", JsonNull.INSTANCE);
        }

        JsonArray slots = new JsonArray();
        CraftingMenu craftingMenu = craftingMenu(open);
        if (craftingMenu != null) {
            for (int index = 0; index < 9; index++) {
                Slot menuSlot = craftingGridSlot(open, index);
                if (menuSlot != null) {
                    slots.add(slotPayload(agent, "container", index, menuSlot.getItem()));
                }
            }
        } else if (open.container != null) {
            for (int index = 0; index < open.container.getContainerSize(); index++) {
                if (open.kind.equals("furnace") && index == 2) {
                    continue;
                }
                slots.add(slotPayload(agent, "container", index, open.container.getItem(index)));
            }
        }
        snapshot.add("slots", slots);

        JsonArray inventorySlots = new JsonArray();
        int inventorySlotCount = Math.min(CONTAINER_INVENTORY_SLOT_LIMIT, playerInventorySize(agent));
        for (int index = 0; index < inventorySlotCount; index++) {
            ItemStack stack = playerInventoryStack(agent, index);
            inventorySlots.add(slotPayload(agent, "inventory", index, stack));
        }
        snapshot.add("inventory_slots", inventorySlots);

        ItemStack output = outputStack(open);
        snapshot.add("output_slot", output.isEmpty() ? null : slotPayload(agent, "output", outputIndex(open), output));
        return snapshot;
    }

    private JsonObject slotPayload(AgentBody agent, String area, int index, ItemStack stack) {
        OpenContainer open = agent.openContainer;
        String ref = "slot:" + open.containerId + ":" + area + ":" + index + ":" + (++agent.slotSeq);
        open.slotRefs.put(ref, new SlotRef(open.containerId, area, index));

        JsonObject payload = new JsonObject();
        payload.addProperty("slot_ref", ref);
        payload.addProperty("area", area);
        payload.addProperty("index", index);
        if (stack.isEmpty()) {
            payload.add("item", null);
            payload.addProperty("count", 0);
        } else {
            payload.addProperty("item", stackItemId(stack));
            payload.addProperty("count", stack.getCount());
        }
        return payload;
    }

    private SlotRef slotRef(AgentBody agent, String ref) {
        OpenContainer open = agent.openContainer;
        if (open == null) {
            return null;
        }
        SlotRef slot = open.slotRefs.get(ref);
        return slot != null && slot.containerId.equals(open.containerId) ? slot : null;
    }

    private Slot serverSlot(AgentBody agent, SlotRef slot) {
        OpenContainer open = agent.openContainer;
        if (open == null || !open.containerId.equals(slot.containerId)) {
            return null;
        }
        if (slot.area.equals("inventory")) {
            if (slot.index < 0 || slot.index >= playerInventorySize(agent)) {
                return null;
            }
            return new Slot(agent.entity.getInventory(), slot.index, 0, 0);
        }
        if (slot.area.equals("container") && open.kind.equals("crafting_table")) {
            return craftingGridSlot(open, slot.index);
        }
        if (slot.area.equals("container") && open.container != null && slot.index >= 0 && slot.index < open.container.getContainerSize()) {
            if (open.kind.equals("furnace")) {
                return furnaceMenuSlot(agent, open, slot.index);
            }
            return new Slot(open.container, slot.index, 0, 0);
        }
        if (slot.area.equals("output") && open.kind.equals("furnace") && open.container != null && slot.index == 2) {
            return furnaceMenuSlot(agent, open, 2);
        }
        if (slot.area.equals("output") && open.kind.equals("crafting_table") && slot.index == CraftingMenu.RESULT_SLOT) {
            return craftingResultSlot(open);
        }
        return null;
    }

    private int menuSlotIndex(OpenContainer open, SlotRef slot) {
        if (open == null || open.nativeMenu == null || !open.containerId.equals(slot.containerId)) {
            return -1;
        }
        if (slot.area.equals("inventory")) {
            if (open.kind.equals("crafting_table")) {
                return inventoryMenuSlotIndex(slot.index);
            }
            return -1;
        }
        if (slot.area.equals("container") && open.kind.equals("crafting_table")) {
            int menuIndex = CRAFTING_GRID_SLOT_START + slot.index;
            return menuIndex >= CRAFTING_GRID_SLOT_START && menuIndex < CRAFTING_GRID_SLOT_END ? menuIndex : -1;
        }
        return -1;
    }

    private int inventoryMenuSlotIndex(int playerInventoryIndex) {
        if (playerInventoryIndex >= 0 && playerInventoryIndex < 9) {
            return 37 + playerInventoryIndex;
        }
        if (playerInventoryIndex >= 9 && playerInventoryIndex < PLAYER_INVENTORY_SLOT_LIMIT) {
            return 10 + (playerInventoryIndex - 9);
        }
        return -1;
    }

    private Slot furnaceMenuSlot(AgentBody agent, OpenContainer open, int containerSlot) {
        if (open.container == null || containerSlot < 0 || containerSlot >= open.container.getContainerSize()) {
            return null;
        }
        FurnaceMenu menu = new FurnaceMenu(-1, agent.entity.getInventory(), open.container, new SimpleContainerData(4));
        var menuSlot = menu.findSlot(open.container, containerSlot);
        return menuSlot.isPresent() ? menu.slots.get(menuSlot.getAsInt()) : null;
    }

    private CraftingMenu craftingMenu(OpenContainer open) {
        return open != null && open.nativeMenu instanceof CraftingMenu menu ? menu : null;
    }

    private Slot craftingGridSlot(OpenContainer open, int gridIndex) {
        CraftingMenu menu = craftingMenu(open);
        int menuIndex = CRAFTING_GRID_SLOT_START + gridIndex;
        if (menu == null || menuIndex < CRAFTING_GRID_SLOT_START || menuIndex >= CRAFTING_GRID_SLOT_END || menuIndex >= menu.slots.size()) {
            return null;
        }
        return menu.slots.get(menuIndex);
    }

    private Slot craftingResultSlot(OpenContainer open) {
        CraftingMenu menu = craftingMenu(open);
        if (menu == null || menu.slots.size() <= CraftingMenu.RESULT_SLOT) {
            return null;
        }
        Slot slot = menu.slots.get(CraftingMenu.RESULT_SLOT);
        return slot instanceof ResultSlot ? slot : null;
    }

    private JsonObject slotTransferPayload(String method, SlotRef source, SlotRef destination, Slot sourceSlot, Slot destinationSlot, ItemStack moved) {
        JsonObject payload = new JsonObject();
        payload.addProperty("method", method);
        payload.addProperty("body_ui", "headless_server_agent");
        payload.addProperty("source_area", source.area);
        payload.addProperty("source_index", source.index);
        payload.addProperty("source_slot_class", sourceSlot.getClass().getName());
        payload.addProperty("destination_area", destination.area);
        payload.addProperty("destination_index", destination.index);
        payload.addProperty("destination_slot_class", destinationSlot.getClass().getName());
        payload.addProperty("server_slot_hooks", true);
        payload.add("moved", stackPayload(moved));
        return payload;
    }

    private int clickButton(JsonObject arguments) {
        String button = stringValue(arguments, "button", "primary").toLowerCase();
        return switch (button) {
            case "", "primary", "left" -> 0;
            case "secondary", "right" -> 1;
            default -> -1;
        };
    }

    private String clickButtonName(int button) {
        return button == 1 ? "secondary" : "primary";
    }

    private JsonObject slotClickPayload(
        OpenContainer open,
        SlotRef source,
        Slot nativeSlot,
        int menuSlot,
        int button,
        ItemStack beforeSlot,
        ItemStack afterSlot,
        ItemStack beforeCursor,
        ItemStack afterCursor
    ) {
        JsonObject payload = new JsonObject();
        payload.addProperty("method", "abstract_container_menu.clicked");
        payload.addProperty("click_type", ClickType.PICKUP.name());
        payload.addProperty("button", clickButtonName(button));
        payload.addProperty("button_id", button);
        payload.addProperty("body_ui", "headless_server_agent");
        payload.addProperty("source_area", source.area);
        payload.addProperty("source_index", source.index);
        payload.addProperty("menu_slot_index", menuSlot);
        payload.addProperty("slot_class", nativeSlot.getClass().getName());
        payload.addProperty("server_menu_hooks", true);
        payload.addProperty("menu_type", open.nativeMenuType);
        payload.add("before_slot", stackPayloadOrNull(beforeSlot));
        payload.add("after_slot", stackPayloadOrNull(afterSlot));
        payload.add("before_cursor", stackPayloadOrNull(beforeCursor));
        payload.add("after_cursor", stackPayloadOrNull(afterCursor));
        return payload;
    }

    private JsonObject outputTransferPayload(OpenContainer open, Slot outputSlot, ItemStack taken) {
        String sourceKind = "synthetic_output";
        if (outputSlot != null && open != null && open.kind.equals("crafting_table")) {
            sourceKind = "crafting_result_slot";
        } else if (outputSlot != null && open != null && open.kind.equals("furnace")) {
            sourceKind = "furnace_result_slot";
        }

        JsonObject payload = new JsonObject();
        payload.addProperty("method", outputSlot == null ? "synthetic_output_inventory_safe_insert" : "slot.safe_take_inventory_safe_insert");
        payload.addProperty("body_ui", "headless_server_agent");
        payload.addProperty("source_area", "output");
        payload.addProperty("source_slot_kind", sourceKind);
        payload.addProperty("source_slot_class", outputSlot == null ? "minelink.synthetic_crafting_output" : outputSlot.getClass().getName());
        payload.addProperty("destination_area", "inventory");
        payload.addProperty("destination_slot_class", Slot.class.getName());
        payload.addProperty("server_slot_hooks", outputSlot != null);
        payload.addProperty("inventory_insert_method", "slot.safe_insert");
        payload.add("taken", stackPayload(taken));
        return payload;
    }

    private JsonObject validateDestinationSlot(JsonObject request, AgentBody agent, SlotRef slot, ItemStack stack) {
        OpenContainer open = agent.openContainer;
        if (open == null || !open.containerId.equals(slot.containerId)) {
            return failure(request, "stale_slot_ref", "Destination slot is not valid for the current container snapshot.");
        }
        if (slot.area.equals("container") && open.container != null && slot.index >= 0 && slot.index < open.container.getContainerSize()) {
            ItemStack probe = stack.copyWithCount(1);
            if (!open.container.canPlaceItem(slot.index, probe)) {
                return failure(request, "blocked", "Server slot rules rejected this item for the destination slot.");
            }
        }
        return null;
    }

    private int destinationLimit(AgentBody agent, SlotRef slot, ItemStack source, ItemStack destination) {
        int itemLimit = destination.isEmpty() ? source.getMaxStackSize() : destination.getMaxStackSize();
        OpenContainer open = agent.openContainer;
        if (slot.area.equals("container") && open != null && open.container != null) {
            return Math.min(itemLimit, open.container.getMaxStackSize());
        }
        if (slot.area.equals("inventory")) {
            return Math.min(itemLimit, agent.entity.getInventory().getMaxStackSize());
        }
        return itemLimit;
    }

    private ItemStack readSlot(AgentBody agent, SlotRef slot) {
        OpenContainer open = agent.openContainer;
        if (open == null || !open.containerId.equals(slot.containerId)) {
            return ItemStack.EMPTY;
        }
        if (slot.area.equals("container") && open.container != null && slot.index >= 0 && slot.index < open.container.getContainerSize()) {
            return open.container.getItem(slot.index).copy();
        }
        if (slot.area.equals("inventory")) {
            return playerInventoryStack(agent, slot.index);
        }
        if (slot.area.equals("output")) {
            return outputStack(open);
        }
        return ItemStack.EMPTY;
    }

    private void writeSlot(AgentBody agent, SlotRef slot, ItemStack stack) {
        OpenContainer open = agent.openContainer;
        if (open == null || !open.containerId.equals(slot.containerId)) {
            return;
        }
        if (slot.area.equals("container") && open.container != null && slot.index >= 0 && slot.index < open.container.getContainerSize()) {
            open.container.setItem(slot.index, stack);
            open.container.setChanged();
            return;
        }
        if (slot.area.equals("inventory")) {
            if (slot.index >= 0 && slot.index < playerInventorySize(agent)) {
                agent.entity.getInventory().setItem(slot.index, stack.copy());
                syncInventoryMirrorFromPlayer(agent);
            }
            return;
        }
        if (slot.area.equals("output")) {
            writeOutputStack(open, stack);
        }
    }

    private ItemStack outputStack(OpenContainer open) {
        if (open.kind.equals("furnace") && open.container != null && open.container.getContainerSize() > 2) {
            return open.container.getItem(2).copy();
        }
        Slot resultSlot = craftingResultSlot(open);
        if (resultSlot != null) {
            return resultSlot.getItem().copy();
        }
        return open.output.copy();
    }

    private void writeOutputStack(OpenContainer open, ItemStack stack) {
        if (open.kind.equals("furnace") && open.container != null && open.container.getContainerSize() > 2) {
            open.container.setItem(2, stack);
            open.container.setChanged();
            return;
        }
        Slot resultSlot = craftingResultSlot(open);
        if (resultSlot != null) {
            resultSlot.set(stack);
            return;
        }
        open.output = stack;
    }

    private int outputIndex(OpenContainer open) {
        return open.kind.equals("furnace") ? 2 : 0;
    }

    private boolean canAcceptInventory(AgentBody agent, ItemStack stack) {
        ItemStack remaining = stack.copy();
        var playerInventory = agent.entity.getInventory();
        int size = playerInventorySize(agent);
        for (int slot = 0; slot < size; slot++) {
            ItemStack existing = playerInventory.getItem(slot);
            if (!existing.isEmpty() && ItemStack.isSameItemSameComponents(existing, remaining)) {
                int limit = Math.min(existing.getMaxStackSize(), playerInventory.getMaxStackSize());
                remaining.shrink(Math.max(0, limit - existing.getCount()));
                if (remaining.isEmpty()) {
                    return true;
                }
            }
        }
        int emptySlotLimit = Math.min(remaining.getMaxStackSize(), playerInventory.getMaxStackSize());
        for (int slot = 0; slot < size; slot++) {
            if (playerInventory.getItem(slot).isEmpty()) {
                remaining.shrink(emptySlotLimit);
                if (remaining.isEmpty()) {
                    return true;
                }
            }
        }
        return false;
    }

    private JsonObject inventoryPayload(AgentBody agent) {
        JsonObject inventory = new JsonObject();
        JsonArray main = new JsonArray();
        JsonArray hotbar = new JsonArray();
        int size = playerInventorySize(agent);
        for (int slot = 0; slot < size; slot++) {
            ItemStack stack = agent.entity.getInventory().getItem(slot);
            if (!stack.isEmpty()) {
                JsonObject item = stackPayload(stack);
                item.addProperty("slot", slot);
                main.add(item);
                if (slot < 9) {
                    hotbar.add(item.deepCopy());
                }
            }
        }
        inventory.addProperty("source", "fake_player");
        inventory.add("main", main);
        inventory.add("hotbar", hotbar);
        return inventory;
    }

    private boolean craftingGridIsEmpty(CraftingMenu menu) {
        for (int gridIndex = 0; gridIndex < 9; gridIndex++) {
            Slot slot = menu.slots.get(CRAFTING_GRID_SLOT_START + gridIndex);
            if (!slot.getItem().isEmpty()) {
                return false;
            }
        }
        return true;
    }

    private JsonObject fillNativeCraftingGrid(JsonObject request, AgentBody agent, CraftingMenu menu, CraftPlan plan) {
        for (int gridIndex = 0; gridIndex < plan.grid.size(); gridIndex++) {
            ItemStack ingredient = plan.grid.get(gridIndex);
            if (ingredient.isEmpty()) {
                continue;
            }
            ItemStack taken = takeFromPlayerInventoryThroughSlotHooks(agent, ingredient);
            if (taken.isEmpty()) {
                returnCraftingGridToInventory(agent, menu);
                return failure(request, "missing_material", "Current agent inventory cannot satisfy the requested recipe.");
            }
            Slot destinationSlot = menu.slots.get(CRAFTING_GRID_SLOT_START + gridIndex);
            if (!destinationSlot.mayPlace(ingredient)) {
                addToPlayerInventoryThroughSlotHooks(agent, taken);
                returnCraftingGridToInventory(agent, menu);
                return failure(request, "blocked", "Server slot rules rejected placing an ingredient into the crafting grid.");
            }
            ItemStack remaining = destinationSlot.safeInsert(taken, taken.getCount());
            if (!remaining.isEmpty()) {
                addToPlayerInventoryThroughSlotHooks(agent, remaining);
                returnCraftingGridToInventory(agent, menu);
                return failure(request, "blocked", "Server slot rules rejected inserting an ingredient into the crafting grid.");
            }
            destinationSlot.setChanged();
        }
        syncInventoryMirrorFromPlayer(agent);
        return null;
    }

    private ItemStack takeFromPlayerInventoryThroughSlotHooks(AgentBody agent, ItemStack wanted) {
        ItemStack remaining = wanted.copy();
        ItemStack gathered = ItemStack.EMPTY;
        while (!remaining.isEmpty()) {
            int sourceIndex = firstPlayerSlotMatching(agent, remaining.copyWithCount(1));
            if (sourceIndex < 0) {
                break;
            }
            Slot sourceSlot = new Slot(agent.entity.getInventory(), sourceIndex, 0, 0);
            if (!sourceSlot.mayPickup(agent.entity)) {
                if (!gathered.isEmpty()) {
                    addToPlayerInventoryThroughSlotHooks(agent, gathered);
                }
                return ItemStack.EMPTY;
            }
            int takeCount = Math.min(remaining.getCount(), sourceSlot.getItem().getCount());
            ItemStack taken = sourceSlot.safeTake(takeCount, takeCount, agent.entity);
            if (taken.isEmpty()) {
                if (!gathered.isEmpty()) {
                    addToPlayerInventoryThroughSlotHooks(agent, gathered);
                }
                return ItemStack.EMPTY;
            }
            if (gathered.isEmpty()) {
                gathered = taken.copy();
            } else {
                gathered.grow(taken.getCount());
            }
            remaining.shrink(taken.getCount());
            sourceSlot.setChanged();
        }
        if (!remaining.isEmpty()) {
            if (!gathered.isEmpty()) {
                addToPlayerInventoryThroughSlotHooks(agent, gathered);
            }
            return ItemStack.EMPTY;
        }
        syncInventoryMirrorFromPlayer(agent);
        return gathered;
    }

    private void returnCraftingGridToInventory(AgentBody agent, CraftingMenu menu) {
        for (int gridIndex = 0; gridIndex < 9; gridIndex++) {
            Slot gridSlot = menu.slots.get(CRAFTING_GRID_SLOT_START + gridIndex);
            ItemStack stack = gridSlot.getItem().copy();
            if (stack.isEmpty()) {
                continue;
            }
            ItemStack taken = gridSlot.safeTake(stack.getCount(), stack.getCount(), agent.entity);
            if (!taken.isEmpty()) {
                addToPlayerInventoryThroughSlotHooks(agent, taken);
            }
            gridSlot.setChanged();
        }
        syncInventoryMirrorFromPlayer(agent);
    }

    private JsonObject craftingTransferPayload(OpenContainer open, Slot resultSlot, CraftPlan plan) {
        JsonObject payload = new JsonObject();
        payload.addProperty("method", "crafting_menu.safe_take_safe_insert_grid");
        payload.addProperty("body_ui", "headless_server_agent");
        payload.addProperty("input_source_area", "inventory");
        payload.addProperty("grid_destination_area", "container");
        payload.addProperty("recipe_placement", "minecraft.recipebook.PlaceRecipe");
        payload.addProperty("output_source", "native_crafting_result_slot");
        payload.addProperty("result_slot_class", resultSlot.getClass().getName());
        payload.addProperty("server_slot_hooks", true);
        payload.addProperty("menu_type", open.nativeMenuType);
        payload.addProperty("planned_result_takes", plan.plannedCrafts());
        payload.add("planned_output", stackPayload(plan.plannedOutput()));

        JsonObject consumed = new JsonObject();
        for (Map.Entry<String, Integer> entry : plan.consumed.entrySet()) {
            consumed.addProperty(entry.getKey(), entry.getValue());
        }
        payload.add("consumed", consumed);

        JsonArray grid = new JsonArray();
        for (int index = 0; index < plan.grid.size(); index++) {
            ItemStack stack = plan.grid.get(index);
            if (stack.isEmpty()) {
                continue;
            }
            JsonObject entry = stackPayload(stack);
            entry.addProperty("grid_index", index);
            entry.addProperty("destination_slot_class", Slot.class.getName());
            grid.add(entry);
        }
        payload.add("grid", grid);
        return payload;
    }

    private Optional<CraftPlan> craftPlan(RecipeHolder<CraftingRecipe> recipe, int count, AgentBody agent) {
        if (!recipe.value().canCraftInDimensions(3, 3)) {
            return Optional.empty();
        }
        List<PlacedIngredient> placements = recipeGridPlacements(recipe);
        if (placements.isEmpty()) {
            return Optional.empty();
        }
        Map<String, Integer> available = new LinkedHashMap<>(inventoryCounts(agent));
        Map<String, Integer> consumed = new LinkedHashMap<>();
        ItemStack output = ItemStack.EMPTY;
        List<ItemStack> stagedGrid = new ArrayList<>();
        for (int slot = 0; slot < 9; slot++) {
            stagedGrid.add(ItemStack.EMPTY);
        }

        for (int craftIndex = 0; craftIndex < count; craftIndex++) {
            List<ItemStack> grid = new ArrayList<>();
            for (int slot = 0; slot < 9; slot++) {
                grid.add(ItemStack.EMPTY);
            }
            for (PlacedIngredient placement : placements) {
                int gridIndex = placement.gridIndex();
                Ingredient ingredient = placement.ingredient();
                if (ingredient.isEmpty()) {
                    continue;
                }
                Optional<ItemStack> selected = selectIngredient(ingredient, available);
                if (selected.isEmpty()) {
                    return Optional.empty();
                }
                ItemStack stack = selected.get();
                available.merge(stackItemId(stack), -1, Integer::sum);
                consumed.merge(stackItemId(stack), 1, Integer::sum);
                ItemStack one = stack.copyWithCount(1);
                grid.set(gridIndex, one);
                ItemStack staged = stagedGrid.get(gridIndex);
                if (staged.isEmpty()) {
                    stagedGrid.set(gridIndex, one.copy());
                } else if (ItemStack.isSameItemSameComponents(staged, one) && staged.getCount() < staged.getMaxStackSize()) {
                    staged.grow(1);
                } else {
                    return Optional.empty();
                }
            }

            CraftingInput input = CraftingInput.of(3, 3, grid);
            if (!recipe.value().matches(input, server.overworld())) {
                return Optional.empty();
            }
            ItemStack crafted = recipe.value().assemble(input, server.registryAccess());
            if (crafted.isEmpty()) {
                return Optional.empty();
            }
            if (output.isEmpty()) {
                output = crafted.copy();
            } else if (ItemStack.isSameItemSameComponents(output, crafted)) {
                output.grow(crafted.getCount());
            } else {
                return Optional.empty();
            }
        }
        return Optional.of(new CraftPlan(consumed, stagedGrid, count, output));
    }

    private List<PlacedIngredient> recipeGridPlacements(RecipeHolder<CraftingRecipe> recipe) {
        List<PlacedIngredient> placements = new ArrayList<>();
        new PlaceRecipe<Ingredient>() {
            @Override
            public void addItemToSlot(Ingredient ingredient, int menuSlot, int maxAmount, int x, int y) {
                int gridIndex = menuSlot - CRAFTING_GRID_SLOT_START;
                if (gridIndex >= 0 && gridIndex < 9) {
                    placements.add(new PlacedIngredient(gridIndex, ingredient));
                }
            }
        }.placeRecipe(3, 3, CraftingMenu.RESULT_SLOT, recipe, recipe.value().getIngredients().iterator(), 1);
        return placements;
    }

    private Optional<ItemStack> selectIngredient(net.minecraft.world.item.crafting.Ingredient ingredient, Map<String, Integer> available) {
        for (Map.Entry<String, Integer> entry : available.entrySet()) {
            if (entry.getValue() <= 0) {
                continue;
            }
            ItemStack stack = new ItemStack(itemById(entry.getKey()), 1);
            if (!stack.isEmpty() && ingredient.test(stack)) {
                return Optional.of(stack);
            }
        }
        return Optional.empty();
    }

    private static JsonObject stackPayload(ItemStack stack) {
        JsonObject payload = new JsonObject();
        payload.addProperty("item", stackItemId(stack));
        payload.addProperty("count", stack.getCount());
        return payload;
    }

    private static JsonElement stackPayloadOrNull(ItemStack stack) {
        return stack == null || stack.isEmpty() ? JsonNull.INSTANCE : stackPayload(stack);
    }

    private static String stackItemId(ItemStack stack) {
        return BuiltInRegistries.ITEM.getKey(stack.getItem()).toString();
    }

    private static Item itemById(String itemId) {
        try {
            return BuiltInRegistries.ITEM.get(ResourceLocation.parse(itemId));
        } catch (RuntimeException error) {
            return Items.AIR;
        }
    }

    private JsonObject unsupported(JsonObject request, String toolName) {
        return failure(request, "unsupported_capability", toolName + " is not implemented by the real NeoForge smoke runtime yet.");
    }

    private boolean onlineMode() {
        Properties properties = new Properties();
        Path path = Path.of("server.properties");
        if (Files.isRegularFile(path)) {
            try (InputStream input = Files.newInputStream(path)) {
                properties.load(input);
                return Boolean.parseBoolean(properties.getProperty("online-mode", "true"));
            } catch (IOException error) {
                MineLinkMod.LOGGER.warn("Unable to read server.properties; assuming online-mode=true", error);
                return true;
            }
        }
        return true;
    }

    private boolean authorized(HttpExchange exchange, JsonObject request) {
        Optional<String> token = endpointToken();
        if (token.isEmpty()) {
            return true;
        }
        String expected = "Bearer " + token.get();
        if (expected.equals(exchange.getRequestHeaders().getFirst("authorization"))) {
            return true;
        }
        return token.get().equals(stringValue(request, "endpoint_token", ""));
    }

    private Optional<String> endpointToken() {
        String value = setting("MINELINK_ENDPOINT_TOKEN", "minelink.endpoint.token", "");
        return value.isBlank() ? Optional.empty() : Optional.of(value);
    }

    private static String setting(String envName, String propertyName, String defaultValue) {
        String property = System.getProperty(propertyName);
        if (property != null && !property.isBlank()) {
            return property;
        }
        String env = System.getenv(envName);
        return env == null || env.isBlank() ? defaultValue : env;
    }

    private static int parsePort(String value) {
        try {
            int port = Integer.parseInt(value);
            if (port < 1 || port > 65535) {
                throw new IllegalArgumentException("Invalid port: " + value);
            }
            return port;
        } catch (NumberFormatException error) {
            throw new IllegalArgumentException("Invalid port: " + value, error);
        }
    }

    private static JsonObject baseResponse(JsonObject request, String type) {
        JsonObject response = new JsonObject();
        if (request != null && request.has("id")) {
            response.add("id", request.get("id"));
        }
        response.addProperty("type", type);
        response.addProperty("ok", true);
        return response;
    }

    private static JsonObject failure(JsonObject request, String reason, String message) {
        JsonObject response = new JsonObject();
        if (request != null && request.has("id")) {
            response.add("id", request.get("id"));
        }
        response.addProperty("type", "error");
        response.addProperty("ok", false);
        response.addProperty("reason", reason);
        response.addProperty("message", message == null ? reason : message);
        return response;
    }

    private static List<ToolDefinition> filteredToolDefinitions(JsonObject request) {
        String namespace = stringValue(request, "namespace", "").toLowerCase();
        String query = stringValue(request, "query", "").toLowerCase();
        List<String> tags = stringList(arrayValue(request, "tags"));
        int limit = Math.min(Math.max(intValue(request, "limit", 20), 1), 50);
        List<ToolDefinition> tools = new ArrayList<>();
        for (ToolDefinition tool : toolDefinitions()) {
            if (!namespace.isBlank() && !tool.name.toLowerCase().startsWith(namespace + ".")) {
                continue;
            }
            if (!query.isBlank() && !tool.searchText().contains(query)) {
                continue;
            }
            if (!tool.tags.containsAll(tags)) {
                continue;
            }
            tools.add(tool);
            if (tools.size() >= limit) {
                break;
            }
        }
        return tools;
    }

    private static List<String> stringList(JsonArray array) {
        List<String> values = new ArrayList<>();
        for (JsonElement element : array) {
            if (!element.isJsonNull()) {
                values.add(element.getAsString());
            }
        }
        return values;
    }

    private static List<ToolDefinition> toolDefinitions() {
        return List.of(
            tool(
                "observe.self",
                "Observe the active server_agent body state.",
                "Returns health, hunger, position, yaw, pitch, current action, and body capability flags.",
                objectSchema(),
                List.of("observe", "self", "survival"),
                List.of(),
                List.of()
            ),
            tool(
                "observe.scene",
                "Observe visible nearby surfaces from the current body.",
                "Returns a bounded visible scene with short-lived refs. It is not a chunk oracle.",
                objectSchema(properties(
                    prop("radius", numberSchema(1, 32, 16)),
                    prop("include", arraySchema("string"))
                )),
                List.of("observe", "scene", "perception"),
                List.of("runtime_unavailable"),
                List.of()
            ),
            tool(
                "observe.inventory",
                "Observe the active server_agent inventory.",
                "Returns hotbar, main inventory, selected slot, and equipment known to the server.",
                objectSchema(),
                List.of("observe", "inventory"),
                List.of(),
                List.of()
            ),
            tool(
                "observe.events",
                "Observe locally visible social and action events.",
                "Returns bounded event summaries visible from the active server_agent body. It is not a global timeline.",
                objectSchema(properties(
                    prop("after_event_id", stringSchema()),
                    prop("limit", numberSchema(1, 50, 20))
                )),
                List.of("observe", "events", "social"),
                List.of("invalid_cursor"),
                List.of()
            ),
            tool(
                "body.freeze",
                "Freeze the active server_agent body.",
                "Pauses the active server_agent body, cancels queued or running actions, and rejects further world-changing tools until restored.",
                objectSchema(properties(prop("reason", stringSchema()))),
                List.of("body", "lifecycle"),
                List.of("body_removed"),
                List.of()
            ),
            tool(
                "body.restore",
                "Restore a frozen server_agent body.",
                "Restores a same-process frozen server_agent body. This is not restart persistence.",
                objectSchema(),
                List.of("body", "lifecycle"),
                List.of("body_removed"),
                List.of()
            ),
            tool(
                "body.remove",
                "Remove the active server_agent body.",
                "Closes server-side body state, cancels pending actions, releases the owner body quota, and makes later tool calls fail as not born.",
                objectSchema(properties(prop("reason", stringSchema()))),
                List.of("body", "lifecycle"),
                List.of("body_removed"),
                List.of()
            ),
            tool(
                "action.move",
                "Move the active body using a bounded vector.",
                "Moves by a small vector and returns collision plus moved-distance feedback.",
                objectSchema(properties(
                    prop("vector", arraySchema("number")),
                    prop("durationMs", numberSchema(50, 5000, null))
                ), "vector", "durationMs"),
                List.of("action", "movement"),
                List.of("blocked", "backpressure_queue_full", "body_frozen"),
                List.of()
            ),
            tool(
                "action.look_at",
                "Turn toward a visible block ref.",
                "Updates the body orientation. Refs must come from a current observation.",
                objectSchema(properties(
                    prop("block_ref", stringSchema()),
                    prop("entity_ref", stringSchema()),
                    prop("point", arraySchema("number"))
                )),
                List.of("action", "look"),
                List.of("unknown_or_unobserved_target", "expired_ref"),
                List.of()
            ),
            tool(
                "action.mine_visible_block",
                "Mine a currently visible block ref.",
                "Mines through server-side guard checks and native runtime harvest rules. It never accepts hidden ore coordinates as authority.",
                objectSchema(properties(
                    prop("block_ref", stringSchema()),
                    prop("tool_policy", stringSchema("best_available"))
                ), "block_ref"),
                List.of("action", "mine", "survival"),
                List.of("unknown_or_unobserved_target", "expired_ref", "target_too_far", "target_not_visible", "wrong_tool"),
                List.of("block_ref comes from a recent observe.scene result", "target is visible and reachable")
            ),
            tool(
                "action.use",
                "Use a visible target when supported.",
                "Runs a server-side use/interact action with the selected item or an empty hand when allowed.",
                objectSchema(properties(
                    prop("target_ref", stringSchema()),
                    prop("block_ref", stringSchema()),
                    prop("item", stringSchema()),
                    prop("face", enumSchema("up", "down", "north", "south", "east", "west"))
                )),
                List.of("action", "use"),
                List.of("unsupported_capability", "target_too_far", "target_not_visible", "missing_material", "blocked"),
                List.of()
            ),
            tool(
                "action.sleep",
                "Try to sleep in a visible reachable bed.",
                "Uses the native server sleep path and returns vanilla sleep rejection as a structured failure.",
                objectSchema(properties(prop("target_ref", stringSchema())), "target_ref"),
                List.of("action", "sleep", "survival"),
                List.of("unknown_or_unobserved_target", "expired_ref", "target_too_far", "target_not_visible", "unsupported_capability", "blocked"),
                List.of("target_ref comes from a recent observe.scene result", "target is a visible reachable bed")
            ),
            tool(
                "action.status",
                "Read a submitted action lifecycle record.",
                "Returns the lifecycle status for a submit-mode action handle owned by the active server_agent.",
                objectSchema(properties(prop("action_id", stringSchema())), "action_id"),
                List.of("action", "lifecycle", "observe"),
                List.of("unknown_action", "invalid_arguments"),
                List.of()
            ),
            tool(
                "action.cancel",
                "Cancel a submitted action that has not reached a terminal state.",
                "Cancels a queued or running submit-mode action handle owned by the active server_agent and releases queue capacity.",
                objectSchema(properties(prop("action_id", stringSchema())), "action_id"),
                List.of("action", "lifecycle"),
                List.of("unknown_action", "action_already_finished", "invalid_arguments"),
                List.of()
            ),
            tool(
                "block.place",
                "Place a block from inventory against a visible target.",
                "Places only through server-side reach, visibility, inventory, and occupancy checks.",
                objectSchema(properties(
                    prop("target_ref", stringSchema()),
                    prop("face", enumSchema("up", "down", "north", "south", "east", "west")),
                    prop("item", stringSchema()),
                    prop("placement_label", stringSchema())
                ), "target_ref", "face", "item"),
                List.of("action", "build", "survival"),
                List.of("unknown_or_unobserved_target", "expired_ref", "target_too_far", "target_not_visible", "missing_material", "blocked", "unsupported_capability", "invalid_arguments"),
                List.of()
            ),
            tool(
                "chat.say_local",
                "Say a bounded local message as the active server_agent.",
                "Sends a bounded local chat/social event with normal rate limits.",
                objectSchema(properties(prop("message", stringSchema())), "message"),
                List.of("chat", "social"),
                List.of("invalid_arguments", "backpressure_queue_full"),
                List.of()
            ),
            tool(
                "notice.post",
                "Post a message to a visible notice board.",
                "Writes a bounded notice to a reachable visible board ref. It is not a global broadcast or timeline.",
                objectSchema(properties(
                    prop("board_ref", stringSchema()),
                    prop("message", stringSchema())
                ), "board_ref", "message"),
                List.of("notice", "social", "write"),
                List.of("unknown_or_unobserved_target", "expired_ref", "target_too_far", "target_not_visible", "unsupported_capability", "invalid_arguments", "backpressure_queue_full"),
                List.of("board_ref comes from a recent observe.scene result", "target is visible and reachable")
            ),
            tool(
                "notice.observe",
                "Read entries from a visible notice board.",
                "Returns bounded notices from one reachable visible board ref. It does not expose board coordinates or other boards.",
                objectSchema(properties(
                    prop("board_ref", stringSchema()),
                    prop("after_notice_id", stringSchema()),
                    prop("limit", numberSchema(1, 50, 20))
                ), "board_ref"),
                List.of("notice", "social", "observe"),
                List.of("unknown_or_unobserved_target", "expired_ref", "target_too_far", "target_not_visible", "unsupported_capability", "invalid_cursor"),
                List.of("board_ref comes from a recent observe.scene result", "target is visible and reachable")
            ),
            tool(
                "container.open",
                "Open a reachable smoke fixture container.",
                "Opens a visible, reachable server-side container through native use-item-on, then exposes a bounded headless server_agent slot snapshot.",
                objectSchema(properties(prop("block_ref", stringSchema())), "block_ref"),
                List.of("container"),
                List.of("unknown_or_unobserved_target", "expired_ref", "target_too_far", "target_not_visible", "unsupported_capability"),
                List.of("block_ref comes from a recent observe.scene result", "target is visible and reachable")
            ),
            tool(
                "container.observe",
                "Observe the currently open smoke fixture container.",
                "Returns server slot refs for the currently opened container.",
                objectSchema(),
                List.of("container", "observe"),
                List.of("container_not_open"),
                List.of()
            ),
            tool(
                "container.move_stack",
                "Move a stack between smoke fixture container and agent inventory.",
                "Moves item stacks through server Slot take/insert hooks and stack-capacity rules.",
                objectSchema(properties(
                    prop("from_slot_ref", stringSchema()),
                    prop("to_slot_ref", stringSchema()),
                    prop("count", numberSchema(1, null, null))
                ), "from_slot_ref", "to_slot_ref"),
                List.of("container"),
                List.of("container_not_open", "stale_slot_ref", "missing_material", "inventory_full", "invalid_arguments", "blocked"),
                List.of()
            ),
            tool(
                "container.click_slot",
                "Click a slot in the open server menu.",
                "Runs a bounded pickup click through the native server menu click path for inventory and container slots. Output slots must use container.take_output.",
                objectSchema(properties(
                    prop("slot_ref", stringSchema()),
                    prop("button", enumSchema("primary", "secondary", "left", "right"))
                ), "slot_ref"),
                List.of("container", "manual"),
                List.of("container_not_open", "stale_slot_ref", "invalid_arguments", "unsupported_capability", "blocked"),
                List.of("slot_ref comes from the current container snapshot")
            ),
            tool(
                "container.take_output",
                "Take crafting output into agent inventory.",
                "Takes output through server output-slot hooks when the opened container exposes them.",
                objectSchema(properties(prop("slot_ref", stringSchema()))),
                List.of("container", "craft"),
                List.of("container_not_open", "stale_slot_ref", "missing_material", "inventory_full", "invalid_arguments", "blocked"),
                List.of()
            ),
            tool(
                "craft.list_available",
                "List smoke fixture recipes available through the server recipe registry.",
                "Returns recipe summaries, not every recipe in the registry.",
                objectSchema(properties(
                    prop("query", stringSchema()),
                    prop("limit", numberSchema(1, 50, 20))
                )),
                List.of("craft", "recipe"),
                List.of("station_too_far"),
                List.of()
            ),
            tool(
                "craft.quick_craft",
                "Craft through the server recipe registry for the smoke fixture.",
                "Crafts only when ingredients and station rules are satisfied.",
                objectSchema(properties(
                    prop("recipe_id", stringSchema()),
                    prop("count", numberSchema(1, null, null))
                ), "recipe_id", "count"),
                List.of("craft", "recipe"),
                List.of("station_too_far", "missing_material", "invalid_recipe", "inventory_full", "blocked", "unsupported_capability"),
                List.of()
            ),
            tool(
                "create.inspect_component",
                "Inspect a visible Create component.",
                "Returns bounded Create adapter semantics for a visible component, including coarse kinetic, blockage, and unsupported client-only capability hints.",
                objectSchema(properties(prop("block_ref", stringSchema())), "block_ref"),
                List.of("create", "observe"),
                List.of("unknown_or_unobserved_target", "expired_ref", "unsupported_capability", "target_not_visible", "target_too_far"),
                List.of("block_ref comes from a recent observe.scene result")
            )
        );
    }

    private static ToolDefinition tool(String name, String summary, String description, JsonObject inputSchema, List<String> tags, List<String> failureReasons, List<String> preconditions) {
        return new ToolDefinition(name, summary, description, inputSchema, tags, failureReasons, preconditions);
    }

    private static JsonObject objectSchema() {
        return objectSchema(new JsonObject());
    }

    private static JsonObject objectSchema(JsonObject properties, String... required) {
        JsonObject schema = new JsonObject();
        schema.addProperty("type", "object");
        schema.add("properties", properties);
        if (required.length > 0) {
            schema.add("required", stringArray(required));
        }
        return schema;
    }

    private static JsonObject properties(PropertyDefinition... definitions) {
        JsonObject properties = new JsonObject();
        for (PropertyDefinition definition : definitions) {
            properties.add(definition.name, definition.schema);
        }
        return properties;
    }

    private static PropertyDefinition prop(String name, JsonObject schema) {
        return new PropertyDefinition(name, schema);
    }

    private static JsonObject stringSchema() {
        JsonObject schema = new JsonObject();
        schema.addProperty("type", "string");
        return schema;
    }

    private static JsonObject stringSchema(String defaultValue) {
        JsonObject schema = stringSchema();
        schema.addProperty("default", defaultValue);
        return schema;
    }

    private static JsonObject numberSchema(Integer minimum, Integer maximum, Integer defaultValue) {
        JsonObject schema = new JsonObject();
        schema.addProperty("type", "number");
        if (minimum != null) {
            schema.addProperty("minimum", minimum);
        }
        if (maximum != null) {
            schema.addProperty("maximum", maximum);
        }
        if (defaultValue != null) {
            schema.addProperty("default", defaultValue);
        }
        return schema;
    }

    private static JsonObject arraySchema(String itemType) {
        JsonObject schema = new JsonObject();
        JsonObject items = new JsonObject();
        items.addProperty("type", itemType);
        schema.addProperty("type", "array");
        schema.add("items", items);
        return schema;
    }

    private static JsonObject enumSchema(String... values) {
        JsonObject schema = stringSchema();
        schema.add("enum", stringArray(values));
        return schema;
    }

    private static JsonObject objectValue(JsonObject object, String name) {
        JsonElement element = object.get(name);
        return element != null && element.isJsonObject() ? element.getAsJsonObject() : new JsonObject();
    }

    private static JsonArray arrayValue(JsonObject object, String name) {
        JsonElement element = object.get(name);
        return element != null && element.isJsonArray() ? element.getAsJsonArray() : new JsonArray();
    }

    private static String stringValue(JsonObject object, String name, String defaultValue) {
        JsonElement element = object == null ? null : object.get(name);
        return element == null || element.isJsonNull() ? defaultValue : element.getAsString();
    }

    private static int intValue(JsonObject object, String name, int defaultValue) {
        JsonElement element = object.get(name);
        return element == null || element.isJsonNull() ? defaultValue : element.getAsInt();
    }

    private static String sanitize(String value) {
        String sanitized = value.replaceAll("[^A-Za-z0-9_.-]", "_");
        return sanitized.isBlank() ? "owner" : sanitized;
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    private static String readBody(HttpExchange exchange) throws IOException {
        try (InputStream input = exchange.getRequestBody()) {
            return new String(input.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    private static void write(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream output = exchange.getResponseBody()) {
            output.write(bytes);
        }
    }

    private static void writeJson(HttpExchange exchange, int status, JsonObject body) throws IOException {
        byte[] bytes = GSON.toJson(body).getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("content-type", "application/json; charset=utf-8");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream output = exchange.getResponseBody()) {
            output.write(bytes);
        }
    }

    private static JsonObject vector(Vec3 vec) {
        JsonObject object = new JsonObject();
        object.addProperty("x", vec.x);
        object.addProperty("y", vec.y);
        object.addProperty("z", vec.z);
        return object;
    }

    private static JsonObject blockPosition(BlockPos pos) {
        JsonObject object = new JsonObject();
        object.addProperty("x", pos.getX());
        object.addProperty("y", pos.getY());
        object.addProperty("z", pos.getZ());
        return object;
    }

    private static JsonArray stringArray(String... values) {
        JsonArray array = new JsonArray();
        for (String value : values) {
            array.add(value);
        }
        return array;
    }

    private static String blockId(BlockState state) {
        return BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString();
    }

    private static JsonArray tags(BlockState state) {
        JsonArray tags = new JsonArray();
        state.getTags().map(TagKey::location).map(Object::toString).forEach(tags::add);
        String id = blockId(state);
        if (isCreateComponent(id)) {
            tags.add("create:component");
            tags.add("create:" + createKind(id));
        }
        return tags;
    }

    private static boolean createAdapterAvailable() {
        return blockById("create:depot").isPresent() && itemById("create:wrench") != Items.AIR;
    }

    private static boolean isCreateComponent(String id) {
        return switch (id) {
            case "create:shaft", "create:cogwheel", "create:large_cogwheel", "create:depot", "create:belt", "create:mechanical_press" -> true;
            default -> false;
        };
    }

    private static String createKind(String id) {
        return id.startsWith("create:") ? id.substring("create:".length()) : id;
    }

    private static Optional<Block> blockById(String blockId) {
        try {
            return BuiltInRegistries.BLOCK.getOptional(ResourceLocation.parse(blockId));
        } catch (RuntimeException error) {
            return Optional.empty();
        }
    }

    private static BlockPos portalChestPos(BlockPos anchor) {
        return anchor.west(2).above();
    }

    private static BlockPos portalNoticeBoardPos(BlockPos anchor) {
        return anchor.north(2).above();
    }

    private static BlockPos[] portalFramePositions(BlockPos anchor) {
        return new BlockPos[] {
            anchor.offset(0, 1, 0),
            anchor.offset(0, 2, 0),
            anchor.offset(0, 3, 0),
            anchor.offset(0, 4, 0),
            anchor.offset(0, 5, 0),
            anchor.offset(1, 1, 0),
            anchor.offset(2, 1, 0),
            anchor.offset(3, 1, 0),
            anchor.offset(3, 2, 0),
            anchor.offset(3, 3, 0),
            anchor.offset(3, 4, 0),
            anchor.offset(3, 5, 0),
            anchor.offset(1, 5, 0),
            anchor.offset(2, 5, 0)
        };
    }

    private static BlockPos[] portalInteriorPositions(BlockPos anchor) {
        return new BlockPos[] {
            anchor.offset(1, 2, 0),
            anchor.offset(2, 2, 0),
            anchor.offset(1, 3, 0),
            anchor.offset(2, 3, 0),
            anchor.offset(1, 4, 0),
            anchor.offset(2, 4, 0)
        };
    }

    private static final class RuntimeState {
        private final Map<String, AgentBody> agents = new LinkedHashMap<>();
        private final List<SocialEvent> socialEvents = new ArrayList<>();
        private final List<NoticeEntry> noticeEntries = new ArrayList<>();
        private final Map<BlockPos, String> noticeBoardIds = new LinkedHashMap<>();
        private String ownerId = "";
        private int agentSeq = 0;
        private int eventSeq = 0;
        private int noticeSeq = 0;
        private int noticeBoardSeq = 0;
        private BlockPos portalBase;

        private AgentBody birth(ServerLevel level, String ownerId, String seedPrompt) {
            agentSeq++;
            String agentId = "agent_" + agentSeq;
            String displayName = "MineLink-" + agentSeq;
            String fixtureName = setting("MINELINK_FIXTURE", "minelink.fixture", "vanilla_tree");
            BlockPos base;
            Vec3 spawn;
            if (fixtureName.equals("portal_coop")) {
                if (portalBase == null) {
                    portalBase = level.getSharedSpawnPos().offset(4, 2, 4).immutable();
                    seedPortalFixture(level, portalBase);
                }
                base = portalBase;
                spawn = new Vec3(base.getX() + 1.5D, base.getY() + 3.0D, base.getZ() - 2.0D);
            } else if (fixtureName.equals("guard_boundaries")) {
                base = level.getSharedSpawnPos().offset(2 + agentSeq, 2, 2).immutable();
                seedGuardFixture(level, base);
                spawn = new Vec3(base.getX() + 0.5D, base.getY(), base.getZ() + 0.5D);
            } else if (fixtureName.equals("perception_shapes")) {
                base = level.getSharedSpawnPos().offset(2 + agentSeq, 2, 2).immutable();
                seedPerceptionFixture(level, base);
                spawn = new Vec3(base.getX() + 0.5D, base.getY(), base.getZ() + 0.5D);
            } else if (fixtureName.equals("create_smoke")) {
                base = level.getSharedSpawnPos().offset(2 + agentSeq, 2, 2).immutable();
                seedCreateFixture(level, base);
                spawn = new Vec3(base.getX() + 0.5D, base.getY(), base.getZ() + 0.5D);
            } else if (fixtureName.equals("furnace_smoke")) {
                base = level.getSharedSpawnPos().offset(2 + agentSeq, 2, 2).immutable();
                seedFurnaceFixture(level, base);
                spawn = new Vec3(base.getX() + 0.5D, base.getY(), base.getZ() + 0.5D);
            } else {
                base = level.getSharedSpawnPos().offset(2 + agentSeq, 2, 2).immutable();
                seedFixture(level, base);
                spawn = new Vec3(base.getX() + 0.5D, base.getY(), base.getZ() + 0.5D);
            }

            GameProfile profile = new GameProfile(
                UUID.nameUUIDFromBytes((ownerId + ":" + agentId).getBytes(StandardCharsets.UTF_8)),
                displayName
            );
            FakePlayer entity = FakePlayerFactory.get(level, profile);
            entity.getInventory().clearContent();
            entity.moveTo(spawn.x, spawn.y, spawn.z, 0.0F, 0.0F);
            entity.setNoGravity(true);
            entity.setInvulnerable(true);
            entity.gameMode.changeGameModeForPlayer(GameType.SURVIVAL);

            AgentBody body = new AgentBody(agentId, displayName, ownerId, seedPrompt, entity, base.immutable(), fixtureName);
            agents.put(agentId, body);
            return body;
        }

        private AgentBody agent(String agentId) {
            return agents.get(agentId);
        }

        private AgentBody removeAgent(String agentId) {
            return agents.remove(agentId);
        }

        private int agentCountForOwner(String ownerId) {
            int count = 0;
            for (AgentBody agent : agents.values()) {
                if (agent.ownerId.equals(ownerId)) {
                    count++;
                }
            }
            return count;
        }

        private SocialEvent addLocalChat(AgentBody agent, String message) {
            SocialEvent event = new SocialEvent(
                "event:" + (++eventSeq),
                "chat.local",
                agent.agentId,
                agent.displayName,
                message,
                agent.position(),
                LOCAL_CHAT_RADIUS,
                Instant.now()
            );
            socialEvents.add(event);
            if (socialEvents.size() > MAX_SOCIAL_EVENTS) {
                socialEvents.remove(0);
            }
            return event;
        }

        private JsonArray visibleEvents(AgentBody observer, String afterEventId, int limit) {
            JsonArray events = new JsonArray();
            boolean afterSeen = afterEventId.isBlank();
            for (SocialEvent event : socialEvents) {
                if (!afterSeen) {
                    afterSeen = event.eventId.equals(afterEventId);
                    continue;
                }
                if (!event.visibleTo(observer)) {
                    continue;
                }
                events.add(event.payloadFor(observer));
                if (events.size() > limit) {
                    events.remove(0);
                }
            }
            return events;
        }

        private boolean visibleEventCursor(AgentBody observer, String eventId) {
            for (SocialEvent event : socialEvents) {
                if (event.eventId.equals(eventId) && event.visibleTo(observer)) {
                    return true;
                }
            }
            return false;
        }

        private int visibleRecipientCount(SocialEvent event) {
            int count = 0;
            for (AgentBody agent : agents.values()) {
                if (event.visibleTo(agent)) {
                    count++;
                }
            }
            return count;
        }

        private String noticeBoardId(BlockPos pos) {
            BlockPos key = pos.immutable();
            String existing = noticeBoardIds.get(key);
            if (existing != null) {
                return existing;
            }
            String next = "board:" + (++noticeBoardSeq);
            noticeBoardIds.put(key, next);
            return next;
        }

        private NoticeEntry addNotice(AgentBody agent, String boardId, String message) {
            NoticeEntry entry = new NoticeEntry(
                "notice:" + (++noticeSeq),
                boardId,
                agent.agentId,
                agent.displayName,
                message,
                Instant.now()
            );
            noticeEntries.add(entry);
            if (noticeEntries.size() > MAX_NOTICE_ENTRIES) {
                noticeEntries.remove(0);
            }
            return entry;
        }

        private JsonArray visibleNotices(AgentBody observer, String boardId, String afterNoticeId, int limit) {
            JsonArray entries = new JsonArray();
            boolean afterSeen = afterNoticeId.isBlank();
            for (NoticeEntry entry : noticeEntries) {
                if (!entry.boardId.equals(boardId)) {
                    continue;
                }
                if (!afterSeen) {
                    afterSeen = entry.noticeId.equals(afterNoticeId);
                    continue;
                }
                entries.add(entry.payloadFor(observer));
                if (entries.size() > limit) {
                    entries.remove(0);
                }
            }
            return entries;
        }

        private boolean visibleNoticeCursor(String boardId, String noticeId) {
            for (NoticeEntry entry : noticeEntries) {
                if (entry.boardId.equals(boardId) && entry.noticeId.equals(noticeId)) {
                    return true;
                }
            }
            return false;
        }

        private static void seedFixture(ServerLevel level, BlockPos base) {
            for (BlockPos pos : BlockPos.betweenClosed(base.offset(-1, -1, -1), base.offset(5, 4, 4))) {
                if (pos.getY() >= base.getY()) {
                    level.setBlockAndUpdate(pos.immutable(), Blocks.AIR.defaultBlockState());
                }
            }
            level.setBlockAndUpdate(base.below(), Blocks.GRASS_BLOCK.defaultBlockState());
            level.setBlockAndUpdate(base.east(3), Blocks.OAK_LOG.defaultBlockState());
            level.setBlockAndUpdate(base.east(3).above(), Blocks.OAK_LEAVES.defaultBlockState());
            BlockPos chestPos = base.south(3);
            level.setBlockAndUpdate(chestPos, Blocks.CHEST.defaultBlockState());
            if (level.getBlockEntity(chestPos) instanceof Container container) {
                container.setItem(0, new ItemStack(Items.OAK_LOG, 2));
                container.setItem(1, new ItemStack(Items.COBBLESTONE, 35));
                container.setItem(2, new ItemStack(Items.DIRT, 1));
                container.setItem(3, new ItemStack(Items.STONE, 1));
                container.setItem(4, new ItemStack(Items.SAND, 1));
                container.setItem(5, new ItemStack(Items.GRAVEL, 1));
                container.setItem(6, new ItemStack(Items.WHEAT, 1));
                container.setItem(7, new ItemStack(Items.STICK, 1));
                container.setChanged();
            }
            level.setBlockAndUpdate(base.south(4), Blocks.CRAFTING_TABLE.defaultBlockState());
            level.setBlockAndUpdate(base.east(2).south(3), Blocks.COPPER_BLOCK.defaultBlockState());
        }

        private static void seedCreateFixture(ServerLevel level, BlockPos base) {
            for (BlockPos pos : BlockPos.betweenClosed(base.offset(-1, -1, -1), base.offset(7, 4, 3))) {
                if (pos.getY() >= base.getY()) {
                    level.setBlockAndUpdate(pos.immutable(), Blocks.AIR.defaultBlockState());
                }
            }
            level.setBlockAndUpdate(base.below(), Blocks.GRASS_BLOCK.defaultBlockState());
            level.setBlockAndUpdate(base.east(3), Blocks.STONE.defaultBlockState());
            setOptionalBlock(level, base.east(4).south(), "create:cogwheel");
            setOptionalBeltChain(level, base.east(5).south());
            BlockPos processingDepot = base.east(3).south(2);
            BlockPos processingPress = processingDepot.above(2);
            BlockPos processingMotor = processingPress.west();
            setOptionalBlock(level, processingDepot, "create:depot");
            setOptionalBlock(level, processingPress, "create:mechanical_press", Map.of("facing", "east"));
            setOptionalBlock(level, processingMotor, "create:creative_motor", Map.of("facing", "east"));
            initializeOptionalCreateKinetics(level, processingMotor, processingPress);
            BlockPos chestPos = base.south(3);
            level.setBlockAndUpdate(chestPos, Blocks.CHEST.defaultBlockState());
            if (level.getBlockEntity(chestPos) instanceof Container container) {
                setOptionalItem(container, 0, "create:shaft", 1);
                setOptionalItem(container, 1, "create:wrench", 1);
                setOptionalItem(container, 2, "create:cogwheel", 1);
                setOptionalItem(container, 3, "create:depot", 1);
                setOptionalItem(container, 4, "create:mechanical_press", 1);
                setOptionalItem(container, 5, "minecraft:iron_ingot", 1);
                container.setChanged();
            }
        }

        private static void seedFurnaceFixture(ServerLevel level, BlockPos base) {
            for (BlockPos pos : BlockPos.betweenClosed(base.offset(-1, -1, -1), base.offset(5, 4, 5))) {
                if (pos.getY() >= base.getY()) {
                    level.setBlockAndUpdate(pos.immutable(), Blocks.AIR.defaultBlockState());
                }
            }
            for (BlockPos pos : BlockPos.betweenClosed(base.offset(-1, -1, -1), base.offset(5, -1, 5))) {
                level.setBlockAndUpdate(pos.immutable(), Blocks.GRASS_BLOCK.defaultBlockState());
            }
            BlockPos chestPos = base.south(3);
            level.setBlockAndUpdate(chestPos, Blocks.CHEST.defaultBlockState());
            if (level.getBlockEntity(chestPos) instanceof Container container) {
                container.setItem(0, new ItemStack(Items.RAW_IRON, 1));
                container.setItem(1, new ItemStack(Items.COAL, 1));
                container.setItem(2, new ItemStack(Items.DIRT, 1));
                container.setChanged();
            }
            level.setBlockAndUpdate(base.south(4), Blocks.FURNACE.defaultBlockState());
        }

        private static void setOptionalBlock(ServerLevel level, BlockPos pos, String blockId) {
            blockById(blockId).ifPresent(block -> level.setBlockAndUpdate(pos, block.defaultBlockState()));
        }

        private static void setOptionalBlock(ServerLevel level, BlockPos pos, String blockId, Map<String, String> properties) {
            blockById(blockId).ifPresent(block -> {
                BlockState state = block.defaultBlockState();
                for (Map.Entry<String, String> property : properties.entrySet()) {
                    state = withStateProperty(state, property.getKey(), property.getValue());
                }
                level.setBlockAndUpdate(pos, state);
            });
        }

        private static void initializeOptionalCreateKinetics(ServerLevel level, BlockPos... positions) {
            for (BlockPos pos : positions) {
                BlockEntity blockEntity = level.getBlockEntity(pos);
                reflectedValue(blockEntity, "initialize");
            }
            for (BlockPos pos : positions) {
                BlockEntity blockEntity = level.getBlockEntity(pos);
                reflectedValue(blockEntity, "attachKinetics");
                reflectedValue(blockEntity, "updateGeneratedRotation");
            }
        }

        private static void setOptionalBeltChain(ServerLevel level, BlockPos start) {
            blockById("create:belt").ifPresent(block -> {
                BlockState startState = withStateProperty(block.defaultBlockState(), "facing", "east");
                startState = withStateProperty(startState, "slope", "horizontal");
                startState = withStateProperty(startState, "part", "start");

                BlockState endState = withStateProperty(block.defaultBlockState(), "facing", "east");
                endState = withStateProperty(endState, "slope", "horizontal");
                endState = withStateProperty(endState, "part", "end");

                level.setBlockAndUpdate(start, startState);
                level.setBlockAndUpdate(start.east(), endState);
                reflectedStaticValue(
                    "com.simibubi.create.content.kinetics.belt.BeltBlock",
                    "initBelt",
                    new Class<?>[] { Level.class, BlockPos.class },
                    level,
                    start
                );
            });
        }

        @SuppressWarnings({ "unchecked", "rawtypes" })
        private static BlockState withStateProperty(BlockState state, String name, String valueName) {
            for (Property<?> property : state.getProperties()) {
                if (!property.getName().equals(name)) {
                    continue;
                }
                Optional<?> value = property.getValue(valueName);
                if (value.isPresent()) {
                    return state.setValue((Property) property, (Comparable) value.get());
                }
                return state;
            }
            return state;
        }

        private static void setOptionalItem(Container container, int slot, String itemId, int count) {
            Item item = itemById(itemId);
            if (item == Items.AIR) {
                return;
            }
            container.setItem(slot, new ItemStack(item, count));
        }

        private static void seedGuardFixture(ServerLevel level, BlockPos base) {
            level.setDayTime(1_000L);
            for (BlockPos pos : BlockPos.betweenClosed(base.offset(-1, -1, -2), base.offset(10, 4, 4))) {
                if (pos.getY() >= base.getY()) {
                    level.setBlockAndUpdate(pos.immutable(), Blocks.AIR.defaultBlockState());
                }
            }
            level.setBlockAndUpdate(base.below(), Blocks.GRASS_BLOCK.defaultBlockState());
            level.setBlockAndUpdate(base.east(2), Blocks.OAK_LOG.defaultBlockState());
            level.setBlockAndUpdate(base.east(8), Blocks.OAK_LOG.defaultBlockState());
            level.setBlockAndUpdate(base.east(3), Blocks.STONE.defaultBlockState());
            level.setBlockAndUpdate(base.east(4), Blocks.DIAMOND_ORE.defaultBlockState());

            BlockPos bedFoot = base.south(2);
            level.setBlockAndUpdate(
                bedFoot,
                Blocks.WHITE_BED.defaultBlockState()
                    .setValue(BedBlock.FACING, Direction.NORTH)
                    .setValue(BedBlock.PART, BedPart.FOOT)
            );
            level.setBlockAndUpdate(
                bedFoot.north(),
                Blocks.WHITE_BED.defaultBlockState()
                    .setValue(BedBlock.FACING, Direction.NORTH)
                    .setValue(BedBlock.PART, BedPart.HEAD)
            );
        }

        private static void seedPerceptionFixture(ServerLevel level, BlockPos base) {
            for (BlockPos pos : BlockPos.betweenClosed(base.offset(-1, -1, -1), base.offset(5, 4, 5))) {
                if (pos.getY() >= base.getY()) {
                    level.setBlockAndUpdate(pos.immutable(), Blocks.AIR.defaultBlockState());
                }
            }
            for (BlockPos pos : BlockPos.betweenClosed(base.offset(-1, -1, -1), base.offset(5, -1, 5))) {
                level.setBlockAndUpdate(pos.immutable(), Blocks.GRASS_BLOCK.defaultBlockState());
            }
            level.setBlockAndUpdate(base.east(2), Blocks.GLASS.defaultBlockState());
            level.setBlockAndUpdate(base.east(2).above(), Blocks.OAK_LEAVES.defaultBlockState());
            level.setBlockAndUpdate(base.south(2), Blocks.TORCH.defaultBlockState());
            level.setBlockAndUpdate(base.south(3), Blocks.WATER.defaultBlockState());
            level.setBlockAndUpdate(base.south(4), Blocks.OAK_FENCE.defaultBlockState());
            level.setBlockAndUpdate(base.east(3), Blocks.STONE.defaultBlockState());
            level.setBlockAndUpdate(base.east(4), Blocks.DIAMOND_ORE.defaultBlockState());
        }

        private static void seedPortalFixture(ServerLevel level, BlockPos anchor) {
            for (BlockPos pos : BlockPos.betweenClosed(anchor.offset(-4, 0, -4), anchor.offset(6, 7, 4))) {
                if (pos.getY() >= anchor.getY()) {
                    level.setBlockAndUpdate(pos.immutable(), Blocks.AIR.defaultBlockState());
                }
            }
            level.setBlockAndUpdate(anchor.below(), Blocks.GRASS_BLOCK.defaultBlockState());
            level.setBlockAndUpdate(anchor, Blocks.NETHERRACK.defaultBlockState());
            level.setBlockAndUpdate(portalNoticeBoardPos(anchor), Blocks.LECTERN.defaultBlockState());
            BlockPos chestPos = portalChestPos(anchor);
            level.setBlockAndUpdate(chestPos, Blocks.CHEST.defaultBlockState());
            if (level.getBlockEntity(chestPos) instanceof Container container) {
                container.setItem(0, new ItemStack(Items.OBSIDIAN, 5));
                container.setItem(1, new ItemStack(Items.OBSIDIAN, 5));
                container.setItem(2, new ItemStack(Items.OBSIDIAN, 4));
                container.setItem(3, new ItemStack(Items.FLINT_AND_STEEL, 1));
                container.setChanged();
            }
        }
    }

    private static final class AgentBody {
        private static final long DEFAULT_REF_TTL_MS = 30_000;

        private final String agentId;
        private final String displayName;
        private final String ownerId;
        private final String seedPrompt;
        private final FakePlayer entity;
        private final BlockPos fixtureBase;
        private final String fixtureName;
        private final Map<String, Integer> inventory = new LinkedHashMap<>();
        private final Map<String, BlockRef> refs = new LinkedHashMap<>();
        private final Map<String, ActionLifecycle> actions = new LinkedHashMap<>();
        private final List<Long> chatTimestamps = new ArrayList<>();
        private OpenContainer openContainer;
        private int refSeq = 0;
        private int slotSeq = 0;
        private int containerSeq = 0;
        private int actionSeq = 0;
        private int queueDepth = 0;
        private boolean frozen = false;

        private AgentBody(String agentId, String displayName, String ownerId, String seedPrompt, FakePlayer entity, BlockPos fixtureBase, String fixtureName) {
            this.agentId = agentId;
            this.displayName = displayName;
            this.ownerId = ownerId;
            this.seedPrompt = seedPrompt;
            this.entity = entity;
            this.fixtureBase = fixtureBase;
            this.fixtureName = fixtureName;
        }

        private Vec3 position() {
            return entity.position();
        }

        private BlockPos blockPosition() {
            return entity.blockPosition();
        }

        private String bodyId() {
            return "body:" + agentId;
        }

        private boolean frozen() {
            return frozen;
        }

        private int freeze(String reason) {
            frozen = true;
            return cancelActiveActions("body_frozen", reason);
        }

        private boolean restore() {
            boolean wasFrozen = frozen;
            frozen = false;
            return wasFrozen;
        }

        private int prepareRemove(String reason) {
            int cancelled = cancelActiveActions("body_removed", reason);
            if (openContainer != null) {
                entity.closeContainer();
                openContainer = null;
            }
            entity.discard();
            frozen = false;
            return cancelled;
        }

        private String addRef(BlockPos pos, String blockId) {
            String ref = "block:" + agentId + ":" + (++refSeq);
            refs.put(ref, new BlockRef(pos, blockId, Instant.now().plusMillis(refTtlMs()).toEpochMilli()));
            return ref;
        }

        private long refTtlMs() {
            String value = setting("MINELINK_REF_TTL_MS", "minelink.ref.ttl.ms", String.valueOf(DEFAULT_REF_TTL_MS));
            try {
                return Math.max(1L, Math.min(Long.parseLong(value), DEFAULT_REF_TTL_MS));
            } catch (NumberFormatException error) {
                return DEFAULT_REF_TTL_MS;
            }
        }

        private BlockRef ref(String ref) {
            return refs.get(ref);
        }

        private void addInventory(String itemId, int count) {
            inventory.merge(itemId, count, Integer::sum);
        }

        private boolean acceptChatNow() {
            long now = System.currentTimeMillis();
            chatTimestamps.removeIf(timestamp -> now - timestamp > 10_000L);
            if (chatTimestamps.size() >= 4) {
                return false;
            }
            chatTimestamps.add(now);
            return true;
        }

        private ActionLifecycle submitQueuedAction(String toolName, JsonObject arguments) {
            refreshActions();
            if (queueDepth >= MAX_ACTION_QUEUE_DEPTH) {
                return null;
            }
            queueDepth++;
            long now = System.currentTimeMillis();
            ActionLifecycle action = new ActionLifecycle(
                nextActionId(),
                toolName,
                "queued",
                arguments,
                now,
                now,
                now + SUBMITTED_ACTION_TTL_MS
            );
            actions.put(action.actionId, action);
            return action;
        }

        private void startQueuedAction(String actionId) {
            refreshActions();
            ActionLifecycle action = actions.get(actionId);
            if (action == null || !action.lifecycleStatus.equals("queued")) {
                return;
            }
            action.lifecycleStatus = "running";
            action.updatedAt = System.currentTimeMillis();
        }

        private void completeQueuedAction(String actionId, JsonObject result) {
            ActionLifecycle action = actions.get(actionId);
            if (action == null || !action.active()) {
                return;
            }
            action.lifecycleStatus = "completed";
            action.result = result == null ? null : result.deepCopy();
            action.updatedAt = System.currentTimeMillis();
            releaseActionQueue(action);
        }

        private void failQueuedAction(String actionId, String reason, String message) {
            ActionLifecycle action = actions.get(actionId);
            if (action == null || !action.active()) {
                return;
            }
            action.lifecycleStatus = "failed";
            action.failureReason = reason;
            action.failureMessage = message;
            action.updatedAt = System.currentTimeMillis();
            releaseActionQueue(action);
        }

        private boolean cancelAction(String actionId) {
            ActionLifecycle action = actions.get(actionId);
            if (action == null || !action.active()) {
                return false;
            }
            action.lifecycleStatus = "cancelled";
            action.updatedAt = System.currentTimeMillis();
            releaseActionQueue(action);
            return true;
        }

        private ActionLifecycle action(String actionId) {
            return actions.get(actionId);
        }

        private void refreshActions() {
            long now = System.currentTimeMillis();
            for (ActionLifecycle action : actions.values()) {
                if (action.active() && now >= action.expiresAt) {
                    action.lifecycleStatus = "expired";
                    action.updatedAt = now;
                    releaseActionQueue(action);
                }
            }
        }

        private void releaseActionQueue(ActionLifecycle action) {
            if (action.queueReleased) {
                return;
            }
            action.queueReleased = true;
            queueDepth = Math.max(0, queueDepth - 1);
        }

        private int cancelActiveActions(String reason, String message) {
            int cancelled = 0;
            for (ActionLifecycle action : actions.values()) {
                if (!action.active()) {
                    continue;
                }
                action.lifecycleStatus = "cancelled";
                action.failureReason = reason;
                action.failureMessage = message;
                action.updatedAt = System.currentTimeMillis();
                releaseActionQueue(action);
                cancelled++;
            }
            return cancelled;
        }

        private int queueDepth() {
            return queueDepth;
        }

        private String nextActionId() {
            return "act_" + agentId + "_" + (++actionSeq);
        }

        private BlockPos[] smokeFixturePositions() {
            if (fixtureName.equals("portal_coop")) {
                List<BlockPos> positions = new ArrayList<>();
                positions.add(fixtureBase);
                positions.add(portalChestPos(fixtureBase));
                positions.add(portalNoticeBoardPos(fixtureBase));
                for (BlockPos pos : portalFramePositions(fixtureBase)) {
                    positions.add(pos);
                }
                for (BlockPos pos : portalInteriorPositions(fixtureBase)) {
                    positions.add(pos);
                }
                return positions.toArray(new BlockPos[0]);
            }
            if (fixtureName.equals("guard_boundaries")) {
                return new BlockPos[] {
                    fixtureBase.east(2),
                    fixtureBase.east(8),
                    fixtureBase.east(3),
                    fixtureBase.east(4),
                    fixtureBase.south(2),
                    fixtureBase.south(1)
                };
            }
            if (fixtureName.equals("perception_shapes")) {
                return new BlockPos[] {
                    fixtureBase.east(2),
                    fixtureBase.east(2).above(),
                    fixtureBase.south(2),
                    fixtureBase.south(3),
                    fixtureBase.south(4),
                    fixtureBase.east(3),
                    fixtureBase.east(4)
                };
            }
            if (fixtureName.equals("create_smoke")) {
                return new BlockPos[] {
                    fixtureBase.east(3),
                    fixtureBase.east(3).above(),
                    fixtureBase.east(4).south(),
                    fixtureBase.east(5).south(),
                    fixtureBase.east(3).south(2),
                    fixtureBase.east(3).south(2).above(2),
                    fixtureBase.east(2).south(2).above(2),
                    fixtureBase.south(3)
                };
            }
            if (fixtureName.equals("furnace_smoke")) {
                return new BlockPos[] {
                    fixtureBase.south(3),
                    fixtureBase.south(4)
                };
            }
            return new BlockPos[] {
                fixtureBase.east(3),
                fixtureBase.east(3).above(),
                fixtureBase.south(3),
                fixtureBase.south(4),
                fixtureBase.east(2).south(3)
            };
        }

        private List<String> extraTags(BlockPos pos, BlockState state) {
            List<String> extra = new ArrayList<>();
            String id = blockId(state);
            if (id.equals("minecraft:chest") || id.equals("minecraft:crafting_table") || id.equals("minecraft:furnace")) {
                extra.add("minelink:container");
            }
            if (state.is(BlockTags.BEDS)) {
                extra.add("minelink:bed");
            }
            if (fixtureName.equals("guard_boundaries")) {
                if (pos.equals(fixtureBase.east(8)) && id.equals("minecraft:oak_log")) {
                    extra.add("minelink:far_fixture");
                }
                if (pos.equals(fixtureBase.east(3)) && id.equals("minecraft:stone")) {
                    extra.add("minelink:opaque_fixture");
                }
                if (pos.equals(fixtureBase.east(4)) && id.equals("minecraft:diamond_ore")) {
                    extra.add("minelink:hidden_fixture");
                }
            }
            if (fixtureName.equals("perception_shapes")) {
                addPerceptionVisionTags(pos, state, id, extra);
            }
            if (fixtureName.equals("portal_coop") && pos.equals(fixtureBase) && id.equals("minecraft:netherrack")) {
                extra.add("minelink:portal_anchor");
            }
            if (fixtureName.equals("portal_coop") && pos.equals(portalNoticeBoardPos(fixtureBase)) && isNoticeBoard(state)) {
                extra.add(NOTICE_BOARD_TAG);
            }
            if (fixtureName.equals("create_smoke") && id.startsWith("create:")) {
                extra.add("minelink:create_fixture");
            }
            if (fixtureName.equals("create_smoke") && pos.equals(fixtureBase.east(3)) && id.equals("minecraft:stone")) {
                extra.add("minelink:create_build_anchor");
            }
            return extra;
        }

        private void addPerceptionVisionTags(BlockPos pos, BlockState state, String id, List<String> extra) {
            boolean hasFluid = !state.getFluidState().isEmpty();
            boolean hasEmptyCollision = state.getCollisionShape(entity.level(), pos).isEmpty();
            if (state.is(Blocks.GLASS) || state.is(BlockTags.LEAVES)) {
                addTag(extra, "minelink:vision_translucent");
            }
            if (hasFluid) {
                addTag(extra, "minelink:vision_fluid");
            }
            if (!hasFluid && !id.equals("minecraft:air") && hasEmptyCollision) {
                addTag(extra, "minelink:vision_decorative");
            }
            if (id.endsWith("_fence") || id.endsWith("_wall")) {
                addTag(extra, "minelink:vision_partial_occluder");
            }
            if (state.is(Blocks.STONE)) {
                addTag(extra, "minelink:vision_opaque");
            }
            if (pos.equals(fixtureBase.east(3)) && state.is(Blocks.STONE)) {
                addTag(extra, "minelink:opaque_fixture");
            }
            if (pos.equals(fixtureBase.east(4)) && id.equals("minecraft:diamond_ore")) {
                addTag(extra, "minelink:hidden_fixture");
            }
        }

        private static void addTag(List<String> tags, String tag) {
            if (!tags.contains(tag)) {
                tags.add(tag);
            }
        }

        private boolean canSee(BlockPos pos, BlockState state, BlockPos origin) {
            if (!fixtureName.equals("guard_boundaries") && !fixtureName.equals("perception_shapes")) {
                return true;
            }
            return !blockId(state).equals("minecraft:diamond_ore") || origin.getX() > fixtureBase.east(3).getX();
        }
    }

    private record SocialEvent(
        String eventId,
        String type,
        String sourceAgentId,
        String sourceDisplayName,
        String message,
        Vec3 position,
        double radius,
        Instant createdAt
    ) {
        private boolean visibleTo(AgentBody observer) {
            return sourceAgentId.equals(observer.agentId) || observer.position().distanceTo(position) <= radius;
        }

        private JsonObject payloadFor(AgentBody observer) {
            JsonObject payload = new JsonObject();
            payload.addProperty("event_id", eventId);
            payload.addProperty("type", type);
            payload.addProperty("source_agent_id", sourceAgentId);
            payload.addProperty("source_display_name", sourceDisplayName);
            payload.addProperty("message", message);
            boolean self = sourceAgentId.equals(observer.agentId);
            payload.addProperty("visibility", self ? "self" : "audible_local");
            payload.addProperty("distance_band", self ? "self" : "nearby");
            payload.addProperty("created_at", createdAt.toString());
            return payload;
        }
    }

    private record NoticeEntry(
        String noticeId,
        String boardId,
        String sourceAgentId,
        String sourceDisplayName,
        String message,
        Instant createdAt
    ) {
        private JsonObject payloadFor(AgentBody observer) {
            JsonObject payload = new JsonObject();
            payload.addProperty("notice_id", noticeId);
            payload.addProperty("type", "notice.board");
            payload.addProperty("board_id", boardId);
            payload.addProperty("source_agent_id", sourceAgentId);
            payload.addProperty("source_display_name", sourceDisplayName);
            payload.addProperty("message", message);
            boolean self = sourceAgentId.equals(observer.agentId);
            payload.addProperty("visibility", self ? "self_board" : "shared_board");
            payload.addProperty("distance_band", self ? "self" : "same_board");
            payload.addProperty("created_at", createdAt.toString());
            return payload;
        }
    }

    private record BlockRef(BlockPos pos, String blockId, long expiresAtMs) {
        private boolean expired() {
            return System.currentTimeMillis() > expiresAtMs;
        }
    }

    private static final class ActionLifecycle {
        private final String actionId;
        private final String toolName;
        private final long submittedAt;
        private final long expiresAt;
        private final JsonObject arguments;
        private String lifecycleStatus;
        private long updatedAt;
        private boolean queueReleased;
        private JsonObject result;
        private String failureReason;
        private String failureMessage;

        private ActionLifecycle(String actionId, String toolName, String lifecycleStatus, JsonObject arguments, long submittedAt, long updatedAt, long expiresAt) {
            this.actionId = actionId;
            this.toolName = toolName;
            this.lifecycleStatus = lifecycleStatus;
            this.arguments = arguments == null ? new JsonObject() : arguments.deepCopy();
            this.submittedAt = submittedAt;
            this.updatedAt = updatedAt;
            this.expiresAt = expiresAt;
            this.queueReleased = false;
        }

        private void recordAccepted() {
            this.updatedAt = System.currentTimeMillis();
        }

        private boolean active() {
            return lifecycleStatus.equals("queued") || lifecycleStatus.equals("running");
        }
    }

    private record InteractionTarget(BlockRef ref, JsonObject failure) {
    }

    private record NoticeBoardTarget(BlockRef ref, String blockRef, String boardId, JsonObject failure) {
    }

    private record PropertyDefinition(String name, JsonObject schema) {
    }

    private record ToolDefinition(
        String name,
        String summary,
        String description,
        JsonObject inputSchema,
        List<String> tags,
        List<String> failureReasons,
        List<String> preconditions
    ) {
        private String searchText() {
            return (name + " " + summary + " " + description).toLowerCase();
        }

        private JsonObject summaryJson() {
            JsonObject payload = new JsonObject();
            payload.addProperty("name", name);
            payload.addProperty("summary", summary);
            payload.add("tags", stringArray(tags.toArray(String[]::new)));
            return payload;
        }
    }

    private static final class OpenContainer {
        private final String containerId;
        private final String kind;
        private final String blockRef;
        private final BlockPos blockPos;
        private final Container container;
        private final boolean serverContainerAvailable;
        private final String nativeInteractionResult;
        private final boolean nativeMenuOpened;
        private final String nativeMenuType;
        private final String nativeMenuSource;
        private final AbstractContainerMenu nativeMenu;
        private final Map<String, SlotRef> slotRefs = new LinkedHashMap<>();
        private ItemStack output = ItemStack.EMPTY;

        private OpenContainer(
            String containerId,
            String kind,
            String blockRef,
            BlockPos blockPos,
            Container container,
            boolean serverContainerAvailable,
            String nativeInteractionResult,
            boolean nativeMenuOpened,
            String nativeMenuType,
            String nativeMenuSource,
            AbstractContainerMenu nativeMenu
        ) {
            this.containerId = containerId;
            this.kind = kind;
            this.blockRef = blockRef;
            this.blockPos = blockPos;
            this.container = container;
            this.serverContainerAvailable = serverContainerAvailable;
            this.nativeInteractionResult = nativeInteractionResult;
            this.nativeMenuOpened = nativeMenuOpened;
            this.nativeMenuType = nativeMenuType;
            this.nativeMenuSource = nativeMenuSource;
            this.nativeMenu = nativeMenu;
        }
    }

    private record SlotRef(String containerId, String area, int index) {
    }

    private record CraftPlan(Map<String, Integer> consumed, List<ItemStack> grid, int plannedCrafts, ItemStack plannedOutput) {
    }

    private record PlacedIngredient(int gridIndex, Ingredient ingredient) {
    }
}
