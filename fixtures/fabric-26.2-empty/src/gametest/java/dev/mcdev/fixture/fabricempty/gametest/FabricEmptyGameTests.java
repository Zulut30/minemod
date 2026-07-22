package dev.mcdev.fixture.fabricempty.gametest;

import dev.mcdev.fixture.fabricempty.FabricEmpty;
import net.fabricmc.fabric.api.gametest.v1.GameTest;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.network.chat.Component;

public final class FabricEmptyGameTests {
    @GameTest
    public void entrypointInitialized(GameTestHelper helper) {
        helper.assertTrue(
                FabricEmpty.isInitialized(),
                Component.literal("FabricEmpty entrypoint was not initialized before GameTest"));
        helper.succeed();
    }
}
