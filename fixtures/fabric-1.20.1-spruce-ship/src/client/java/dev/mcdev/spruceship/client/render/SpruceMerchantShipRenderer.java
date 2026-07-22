package dev.mcdev.spruceship.client.render;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.math.Axis;
import dev.mcdev.spruceship.entity.SpruceMerchantShipEntity;
import java.util.List;
import net.minecraft.client.renderer.MultiBufferSource;
import net.minecraft.client.renderer.block.BlockRenderDispatcher;
import net.minecraft.client.renderer.entity.EntityRenderer;
import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.client.renderer.texture.OverlayTexture;
import net.minecraft.client.renderer.texture.TextureAtlas;
import net.minecraft.core.Direction;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.util.Mth;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.RotatedPillarBlock;
import net.minecraft.world.level.block.state.BlockState;
import org.joml.Quaternionf;

public final class SpruceMerchantShipRenderer
        extends EntityRenderer<SpruceMerchantShipEntity> {
    private static final BlockState PLANKS = Blocks.SPRUCE_PLANKS.defaultBlockState();
    private static final BlockState DARK_PLANKS = Blocks.DARK_OAK_PLANKS.defaultBlockState();
    private static final BlockState SAIL = Blocks.WHITE_WOOL.defaultBlockState();
    private static final BlockState GOLD = Blocks.GOLD_BLOCK.defaultBlockState();
    private static final BlockState LOG_X = log(Direction.Axis.X);
    private static final BlockState LOG_Y = log(Direction.Axis.Y);
    private static final BlockState LOG_Z = log(Direction.Axis.Z);

    private static final List<ShipPart> PARTS = List.of(
            // Keel and stepped hull.
            part(LOG_Z, 0.0F, -0.20F, 0.15F, 0.75F, 0.55F, 7.7F),
            part(DARK_PLANKS, 0.0F, 0.05F, 0.10F, 1.55F, 0.65F, 7.45F),
            part(PLANKS, 0.0F, 0.35F, 0.10F, 2.65F, 0.90F, 7.10F),
            part(PLANKS, -1.48F, 0.72F, 0.15F, 0.48F, 1.15F, 6.55F),
            part(PLANKS, 1.48F, 0.72F, 0.15F, 0.48F, 1.15F, 6.55F),
            part(DARK_PLANKS, -1.70F, 0.48F, 0.15F, 0.18F, 0.38F, 6.75F),
            part(DARK_PLANKS, 1.70F, 0.48F, 0.15F, 0.18F, 0.38F, 6.75F),

            // Bow and stern taper.
            part(PLANKS, 0.0F, 0.55F, -3.70F, 2.15F, 1.05F, 0.75F),
            part(LOG_Z, 0.0F, 0.95F, -4.20F, 0.48F, 0.48F, 1.60F),
            part(GOLD, 0.0F, 1.00F, -4.98F, 0.58F, 0.58F, 0.36F),
            part(PLANKS, 0.0F, 0.70F, 3.72F, 2.45F, 1.20F, 0.80F),
            part(DARK_PLANKS, 0.0F, 1.55F, 3.78F, 2.75F, 0.24F, 0.88F),
            part(DARK_PLANKS, 0.0F, -0.05F, 4.00F, 0.26F, 1.20F, 0.35F),

            // Deck, gunwales and cross beams.
            part(PLANKS, 0.0F, 1.30F, 0.20F, 3.18F, 0.22F, 6.25F),
            part(LOG_Z, -1.72F, 1.50F, 0.15F, 0.28F, 0.28F, 6.75F),
            part(LOG_Z, 1.72F, 1.50F, 0.15F, 0.28F, 0.28F, 6.75F),
            part(LOG_X, 0.0F, 1.42F, -2.55F, 3.55F, 0.22F, 0.28F),
            part(LOG_X, 0.0F, 1.42F, 0.20F, 3.55F, 0.22F, 0.28F),
            part(LOG_X, 0.0F, 1.42F, 2.85F, 3.55F, 0.22F, 0.28F),

            // Fore mast, yards and two sails.
            part(LOG_Y, 0.0F, 1.45F, -1.82F, 0.34F, 4.55F, 0.34F),
            part(LOG_X, 0.0F, 3.20F, -1.82F, 3.60F, 0.24F, 0.24F),
            part(SAIL, 0.0F, 3.30F, -1.82F, 3.05F, 1.35F, 0.12F),
            part(LOG_X, 0.0F, 4.73F, -1.82F, 2.80F, 0.22F, 0.22F),
            part(SAIL, 0.0F, 4.82F, -1.82F, 2.25F, 0.92F, 0.12F),

            // Main mast and larger sails.
            part(LOG_Y, 0.0F, 1.45F, 0.78F, 0.38F, 5.35F, 0.38F),
            part(LOG_X, 0.0F, 3.40F, 0.78F, 4.15F, 0.26F, 0.26F),
            part(SAIL, 0.0F, 3.52F, 0.78F, 3.55F, 1.55F, 0.14F),
            part(LOG_X, 0.0F, 5.12F, 0.78F, 3.35F, 0.24F, 0.24F),
            part(SAIL, 0.0F, 5.23F, 0.78F, 2.80F, 1.05F, 0.14F),
            part(LOG_X, 0.0F, 6.36F, 0.78F, 2.25F, 0.20F, 0.20F),

            // Short mizzen mast over the cargo deck.
            part(LOG_Y, 0.0F, 1.45F, 2.82F, 0.30F, 3.55F, 0.30F),
            part(LOG_X, 0.0F, 3.02F, 2.82F, 2.65F, 0.22F, 0.22F),
            part(SAIL, 0.0F, 3.12F, 2.82F, 2.12F, 1.02F, 0.12F),

            // Two visible cargo chests assembled from blocks.
            chestBase(-0.72F, 1.53F, 2.18F),
            chestBand(-0.72F, 1.93F, 2.18F),
            chestLatch(-0.72F, 1.78F, 1.69F),
            chestBase(0.72F, 1.53F, 2.18F),
            chestBand(0.72F, 1.93F, 2.18F),
            chestLatch(0.72F, 1.78F, 1.69F));

    private final BlockRenderDispatcher blocks;

    public SpruceMerchantShipRenderer(EntityRendererProvider.Context context) {
        super(context);
        blocks = context.getBlockRenderDispatcher();
        shadowRadius = 1.9F;
    }

    @Override
    public void render(
            SpruceMerchantShipEntity ship,
            float entityYaw,
            float partialTick,
            PoseStack poseStack,
            MultiBufferSource buffers,
            int packedLight) {
        poseStack.pushPose();
        poseStack.translate(0.0F, 0.22F, 0.0F);
        poseStack.mulPose(Axis.YP.rotationDegrees(180.0F - entityYaw));

        float hurtTime = ship.getHurtTime() - partialTick;
        float damage = Math.max(ship.getDamage() - partialTick, 0.0F);
        if (hurtTime > 0.0F) {
            poseStack.mulPose(Axis.XP.rotationDegrees(
                    Mth.sin(hurtTime) * hurtTime * damage / 10.0F * ship.getHurtDir()));
        }

        float bubbleAngle = ship.getBubbleAngle(partialTick);
        if (!Mth.equal(bubbleAngle, 0.0F)) {
            poseStack.mulPose(new Quaternionf().setAngleAxis(
                    bubbleAngle * Mth.DEG_TO_RAD,
                    1.0F,
                    0.0F,
                    1.0F));
        }

        for (ShipPart part : PARTS) {
            renderPart(part, poseStack, buffers, packedLight);
        }

        poseStack.popPose();
        super.render(ship, entityYaw, partialTick, poseStack, buffers, packedLight);
    }

    @Override
    public ResourceLocation getTextureLocation(SpruceMerchantShipEntity ship) {
        return TextureAtlas.LOCATION_BLOCKS;
    }

    private void renderPart(
            ShipPart part,
            PoseStack poseStack,
            MultiBufferSource buffers,
            int packedLight) {
        poseStack.pushPose();
        poseStack.translate(
                part.x() - part.width() / 2.0F,
                part.y(),
                part.z() - part.depth() / 2.0F);
        poseStack.scale(part.width(), part.height(), part.depth());
        blocks.renderSingleBlock(
                part.state(),
                poseStack,
                buffers,
                packedLight,
                OverlayTexture.NO_OVERLAY);
        poseStack.popPose();
    }

    private static BlockState log(Direction.Axis axis) {
        return Blocks.STRIPPED_SPRUCE_LOG.defaultBlockState()
                .setValue(RotatedPillarBlock.AXIS, axis);
    }

    private static ShipPart part(
            BlockState state,
            float x,
            float y,
            float z,
            float width,
            float height,
            float depth) {
        return new ShipPart(state, x, y, z, width, height, depth);
    }

    private static ShipPart chestBase(float x, float y, float z) {
        return part(PLANKS, x, y, z, 1.12F, 0.72F, 0.90F);
    }

    private static ShipPart chestBand(float x, float y, float z) {
        return part(DARK_PLANKS, x, y, z, 1.18F, 0.14F, 0.94F);
    }

    private static ShipPart chestLatch(float x, float y, float z) {
        return part(GOLD, x, y, z, 0.20F, 0.24F, 0.10F);
    }

    private record ShipPart(
            BlockState state,
            float x,
            float y,
            float z,
            float width,
            float height,
            float depth) {}
}
