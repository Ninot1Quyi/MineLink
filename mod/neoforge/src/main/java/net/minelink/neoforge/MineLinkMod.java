package net.minelink.neoforge;

import com.mojang.logging.LogUtils;
import net.minelink.neoforge.server.MineLinkServerEvents;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.loading.FMLEnvironment;
import net.neoforged.neoforge.common.NeoForge;
import org.slf4j.Logger;

@Mod(MineLinkMod.MOD_ID)
public final class MineLinkMod {
    public static final String MOD_ID = "minelink";
    public static final Logger LOGGER = LogUtils.getLogger();

    public MineLinkMod(IEventBus modEventBus) {
        NeoForge.EVENT_BUS.register(new MineLinkServerEvents());
        registerClientRecorderIfNeeded();
        LOGGER.info("MineLink mod initialized");
    }

    private static void registerClientRecorderIfNeeded() {
        if (FMLEnvironment.dist != Dist.CLIENT) {
            return;
        }
        try {
            Class<?> recorder = Class.forName("net.minelink.neoforge.client.MineLinkClientRecorder");
            recorder.getMethod("register").invoke(null);
        } catch (ReflectiveOperationException error) {
            LOGGER.warn("MineLink recorder client registration failed", error);
        }
    }
}
