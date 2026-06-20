package net.minelink.neoforge.server;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
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
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.tags.TagKey;
import net.minecraft.world.Container;
import net.minecraft.world.entity.decoration.ArmorStand;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.crafting.CraftingInput;
import net.minecraft.world.item.crafting.CraftingRecipe;
import net.minecraft.world.item.crafting.RecipeHolder;
import net.minecraft.world.item.crafting.RecipeType;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.Vec3;
import net.minelink.neoforge.MineLinkMod;

public final class MineLinkEndpointBootstrap {
    private static final Gson GSON = new Gson();
    private static final String PROTOCOL_VERSION = "0.1";
    private static final int DEFAULT_PORT = 25575;
    private static final int REQUEST_TIMEOUT_SECONDS = 10;

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
        admission.addProperty("max_agents_per_owner", 3);
        response.add("admission", admission);

        JsonObject capabilities = new JsonObject();
        capabilities.addProperty("server_agent", true);
        capabilities.addProperty("birth", true);
        capabilities.addProperty("visible_surface_scan", true);
        capabilities.addProperty("inventory", true);
        capabilities.addProperty("container_basic", true);
        capabilities.addProperty("crafting_basic", true);
        capabilities.addProperty("create_adapter", false);
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
        String seedPrompt = stringValue(request, "seed_prompt", "A cautious but curious newcomer.");
        AgentBody agent = runtimeState.birth(server.overworld(), ownerId, seedPrompt);

        JsonObject response = baseResponse(request, "agent.birth_result");
        response.addProperty("agent_id", agent.agentId);
        response.addProperty("display_name", agent.displayName);
        response.addProperty("body_type", "server_agent.command_body");
        response.add("position", vector(agent.position()));
        response.add("initial_needs", stringArray("food", "shelter", "tools"));
        response.add("capabilities", stringArray(
            "observe.self",
            "observe.scene",
            "observe.inventory",
            "action.move",
            "action.look_at",
            "action.mine_visible_block",
            "container.open",
            "container.observe",
            "container.move_stack",
            "container.take_output",
            "craft.list_available",
            "craft.quick_craft"
        ));
        return response;
    }

    private JsonObject toolList(JsonObject request) {
        JsonObject response = baseResponse(request, "tool.list_result");
        JsonArray tools = new JsonArray();
        addTool(tools, "observe.self", "Observe the active server_agent body state.", "observe", "self");
        addTool(tools, "observe.scene", "Observe visible nearby surfaces from the current body.", "observe", "scene");
        addTool(tools, "observe.inventory", "Observe the active server_agent inventory.", "observe", "inventory");
        addTool(tools, "action.move", "Move the active body using a bounded vector.", "action", "movement");
        addTool(tools, "action.look_at", "Turn toward a visible block ref.", "action", "look");
        addTool(tools, "action.mine_visible_block", "Mine a currently visible block ref.", "action", "mine");
        addTool(tools, "action.use", "Use a visible target when supported.", "action", "use");
        addTool(tools, "container.open", "Open a reachable smoke fixture container.", "container");
        addTool(tools, "container.observe", "Observe the currently open smoke fixture container.", "container", "observe");
        addTool(tools, "container.move_stack", "Move a stack between smoke fixture container and agent inventory.", "container");
        addTool(tools, "container.take_output", "Take crafting output into agent inventory.", "container", "craft");
        addTool(tools, "craft.list_available", "List smoke fixture recipes available through the server recipe registry.", "craft", "recipe");
        addTool(tools, "craft.quick_craft", "Craft through the server recipe registry for the smoke fixture.", "craft", "recipe");
        response.add("tools", tools);
        response.add("next_cursor", null);
        return response;
    }

    private JsonObject toolExecute(JsonObject request) {
        AgentBody agent = runtimeState.agent(stringValue(request, "agent_id", ""));
        if (agent == null) {
            return failure(request, "agent_not_born", "Call agent.birth before executing tools.");
        }

        String name = stringValue(request, "name", "");
        JsonObject arguments = objectValue(request, "arguments");
        return switch (name) {
            case "observe.self" -> observeSelf(request, agent);
            case "observe.scene" -> observeScene(request, agent, arguments);
            case "observe.inventory" -> observeInventory(request, agent);
            case "action.move" -> move(request, agent, arguments);
            case "action.look_at" -> lookAt(request, agent, arguments);
            case "action.mine_visible_block" -> mineVisibleBlock(request, agent, arguments);
            case "action.use" -> unsupported(request, "action.use");
            case "container.open" -> openContainer(request, agent, arguments);
            case "container.observe" -> observeContainer(request, agent);
            case "container.move_stack" -> moveStack(request, agent, arguments);
            case "container.take_output" -> takeOutput(request, agent, arguments);
            case "craft.list_available" -> listCraftable(request, agent, arguments);
            case "craft.quick_craft" -> quickCraft(request, agent, arguments);
            case "create.inspect_component" -> unsupported(request, name);
            default -> failure(request, "unknown_tool", "Unknown dynamic tool: " + name);
        };
    }

    private JsonObject observeSelf(JsonObject request, AgentBody agent) {
        JsonObject response = baseResponse(request, "tool.execute_result");
        response.addProperty("status", "completed");
        response.addProperty("agent_id", agent.agentId);
        response.addProperty("body_type", "server_agent.command_body");
        response.add("position", vector(agent.position()));
        response.addProperty("health", 20);
        response.addProperty("hunger", 20);
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
        response.addProperty("ref_ttl_ms", AgentBody.REF_TTL_MS);
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
        block.add("tags", tags(state));
        blocks.add(block);
    }

    private JsonObject observeInventory(JsonObject request, AgentBody agent) {
        JsonObject inventory = new JsonObject();
        JsonArray main = new JsonArray();
        int slot = 0;
        for (Map.Entry<String, Integer> entry : agent.inventory.entrySet()) {
            JsonObject item = new JsonObject();
            item.addProperty("slot", slot++);
            item.addProperty("item", entry.getKey());
            item.addProperty("count", entry.getValue());
            main.add(item);
        }
        inventory.add("main", main);
        inventory.add("hotbar", new JsonArray());

        JsonObject response = baseResponse(request, "tool.execute_result");
        response.addProperty("status", "completed");
        response.add("inventory", inventory);
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
        agent.entity.moveTo(current.x + dx, current.y + dy, current.z + dz, agent.entity.getYRot(), agent.entity.getXRot());

        JsonObject response = baseResponse(request, "tool.execute_result");
        response.addProperty("status", "completed");
        response.addProperty("moved", true);
        response.add("position", vector(agent.position()));
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

        Item item = state.getBlock().asItem();
        String itemId = item == Items.AIR ? blockRef.blockId : BuiltInRegistries.ITEM.getKey(item).toString();
        level.destroyBlock(blockRef.pos, false);
        agent.addInventory(itemId, 1);

        JsonObject response = baseResponse(request, "tool.execute_result");
        response.addProperty("status", "completed");
        response.addProperty("mined", blockRef.blockId);
        JsonObject drop = new JsonObject();
        drop.addProperty("item", itemId);
        drop.addProperty("count", 1);
        response.add("drop", drop);
        return response;
    }

    private JsonObject openContainer(JsonObject request, AgentBody agent, JsonObject arguments) {
        String ref = stringValue(arguments, "block_ref", "");
        BlockRef blockRef = agent.ref(ref);
        if (blockRef == null) {
            return failure(request, "unknown_or_unobserved_target", "Block ref is not from the latest observation.");
        }
        if (blockRef.expired()) {
            return failure(request, "expired_ref", "Block ref has expired.");
        }
        if (Math.sqrt(blockRef.pos.distSqr(agent.blockPosition())) > 6.0) {
            return failure(request, "target_too_far", "The container is outside the current server_agent reach.");
        }

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
        } else if (blockId.equals("minecraft:crafting_table")) {
            kind = "crafting_table";
        } else {
            return failure(request, "unsupported_capability", "The referenced block is not a supported smoke fixture container.");
        }

        agent.openContainer = new OpenContainer("container:" + agent.agentId + ":" + (++agent.containerSeq), kind, ref, blockRef.pos, container);
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

        ItemStack source = readSlot(agent, from);
        if (source.isEmpty()) {
            return failure(request, "missing_material", "Source slot is empty.");
        }
        int requestedCount = Math.max(1, intValue(arguments, "count", source.getCount()));
        int count = Math.min(requestedCount, source.getCount());
        ItemStack destination = readSlot(agent, to);
        if (!destination.isEmpty() && !ItemStack.isSameItemSameComponents(destination, source)) {
            return failure(request, "inventory_full", "Destination slot already contains a different item.");
        }

        ItemStack moved = source.copyWithCount(count);
        ItemStack remaining = source.copy();
        remaining.shrink(count);
        writeSlot(agent, from, remaining.isEmpty() ? ItemStack.EMPTY : remaining);
        ItemStack merged = destination.isEmpty() ? moved.copy() : destination.copyWithCount(destination.getCount() + count);
        writeSlot(agent, to, merged);

        JsonObject result = new JsonObject();
        JsonObject movedPayload = stackPayload(moved);
        result.add("moved", movedPayload);
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

        ItemStack output = agent.openContainer.output;
        if (output.isEmpty()) {
            return failure(request, "missing_material", "No output is available.");
        }
        if (!canAcceptInventory(agent, output)) {
            return failure(request, "inventory_full", "No inventory slot is available for the output.");
        }
        agent.addInventory(stackItemId(output), output.getCount());
        JsonObject taken = stackPayload(output);
        agent.openContainer.output = ItemStack.EMPTY;

        JsonObject result = new JsonObject();
        result.add("taken", taken);
        result.add("inventory", inventoryPayload(agent));

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
        if (!agent.openContainer.output.isEmpty()) {
            return failure(request, "inventory_full", "Take the current crafting output before crafting again.");
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

        for (Map.Entry<String, Integer> entry : plan.get().consumed.entrySet()) {
            agent.removeInventory(entry.getKey(), entry.getValue());
        }
        agent.openContainer.output = plan.get().output;

        JsonObject result = new JsonObject();
        result.addProperty("recipe_id", recipeId);
        result.add("output", stackPayload(plan.get().output));
        result.add("container", containerSnapshot(agent));

        JsonObject response = toolCompleted(request);
        response.add("result", result);
        return response;
    }

    private JsonObject toolCompleted(JsonObject request) {
        JsonObject response = baseResponse(request, "tool.execute_result");
        response.addProperty("status", "completed");
        return response;
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

        JsonArray slots = new JsonArray();
        if (open.container != null) {
            for (int index = 0; index < open.container.getContainerSize(); index++) {
                slots.add(slotPayload(agent, "container", index, open.container.getItem(index)));
            }
        }
        snapshot.add("slots", slots);

        List<ItemStack> inventory = inventoryEntries(agent);
        JsonArray inventorySlots = new JsonArray();
        for (int index = 0; index < 8; index++) {
            ItemStack stack = index < inventory.size() ? inventory.get(index) : ItemStack.EMPTY;
            inventorySlots.add(slotPayload(agent, "inventory", index, stack));
        }
        snapshot.add("inventory_slots", inventorySlots);

        snapshot.add("output_slot", open.output.isEmpty() ? null : slotPayload(agent, "output", 0, open.output));
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

    private ItemStack readSlot(AgentBody agent, SlotRef slot) {
        OpenContainer open = agent.openContainer;
        if (open == null || !open.containerId.equals(slot.containerId)) {
            return ItemStack.EMPTY;
        }
        if (slot.area.equals("container") && open.container != null && slot.index >= 0 && slot.index < open.container.getContainerSize()) {
            return open.container.getItem(slot.index).copy();
        }
        if (slot.area.equals("inventory")) {
            List<ItemStack> inventory = inventoryEntries(agent);
            return slot.index >= 0 && slot.index < inventory.size() ? inventory.get(slot.index).copy() : ItemStack.EMPTY;
        }
        if (slot.area.equals("output")) {
            return open.output.copy();
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
            List<ItemStack> inventory = inventoryEntries(agent);
            if (slot.index >= 0 && slot.index < inventory.size()) {
                ItemStack existing = inventory.get(slot.index);
                agent.removeInventory(stackItemId(existing), existing.getCount());
            }
            if (!stack.isEmpty()) {
                agent.addInventory(stackItemId(stack), stack.getCount());
            }
            return;
        }
        if (slot.area.equals("output")) {
            open.output = stack;
        }
    }

    private List<ItemStack> inventoryEntries(AgentBody agent) {
        List<ItemStack> entries = new ArrayList<>();
        for (Map.Entry<String, Integer> entry : agent.inventory.entrySet()) {
            if (entry.getValue() <= 0) {
                continue;
            }
            Item item = itemById(entry.getKey());
            if (item != Items.AIR) {
                entries.add(new ItemStack(item, entry.getValue()));
            }
        }
        return entries;
    }

    private boolean canAcceptInventory(AgentBody agent, ItemStack stack) {
        return agent.inventory.containsKey(stackItemId(stack)) || inventoryEntries(agent).size() < 8;
    }

    private JsonObject inventoryPayload(AgentBody agent) {
        JsonObject inventory = new JsonObject();
        JsonArray main = new JsonArray();
        int slot = 0;
        for (ItemStack stack : inventoryEntries(agent)) {
            JsonObject item = stackPayload(stack);
            item.addProperty("slot", slot++);
            main.add(item);
        }
        inventory.add("main", main);
        inventory.add("hotbar", new JsonArray());
        return inventory;
    }

    private Optional<CraftPlan> craftPlan(RecipeHolder<CraftingRecipe> recipe, int count, AgentBody agent) {
        if (!recipe.value().canCraftInDimensions(3, 3)) {
            return Optional.empty();
        }
        Map<String, Integer> available = new LinkedHashMap<>(agent.inventory);
        Map<String, Integer> consumed = new LinkedHashMap<>();
        ItemStack output = ItemStack.EMPTY;

        for (int craftIndex = 0; craftIndex < count; craftIndex++) {
            List<ItemStack> grid = new ArrayList<>();
            for (int slot = 0; slot < 9; slot++) {
                grid.add(ItemStack.EMPTY);
            }
            int gridIndex = 0;
            for (var ingredient : recipe.value().getIngredients()) {
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
                if (gridIndex >= grid.size()) {
                    return Optional.empty();
                }
                grid.set(gridIndex++, stack.copyWithCount(1));
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
        return Optional.of(new CraftPlan(consumed, output));
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

    private static void addTool(JsonArray tools, String name, String summary, String... tags) {
        JsonObject tool = new JsonObject();
        tool.addProperty("name", name);
        tool.addProperty("summary", summary);
        JsonArray tagArray = new JsonArray();
        for (String tag : tags) {
            tagArray.add(tag);
        }
        tool.add("tags", tagArray);
        tools.add(tool);
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
        if (id.equals("minecraft:copper_block")) {
            tags.add("create:component");
        }
        return tags;
    }

    private static final class RuntimeState {
        private final Map<String, AgentBody> agents = new LinkedHashMap<>();
        private String ownerId = "";
        private int agentSeq = 0;

        private AgentBody birth(ServerLevel level, String ownerId, String seedPrompt) {
            agentSeq++;
            String agentId = "agent_" + agentSeq;
            String displayName = "MineLink-" + agentSeq;
            BlockPos base = level.getSharedSpawnPos().offset(2 + agentSeq, 2, 2);
            seedFixture(level, base);

            ArmorStand entity = new ArmorStand(level, base.getX() + 0.5, base.getY(), base.getZ() + 0.5);
            entity.setCustomName(Component.literal(displayName));
            entity.setCustomNameVisible(true);
            entity.setNoGravity(true);
            entity.setInvulnerable(true);
            level.addFreshEntity(entity);

            AgentBody body = new AgentBody(agentId, displayName, ownerId, seedPrompt, entity, base.immutable());
            agents.put(agentId, body);
            return body;
        }

        private AgentBody agent(String agentId) {
            return agents.get(agentId);
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
                container.setItem(1, new ItemStack(Items.COBBLESTONE, 1));
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
    }

    private static final class AgentBody {
        private static final long REF_TTL_MS = 30_000;

        private final String agentId;
        private final String displayName;
        private final String ownerId;
        private final String seedPrompt;
        private final ArmorStand entity;
        private final BlockPos fixtureBase;
        private final Map<String, Integer> inventory = new LinkedHashMap<>();
        private final Map<String, BlockRef> refs = new LinkedHashMap<>();
        private OpenContainer openContainer;
        private int refSeq = 0;
        private int slotSeq = 0;
        private int containerSeq = 0;

        private AgentBody(String agentId, String displayName, String ownerId, String seedPrompt, ArmorStand entity, BlockPos fixtureBase) {
            this.agentId = agentId;
            this.displayName = displayName;
            this.ownerId = ownerId;
            this.seedPrompt = seedPrompt;
            this.entity = entity;
            this.fixtureBase = fixtureBase;
        }

        private Vec3 position() {
            return entity.position();
        }

        private BlockPos blockPosition() {
            return entity.blockPosition();
        }

        private String addRef(BlockPos pos, String blockId) {
            String ref = "block:" + agentId + ":" + (++refSeq);
            refs.put(ref, new BlockRef(pos, blockId, Instant.now().plusMillis(REF_TTL_MS).toEpochMilli()));
            return ref;
        }

        private BlockRef ref(String ref) {
            return refs.get(ref);
        }

        private void addInventory(String itemId, int count) {
            inventory.merge(itemId, count, Integer::sum);
        }

        private void removeInventory(String itemId, int count) {
            inventory.merge(itemId, -count, Integer::sum);
            if (inventory.getOrDefault(itemId, 0) <= 0) {
                inventory.remove(itemId);
            }
        }

        private BlockPos[] smokeFixturePositions() {
            return new BlockPos[] {
                fixtureBase.east(3),
                fixtureBase.east(3).above(),
                fixtureBase.south(3),
                fixtureBase.south(4),
                fixtureBase.east(2).south(3)
            };
        }
    }

    private record BlockRef(BlockPos pos, String blockId, long expiresAtMs) {
        private boolean expired() {
            return System.currentTimeMillis() > expiresAtMs;
        }
    }

    private static final class OpenContainer {
        private final String containerId;
        private final String kind;
        private final String blockRef;
        private final BlockPos blockPos;
        private final Container container;
        private final Map<String, SlotRef> slotRefs = new LinkedHashMap<>();
        private ItemStack output = ItemStack.EMPTY;

        private OpenContainer(String containerId, String kind, String blockRef, BlockPos blockPos, Container container) {
            this.containerId = containerId;
            this.kind = kind;
            this.blockRef = blockRef;
            this.blockPos = blockPos;
            this.container = container;
        }
    }

    private record SlotRef(String containerId, String area, int index) {
    }

    private record CraftPlan(Map<String, Integer> consumed, ItemStack output) {
    }
}
