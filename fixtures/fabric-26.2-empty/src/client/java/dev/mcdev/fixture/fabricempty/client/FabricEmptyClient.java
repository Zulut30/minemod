package dev.mcdev.fixture.fabricempty.client;

import net.fabricmc.api.ClientModInitializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class FabricEmptyClient implements ClientModInitializer {
    private static final Logger LOGGER = LoggerFactory.getLogger("fabricempty-client");
    private static volatile boolean initialized;

    @Override
    public void onInitializeClient() {
        initialized = true;
        LOGGER.info("Fabric 26.2 empty client initialized");
    }

    public static boolean isInitialized() {
        return initialized;
    }
}
