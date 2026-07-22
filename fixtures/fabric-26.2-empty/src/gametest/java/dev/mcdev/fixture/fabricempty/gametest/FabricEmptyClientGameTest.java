package dev.mcdev.fixture.fabricempty.gametest;

import dev.mcdev.fixture.fabricempty.client.FabricEmptyClient;
import net.fabricmc.fabric.api.client.gametest.v1.FabricClientGameTest;
import net.fabricmc.fabric.api.client.gametest.v1.context.ClientGameTestContext;
import net.minecraft.client.gui.screens.TitleScreen;

public final class FabricEmptyClientGameTest implements FabricClientGameTest {
    @Override
    public void runTest(ClientGameTestContext context) {
        context.waitForScreen(TitleScreen.class);
        context.runOnClient(client -> {
            if (!FabricEmptyClient.isInitialized()) {
                throw new AssertionError("FabricEmptyClient entrypoint was not initialized before client GameTest");
            }
        });
        context.takeScreenshot("fabricempty-title-screen");
    }
}
