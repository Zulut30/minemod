package dev.mcdev.fixture.fabricempty.client;

import net.fabricmc.api.ClientModInitializer;

public final class FabricEmptyClient implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        // The explicit client entrypoint proves splitEnvironmentSourceSets wiring.
    }
}
