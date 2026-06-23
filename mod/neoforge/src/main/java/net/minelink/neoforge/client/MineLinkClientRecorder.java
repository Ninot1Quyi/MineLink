package net.minelink.neoforge.client;

import net.minecraft.client.CameraType;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.resolver.ServerAddress;
import net.minecraft.client.tutorial.TutorialSteps;
import net.minecraft.util.Mth;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.phys.Vec3;
import net.minelink.neoforge.MineLinkMod;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.api.distmarker.OnlyIn;
import net.neoforged.neoforge.client.event.ClientPlayerNetworkEvent;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.common.NeoForge;

@OnlyIn(Dist.CLIENT)
public final class MineLinkClientRecorder {
    private static boolean registered;
    private static boolean connecting;
    private static boolean connected;
    private static int ticks;
    private static boolean worldReadyLogged;
    private static int worldReadyTicks;
    private static boolean followLogged;
    private static int followTicks;

    private MineLinkClientRecorder() {
    }

    public static void register() {
        if (registered || !enabled()) {
            return;
        }
        registered = true;
        NeoForge.EVENT_BUS.addListener(MineLinkClientRecorder::onClientTick);
        NeoForge.EVENT_BUS.addListener(MineLinkClientRecorder::onClientLoggedIn);
        NeoForge.EVENT_BUS.addListener(MineLinkClientRecorder::onClientLoggedOut);
        MineLinkMod.LOGGER.info("MineLink recorder client enabled for {}", address());
    }

    private static void onClientTick(ClientTickEvent.Post event) {
        if (!enabled()) {
            return;
        }
        Minecraft minecraft = Minecraft.getInstance();
        if (connected) {
            if (observeWorldReady(minecraft)) {
                followServerAgent(minecraft);
            }
            return;
        }
        if (connecting) {
            return;
        }
        if (minecraft.level != null || minecraft.player != null) {
            connected = true;
            if (observeWorldReady(minecraft)) {
                followServerAgent(minecraft);
            }
            return;
        }
        ticks++;
        int delayTicks = positiveInt(setting("MINELINK_RECORDER_CLIENT_CONNECT_DELAY_TICKS", "minelink.recorder.client.connectDelayTicks", "40"), 40);
        if (ticks < delayTicks) {
            return;
        }
        connecting = true;
        String targetAddress = address();
        MineLinkMod.LOGGER.info("MineLink recorder client connecting to {}", targetAddress);
        minecraft.execute(() -> ConnectScreen.startConnecting(
            new TitleScreen(),
            minecraft,
            ServerAddress.parseString(targetAddress),
            new ServerData("MineLink Recorder", targetAddress, ServerData.Type.OTHER),
            false,
            null
        ));
    }

    private static void onClientLoggedIn(ClientPlayerNetworkEvent.LoggingIn event) {
        connected = true;
        connecting = false;
        worldReadyLogged = false;
        worldReadyTicks = 0;
        followLogged = false;
        followTicks = 0;
        MineLinkMod.LOGGER.info("MineLink recorder client joined {}", address());
    }

    private static void onClientLoggedOut(ClientPlayerNetworkEvent.LoggingOut event) {
        connected = false;
        connecting = false;
        worldReadyLogged = false;
        worldReadyTicks = 0;
        followLogged = false;
        followTicks = 0;
        ticks = 0;
    }

    private static boolean observeWorldReady(Minecraft minecraft) {
        boolean inWorld = minecraft.level != null && minecraft.player != null && minecraft.screen == null;
        if (!inWorld) {
            worldReadyTicks = 0;
            followTicks = 0;
            return false;
        }
        worldReadyTicks++;
        int readyTicks = positiveInt(setting(
            "MINELINK_RECORDER_CLIENT_WORLD_READY_TICKS",
            "minelink.recorder.client.worldReadyTicks",
            "20"
        ), 20);
        if (!worldReadyLogged && worldReadyTicks >= readyTicks) {
            worldReadyLogged = true;
            MineLinkMod.LOGGER.info("MineLink recorder client in world {}", address());
        }
        return worldReadyLogged;
    }

    private static void followServerAgent(Minecraft minecraft) {
        if (minecraft.level == null || minecraft.player == null || minecraft.screen != null) {
            followTicks = 0;
            return;
        }
        configureRecorderView(minecraft);
        Entity target = findServerAgent(minecraft);
        if (target == null) {
            followTicks = 0;
            return;
        }
        Vec3 targetPos = target.position().add(0.0D, Math.max(1.35D, target.getBbHeight() * 0.75D), 0.0D);
        double distance = positiveDouble(setting(
            "MINELINK_RECORDER_CLIENT_CAMERA_DISTANCE",
            "minelink.recorder.client.cameraDistance",
            "6.0"
        ), 6.0D);
        double height = positiveDouble(setting(
            "MINELINK_RECORDER_CLIENT_CAMERA_HEIGHT",
            "minelink.recorder.client.cameraHeight",
            "2.25"
        ), 2.25D);
        Vec3 cameraPos = targetPos.add(-distance, height, -distance);
        float yaw = yawToward(cameraPos, targetPos);
        float pitch = pitchToward(cameraPos, targetPos);

        minecraft.player.noPhysics = true;
        minecraft.player.setDeltaMovement(Vec3.ZERO);
        minecraft.player.moveTo(cameraPos.x, cameraPos.y, cameraPos.z, yaw, pitch);
        minecraft.player.setYHeadRot(yaw);
        minecraft.player.setYBodyRot(yaw);
        minecraft.setCameraEntity(minecraft.player);

        followTicks++;
        int readyTicks = positiveInt(setting(
            "MINELINK_RECORDER_CLIENT_FOLLOW_READY_TICKS",
            "minelink.recorder.client.followReadyTicks",
            "10"
        ), 10);
        if (!followLogged && followTicks >= readyTicks) {
            followLogged = true;
            MineLinkMod.LOGGER.info(
                "MineLink recorder client following server_agent {} from camera {},{},{}",
                target.getName().getString(),
                String.format("%.2f", cameraPos.x),
                String.format("%.2f", cameraPos.y),
                String.format("%.2f", cameraPos.z)
            );
        }
    }

    private static void configureRecorderView(Minecraft minecraft) {
        minecraft.options.hideGui = true;
        minecraft.options.joinedFirstServer = true;
        minecraft.options.tutorialStep = TutorialSteps.NONE;
        minecraft.options.hideBundleTutorial = true;
        minecraft.options.setCameraType(CameraType.FIRST_PERSON);
    }

    private static Entity findServerAgent(Minecraft minecraft) {
        Entity best = null;
        double bestDistance = Double.MAX_VALUE;
        Vec3 origin = minecraft.player == null ? Vec3.ZERO : minecraft.player.position();
        for (Entity entity : minecraft.level.entitiesForRendering()) {
            if (entity == minecraft.player || entity.isRemoved()) {
                continue;
            }
            String name = entity.getName().getString();
            if (!name.endsWith(" server_agent")) {
                continue;
            }
            double distance = entity.position().distanceToSqr(origin);
            if (distance < bestDistance) {
                best = entity;
                bestDistance = distance;
            }
        }
        return best;
    }

    private static float yawToward(Vec3 from, Vec3 to) {
        double dx = to.x - from.x;
        double dz = to.z - from.z;
        return Mth.wrapDegrees((float)(Mth.atan2(dz, dx) * 180.0D / Math.PI) - 90.0F);
    }

    private static float pitchToward(Vec3 from, Vec3 to) {
        double dx = to.x - from.x;
        double dy = to.y - from.y;
        double dz = to.z - from.z;
        double horizontal = Math.sqrt(dx * dx + dz * dz);
        return Mth.wrapDegrees((float)(-(Mth.atan2(dy, horizontal) * 180.0D / Math.PI)));
    }

    private static boolean enabled() {
        return truthy(setting("MINELINK_RECORDER_CLIENT_ENABLED", "minelink.recorder.client.enabled", "false"));
    }

    private static String address() {
        return setting("MINELINK_RECORDER_CLIENT_ADDRESS", "minelink.recorder.client.address", "127.0.0.1:26575");
    }

    private static String setting(String envName, String propertyName, String defaultValue) {
        String env = System.getenv(envName);
        if (env != null && !env.isBlank()) {
            return env;
        }
        String property = System.getProperty(propertyName);
        if (property != null && !property.isBlank()) {
            return property;
        }
        return defaultValue;
    }

    private static boolean truthy(String value) {
        return value.equalsIgnoreCase("1") || value.equalsIgnoreCase("true") || value.equalsIgnoreCase("yes");
    }

    private static int positiveInt(String value, int fallback) {
        try {
            int parsed = Integer.parseInt(value.trim());
            return parsed > 0 ? parsed : fallback;
        } catch (RuntimeException error) {
            return fallback;
        }
    }

    private static double positiveDouble(String value, double fallback) {
        try {
            double parsed = Double.parseDouble(value.trim());
            return parsed > 0.0D ? parsed : fallback;
        } catch (RuntimeException error) {
            return fallback;
        }
    }
}
