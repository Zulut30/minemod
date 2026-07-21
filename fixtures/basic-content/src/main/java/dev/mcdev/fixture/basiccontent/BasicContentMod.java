package dev.mcdev.fixture.basiccontent;

import com.mojang.logging.LogUtils;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.function.Consumer;
import net.minecraft.core.registries.Registries;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.network.chat.Component;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.registries.DeferredRegister;
import org.slf4j.Logger;

@Mod(BasicContentMod.MOD_ID)
@EventBusSubscriber(modid = BasicContentMod.MOD_ID)
public final class BasicContentMod {
    public static final String MOD_ID = "basiccontent";
    private static final Logger LOGGER = LogUtils.getLogger();
    private static final DeferredRegister<Consumer<GameTestHelper>> TEST_FUNCTIONS =
            DeferredRegister.create(Registries.TEST_FUNCTION, MOD_ID);
    private static final String SERVER_SMOKE_NONCE_ENV = "PHASE0_SMOKE_SERVER_NONCE";
    private static final Path SERVER_SMOKE_READY_SENTINEL = Path.of(".phase0-server-ready");
    private static final Path SERVER_SMOKE_READY_SENTINEL_TEMP = Path.of(".phase0-server-ready.tmp");
    private static volatile boolean entrypointInitialized;

    static {
        TEST_FUNCTIONS.register("entrypoint_initialized", () -> BasicContentMod::verifyEntrypointInitialized);
    }

    public BasicContentMod(IEventBus modBus) {
        entrypointInitialized = true;
        TEST_FUNCTIONS.register(modBus);
        LOGGER.info("BASIC_CONTENT_FIXTURE_LOADED");
    }

    @SubscribeEvent
    public static void onServerStarted(ServerStartedEvent event) {
        String nonce = System.getenv(SERVER_SMOKE_NONCE_ENV);
        if (nonce == null) {
            return;
        }
        if (!nonce.matches("[A-Za-z0-9._-]{1,128}")) {
            throw new IllegalStateException("Invalid phase-0 dedicated-server smoke nonce");
        }

        try {
            Files.writeString(
                    SERVER_SMOKE_READY_SENTINEL_TEMP,
                    nonce + System.lineSeparator(),
                    StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE,
                    StandardOpenOption.TRUNCATE_EXISTING,
                    StandardOpenOption.WRITE);
            try {
                Files.move(
                        SERVER_SMOKE_READY_SENTINEL_TEMP,
                        SERVER_SMOKE_READY_SENTINEL,
                        StandardCopyOption.ATOMIC_MOVE,
                        StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException ignored) {
                Files.move(
                        SERVER_SMOKE_READY_SENTINEL_TEMP,
                        SERVER_SMOKE_READY_SENTINEL,
                        StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException exception) {
            throw new IllegalStateException(
                    "Could not publish phase-0 dedicated-server readiness", exception);
        }
        LOGGER.info("BASIC_CONTENT_SERVER_STARTED_READY");
        event.getServer().halt(false);
    }

    private static void verifyEntrypointInitialized(GameTestHelper helper) {
        helper.assertTrue(
                entrypointInitialized,
                Component.literal("BasicContentMod constructor did not initialize the fixture"));
        LOGGER.info("BASIC_CONTENT_ENTRYPOINT_GAMETEST_EXECUTED");
        helper.succeed();
    }
}
