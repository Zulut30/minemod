package dev.mcdev.spruceship;

import dev.mcdev.spruceship.entity.SpruceMerchantShipEntity;
import net.fabricmc.api.ModInitializer;
import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.MobCategory;

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

    @Override
    public void onInitialize() {
        // Loading this class registers the entity type. Gameplay content is added in later slices.
    }

    public static ResourceLocation id(String path) {
        return new ResourceLocation(MOD_ID, path);
    }
}
