package dev.mcdev.spruceship.test;

import dev.mcdev.spruceship.SpruceShipMod;
import dev.mcdev.spruceship.entity.SpruceMerchantShipEntity;
import net.fabricmc.fabric.api.gametest.v1.FabricGameTest;
import net.minecraft.gametest.framework.GameTest;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.entity.vehicle.Boat;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;

public final class SpruceShipGameTests implements FabricGameTest {
    @GameTest(template = FabricGameTest.EMPTY_STRUCTURE, timeoutTicks = 100)
    public void cargoAndPassengerStateSurviveTheRuntime(GameTestHelper helper) {
        SpruceMerchantShipEntity ship = helper.spawn(
                SpruceShipMod.SPRUCE_MERCHANT_SHIP,
                2,
                2,
                2);

        helper.assertTrue(ship instanceof Boat, "The generated ship must use boat movement physics");
        helper.assertTrue(
                ship.getVariant() == Boat.Type.SPRUCE,
                "The ship must keep the spruce boat variant");
        helper.assertTrue(
                ship.getContainerSize() == 54,
                "The ship must expose a double-chest inventory");

        ship.setItem(53, new ItemStack(Items.DIAMOND, 3));
        CompoundTag saved = ship.saveWithoutId(new CompoundTag());
        SpruceMerchantShipEntity restored = new SpruceMerchantShipEntity(
                SpruceShipMod.SPRUCE_MERCHANT_SHIP,
                helper.getLevel());
        restored.load(saved);
        helper.assertTrue(
                restored.getItem(53).is(Items.DIAMOND)
                        && restored.getItem(53).getCount() == 3,
                "Cargo in the final slot must survive an NBT round trip");

        Player passenger = helper.makeMockPlayer();
        helper.assertTrue(
                passenger.startRiding(ship),
                "A player must be able to board and control the ship");
        helper.assertTrue(
                ship.getControllingPassenger() == passenger,
                "The first passenger must become the controlling passenger");
        helper.succeed();
    }
}
