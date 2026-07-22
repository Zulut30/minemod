package dev.mcdev.fixture.fabriclegacy;

import net.fabricmc.api.ModInitializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class FabricLegacy implements ModInitializer {
    public static final String MOD_ID = "fabriclegacy";
    private static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    @Override
    public void onInitialize() {
        LOGGER.info("FABRIC_1_20_1_FIXTURE_LOADED");
    }
}
