import { types as utilTypes } from "node:util";
import type { CompatibilityPackTarget, CompatibilitySelector } from "@mcdev/contracts";

export const BUILTIN_NEOFORGE_26_1_2_SELECTOR: CompatibilitySelector = Object.freeze({
  minecraft: "26.1.2",
  loader: "neoforge",
  java: 25,
});

export interface BuiltinCompatibilityPackRegistration {
  readonly selector: CompatibilitySelector;
  readonly target: CompatibilityPackTarget;
  readonly packId: "neoforge-26.1.2-java-25";
  readonly revision: 1;
  readonly treeEntries: 16;
  readonly treeSha256: string;
  readonly trust: "builtin-reviewed";
  readonly releaseStatus: "candidate";
}

export const BUILTIN_NEOFORGE_26_1_2: BuiltinCompatibilityPackRegistration = Object.freeze({
  selector: BUILTIN_NEOFORGE_26_1_2_SELECTOR,
  target: Object.freeze({
    ...BUILTIN_NEOFORGE_26_1_2_SELECTOR,
    neoForge: "26.1.2.80",
  }),
  packId: "neoforge-26.1.2-java-25",
  revision: 1,
  treeEntries: 16,
  treeSha256: "298ed68a800ccdb108fcf9d18159e9aedde0717f8b878b4eac7c0d1cb86cb3fb",
  trust: "builtin-reviewed",
  releaseStatus: "candidate",
});

function isExactSelector(value: unknown): value is CompatibilitySelector {
  if (typeof value !== "object" || value === null || utilTypes.isProxy(value) || Array.isArray(value)) return false;
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== 3 || !["java", "loader", "minecraft"].every((key) => keys.includes(key))) return false;
    const minecraft = descriptors.minecraft;
    const loader = descriptors.loader;
    const java = descriptors.java;
    if (minecraft === undefined || loader === undefined || java === undefined ||
      !minecraft.enumerable || !loader.enumerable || !java.enumerable ||
      !Object.hasOwn(minecraft, "value") || !Object.hasOwn(loader, "value") || !Object.hasOwn(java, "value")) {
      return false;
    }
    return minecraft.value === BUILTIN_NEOFORGE_26_1_2_SELECTOR.minecraft &&
      loader.value === BUILTIN_NEOFORGE_26_1_2_SELECTOR.loader &&
      java.value === BUILTIN_NEOFORGE_26_1_2_SELECTOR.java;
  } catch {
    return false;
  }
}

export function selectBuiltinCompatibilityPack(
  selector: unknown,
): BuiltinCompatibilityPackRegistration | undefined {
  return isExactSelector(selector) ? BUILTIN_NEOFORGE_26_1_2 : undefined;
}
