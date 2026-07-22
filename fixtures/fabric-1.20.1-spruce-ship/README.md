# Spruce Merchant Ship

Playable Fabric 1.20.1 vertical-slice fixture for the model/gameplay generator.

## In game

- Place the ship on water with the `Spruce Merchant Ship` item.
- Right-click the ship to board it, then use the normal boat movement controls.
- Sneak and right-click to open the 54-slot cargo inventory.
- The inventory is persisted in entity NBT and dropped when the ship is destroyed.
- The renderer assembles the hull from spruce planks and stripped spruce logs, with
  three masts, wool sails and two visible cargo chests.

## Recipe

The shaped recipe uses four spruce logs, three spruce planks and two chests.

## Build and test

This fixture targets Minecraft 1.20.1, Fabric Loader 0.19.3, Fabric API
0.92.11+1.20.1 and Java 17. Run `build` and `runGametest` through the pinned
Fabric 1.20.1 Gradle wrapper. The GameTest checks entity creation, the spruce
variant, passenger control, the 54-slot inventory and cargo NBT persistence.

## Current MVP limits

Movement and water physics intentionally reuse vanilla `Boat` behavior. The
rendered ship is larger than its collision box, has no walkable deck, sail wind
simulation, anchors, cannons or multipart collision yet.
