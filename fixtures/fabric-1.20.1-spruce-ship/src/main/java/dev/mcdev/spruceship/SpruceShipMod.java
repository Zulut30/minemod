package dev.mcdev.spruceship;

import dev.mcdev.spruceship.entity.SpruceMerchantShipEntity;
import dev.mcdev.spruceship.item.SpruceMerchantShipItem;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.itemgroup.v1.ItemGroupEvents;
import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.MobCategory;
import net.minecraft.world.item.CreativeModeTabs;
import net.minecraft.world.item.Item;

public final class SpruceShipMod implements ModInitializer {
    public static final String MOD_ID = "spruceship";

    public static final EntityType<SpruceMerchantShipEntity> SPRUCE_MERCHANT_SHIP =
            Registry.register(
                    BuiltInRegistries.ENTITY_TYPE,
                    id("spruce_merchant_ship"),
                    EntityType.Builder.<SpruceMerchantShipEntity>of(
                                    SpruceMerchantShipEntity::new,
                                    MobCategory.MISC)
                            .sized(3.6F, 1.35F)
                            .clientTrackingRange(12)
                            .updateInterval(3)
                            .build("spruce_merchant_ship"));

    public static final Item SPRUCE_MERCHANT_SHIP_ITEM =
            Registry.register(
                    BuiltInRegistries.ITEM,
                    id("spruce_merchant_ship"),
                    new SpruceMerchantShipItem(new Item.Properties().stacksTo(1)));

    @Override
    public void onInitialize() {
        ItemGroupEvents.modifyEntriesEvent(CreativeModeTabs.TOOLS_AND_UTILITIES)
                .register(entries -> entries.accept(SPRUCE_MERCHANT_SHIP_ITEM));
    }

    public static ResourceLocation id(String path) {
        return new ResourceLocation(MOD_ID, path);
    }
}
