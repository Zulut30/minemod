package dev.mcdev.fixture.fabriclegacy;

import net.fabricmc.fabric.api.gametest.v1.FabricGameTest;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.gametest.framework.GameTest;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.StairBlock;

/** Проверки harness; приёмка generated gameplay требует отдельного набора. */
public final class FabricLegacyGameTests implements FabricGameTest {
    @GameTest(template = FabricGameTest.EMPTY_STRUCTURE)
    public void fixtureLoadedOnPinnedServer(GameTestHelper helper) {
        helper.assertTrue(
                FabricLoader.getInstance().isModLoaded(FabricLegacy.MOD_ID),
                "Production fixture must be loaded");
        helper.assertTrue(
                helper.getLevel().getServer().getServerVersion().equals("1.20.1"),
                "GameTest must run on Minecraft 1.20.1");
        helper.succeed();
    }

    @GameTest(template = FabricGameTest.EMPTY_STRUCTURE)
    public void directionalBlockStateSurvivesTick(GameTestHelper helper) {
        BlockPos position = new BlockPos(2, 1, 2);
        helper.setBlock(position, Blocks.OAK_STAIRS.defaultBlockState()
                .setValue(StairBlock.FACING, Direction.EAST));
        helper.runAfterDelay(2, () -> {
            helper.assertBlockPresent(Blocks.OAK_STAIRS, position);
            helper.assertTrue(
                    helper.getBlockState(position).getValue(StairBlock.FACING) == Direction.EAST,
                    "Placed directional state must survive server ticks");
            helper.succeed();
        });
    }
}
