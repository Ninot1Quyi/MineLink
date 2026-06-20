package net.minelink.neoforge.server;

import net.minelink.neoforge.MineLinkMod;

public final class MineLinkEndpointBootstrap {
    public void start() {
        // The real endpoint will bind the MineLink Protocol WebSocket server here.
        // Keep the MVP skeleton side-effect-light until the action/perception services land.
        MineLinkMod.LOGGER.info("MineLink ready: endpoint bootstrap placeholder active");
    }
}
