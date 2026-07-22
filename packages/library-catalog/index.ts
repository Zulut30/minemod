export type FabricLibraryId = "modmenu" | "yet_another_config_lib_v3";
export type FabricLibraryRelation = "required" | "optional";

export interface FabricLibraryRepository {
  readonly name: string;
  readonly url: string;
  readonly includeGroup: string;
}

export interface FabricLibraryCatalogEntry {
  readonly id: FabricLibraryId;
  readonly displayName: string;
  readonly minecraft: "1.20.1";
  readonly environment: "client" | "both";
  readonly version: string;
  readonly mavenCoordinate: string;
  readonly repository: FabricLibraryRepository;
  readonly license: "LGPL-3.0-or-later" | "MIT";
  readonly source: string;
  readonly allowedRelation: FabricLibraryRelation;
  readonly manifestVersion: string;
}

export interface ResolvedFabricLibrary extends FabricLibraryCatalogEntry {
  readonly relation: FabricLibraryRelation;
}

export interface FabricLibraryDiagnostic {
  readonly code: "DUPLICATE_LIBRARY" | "INVALID_LIBRARY_ID" | "UNSUPPORTED_LIBRARY" | "UNSUPPORTED_RELATION";
  readonly path: string;
  readonly message: string;
}

export type FabricLibraryResolution =
  | { readonly valid: true; readonly libraries: readonly ResolvedFabricLibrary[] }
  | { readonly valid: false; readonly diagnostics: readonly FabricLibraryDiagnostic[] };

const CATALOG: Readonly<Record<FabricLibraryId, FabricLibraryCatalogEntry>> = Object.freeze({
  modmenu: Object.freeze({
    id: "modmenu",
    displayName: "Mod Menu",
    minecraft: "1.20.1",
    environment: "client",
    version: "7.2.2",
    mavenCoordinate: "com.terraformersmc:modmenu:7.2.2",
    repository: Object.freeze({
      name: "Terraformers",
      url: "https://maven.terraformersmc.com/releases/",
      includeGroup: "com.terraformersmc",
    }),
    license: "MIT",
    source: "https://github.com/TerraformersMC/ModMenu/tree/v7.2.2",
    allowedRelation: "optional",
    manifestVersion: "*",
  }),
  yet_another_config_lib_v3: Object.freeze({
    id: "yet_another_config_lib_v3",
    displayName: "YetAnotherConfigLib",
    minecraft: "1.20.1",
    environment: "both",
    version: "3.6.6+1.20.1-fabric",
    mavenCoordinate: "dev.isxander:yet-another-config-lib:3.6.6+1.20.1-fabric",
    repository: Object.freeze({
      name: "Xander Maven",
      url: "https://maven.isxander.dev/releases/",
      includeGroup: "dev.isxander",
    }),
    license: "LGPL-3.0-or-later",
    source: "https://github.com/isXander/YetAnotherConfigLib/tree/3.6.6",
    allowedRelation: "required",
    manifestVersion: ">=3.6.6+1.20.1-fabric",
  }),
});

function diagnostic(
  code: FabricLibraryDiagnostic["code"],
  path: string,
  message: string,
): FabricLibraryDiagnostic {
  return Object.freeze({ code, path, message });
}

type CopiedIds =
  | { readonly valid: true; readonly ids: readonly string[] }
  | { readonly valid: false; readonly diagnostic: FabricLibraryDiagnostic };

function copyIds(value: readonly string[], path: string): CopiedIds {
  if (!Array.isArray(value)) {
    return { valid: false, diagnostic: diagnostic(
      "INVALID_LIBRARY_ID",
      path,
      "Library selection must be a dense array of mod ids.",
    ) };
  }
  const copied: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index) || typeof value[index] !== "string") {
      return { valid: false, diagnostic: diagnostic(
        "INVALID_LIBRARY_ID",
        `${path}/${index}`,
        "Library id must be a string.",
      ) };
    }
    copied.push(value[index]);
  }
  return { valid: true, ids: copied };
}

export function resolveFabric1201Libraries(
  required: readonly string[],
  optional: readonly string[],
): FabricLibraryResolution {
  const copiedRequired = copyIds(required, "/dependencies/required");
  const copiedOptional = copyIds(optional, "/dependencies/optional");
  const diagnostics: FabricLibraryDiagnostic[] = [];
  if (!copiedRequired.valid) diagnostics.push(copiedRequired.diagnostic);
  if (!copiedOptional.valid) diagnostics.push(copiedOptional.diagnostic);
  if (diagnostics.length > 0) return Object.freeze({ valid: false, diagnostics: Object.freeze(diagnostics) });
  if (!copiedRequired.valid || !copiedOptional.valid) {
    return Object.freeze({ valid: false, diagnostics: Object.freeze(diagnostics) });
  }

  const seen = new Set<string>();
  const resolved: ResolvedFabricLibrary[] = [];
  const selections = [
    { ids: copiedRequired.ids, relation: "required" as const, path: "/dependencies/required" },
    { ids: copiedOptional.ids, relation: "optional" as const, path: "/dependencies/optional" },
  ];
  for (const selection of selections) {
    selection.ids.forEach((id, index) => {
      const path = `${selection.path}/${index}`;
      if (seen.has(id)) {
        diagnostics.push(diagnostic("DUPLICATE_LIBRARY", path, `Library '${id}' is selected more than once.`));
        return;
      }
      seen.add(id);
      if (!Object.hasOwn(CATALOG, id)) {
        diagnostics.push(diagnostic("UNSUPPORTED_LIBRARY", path, `Library '${id}' is not in the trusted Fabric 1.20.1 catalog.`));
        return;
      }
      const entry = CATALOG[id as FabricLibraryId];
      if (entry.allowedRelation !== selection.relation) {
        diagnostics.push(diagnostic(
          "UNSUPPORTED_RELATION",
          path,
          `${entry.displayName} must be selected as ${entry.allowedRelation}.`,
        ));
        return;
      }
      resolved.push(Object.freeze({ ...entry, relation: selection.relation }));
    });
  }
  if (diagnostics.length > 0) return Object.freeze({ valid: false, diagnostics: Object.freeze(diagnostics) });
  resolved.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  return Object.freeze({ valid: true, libraries: Object.freeze(resolved) });
}

export function listFabric1201Libraries(): readonly FabricLibraryCatalogEntry[] {
  return Object.freeze(Object.values(CATALOG).map((entry) => entry));
}
