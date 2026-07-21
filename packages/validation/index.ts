import { isProxy } from "node:util/types";
import {
  ArtSpecSchema,
  ModSpecSchema,
  SPEC_COLLECTION_LIMITS,
  type Spec,
} from "@mcdev/modspec";

export const MAX_INLINE_SPEC_BYTES = 262_144;
export const MAX_DIAGNOSTICS = 100;
// These limits are deliberately above every valid v0 schema cardinality while
// remaining low enough that malformed JSON cannot make Zod allocate an
// attacker-controlled number of issues. They apply to every container,
// including containers hidden below unknown properties.
export const MAX_SPEC_ARRAY_ITEMS = 256;
export const MAX_SPEC_OBJECT_KEYS = 64;
export const MAX_SPEC_NESTING_DEPTH = 16;
export const MAX_SPEC_TOTAL_NODES = 16_384;
export const MAX_SPEC_TOTAL_OBJECT_KEYS = 8_192;
export const MAX_SPEC_KEY_CHARS = 256;
export const MAX_SPEC_TOTAL_KEY_CHARS = 131_072;

export type SpecKind = "auto" | "mod" | "art";
export const VALIDATION_PROFILE_IDS = ["neoforge-26.1.2-java-25"] as const;
export type ValidationProfile = typeof VALIDATION_PROFILE_IDS[number];
export interface ValidationOptions {
  readonly profile?: ValidationProfile;
}
export type DiagnosticCode =
  | "PAYLOAD_TOO_LARGE"
  | "INVALID_JSON"
  | "NON_JSON_VALUE"
  | "STRUCTURE_LIMIT_EXCEEDED"
  | "SCHEMA_INVALID"
  | "KIND_MISMATCH"
  | "DUPLICATE_RESOURCE_LOCATION"
  | "DUPLICATE_DEPENDENCY"
  | "DUPLICATE_ASSET_PATH"
  | "BROKEN_REFERENCE"
  | "INCOMPATIBLE_TARGET"
  | "MISSING_LICENSE"
  | "MISSING_PROVENANCE"
  | "SEMANTIC_INVALID"
  | "BUDGET_OVERFLOW";

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly path: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly kind?: "mod" | "art";
  readonly diagnostics: readonly Diagnostic[];
  readonly value?: Spec;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pointer(path: readonly PropertyKey[]): string {
  if (path.length === 0) return "";
  return `/${path.map((part) => String(part).replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}`;
}

function push(diagnostics: Diagnostic[], diagnostic: Diagnostic): void {
  if (diagnostics.length < MAX_DIAGNOSTICS) diagnostics.push(diagnostic);
}

type JsonContainer = JsonObject | unknown[];

interface PendingNode {
  readonly type: "node";
  readonly source: unknown;
  readonly path: readonly PropertyKey[];
  readonly depth: number;
  readonly parent: JsonContainer | undefined;
  readonly key: string | number | undefined;
}

interface PendingExit {
  readonly type: "exit";
  readonly source: object;
}

type PendingEntry = PendingNode | PendingExit;

type StructuralPreflightResult =
  | { readonly valid: true; readonly value: unknown }
  | { readonly valid: false; readonly diagnostic: Diagnostic };

function structureLimit(path: readonly PropertyKey[], message: string): Diagnostic {
  return {
    code: "STRUCTURE_LIMIT_EXCEEDED",
    path: pointer(path),
    message,
  };
}

function nonJsonValue(path: readonly PropertyKey[], message: string): Diagnostic {
  return {
    code: "NON_JSON_VALUE",
    path: pointer(path),
    message,
  };
}

function rejected(diagnostic: Diagnostic): StructuralPreflightResult {
  return { valid: false, diagnostic };
}

interface StructuralKeyBudget {
  totalChars: number;
}

function accountEnumerableOwnKey(
  key: string,
  path: readonly PropertyKey[],
  budget: StructuralKeyBudget,
): Diagnostic | undefined {
  if (key.length > MAX_SPEC_KEY_CHARS) {
    return structureLimit(
      path,
      `Enumerable own key length exceeds ${MAX_SPEC_KEY_CHARS} UTF-16 code units.`,
    );
  }
  budget.totalChars += key.length;
  if (budget.totalChars > MAX_SPEC_TOTAL_KEY_CHARS) {
    return structureLimit(
      path,
      `Spec contains more than ${MAX_SPEC_TOTAL_KEY_CHARS} enumerable own key UTF-16 code units.`,
    );
  }
  return undefined;
}

function assignNormalized(
  parent: JsonContainer | undefined,
  key: string | number | undefined,
  value: unknown,
  setRoot: (root: unknown) => void,
): void {
  if (parent === undefined) {
    setRoot(value);
  } else if (Array.isArray(parent) && typeof key === "number") {
    parent[key] = value;
  } else if (!Array.isArray(parent) && typeof key === "string") {
    parent[key] = value;
  } else {
    throw new Error("Structural preflight normalization invariant failed.");
  }
}

function knownArrayItemLimit(path: readonly PropertyKey[]): number | undefined {
  const location = pointer(path);
  switch (location) {
    case "/project/provenance":
      return SPEC_COLLECTION_LIMITS.projectProvenance;
    case "/gameplay/items":
      return SPEC_COLLECTION_LIMITS.gameplayItems;
    case "/gameplay/blocks":
      return SPEC_COLLECTION_LIMITS.gameplayBlocks;
    case "/gameplay/entities":
      return SPEC_COLLECTION_LIMITS.gameplayEntities;
    case "/gameplay/recipes":
      return SPEC_COLLECTION_LIMITS.gameplayRecipes;
    case "/gameplay/summoning":
      return SPEC_COLLECTION_LIMITS.gameplaySummoning;
    case "/gameplay/screens":
      return SPEC_COLLECTION_LIMITS.gameplayScreens;
    case "/assets/models":
      return SPEC_COLLECTION_LIMITS.assetModels;
    case "/assets/textures":
      return SPEC_COLLECTION_LIMITS.assetTextures;
    case "/assets/animations":
      return SPEC_COLLECTION_LIMITS.assetAnimations;
    case "/assets":
      return SPEC_COLLECTION_LIMITS.artAssets;
    case "/tests/gameTests":
      return SPEC_COLLECTION_LIMITS.gameTests;
    case "/targetContexts":
      return SPEC_COLLECTION_LIMITS.targetContexts;
    case "/targetMatrix":
      return SPEC_COLLECTION_LIMITS.targetMatrix;
    case "/dependencies/required":
    case "/dependencies/optional":
    case "/style/palette":
      return location === "/style/palette"
        ? SPEC_COLLECTION_LIMITS.palette
        : location === "/dependencies/required"
          ? SPEC_COLLECTION_LIMITS.requiredDependencies
          : SPEC_COLLECTION_LIMITS.optionalDependencies;
    case "/style/hueValueHierarchy/shadows":
    case "/style/hueValueHierarchy/midtones":
    case "/style/hueValueHierarchy/highlights":
      return SPEC_COLLECTION_LIMITS.hueValueColors;
    case "/style/materialRecipes":
      return SPEC_COLLECTION_LIMITS.materialRecipes;
    case "/style/forbiddenReferences":
      return SPEC_COLLECTION_LIMITS.forbiddenReferences;
    case "/references":
      return SPEC_COLLECTION_LIMITS.artReferences;
    case "/provenancePolicy/allowedSourceKinds":
      return SPEC_COLLECTION_LIMITS.allowedSourceKinds;
    default:
      if (/^\/gameplay\/(?:items|blocks|entities|recipes|summoning|screens)\/\d+\/(?:references|ingredients)$/u.test(location)) {
        return SPEC_COLLECTION_LIMITS.resourceReferences;
      }
      if (/^\/tests\/gameTests\/\d+\/references$/u.test(location)) {
        return SPEC_COLLECTION_LIMITS.resourceReferences;
      }
      if (/^\/assets(?:\/(?:models|textures|animations))?\/\d+\/provenance$/u.test(location)) {
        return SPEC_COLLECTION_LIMITS.assetProvenance;
      }
      return undefined;
  }
}

/**
 * Bounds the parsed JSON graph before semantic scans or Zod issue creation.
 * Traversal is iterative and ordered by array index / sorted bounded object key
 * so both the work and the first reported RFC 6901 pointer are deterministic.
 * Enumerable own string keys are counted and character-bounded with `for..in`
 * before any key array or sort. The first inherited enumerable candidate is
 * rejected, so polluted standard prototypes cannot create an unbounded scan.
 * Non-enumerable and symbol keys are outside the JSON data model and deliberately
 * ignored: only inspected own data descriptors are copied into the detached graph.
 */
function structuralPreflight(value: unknown): StructuralPreflightResult {
  const pending: PendingEntry[] = [{
    type: "node",
    source: value,
    path: [],
    depth: 0,
    parent: undefined,
    key: undefined,
  }];
  const activeContainers = new WeakSet<object>();
  let normalizedValue: unknown;
  let totalNodes = 0;
  let totalObjectKeys = 0;
  const keyBudget: StructuralKeyBudget = { totalChars: 0 };

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    if (current.type === "exit") {
      activeContainers.delete(current.source);
      continue;
    }

    totalNodes += 1;
    if (totalNodes > MAX_SPEC_TOTAL_NODES) {
      return rejected(structureLimit(
        current.path,
        `Spec contains more than ${MAX_SPEC_TOTAL_NODES} JSON nodes.`,
      ));
    }
    if (current.depth > MAX_SPEC_NESTING_DEPTH) {
      return rejected(structureLimit(
        current.path,
        `JSON nesting depth exceeds ${MAX_SPEC_NESTING_DEPTH}.`,
      ));
    }

    const sourceType = typeof current.source;
    if (
      current.source === null ||
      sourceType === "string" ||
      sourceType === "boolean"
    ) {
      assignNormalized(current.parent, current.key, current.source, (root) => {
        normalizedValue = root;
      });
      continue;
    }
    if (sourceType === "number") {
      if (!Number.isFinite(current.source)) {
        return rejected(nonJsonValue(current.path, "JSON numbers must be finite."));
      }
      assignNormalized(current.parent, current.key, current.source, (root) => {
        normalizedValue = root;
      });
      continue;
    }
    if (sourceType !== "object") {
      return rejected(nonJsonValue(
        current.path,
        `Values of type ${sourceType} are not valid JSON data.`,
      ));
    }

    const source = current.source as object;
    if (isProxy(source)) {
      return rejected(nonJsonValue(current.path, "Proxy values are not accepted as JSON data."));
    }
    if (activeContainers.has(source)) {
      return rejected(nonJsonValue(current.path, "Cyclic references are not valid JSON data."));
    }

    if (Array.isArray(source)) {
      if (Object.getPrototypeOf(source) !== Array.prototype) {
        return rejected(nonJsonValue(current.path, "Array prototype is not plain JSON data."));
      }
      const lengthDescriptor = Object.getOwnPropertyDescriptor(source, "length");
      if (lengthDescriptor === undefined || !("value" in lengthDescriptor)) {
        return rejected(nonJsonValue(current.path, "Array length must be an own data property."));
      }
      const length = lengthDescriptor.value as number;
      const itemLimit = knownArrayItemLimit(current.path) ?? MAX_SPEC_ARRAY_ITEMS;
      if (length > itemLimit) {
        return rejected(structureLimit(
          current.path,
          `Array contains ${length} items; maximum structural limit is ${itemLimit}.`,
        ));
      }

      const childValues: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(source, String(index));
        if (descriptor === undefined) {
          return rejected(nonJsonValue(
            [...current.path, index],
            "Sparse arrays are not valid JSON data.",
          ));
        }
        if (!("value" in descriptor)) {
          return rejected(nonJsonValue(
            [...current.path, index],
            "Accessor properties are not valid JSON data.",
          ));
        }
        if (descriptor.enumerable !== true) {
          return rejected(nonJsonValue(
            [...current.path, index],
            "Array elements must be enumerable own data properties.",
          ));
        }
        childValues.push(descriptor.value);
      }

      // Array length and index descriptor reads are bounded. Reject the first
      // enumerable named extra without collecting or sorting its whole key set.
      // Hidden/symbol extras do not participate in the detached JSON view.
      for (const key in source) {
        if (!Object.hasOwn(source, key)) {
          return rejected(nonJsonValue(
            current.path,
            "Enumerable inherited properties are not accepted as JSON data.",
          ));
        }
        const keyDiagnostic = accountEnumerableOwnKey(key, current.path, keyBudget);
        if (keyDiagnostic !== undefined) return rejected(keyDiagnostic);
        const index = Number(key);
        if (!Number.isInteger(index) || index < 0 || index >= length || String(index) !== key) {
          return rejected(nonJsonValue(current.path, "Array contains a non-index own property."));
        }
      }

      const normalizedArray = new Array<unknown>(length);
      assignNormalized(current.parent, current.key, normalizedArray, (root) => {
        normalizedValue = root;
      });
      activeContainers.add(source);
      pending.push({ type: "exit", source });
      for (let index = length - 1; index >= 0; index -= 1) {
        pending.push({
          type: "node",
          source: childValues[index],
          path: [...current.path, index],
          depth: current.depth + 1,
          parent: normalizedArray,
          key: index,
        });
      }
      continue;
    }

    const prototype = Object.getPrototypeOf(source);
    if (prototype !== Object.prototype && prototype !== null) {
      return rejected(nonJsonValue(current.path, "Object prototype is not plain JSON data."));
    }
    const keys: string[] = [];
    for (const key in source) {
      if (!Object.hasOwn(source, key)) {
        return rejected(nonJsonValue(
          current.path,
          "Enumerable inherited properties are not accepted as JSON data.",
        ));
      }
      const keyDiagnostic = accountEnumerableOwnKey(key, current.path, keyBudget);
      if (keyDiagnostic !== undefined) return rejected(keyDiagnostic);
      if (keys.length === MAX_SPEC_OBJECT_KEYS) {
        return rejected(structureLimit(
          current.path,
          `Object contains more than ${MAX_SPEC_OBJECT_KEYS} enumerable own string keys.`,
        ));
      }
      keys.push(key);
    }
    totalObjectKeys += keys.length;
    if (totalObjectKeys > MAX_SPEC_TOTAL_OBJECT_KEYS) {
      return rejected(structureLimit(
        current.path,
        `Spec contains more than ${MAX_SPEC_TOTAL_OBJECT_KEYS} object keys.`,
      ));
    }
    keys.sort();

    const childValues = new Map<string, unknown>();
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      if (descriptor === undefined || !("value" in descriptor)) {
        return rejected(nonJsonValue(
          [...current.path, key],
          "Accessor properties are not valid JSON data.",
        ));
      }
      if (descriptor.enumerable !== true) {
        return rejected(nonJsonValue(
          [...current.path, key],
          "Object properties must be enumerable own data properties.",
        ));
      }
      childValues.set(key, descriptor.value);
    }

    const normalizedObject = Object.create(null) as JsonObject;
    assignNormalized(current.parent, current.key, normalizedObject, (root) => {
      normalizedValue = root;
    });
    activeContainers.add(source);
    pending.push({ type: "exit", source });
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      if (key === undefined) continue;
      pending.push({
        type: "node",
        source: childValues.get(key),
        path: [...current.path, key],
        depth: current.depth + 1,
        parent: normalizedObject,
        key,
      });
    }
  }

  return { valid: true, value: normalizedValue };
}

function reservedKeyDiagnostic(value: unknown): Diagnostic | undefined {
  const pending: { readonly value: unknown; readonly path: readonly PropertyKey[] }[] = [{
    value,
    path: [],
  }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        pending.push({ value: current.value[index], path: [...current.path, index] });
      }
      continue;
    }
    if (!isObject(current.value)) continue;

    const keys = Object.keys(current.value).sort();
    if (keys.includes("__proto__")) {
      return {
        code: "SCHEMA_INVALID",
        path: pointer([...current.path, "__proto__"]),
        message: "Reserved JSON key \"__proto__\" is not allowed.",
      };
    }
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      if (key === undefined) continue;
      pending.push({ value: current.value[key], path: [...current.path, key] });
    }
  }
  return undefined;
}

function missingRequiredMetadata(value: JsonObject, diagnostics: Diagnostic[]): void {
  const project = isObject(value.project) ? value.project : undefined;
  if (value.kind === "mod" && project !== undefined) {
    if (typeof project.license !== "string" || project.license.length === 0) {
      push(diagnostics, { code: "MISSING_LICENSE", path: "/project/license", message: "Project license is required." });
    }
    if (!Array.isArray(project.provenance) || project.provenance.length === 0) {
      push(diagnostics, {
        code: "MISSING_PROVENANCE",
        path: "/project/provenance",
        message: "Project provenance is required.",
      });
    }
  }

  const collections = value.kind === "art"
    ? [["/assets", value.assets] as const]
    : isObject(value.assets)
      ? [
          ["/assets/models", value.assets.models] as const,
          ["/assets/textures", value.assets.textures] as const,
          ["/assets/animations", value.assets.animations] as const,
        ]
      : [];
  for (const [basePath, assets] of collections) {
    if (!Array.isArray(assets)) continue;
    assets.forEach((asset, index) => {
      if (!isObject(asset)) return;
      if (typeof asset.license !== "string" || asset.license.length === 0) {
        push(diagnostics, {
          code: "MISSING_LICENSE",
          path: `${basePath}/${index}/license`,
          message: "Every asset requires a license identifier.",
        });
      }
      if (!Array.isArray(asset.provenance) || asset.provenance.length === 0) {
        push(diagnostics, {
          code: "MISSING_PROVENANCE",
          path: `${basePath}/${index}/provenance`,
          message: "Every asset requires bounded provenance records.",
        });
      }
    });
  }
}

function validateTarget(
  value: JsonObject,
  profile: ValidationProfile | undefined,
  diagnostics: Diagnostic[],
): void {
  if (profile === undefined) return;
  const targets = value.kind === "mod" && isObject(value.target)
    ? [value.target]
    : value.kind === "art" && Array.isArray(value.targetMatrix)
      ? value.targetMatrix.filter(isObject)
      : [];
  const matches = targets.some((target) =>
    target.minecraft === "26.1.2" && target.loader === "neoforge" && target.java === 25);
  if (!matches) {
    push(diagnostics, {
      code: "INCOMPATIBLE_TARGET",
      path: value.kind === "art" ? "/targetMatrix" : "/target",
      message: `Validation profile ${profile} requires Minecraft 26.1.2, NeoForge, and Java 25.`,
    });
  }
}

function collectUniqueIds(
  entries: unknown,
  basePath: string,
  diagnostics: Diagnostic[],
): Set<string> {
  const seen = new Set<string>();
  if (!Array.isArray(entries)) return seen;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!isObject(entry) || typeof entry.id !== "string") continue;
    if (seen.has(entry.id)) {
      push(diagnostics, {
        code: "DUPLICATE_RESOURCE_LOCATION",
        path: `${basePath}/${index}/id`,
        message: `Duplicate ResourceLocation: ${entry.id}`,
      });
    }
    seen.add(entry.id);
  }
  return seen;
}

const GAMEPLAY_SECTIONS = ["items", "blocks", "entities", "recipes", "summoning", "screens"] as const;

function collectGameplayIds(value: JsonObject, diagnostics: Diagnostic[]): Set<string> {
  const result = new Set<string>();
  if (value.kind !== "mod" || !isObject(value.gameplay)) return result;
  for (const section of GAMEPLAY_SECTIONS) {
    const entries = value.gameplay[section];
    if (!Array.isArray(entries)) continue;
    const sectionIds = new Set<string>();
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (!isObject(entry) || typeof entry.id !== "string") continue;
      if (sectionIds.has(entry.id)) {
        push(diagnostics, {
          code: "DUPLICATE_RESOURCE_LOCATION",
          path: `/gameplay/${section}/${index}/id`,
          message: `Duplicate ResourceLocation in gameplay.${section}: ${entry.id}`,
        });
      }
      sectionIds.add(entry.id);
      result.add(entry.id);
    }
  }
  return result;
}

function idsFromEntries(entries: unknown): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(entries)) return ids;
  for (const entry of entries) {
    if (isObject(entry) && typeof entry.id === "string") ids.add(entry.id);
  }
  return ids;
}

function validateDependencyLocations(value: JsonObject, diagnostics: Diagnostic[]): void {
  if (value.kind !== "mod" || !isObject(value.dependencies)) return;
  const seen = new Set<string>();
  const lists = [
    ["required", value.dependencies.required],
    ["optional", value.dependencies.optional],
  ] as const;
  for (const [listName, entries] of lists) {
    if (!Array.isArray(entries)) continue;
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (typeof entry !== "string") continue;
      if (seen.has(entry)) {
        push(diagnostics, {
          code: "DUPLICATE_DEPENDENCY",
          path: `/dependencies/${listName}/${index}`,
          message: `Duplicate dependency mod id: ${entry}`,
        });
      }
      seen.add(entry);
    }
  }
}

function validateIntegrations(value: JsonObject, diagnostics: Diagnostic[]): void {
  if (
    value.kind !== "mod" ||
    !isObject(value.dependencies) ||
    !isObject(value.integrations)
  ) return;
  const required = new Set(Array.isArray(value.dependencies.required) ? value.dependencies.required : []);
  const optional = new Set(Array.isArray(value.dependencies.optional) ? value.dependencies.optional : []);
  for (const integration of ["jei", "jade"] as const) {
    const configuration = value.integrations[integration];
    const mode = typeof configuration === "string"
      ? configuration
      : isObject(configuration)
        ? configuration.mode
        : undefined;
    const path = `/integrations/${integration}`;
    if (mode === "auto" && (!optional.has(integration) || required.has(integration))) {
      push(diagnostics, {
        code: "SEMANTIC_INVALID",
        path,
        message: `Auto integration ${integration} must appear only in dependencies.optional.`,
      });
    } else if (mode === "off" && (optional.has(integration) || required.has(integration))) {
      push(diagnostics, {
        code: "SEMANTIC_INVALID",
        path,
        message: `Disabled integration ${integration} must not appear in dependencies.`,
      });
    } else if (mode === "required" && (!required.has(integration) || optional.has(integration))) {
      push(diagnostics, {
        code: "SEMANTIC_INVALID",
        path,
        message: `Required integration ${integration} must appear only in dependencies.required.`,
      });
    }
  }
}

function canonicalAssetDestination(path: string): string | undefined {
  if (path.startsWith("/") || path.includes("\\")) return undefined;
  const canonicalSegments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (canonicalSegments.length === 0) return undefined;
      canonicalSegments.pop();
    } else {
      canonicalSegments.push(segment);
    }
  }
  return canonicalSegments.length === 0 ? undefined : canonicalSegments.join("/");
}

function collectUniqueAssetPaths(
  entries: unknown,
  basePath: string,
  diagnostics: Diagnostic[],
): void {
  if (!Array.isArray(entries)) return;
  const seen = new Set<string>();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!isObject(entry) || typeof entry.path !== "string") continue;
    const canonicalPath = canonicalAssetDestination(entry.path);
    if (canonicalPath === undefined) continue;
    if (seen.has(canonicalPath)) {
      push(diagnostics, {
        code: "DUPLICATE_ASSET_PATH",
        path: `${basePath}/${index}/path`,
        message: `Duplicate canonical asset destination: ${canonicalPath}`,
      });
    }
    seen.add(canonicalPath);
  }
}

function collectModAssetIds(value: JsonObject, diagnostics: Diagnostic[]): void {
  if (value.kind !== "mod" || !isObject(value.assets)) return;
  const paths = new Set<string>();
  for (const section of ["models", "textures", "animations"] as const) {
    const entries = value.assets[section];
    if (!Array.isArray(entries)) continue;
    const sectionIds = new Set<string>();
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (!isObject(entry)) continue;
      if (typeof entry.id === "string") {
        if (sectionIds.has(entry.id)) {
          push(diagnostics, {
            code: "DUPLICATE_RESOURCE_LOCATION",
            path: `/assets/${section}/${index}/id`,
            message: `Duplicate ResourceLocation in assets.${section}: ${entry.id}`,
          });
        }
        sectionIds.add(entry.id);
      }
      if (typeof entry.path === "string") {
        const canonicalPath = canonicalAssetDestination(entry.path);
        if (canonicalPath !== undefined) {
          if (paths.has(canonicalPath)) {
            push(diagnostics, {
              code: "DUPLICATE_ASSET_PATH",
              path: `/assets/${section}/${index}/path`,
              message: `Duplicate canonical asset destination: ${canonicalPath}`,
            });
          }
          paths.add(canonicalPath);
        }
      }
    }
  }
}

function validateKnownReference(
  value: unknown,
  path: string,
  knownIds: ReadonlySet<string>,
  diagnostics: Diagnostic[],
): void {
  if (typeof value === "string" && !knownIds.has(value)) {
    push(diagnostics, {
      code: "BROKEN_REFERENCE",
      path,
      message: `Unknown ResourceLocation reference: ${value}`,
    });
  }
}

function validateReferenceList(
  value: unknown,
  basePath: string,
  knownIds: ReadonlySet<string>,
  diagnostics: Diagnostic[],
): void {
  if (!Array.isArray(value)) return;
  value.forEach((reference, index) => {
    validateKnownReference(reference, `${basePath}/${index}`, knownIds, diagnostics);
  });
}

function validateResourceGraph(value: JsonObject, diagnostics: Diagnostic[]): void {
  validateDependencyLocations(value, diagnostics);
  validateIntegrations(value, diagnostics);
  if (value.kind === "art") {
    collectUniqueIds(value.assets, "/assets", diagnostics);
    collectUniqueAssetPaths(value.assets, "/assets", diagnostics);
    return;
  }
  if (value.kind !== "mod" || !isObject(value.gameplay)) return;

  const resourceIds = collectGameplayIds(value, diagnostics);
  collectModAssetIds(value, diagnostics);
  const itemIds = idsFromEntries(value.gameplay.items);
  const blockIds = idsFromEntries(value.gameplay.blocks);
  const entityIds = idsFromEntries(value.gameplay.entities);
  const itemOrBlockIds = new Set([...itemIds, ...blockIds]);
  const modelIds = isObject(value.assets) ? idsFromEntries(value.assets.models) : new Set<string>();
  for (const section of GAMEPLAY_SECTIONS) {
    const entries = value.gameplay[section];
    if (!Array.isArray(entries)) continue;
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (!isObject(entry)) continue;
      const basePath = `/gameplay/${section}/${index}`;
      validateReferenceList(entry.references, `${basePath}/references`, resourceIds, diagnostics);
      if (section === "blocks") {
        validateKnownReference(entry.item, `${basePath}/item`, itemIds, diagnostics);
      } else if (section === "entities") {
        validateKnownReference(entry.renderer, `${basePath}/renderer`, modelIds, diagnostics);
      } else if (section === "recipes") {
        validateReferenceList(entry.ingredients, `${basePath}/ingredients`, itemOrBlockIds, diagnostics);
        validateKnownReference(entry.result, `${basePath}/result`, itemOrBlockIds, diagnostics);
        if (entry.type === "custom" && typeof entry.serializer !== "string") {
          push(diagnostics, {
            code: "SEMANTIC_INVALID",
            path: `${basePath}/serializer`,
            message: "Custom recipes require a serializer ResourceLocation.",
          });
        }
      } else if (section === "summoning") {
        validateKnownReference(entry.entity, `${basePath}/entity`, entityIds, diagnostics);
        validateReferenceList(entry.ingredients, `${basePath}/ingredients`, itemOrBlockIds, diagnostics);
      } else if (section === "screens" && entry.serverValidation !== true) {
        push(diagnostics, {
          code: "SEMANTIC_INVALID",
          path: `${basePath}/serverValidation`,
          message: "Screens must declare server-side validation.",
        });
      }
    }
  }
  if (isObject(value.tests) && Array.isArray(value.tests.gameTests)) {
    collectUniqueIds(value.tests.gameTests, "/tests/gameTests", diagnostics);
    value.tests.gameTests.forEach((entry, index) => {
      if (!isObject(entry)) return;
      validateReferenceList(entry.references, `/tests/gameTests/${index}/references`, resourceIds, diagnostics);
    });
  }
}

interface AssetWithMetrics {
  readonly metrics: {
    readonly textureBytes: number;
    readonly cubes: number;
    readonly bones: number;
    readonly triangles: number;
    readonly keyframes: number;
  };
}

const REQUIRED_CONTEXTS_BY_ASSET_CLASS = {
  "item-icon": [
    "native-size",
    "nearest-neighbor-2x",
    "nearest-neighbor-4x",
    "alpha-checkerboard",
    "inventory-normal",
    "inventory-selected",
  ],
  "cuboid-model": [
    "turntable",
    "uv-sheet",
    "close-seams",
    "inventory-normal",
    "placed",
    "daylight",
    "night",
    "interior",
    "near",
    "mid",
  ],
  "animated-model": [
    "turntable",
    "key-poses",
    "idle",
    "gameplay-animation",
    "near",
    "mid",
    "daylight",
    "night",
    "interior",
    "timing-evidence",
  ],
  structure: [
    "orthographic-elevations",
    "palette-material-sheet",
    "placed-fixture",
    "exterior",
    "near",
    "mid",
    "far",
  ],
  "decorative-mesh": [
    "turntable",
    "wireframe-lod-uv",
    "renderer-fixture",
    "near",
    "mid",
    "far",
    "worst-case-lighting",
    "lod-transitions",
  ],
  "ui-sprite": [
    "source-atlas",
    "nine-slice-bounds",
    "gui-scale-2",
    "gui-scale-3",
    "gui-scale-4",
    "minimum-resolution",
    "reference-resolution",
  ],
} as const;

function totalMetrics(assets: readonly AssetWithMetrics[]): {
  textureBytes: number;
  cubes: number;
  bones: number;
  triangles: number;
  keyframes: number;
} {
  return assets.reduce(
    (total, asset) => ({
      textureBytes: total.textureBytes + asset.metrics.textureBytes,
      cubes: total.cubes + asset.metrics.cubes,
      bones: total.bones + asset.metrics.bones,
      triangles: total.triangles + asset.metrics.triangles,
      keyframes: total.keyframes + asset.metrics.keyframes,
    }),
    { textureBytes: 0, cubes: 0, bones: 0, triangles: 0, keyframes: 0 },
  );
}

function validateBudgets(spec: Spec, diagnostics: Diagnostic[]): void {
  const assets = spec.kind === "mod"
    ? [...spec.assets.models, ...spec.assets.textures, ...spec.assets.animations]
    : spec.assets;
  const budgets = spec.kind === "mod" ? spec.assets.budgets : spec.budgets;
  const totals = totalMetrics(assets);
  const comparisons = [
    ["textureBytes", "maxTextureBytes", totals.textureBytes, budgets.maxTextureBytes],
    ["cubes", "maxCubes", totals.cubes, budgets.maxCubes],
    ["bones", "maxBones", totals.bones, budgets.maxBones],
    ["triangles", "maxTriangles", totals.triangles, budgets.maxTriangles],
    ["keyframes", "maxKeyframes", totals.keyframes, budgets.maxKeyframes],
  ] as const;
  for (const [metricName, budgetName, actual, budget] of comparisons) {
    if (actual > budget) {
      push(diagnostics, {
        code: "BUDGET_OVERFLOW",
        path: `${spec.kind === "mod" ? "/assets/budgets" : "/budgets"}/${budgetName}`,
        message: `${metricName} total ${actual} exceeds budget ${budget}.`,
      });
    }
  }
}

function validateProfileRequirements(
  spec: Spec,
  profile: ValidationProfile | undefined,
  diagnostics: Diagnostic[],
): void {
  if (
    profile !== "neoforge-26.1.2-java-25" ||
    spec.kind !== "mod" ||
    spec.assets.animations.length === 0 ||
    spec.dependencies.required.includes("geckolib")
  ) return;
  push(diagnostics, {
    code: "SEMANTIC_INVALID",
    path: "/dependencies/required",
    message: `Validation profile ${profile} requires bare dependency mod id "geckolib" in dependencies.required when assets.animations is nonempty.`,
  });
}

function validateArtConstraints(spec: Spec, diagnostics: Diagnostic[]): void {
  if (spec.kind !== "art") return;
  const targetTuples = new Set<string>();
  spec.targetMatrix.forEach((target, index) => {
    const tuple = JSON.stringify([
      target.minecraft,
      target.loader,
      target.java,
      target.loaderVersion,
      target.runtime.id,
      target.runtime.version,
      target.renderer.id,
      target.renderer.version,
    ]);
    if (targetTuples.has(tuple)) {
      push(diagnostics, {
        code: "SEMANTIC_INVALID",
        path: `/targetMatrix/${index}`,
        message: "Duplicate ArtSpec target matrix tuple.",
      });
    }
    targetTuples.add(tuple);
    if (target.runtime.version !== String(target.java)) {
      push(diagnostics, {
        code: "SEMANTIC_INVALID",
        path: `/targetMatrix/${index}/runtime/version`,
        message: `Java runtime version ${target.runtime.version} must match java ${target.java}.`,
      });
    }
  });
  const palette = new Set<string>();
  spec.style.palette.forEach((color, index) => {
    const normalized = color.toUpperCase();
    if (palette.has(normalized)) {
      push(diagnostics, {
        code: "SEMANTIC_INVALID",
        path: `/style/palette/${index}`,
        message: `Duplicate palette color: ${normalized}`,
      });
    }
    palette.add(normalized);
  });
  if (spec.style.targetPaletteColors !== spec.style.palette.length) {
    push(diagnostics, {
      code: "SEMANTIC_INVALID",
      path: "/style/targetPaletteColors",
      message: "targetPaletteColors must equal the declared palette length.",
    });
  }
  if (spec.style.saturation.minimum > spec.style.saturation.maximum) {
    push(diagnostics, {
      code: "SEMANTIC_INVALID",
      path: "/style/saturation/minimum",
      message: "Minimum saturation must not exceed maximum saturation.",
    });
  }
  const targetContexts = new Set<string>();
  spec.targetContexts.forEach((context, index) => {
    if (targetContexts.has(context)) {
      push(diagnostics, {
        code: "SEMANTIC_INVALID",
        path: `/targetContexts/${index}`,
        message: `Duplicate target context: ${context}`,
      });
    }
    targetContexts.add(context);
  });
  const missingContexts = REQUIRED_CONTEXTS_BY_ASSET_CLASS[spec.assetClass]
    .filter((context) => !targetContexts.has(context));
  if (missingContexts.length > 0) {
    push(diagnostics, {
      code: "SEMANTIC_INVALID",
      path: "/targetContexts",
      message: `Asset class ${spec.assetClass} requires target contexts: ${missingContexts.join(", ")}.`,
    });
  }
  const allowedKinds = new Set<string>();
  spec.provenancePolicy.allowedSourceKinds.forEach((kind, index) => {
    if (allowedKinds.has(kind)) {
      push(diagnostics, {
        code: "SEMANTIC_INVALID",
        path: `/provenancePolicy/allowedSourceKinds/${index}`,
        message: `Duplicate allowed provenance kind: ${kind}`,
      });
    }
    allowedKinds.add(kind);
  });
  spec.assets.forEach((asset, assetIndex) => {
    asset.provenance.forEach((record, recordIndex) => {
      if (!allowedKinds.has(record.kind)) {
        push(diagnostics, {
          code: "SEMANTIC_INVALID",
          path: `/assets/${assetIndex}/provenance/${recordIndex}/kind`,
          message: `Provenance kind ${record.kind} is not allowed by provenancePolicy.`,
        });
      }
    });
  });
}

/**
 * Validates hostile spec data. `expectedKind` preserves the original public
 * call shape; `options` is trusted programmatic configuration selected by the
 * caller, not a second untrusted payload. The CLI normalizes the only current
 * option through the exported profile constant; MCP deliberately exposes no
 * validation options and always uses loader-neutral validation.
 */
export function validateSpec(
  value: unknown,
  expectedKind: SpecKind = "auto",
  options: ValidationOptions = {},
): ValidationResult {
  const diagnostics: Diagnostic[] = [];
  const preflight = structuralPreflight(value);
  if (!preflight.valid) {
    return {
      valid: false,
      diagnostics: [preflight.diagnostic],
    };
  }
  if (!isObject(preflight.value)) {
    return {
      valid: false,
      diagnostics: [{ code: "SCHEMA_INVALID", path: "", message: "Spec must be a JSON object." }],
    };
  }

  const normalized = preflight.value;
  const actualKind = normalized.kind === "mod" || normalized.kind === "art" ? normalized.kind : undefined;
  // Zod 4.4.2 does not report an own enumerable `__proto__` key as an
  // unrecognized property. Reject it explicitly so runtime validation matches
  // the emitted strict JSON Schema at every object level.
  const reservedDiagnostic = reservedKeyDiagnostic(normalized);
  if (reservedDiagnostic !== undefined) {
    return {
      valid: false,
      ...(actualKind === undefined ? {} : { kind: actualKind }),
      diagnostics: [reservedDiagnostic],
    };
  }
  if (expectedKind !== "auto" && actualKind !== expectedKind) {
    push(diagnostics, {
      code: "KIND_MISMATCH",
      path: "/kind",
      message: `Expected ${expectedKind} spec.`,
    });
  }

  missingRequiredMetadata(normalized, diagnostics);
  validateTarget(normalized, options.profile, diagnostics);
  validateResourceGraph(normalized, diagnostics);

  const schemaKind = actualKind ?? (expectedKind === "art" ? "art" : "mod");
  const schema = schemaKind === "art" ? ArtSpecSchema : ModSpecSchema;
  const parsed = schema.safeParse(normalized);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      if (issue.code === "unrecognized_keys") {
        for (const key of [...issue.keys].sort()) {
          push(diagnostics, {
            code: "SCHEMA_INVALID",
            path: pointer([...issue.path, key]),
            message: `Unrecognized key: ${JSON.stringify(key)}`,
          });
        }
      } else {
        push(diagnostics, { code: "SCHEMA_INVALID", path: pointer(issue.path), message: issue.message });
      }
    }
  } else {
    validateBudgets(parsed.data, diagnostics);
    validateArtConstraints(parsed.data, diagnostics);
    validateProfileRequirements(parsed.data, options.profile, diagnostics);
  }

  return {
    valid: diagnostics.length === 0,
    ...(actualKind === undefined ? {} : { kind: actualKind }),
    diagnostics,
    ...(parsed.success && diagnostics.length === 0 ? { value: parsed.data } : {}),
  };
}

/** Validates bounded inline JSON with the same trusted options contract as validateSpec. */
export function validateInlineSpec(
  payload: string,
  expectedKind: SpecKind = "auto",
  options: ValidationOptions = {},
): ValidationResult {
  if (Buffer.byteLength(payload, "utf8") > MAX_INLINE_SPEC_BYTES) {
    return {
      valid: false,
      diagnostics: [{
        code: "PAYLOAD_TOO_LARGE",
        path: "",
        message: `Inline JSON exceeds ${MAX_INLINE_SPEC_BYTES} UTF-8 bytes.`,
      }],
    };
  }
  let value: unknown;
  try {
    value = JSON.parse(payload) as unknown;
  } catch {
    return {
      valid: false,
      diagnostics: [{ code: "INVALID_JSON", path: "", message: "Payload is not valid JSON." }],
    };
  }
  return validateSpec(value, expectedKind, options);
}
