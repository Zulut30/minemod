package dev.mcdev.fixture.basiccontent;

import com.mojang.logging.LogUtils;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import net.minecraft.client.Minecraft;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import org.slf4j.Logger;

@EventBusSubscriber(modid = BasicContentMod.MOD_ID, value = Dist.CLIENT)
public final class BasicContentClientReadiness {
    private static final Logger LOGGER = LogUtils.getLogger();
    private static final int REQUIRED_STABLE_TICKS = 20;
    private static final String SMOKE_NONCE_ENV = "PHASE0_SMOKE_CLIENT_NONCE";
    private static final Path SMOKE_READY_SENTINEL = Path.of(".phase0-client-ready");
    private static final Path SMOKE_READY_SENTINEL_TEMP = Path.of(".phase0-client-ready.tmp");
    private static int stableTicks;
    private static boolean readinessLogged;

    private BasicContentClientReadiness() {}

    @SubscribeEvent
    public static void onClientTick(ClientTickEvent.Post event) {
        if (readinessLogged) {
            return;
        }
        if (Minecraft.getInstance().screen == null) {
            stableTicks = 0;
            return;
        }
        if (++stableTicks >= REQUIRED_STABLE_TICKS) {
            readinessLogged = true;
            writeSmokeReadinessSentinel();
            LOGGER.info("BASIC_CONTENT_CLIENT_POST_INITIALIZATION_READY");
        }
    }

    private static void writeSmokeReadinessSentinel() {
        String nonce = System.getenv(SMOKE_NONCE_ENV);
        if (nonce == null) {
            return;
        }
        if (!nonce.matches("[A-Za-z0-9._-]{1,128}")) {
            throw new IllegalStateException("Invalid phase-0 client smoke nonce");
        }

        try {
            Files.writeString(
                    SMOKE_READY_SENTINEL_TEMP,
                    nonce + System.lineSeparator(),
                    StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE,
                    StandardOpenOption.TRUNCATE_EXISTING,
                    StandardOpenOption.WRITE);
            try {
                Files.move(
                        SMOKE_READY_SENTINEL_TEMP,
                        SMOKE_READY_SENTINEL,
                        StandardCopyOption.ATOMIC_MOVE,
                        StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException ignored) {
                Files.move(
                        SMOKE_READY_SENTINEL_TEMP,
                        SMOKE_READY_SENTINEL,
                        StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException exception) {
            throw new IllegalStateException("Could not publish phase-0 client readiness", exception);
        }
    }
}
