import type { ModSpecV1 } from "../../packages/modspec/index.ts";
import { validFabricV1Fixture } from "./validation.ts";

export function fabricBasicContentFixture(): ModSpecV1 {
  const spec = structuredClone(validFabricV1Fixture);
  spec.project.name = "Infected \"Frontier\"";
  spec.gameplay.items = [
    { id: "infectedfrontier:blue_ingot", references: [], maxStackSize: 32 },
    { id: "infectedfrontier:blue_ore_item", references: [], maxStackSize: 64 },
  ];
  spec.gameplay.blocks = [{
    id: "infectedfrontier:blue_ore",
    references: [],
    item: "infectedfrontier:blue_ore_item",
    hardness: 3.5,
  }];
  spec.gameplay.recipes = [
    {
      id: "infectedfrontier:blue_ingot_recycling",
      references: [],
      type: "shapeless",
      ingredients: ["infectedfrontier:blue_ore_item"],
      result: "infectedfrontier:blue_ingot",
    },
    {
      id: "infectedfrontier:smelt_blue_ore",
      references: [],
      type: "smelting",
      ingredients: ["infectedfrontier:blue_ore_item"],
      result: "infectedfrontier:blue_ingot",
    },
  ];
  spec.gameplay.entities = [];
  spec.gameplay.structures = [];
  spec.gameplay.screens = [];
  spec.assets.models = [];
  spec.assets.animations = [];
  spec.packaging.includeSources = false;
  return spec;
}
