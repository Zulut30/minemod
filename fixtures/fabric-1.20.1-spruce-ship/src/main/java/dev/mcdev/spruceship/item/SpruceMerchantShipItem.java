package dev.mcdev.spruceship.item;

import dev.mcdev.spruceship.entity.SpruceMerchantShipEntity;
import java.util.List;
import net.minecraft.network.chat.Component;
import net.minecraft.stats.Stats;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResultHolder;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.TooltipFlag;
import net.minecraft.world.level.ClipContext;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.gameevent.GameEvent;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.HitResult;

public final class SpruceMerchantShipItem extends Item {
    public SpruceMerchantShipItem(Properties properties) {
        super(properties);
    }

    @Override
    public InteractionResultHolder<ItemStack> use(
            Level level,
            Player player,
            InteractionHand hand) {
        ItemStack stack = player.getItemInHand(hand);
        BlockHitResult hit = getPlayerPOVHitResult(level, player, ClipContext.Fluid.ANY);
        if (hit.getType() == HitResult.Type.MISS) {
            return InteractionResultHolder.pass(stack);
        }

        SpruceMerchantShipEntity ship = new SpruceMerchantShipEntity(
                level,
                hit.getLocation().x,
                hit.getLocation().y,
                hit.getLocation().z);
        ship.setYRot(player.getYRot());

        if (!level.noCollision(ship, ship.getBoundingBox())) {
            return InteractionResultHolder.fail(stack);
        }

        if (!level.isClientSide) {
            level.addFreshEntity(ship);
            level.gameEvent(player, GameEvent.ENTITY_PLACE, hit.getLocation());
            if (!player.getAbilities().instabuild) {
                stack.shrink(1);
            }
        }

        player.awardStat(Stats.ITEM_USED.get(this));
        return InteractionResultHolder.sidedSuccess(stack, level.isClientSide());
    }

    @Override
    public void appendHoverText(
            ItemStack stack,
            Level level,
            List<Component> lines,
            TooltipFlag flag) {
        lines.add(Component.translatable("item.spruceship.spruce_merchant_ship.hint"));
    }
}
