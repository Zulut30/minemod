package dev.mcdev.spruceship.client;

import dev.mcdev.spruceship.SpruceShipMod;
import dev.mcdev.spruceship.client.render.SpruceMerchantShipRenderer;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.rendering.v1.EntityRendererRegistry;

public final class SpruceShipClient implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        EntityRendererRegistry.register(
                SpruceShipMod.SPRUCE_MERCHANT_SHIP,
                SpruceMerchantShipRenderer::new);
    }
}
