import { z } from "zod";

export const REFERENCE_STUDY_SCHEMA_ID = "https://mcdev.local/schemas/reference-study-v0.json";
export const REFERENCE_STUDY_LIMITS = Object.freeze({
  maxEvidence: 24,
  maxObservations: 32,
  maxDerivedRules: 16,
} as const);

const identifier = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u);
const boundedText = z.string().min(1).max(240);
const httpsUrl = z.url().refine((value) => value.startsWith("https://"), "Only HTTPS sources are accepted.");
const licenseEvidence = z.strictObject({
  spdx: z.string().regex(/^[A-Za-z0-9.+-]{1,64}$/u),
  status: z.enum(["verified", "unknown"]),
  evidenceUrl: httpsUrl,
});
const assetClass = z.enum([
  "armor", "creature", "crop", "mechanism", "object", "resource", "vehicle", "weapon",
]);

export const ReferenceStudySchema = z.strictObject({
  schemaVersion: z.literal(0),
  kind: z.literal("reference-study"),
  id: identifier,
  analysisMode: z.enum(["source-inspection", "visual-only"]),
  source: z.strictObject({
    project: boundedText,
    homepage: httpsUrl,
    repository: httpsUrl,
    revision: z.string().regex(/^[0-9a-f]{40}$/u),
    minecraftVersion: z.string().regex(/^\d+(?:\.\d+){1,2}$/u),
    loaders: z.array(z.enum(["fabric", "forge", "neoforge", "vanilla"])).min(1).max(4),
    codeLicense: licenseEvidence,
    assetLicense: licenseEvidence,
    reviewedAt: z.iso.date(),
  }),
  subject: z.strictObject({ id: identifier, assetClass }),
  evidence: z.array(z.strictObject({
    kind: z.enum(["behavior", "model", "state", "texture"]),
    sourcePath: z.string().min(1).max(240),
    observation: boundedText,
  })).min(1).max(REFERENCE_STUDY_LIMITS.maxEvidence),
  observations: z.array(z.strictObject({
    dimension: z.enum(["animation", "gameplay-state", "material", "performance", "proportion", "rig", "silhouette", "texture"]),
    statement: boundedText,
  })).min(1).max(REFERENCE_STUDY_LIMITS.maxObservations),
  derivedRules: z.array(z.strictObject({
    id: identifier,
    appliesTo: z.array(assetClass).min(1).max(8),
    statement: boundedText,
    validation: z.enum(["automated", "human-review", "in-game"]),
  })).min(1).max(REFERENCE_STUDY_LIMITS.maxDerivedRules),
  reusePolicy: z.strictObject({
    geometry: z.literal("forbidden"),
    textures: z.literal("forbidden"),
    distinctiveDesign: z.literal("forbidden"),
    implementation: z.literal("abstract-rules-only"),
  }),
}).superRefine((study, context) => {
  if (study.analysisMode === "source-inspection" &&
    (study.source.codeLicense.status !== "verified" || study.source.assetLicense.status !== "verified")) {
    context.addIssue({ code: "custom", path: ["analysisMode"], message: "Source inspection requires verified code and asset licenses." });
  }
  const ruleIds = new Set<string>();
  for (const [index, rule] of study.derivedRules.entries()) {
    if (ruleIds.has(rule.id)) context.addIssue({ code: "custom", path: ["derivedRules", index, "id"], message: "Derived rule ids must be unique." });
    ruleIds.add(rule.id);
  }
});

export type ReferenceStudy = z.infer<typeof ReferenceStudySchema>;

export const ReferenceStudyJsonSchema = Object.freeze({
  ...z.toJSONSchema(ReferenceStudySchema),
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: REFERENCE_STUDY_SCHEMA_ID,
});
