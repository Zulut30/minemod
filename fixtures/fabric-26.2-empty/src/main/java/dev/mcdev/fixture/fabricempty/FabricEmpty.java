package dev.mcdev.fixture.fabricempty;

import net.fabricmc.api.ModInitializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class FabricEmpty implements ModInitializer {
    public static final String MOD_ID = "fabricempty";
    private static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);
    private static volatile boolean initialized;

    @Override
    public void onInitialize() {
        initialized = true;
        LOGGER.info("Fabric 26.2 empty fixture initialized");
    }

    public static boolean isInitialized() {
        return initialized;
    }
}
