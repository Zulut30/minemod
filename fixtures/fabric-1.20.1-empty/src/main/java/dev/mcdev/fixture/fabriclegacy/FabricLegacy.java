package dev.mcdev.fixture.fabriclegacy;

import java.nio.file.Path;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.minecraft.server.MinecraftServer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class FabricLegacy implements ModInitializer {
    public static final String MOD_ID = "fabriclegacy";
    private static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);
    private static final String SERVER_SMOKE_NONCE_ENV = "PHASE0_SMOKE_SERVER_NONCE";
    private static final Path SERVER_SMOKE_READY_SENTINEL = Path.of(".phase0-server-ready");
    private static final Path SERVER_SMOKE_READY_SENTINEL_TEMP = Path.of(".phase0-server-ready.tmp");

    @Override
    public void onInitialize() {
        ServerLifecycleEvents.SERVER_STARTED.register(FabricLegacy::onServerStarted);
        LOGGER.info("FABRIC_1_20_1_FIXTURE_LOADED");
    }

    private static void onServerStarted(MinecraftServer server) {
        if (SmokeReadiness.publishFromEnvironment(
                SERVER_SMOKE_NONCE_ENV,
                SERVER_SMOKE_READY_SENTINEL_TEMP,
                SERVER_SMOKE_READY_SENTINEL)) {
            LOGGER.info("FABRIC_1_20_1_SERVER_STARTED_READY");
            server.halt(false);
        }
    }
}
