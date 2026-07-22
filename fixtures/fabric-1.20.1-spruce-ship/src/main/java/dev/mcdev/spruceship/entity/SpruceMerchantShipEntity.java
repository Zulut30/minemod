package dev.mcdev.spruceship.entity;

import java.util.OptionalInt;
import net.minecraft.core.NonNullList;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.Container;
import net.minecraft.world.Containers;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.HasCustomInventoryScreen;
import net.minecraft.world.entity.SlotAccess;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.entity.vehicle.Boat;
import net.minecraft.world.entity.vehicle.ContainerEntity;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.ChestMenu;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.gameevent.GameEvent;
import net.minecraft.world.phys.AABB;

public final class SpruceMerchantShipEntity extends Boat
        implements HasCustomInventoryScreen, ContainerEntity {
    public static final int INVENTORY_SIZE = 54;

    private NonNullList<ItemStack> itemStacks =
            NonNullList.withSize(INVENTORY_SIZE, ItemStack.EMPTY);
    private ResourceLocation lootTable;
    private long lootTableSeed;

    public SpruceMerchantShipEntity(
            EntityType<? extends SpruceMerchantShipEntity> entityType,
            Level level) {
        super(entityType, level);
        setVariant(Type.SPRUCE);
    }

    public SpruceMerchantShipEntity(Level level, double x, double y, double z) {
        this(dev.mcdev.spruceship.SpruceShipMod.SPRUCE_MERCHANT_SHIP, level);
        setPos(x, y, z);
        xo = x;
        yo = y;
        zo = z;
    }

    @Override
    public double getPassengersRidingOffset() {
        return 0.82D;
    }

    @Override
    public AABB getBoundingBoxForCulling() {
        return getBoundingBox().inflate(3.0D, 4.5D, 3.0D);
    }

    @Override
    protected void addAdditionalSaveData(CompoundTag tag) {
        super.addAdditionalSaveData(tag);
        addChestVehicleSaveData(tag);
    }

    @Override
    protected void readAdditionalSaveData(CompoundTag tag) {
        super.readAdditionalSaveData(tag);
        readChestVehicleSaveData(tag);
        setVariant(Type.SPRUCE);
    }

    @Override
    public void destroy(net.minecraft.world.damagesource.DamageSource damageSource) {
        super.destroy(damageSource);
        chestVehicleDestroyed(damageSource, level(), this);
    }

    @Override
    public void remove(Entity.RemovalReason reason) {
        if (!level().isClientSide && reason.shouldDestroy()) {
            Containers.dropContents(level(), this, this);
        }
        super.remove(reason);
    }

    @Override
    public InteractionResult interact(Player player, InteractionHand hand) {
        if (!canAddPassenger(player) || player.isSecondaryUseActive()) {
            InteractionResult result = interactWithContainerVehicle(player);
            if (result.consumesAction()) {
                gameEvent(GameEvent.CONTAINER_OPEN, player);
            }
            return result;
        }
        return super.interact(player, hand);
    }

    @Override
    public void openCustomInventoryScreen(Player player) {
        OptionalInt ignored = player.openMenu(this);
        if (!player.level().isClientSide) {
            gameEvent(GameEvent.CONTAINER_OPEN, player);
        }
    }

    @Override
    public Item getDropItem() {
        return Items.SPRUCE_CHEST_BOAT;
    }

    @Override
    public int getContainerSize() {
        return INVENTORY_SIZE;
    }

    @Override
    public boolean isEmpty() {
        return isChestVehicleEmpty();
    }

    @Override
    public ItemStack getItem(int slot) {
        return getChestVehicleItem(slot);
    }

    @Override
    public ItemStack removeItem(int slot, int amount) {
        return removeChestVehicleItem(slot, amount);
    }

    @Override
    public ItemStack removeItemNoUpdate(int slot) {
        return removeChestVehicleItemNoUpdate(slot);
    }

    @Override
    public void setItem(int slot, ItemStack stack) {
        setChestVehicleItem(slot, stack);
    }

    @Override
    public SlotAccess getSlot(int slot) {
        return getChestVehicleSlot(slot);
    }

    @Override
    public void setChanged() {
        // Entity inventory changes are written with the entity NBT on save.
    }

    @Override
    public boolean stillValid(Player player) {
        return isChestVehicleStillValid(player);
    }

    @Override
    public AbstractContainerMenu createMenu(
            int syncId,
            Inventory inventory,
            Player player) {
        if (lootTable != null && player.isSpectator()) {
            return null;
        }
        unpackLootTable(inventory.player);
        return ChestMenu.sixRows(syncId, inventory, this);
    }

    public void unpackLootTable(Player player) {
        unpackChestVehicleLootTable(player);
    }

    @Override
    public ResourceLocation getLootTable() {
        return lootTable;
    }

    @Override
    public void setLootTable(ResourceLocation lootTable) {
        this.lootTable = lootTable;
    }

    @Override
    public long getLootTableSeed() {
        return lootTableSeed;
    }

    @Override
    public void setLootTableSeed(long lootTableSeed) {
        this.lootTableSeed = lootTableSeed;
    }

    @Override
    public NonNullList<ItemStack> getItemStacks() {
        return itemStacks;
    }

    @Override
    public void clearItemStacks() {
        itemStacks = NonNullList.withSize(INVENTORY_SIZE, ItemStack.EMPTY);
    }

    @Override
    public void clearContent() {
        clearChestVehicleContent();
    }

    @Override
    public void stopOpen(Player player) {
        level().gameEvent(
                GameEvent.CONTAINER_CLOSE,
                position(),
                GameEvent.Context.of(this));
    }
}
