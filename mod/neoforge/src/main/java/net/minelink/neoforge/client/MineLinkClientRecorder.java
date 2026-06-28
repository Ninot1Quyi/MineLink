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
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.ClipContext;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.HitResult;
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
    private static boolean targetCenteredLogged;
    private static int targetCenteredTicks;
    private static boolean targetVisibleLogged;
    private static int targetVisibleTicks;
    private static boolean candidateCountLogged;
    private static Vec3 smoothedCameraPosition;
    private static float smoothedYaw;
    private static float smoothedPitch;
    private static String smoothedTargetName = "";
    private static boolean hasStableCameraChoice;
    private static double stableCameraDistance;
    private static double stableCameraHeight;
    private static double stableCameraSide;

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
        targetCenteredLogged = false;
        targetCenteredTicks = 0;
        targetVisibleLogged = false;
        targetVisibleTicks = 0;
        candidateCountLogged = false;
        smoothedCameraPosition = null;
        smoothedTargetName = "";
        hasStableCameraChoice = false;
        MineLinkMod.LOGGER.info("MineLink recorder client joined {}", address());
    }

    private static void onClientLoggedOut(ClientPlayerNetworkEvent.LoggingOut event) {
        connected = false;
        connecting = false;
        worldReadyLogged = false;
        worldReadyTicks = 0;
        followLogged = false;
        followTicks = 0;
        targetCenteredLogged = false;
        targetCenteredTicks = 0;
        targetVisibleLogged = false;
        targetVisibleTicks = 0;
        candidateCountLogged = false;
        smoothedCameraPosition = null;
        smoothedTargetName = "";
        hasStableCameraChoice = false;
        ticks = 0;
    }

    private static boolean observeWorldReady(Minecraft minecraft) {
        boolean inWorld = minecraft.level != null && minecraft.player != null && minecraft.screen == null;
        if (!inWorld) {
            worldReadyTicks = 0;
            followTicks = 0;
            targetCenteredTicks = 0;
            targetVisibleTicks = 0;
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
            targetVisibleTicks = 0;
            return;
        }
        configureRecorderView(minecraft);
        TargetSelection targetSelection = findServerAgent(minecraft);
        Entity target = targetSelection.target();
        int expectedServerAgents = expectedVisibleServerAgents();
        if (target == null || targetSelection.candidateCount() != expectedServerAgents) {
            followTicks = 0;
            targetCenteredTicks = 0;
            targetVisibleTicks = 0;
            smoothedCameraPosition = null;
            smoothedTargetName = "";
            hasStableCameraChoice = false;
            if (!candidateCountLogged && targetSelection.candidateCount() > 0) {
                candidateCountLogged = true;
                MineLinkMod.LOGGER.info(
                    "MineLink recorder client server_agent candidates {} expected {} target {}",
                    targetSelection.candidateCount(),
                    expectedServerAgents,
                    target == null ? "none" : target.getName().getString()
                );
            }
            return;
        }
        if (!candidateCountLogged) {
            candidateCountLogged = true;
            MineLinkMod.LOGGER.info(
                "MineLink recorder client server_agent candidates {} expected {} target {}",
                targetSelection.candidateCount(),
                expectedServerAgents,
                target.getName().getString()
            );
        }
        if (useTargetThirdPersonCamera()) {
            followTargetThirdPerson(minecraft, target);
            return;
        }
        Vec3 targetPos = target.position().add(0.0D, Math.max(1.35D, target.getBbHeight() * 0.75D), 0.0D);
        Vec3 forward = forwardVector(target.getYRot());
        Vec3 right = rightVector(target.getYRot());
        double distance = positiveDouble(setting(
            "MINELINK_RECORDER_CLIENT_CAMERA_DISTANCE",
            "minelink.recorder.client.cameraDistance",
            "4.0"
        ), 4.0D);
        double height = positiveDouble(setting(
            "MINELINK_RECORDER_CLIENT_CAMERA_HEIGHT",
            "minelink.recorder.client.cameraHeight",
            "1.8"
        ), 1.8D);
        double side = signedDouble(setting(
            "MINELINK_RECORDER_CLIENT_CAMERA_SIDE",
            "minelink.recorder.client.cameraSide",
            "1.6"
        ), 1.6D);
        double lead = positiveDouble(setting(
            "MINELINK_RECORDER_CLIENT_CAMERA_LEAD",
            "minelink.recorder.client.cameraLead",
            "0.75"
        ), 0.75D);
        Vec3 focusPos = targetPos.add(forward.scale(lead));
        String targetName = target.getName().getString();
        if (!targetName.equals(smoothedTargetName)) {
            hasStableCameraChoice = false;
        }
        CameraChoice cameraChoice = chooseCameraPosition(minecraft, targetPos, focusPos, forward, right, distance, height, side);
        boolean resetCameraSmoothing = smoothedCameraPosition == null || !targetName.equals(smoothedTargetName);
        Vec3 cameraPos = smoothCameraPosition(targetName, cameraChoice.position());
        float yaw = yawToward(cameraPos, focusPos);
        float pitch = pitchToward(cameraPos, focusPos);
        if (!resetCameraSmoothing) {
            yaw = smoothAngle(smoothedYaw, yaw, cameraSmoothingFactor());
            pitch = smoothAngle(smoothedPitch, pitch, cameraSmoothingFactor());
        }
        smoothedYaw = yaw;
        smoothedPitch = pitch;

        minecraft.player.noPhysics = true;
        minecraft.player.setDeltaMovement(Vec3.ZERO);
        minecraft.player.moveTo(cameraPos.x, cameraPos.y, cameraPos.z, yaw, pitch);
        minecraft.player.setYRot(yaw);
        minecraft.player.setXRot(pitch);
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
                "MineLink recorder client following server_agent {} candidates {}/{} from camera {},{},{}",
                targetName,
                targetSelection.candidateCount(),
                expectedServerAgents,
                String.format("%.2f", cameraPos.x),
                String.format("%.2f", cameraPos.y),
                String.format("%.2f", cameraPos.z)
            );
        }
        boolean targetVisible = cameraChoice.visible() && clearLineOfSight(minecraft, cameraPos, focusPos);
        if (targetVisible) {
            targetVisibleTicks++;
        } else {
            targetVisibleTicks = 0;
        }
        if (!targetVisibleLogged && targetVisibleTicks >= readyTicks) {
            targetVisibleLogged = true;
            MineLinkMod.LOGGER.info(
                "MineLink recorder client target visible server_agent {} candidates {}/{} camera {},{},{} focus {},{},{}",
                targetName,
                targetSelection.candidateCount(),
                expectedServerAgents,
                String.format("%.2f", cameraPos.x),
                String.format("%.2f", cameraPos.y),
                String.format("%.2f", cameraPos.z),
                String.format("%.2f", focusPos.x),
                String.format("%.2f", focusPos.y),
                String.format("%.2f", focusPos.z)
            );
        }
        if (minecraft.getCameraEntity() == minecraft.player && targetVisible) {
            targetCenteredTicks++;
        } else {
            targetCenteredTicks = 0;
        }
        if (!targetCenteredLogged && targetCenteredTicks >= readyTicks) {
            targetCenteredLogged = true;
            MineLinkMod.LOGGER.info(
                "MineLink recorder client target centered server_agent {} candidates {}/{} focus {},{},{}",
                targetName,
                targetSelection.candidateCount(),
                expectedServerAgents,
                String.format("%.2f", focusPos.x),
                String.format("%.2f", focusPos.y),
                String.format("%.2f", focusPos.z)
            );
        }
    }

    private static void followTargetThirdPerson(Minecraft minecraft, Entity target) {
        minecraft.options.setCameraType(CameraType.THIRD_PERSON_BACK);
        minecraft.setCameraEntity(target);
        TargetSelection targetSelection = findServerAgent(minecraft);
        int expectedServerAgents = expectedVisibleServerAgents();
        if (targetSelection.candidateCount() != expectedServerAgents) {
            followTicks = 0;
            targetVisibleTicks = 0;
            targetCenteredTicks = 0;
            return;
        }

        followTicks++;
        int readyTicks = positiveInt(setting(
            "MINELINK_RECORDER_CLIENT_FOLLOW_READY_TICKS",
            "minelink.recorder.client.followReadyTicks",
            "10"
        ), 10);
        if (!followLogged && followTicks >= readyTicks) {
            followLogged = true;
            MineLinkMod.LOGGER.info(
                "MineLink recorder client following server_agent {} candidates {}/{} from target third-person camera",
                target.getName().getString(),
                targetSelection.candidateCount(),
                expectedServerAgents
            );
        }

        targetVisibleTicks++;
        targetCenteredTicks++;
        if (!targetVisibleLogged && targetVisibleTicks >= readyTicks) {
            targetVisibleLogged = true;
            MineLinkMod.LOGGER.info(
                "MineLink recorder client target visible server_agent {} candidates {}/{} target-third-person",
                target.getName().getString(),
                targetSelection.candidateCount(),
                expectedServerAgents
            );
        }
        if (!targetCenteredLogged && targetCenteredTicks >= readyTicks) {
            targetCenteredLogged = true;
            MineLinkMod.LOGGER.info(
                "MineLink recorder client target centered server_agent {} candidates {}/{} target-third-person",
                target.getName().getString(),
                targetSelection.candidateCount(),
                expectedServerAgents
            );
        }
    }

    private static CameraChoice chooseCameraPosition(
        Minecraft minecraft,
        Vec3 targetPos,
        Vec3 focusPos,
        Vec3 forward,
        Vec3 right,
        double distance,
        double height,
        double side
    ) {
        if (hasStableCameraChoice) {
            Vec3 cameraPos = targetPos
                .subtract(forward.scale(stableCameraDistance))
                .add(right.scale(stableCameraSide))
                .add(0.0D, stableCameraHeight, 0.0D);
            if (clearLineOfSight(minecraft, cameraPos, focusPos)) {
                return new CameraChoice(cameraPos, true);
            }
        }
        double[] distances = new double[] { distance, Math.max(3.0D, distance - 1.0D), distance + 2.0D, distance + 4.0D };
        double[] heights = new double[] { height, height + 1.0D, height + 2.0D, height + 3.0D, height + 5.0D };
        double[] sides = new double[] { side, 0.0D, -side, side * 2.0D, -side * 2.0D };
        CameraChoice fallback = null;
        for (double candidateDistance : distances) {
            for (double candidateHeight : heights) {
                for (double candidateSide : sides) {
                    Vec3 cameraPos = targetPos
                        .subtract(forward.scale(candidateDistance))
                        .add(right.scale(candidateSide))
                        .add(0.0D, candidateHeight, 0.0D);
                    boolean visible = clearLineOfSight(minecraft, cameraPos, focusPos);
                    CameraChoice choice = new CameraChoice(cameraPos, visible);
                    if (fallback == null) {
                        fallback = choice;
                    }
                    if (visible) {
                        hasStableCameraChoice = true;
                        stableCameraDistance = candidateDistance;
                        stableCameraHeight = candidateHeight;
                        stableCameraSide = candidateSide;
                        return choice;
                    }
                }
            }
        }
        return fallback == null
            ? new CameraChoice(targetPos.subtract(forward.scale(distance)).add(right.scale(side)).add(0.0D, height, 0.0D), false)
            : fallback;
    }

    private static boolean clearLineOfSight(Minecraft minecraft, Vec3 cameraPos, Vec3 focusPos) {
        if (minecraft.level == null || minecraft.player == null) {
            return false;
        }
        BlockHitResult hit = minecraft.level.clip(new ClipContext(
            cameraPos,
            focusPos,
            ClipContext.Block.COLLIDER,
            ClipContext.Fluid.NONE,
            minecraft.player
        ));
        return hit.getType() == HitResult.Type.MISS || hit.getLocation().distanceToSqr(focusPos) <= 0.75D;
    }

    private static void configureRecorderView(Minecraft minecraft) {
        minecraft.options.hideGui = false;
        minecraft.options.joinedFirstServer = true;
        minecraft.options.tutorialStep = TutorialSteps.NONE;
        minecraft.options.hideBundleTutorial = true;
        minecraft.options.setCameraType(CameraType.FIRST_PERSON);
    }

    private static boolean useTargetThirdPersonCamera() {
        String mode = setting(
            "MINELINK_RECORDER_CLIENT_CAMERA_MODE",
            "minelink.recorder.client.cameraMode",
            "observer_follow"
        );
        return mode.equalsIgnoreCase("target_third_person") || mode.equalsIgnoreCase("target-third-person");
    }

    private static TargetSelection findServerAgent(Minecraft minecraft) {
        Entity best = null;
        double bestDistance = Double.MAX_VALUE;
        int candidateCount = 0;
        Vec3 origin = minecraft.player == null ? Vec3.ZERO : minecraft.player.position();
        for (Entity entity : minecraft.level.entitiesForRendering()) {
            if (entity == minecraft.player || entity.isRemoved()) {
                continue;
            }
            if (!(entity instanceof Player)) {
                continue;
            }
            String name = entity.getName().getString();
            if (!name.startsWith("MineLink-") && !name.endsWith(" server_agent")) {
                continue;
            }
            candidateCount++;
            double distance = entity.position().distanceToSqr(origin);
            if (distance < bestDistance) {
                best = entity;
                bestDistance = distance;
            }
        }
        return new TargetSelection(best, candidateCount);
    }

    private static int expectedVisibleServerAgents() {
        return positiveInt(setting(
            "MINELINK_RECORDER_EXPECTED_VISIBLE_AGENTS",
            "minelink.recorder.expectedVisibleAgents",
            "1"
        ), 1);
    }

    private static double cameraSmoothingFactor() {
        double value = positiveDouble(setting(
            "MINELINK_RECORDER_CLIENT_CAMERA_SMOOTHING",
            "minelink.recorder.client.cameraSmoothing",
            "0.35"
        ), 0.35D);
        return Math.max(0.05D, Math.min(1.0D, value));
    }

    private static Vec3 smoothCameraPosition(String targetName, Vec3 desiredPosition) {
        double factor = cameraSmoothingFactor();
        if (smoothedCameraPosition == null || !targetName.equals(smoothedTargetName)) {
            smoothedCameraPosition = desiredPosition;
            smoothedTargetName = targetName;
            smoothedYaw = 0.0F;
            smoothedPitch = 0.0F;
            return desiredPosition;
        }
        smoothedCameraPosition = new Vec3(
            Mth.lerp(factor, smoothedCameraPosition.x, desiredPosition.x),
            Mth.lerp(factor, smoothedCameraPosition.y, desiredPosition.y),
            Mth.lerp(factor, smoothedCameraPosition.z, desiredPosition.z)
        );
        return smoothedCameraPosition;
    }

    private static float smoothAngle(float current, float desired, double factor) {
        float delta = Mth.wrapDegrees(desired - current);
        return Mth.wrapDegrees(current + (float)(delta * factor));
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

    private static Vec3 forwardVector(float yawDegrees) {
        double yaw = Math.toRadians(yawDegrees);
        return new Vec3(-Math.sin(yaw), 0.0D, Math.cos(yaw));
    }

    private static Vec3 rightVector(float yawDegrees) {
        double yaw = Math.toRadians(yawDegrees);
        return new Vec3(Math.cos(yaw), 0.0D, Math.sin(yaw));
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

    private static double signedDouble(String value, double fallback) {
        try {
            return Double.parseDouble(value.trim());
        } catch (RuntimeException error) {
            return fallback;
        }
    }

    private record CameraChoice(Vec3 position, boolean visible) {
    }

    private record TargetSelection(Entity target, int candidateCount) {
    }
}
