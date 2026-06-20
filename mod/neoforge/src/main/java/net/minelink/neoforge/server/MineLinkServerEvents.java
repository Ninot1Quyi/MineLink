package net.minelink.neoforge.server;

import net.minelink.neoforge.MineLinkMod;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;

public final class MineLinkServerEvents {
    @SubscribeEvent
    public void onServerStarted(ServerStartedEvent event) {
        MineLinkEndpointBootstrap endpoint = new MineLinkEndpointBootstrap();
        endpoint.start();
    }

    @SubscribeEvent
    public void onServerStopping(ServerStoppingEvent event) {
        MineLinkMod.LOGGER.info("MineLink server runtime stopping");
    }
}
