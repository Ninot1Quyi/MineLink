package net.minelink.neoforge;

import com.mojang.logging.LogUtils;
import net.minelink.neoforge.server.MineLinkServerEvents;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import org.slf4j.Logger;

@Mod(MineLinkMod.MOD_ID)
public final class MineLinkMod {
    public static final String MOD_ID = "minelink";
    public static final Logger LOGGER = LogUtils.getLogger();

    public MineLinkMod(IEventBus modEventBus) {
        NeoForge.EVENT_BUS.register(new MineLinkServerEvents());
        LOGGER.info("MineLink mod initialized");
    }
}
