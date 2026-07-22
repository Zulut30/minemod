import { types as utilTypes } from "node:util";
import type {
  CompatibilityPackTarget,
  CompatibilityPackTargetV2,
  CompatibilityPackTargetV3,
  CompatibilitySelector,
  CompatibilitySelectorV2,
  CompatibilitySelectorV3,
  FabricCompatibilityPackTargetV3,
  FabricCompatibilitySelectorV3,
  FabricCompatibilityPackTargetV2,
  FabricCompatibilitySelectorV2,
} from "@mcdev/contracts";

export const BUILTIN_NEOFORGE_26_1_2_SELECTOR: CompatibilitySelector = Object.freeze({
  minecraft: "26.1.2",
  loader: "neoforge",
  java: 25,
});

export const BUILTIN_FABRIC_26_2_SELECTOR: FabricCompatibilitySelectorV2 = Object.freeze({
  minecraft: "26.2",
  loader: "fabric",
  java: 25,
});

export const BUILTIN_FABRIC_1_20_1_SELECTOR: FabricCompatibilitySelectorV3 = Object.freeze({
  minecraft: "1.20.1",
  loader: "fabric",
  java: 17,
});

export interface BuiltinCompatibilityPackRegistration<
  Selector extends CompatibilitySelector | CompatibilitySelectorV2 | CompatibilitySelectorV3 =
    CompatibilitySelector | CompatibilitySelectorV2 | CompatibilitySelectorV3,
  Target extends CompatibilityPackTarget | CompatibilityPackTargetV2 | CompatibilityPackTargetV3 =
    CompatibilityPackTarget | CompatibilityPackTargetV2 | CompatibilityPackTargetV3,
  PackId extends "fabric-1.20.1-java-17" | "fabric-26.2-java-25" | "neoforge-26.1.2-java-25" =
    "fabric-1.20.1-java-17" | "fabric-26.2-java-25" | "neoforge-26.1.2-java-25",
> {
  readonly selector: Selector;
  readonly target: Target;
  readonly packId: PackId;
  readonly revision: 1;
  readonly treeEntries: 15 | 16;
  readonly treeSha256: string;
  readonly trust: "builtin-reviewed";
  readonly releaseStatus: "candidate";
}

export const BUILTIN_NEOFORGE_26_1_2: BuiltinCompatibilityPackRegistration<
  CompatibilitySelector,
  CompatibilityPackTarget,
  "neoforge-26.1.2-java-25"
> = Object.freeze({
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

export const BUILTIN_FABRIC_26_2: BuiltinCompatibilityPackRegistration<
  FabricCompatibilitySelectorV2,
  FabricCompatibilityPackTargetV2,
  "fabric-26.2-java-25"
> = Object.freeze({
  selector: BUILTIN_FABRIC_26_2_SELECTOR,
  target: Object.freeze({
    ...BUILTIN_FABRIC_26_2_SELECTOR,
    fabricLoader: "0.19.3",
  }),
  packId: "fabric-26.2-java-25",
  revision: 1,
  treeEntries: 15,
  treeSha256: "a734a1c56878bb62f08928e008d2e3a59fa7ecdfa6afe125526a3e53a2a48c52",
  trust: "builtin-reviewed",
  releaseStatus: "candidate",
});

export const BUILTIN_FABRIC_1_20_1: BuiltinCompatibilityPackRegistration<
  FabricCompatibilitySelectorV3,
  FabricCompatibilityPackTargetV3,
  "fabric-1.20.1-java-17"
> = Object.freeze({
  selector: BUILTIN_FABRIC_1_20_1_SELECTOR,
  target: Object.freeze({
    ...BUILTIN_FABRIC_1_20_1_SELECTOR,
    fabricLoader: "0.19.3",
  }),
  packId: "fabric-1.20.1-java-17",
  revision: 1,
  treeEntries: 15,
  treeSha256: "312f9a8d39a5fc50e4889ea42f14ef61fc0d91793319866e4d3e3e36b97f1deb",
  trust: "builtin-reviewed",
  releaseStatus: "candidate",
});

const BUILTIN_PACKS = Object.freeze([
  BUILTIN_FABRIC_1_20_1,
  BUILTIN_FABRIC_26_2,
  BUILTIN_NEOFORGE_26_1_2,
]);

export type RegisteredBuiltinCompatibilityPack =
  | typeof BUILTIN_FABRIC_1_20_1
  | typeof BUILTIN_FABRIC_26_2
  | typeof BUILTIN_NEOFORGE_26_1_2;

function copyExactSelector(
  value: unknown,
): CompatibilitySelector | CompatibilitySelectorV2 | CompatibilitySelectorV3 | undefined {
  if (typeof value !== "object" || value === null || utilTypes.isProxy(value) || Array.isArray(value)) return undefined;
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== 3 || !["java", "loader", "minecraft"].every((key) => keys.includes(key))) return undefined;
    const minecraft = descriptors.minecraft;
    const loader = descriptors.loader;
    const java = descriptors.java;
    if (minecraft === undefined || loader === undefined || java === undefined ||
      !minecraft.enumerable || !loader.enumerable || !java.enumerable ||
      !Object.hasOwn(minecraft, "value") || !Object.hasOwn(loader, "value") || !Object.hasOwn(java, "value")) {
      return undefined;
    }
    if (typeof minecraft.value !== "string" || minecraft.value.length < 1 || minecraft.value.length > 32 ||
      !((java.value === 25 && (loader.value === "fabric" || loader.value === "neoforge")) ||
        (java.value === 17 && loader.value === "fabric"))) return undefined;
    return Object.freeze({
      minecraft: minecraft.value,
      loader: loader.value,
      java: java.value,
    });
  } catch {
    return undefined;
  }
}

export function selectBuiltinCompatibilityPack(
  selector: unknown,
): RegisteredBuiltinCompatibilityPack | undefined {
  const copied = copyExactSelector(selector);
  if (copied === undefined) return undefined;
  return BUILTIN_PACKS.find((registration) =>
    registration.selector.minecraft === copied.minecraft &&
    registration.selector.loader === copied.loader && registration.selector.java === copied.java);
}
