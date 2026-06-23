package net.minelink.neoforge.client;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.resolver.ServerAddress;
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
        if (!enabled() || connected || connecting) {
            return;
        }
        Minecraft minecraft = Minecraft.getInstance();
        if (minecraft.level != null || minecraft.player != null) {
            connected = true;
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
        MineLinkMod.LOGGER.info("MineLink recorder client joined {}", address());
    }

    private static void onClientLoggedOut(ClientPlayerNetworkEvent.LoggingOut event) {
        connected = false;
        connecting = false;
        ticks = 0;
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
}
