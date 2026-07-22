package dev.mcdev.fixture.fabricempty;

import java.nio.file.Path;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.minecraft.server.MinecraftServer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class FabricEmpty implements ModInitializer {
    public static final String MOD_ID = "fabricempty";
    private static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);
    private static final String SERVER_SMOKE_NONCE_ENV = "PHASE0_SMOKE_SERVER_NONCE";
    private static final Path SERVER_SMOKE_READY_SENTINEL = Path.of(".phase0-server-ready");
    private static final Path SERVER_SMOKE_READY_SENTINEL_TEMP = Path.of(".phase0-server-ready.tmp");
    private static volatile boolean initialized;

    @Override
    public void onInitialize() {
        initialized = true;
        ServerLifecycleEvents.SERVER_STARTED.register(FabricEmpty::onServerStarted);
        LOGGER.info("FABRIC_EMPTY_FIXTURE_LOADED");
    }

    public static boolean isInitialized() {
        return initialized;
    }

    private static void onServerStarted(MinecraftServer server) {
        if (SmokeReadiness.publishFromEnvironment(
                SERVER_SMOKE_NONCE_ENV,
                SERVER_SMOKE_READY_SENTINEL_TEMP,
                SERVER_SMOKE_READY_SENTINEL)) {
            LOGGER.info("FABRIC_EMPTY_SERVER_STARTED_READY");
            server.halt(false);
        }
    }
}
