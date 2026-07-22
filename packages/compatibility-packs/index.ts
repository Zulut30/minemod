export {
  BUILTIN_FABRIC_1_20_1,
  BUILTIN_FABRIC_1_20_1_SELECTOR,
  BUILTIN_FABRIC_26_2,
  BUILTIN_FABRIC_26_2_SELECTOR,
  BUILTIN_NEOFORGE_26_1_2,
  BUILTIN_NEOFORGE_26_1_2_SELECTOR,
  selectBuiltinCompatibilityPack,
  type BuiltinCompatibilityPackRegistration,
} from "./src/builtin-registry.ts";
export { BuiltinPackIntegrityError, type BuiltinPackErrorCode } from "./src/errors.ts";
export { loadBuiltinCompatibilityPack } from "./src/load-builtin.ts";
export type { VerifiedCompatibilityPack } from "./src/snapshot.ts";
