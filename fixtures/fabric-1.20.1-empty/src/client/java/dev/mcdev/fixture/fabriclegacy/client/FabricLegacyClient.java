package dev.mcdev.fixture.fabriclegacy.client;

import dev.mcdev.fixture.fabriclegacy.SmokeReadiness;
import java.nio.file.Path;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class FabricLegacyClient implements ClientModInitializer {
    private static final Logger LOGGER = LoggerFactory.getLogger("fabriclegacy-client");
    private static final int REQUIRED_STABLE_TICKS = 20;
    private static final String CLIENT_SMOKE_NONCE_ENV = "PHASE0_SMOKE_CLIENT_NONCE";
    private static final Path CLIENT_SMOKE_READY_SENTINEL = Path.of(".phase0-client-ready");
    private static final Path CLIENT_SMOKE_READY_SENTINEL_TEMP = Path.of(".phase0-client-ready.tmp");
    private static int stableTicks;
    private static boolean readinessAttempted;

    @Override
    public void onInitializeClient() {
        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            if (readinessAttempted) {
                return;
            }
            if (client.screen == null) {
                stableTicks = 0;
                return;
            }
            if (++stableTicks >= REQUIRED_STABLE_TICKS) {
                readinessAttempted = true;
                if (SmokeReadiness.publishFromEnvironment(
                        CLIENT_SMOKE_NONCE_ENV,
                        CLIENT_SMOKE_READY_SENTINEL_TEMP,
                        CLIENT_SMOKE_READY_SENTINEL)) {
                    LOGGER.info("FABRIC_1_20_1_CLIENT_POST_INITIALIZATION_READY");
                }
            }
        });
        LOGGER.info("FABRIC_1_20_1_CLIENT_LOADED");
    }
}
