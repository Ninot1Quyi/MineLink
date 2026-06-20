package net.minelink.neoforge.server;

import net.minelink.neoforge.MineLinkMod;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.event.server.ServerStoppedEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;

public final class MineLinkServerEvents {
    private MineLinkEndpointBootstrap endpoint;

    @SubscribeEvent
    public void onServerStarted(ServerStartedEvent event) {
        endpoint = new MineLinkEndpointBootstrap(event.getServer());
        endpoint.start();
    }

    @SubscribeEvent
    public void onServerStopping(ServerStoppingEvent event) {
        MineLinkMod.LOGGER.info("MineLink server runtime stopping");
        stopEndpoint();
    }

    @SubscribeEvent
    public void onServerStopped(ServerStoppedEvent event) {
        stopEndpoint();
    }

    private void stopEndpoint() {
        if (endpoint == null) {
            return;
        }
        endpoint.stop();
        endpoint = null;
    }
}
