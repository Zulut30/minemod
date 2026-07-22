package dev.mcdev.fixture.fabriclegacy.client;

import net.fabricmc.api.ClientModInitializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class FabricLegacyClient implements ClientModInitializer {
    private static final Logger LOGGER = LoggerFactory.getLogger("fabriclegacy-client");

    @Override
    public void onInitializeClient() {
        LOGGER.info("FABRIC_1_20_1_CLIENT_LOADED");
    }
}
