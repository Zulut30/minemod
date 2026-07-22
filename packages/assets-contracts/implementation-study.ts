import { z } from "zod";

export const IMPLEMENTATION_STUDY_SCHEMA_ID =
  "https://mcdev.local/schemas/implementation-study-v0.json";
export const IMPLEMENTATION_STUDY_LIMITS = Object.freeze({
  maxDomains: 8,
  maxFiles: 48,
  maxFindings: 32,
  maxEvidencePaths: 8,
  maxDerivedRules: 24,
} as const);

const identifier = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u);
const boundedText = z.string().min(1).max(320);
const httpsUrl = z.url().refine((value) => value.startsWith("https://"), "Only HTTPS sources are accepted.");
const sourcePath = z.string().min(1).max(240).refine(
  (value) => !value.startsWith("/") && !value.split("/").includes(".."),
  "Source paths must be repository-relative and traversal-free.",
);

export const IMPLEMENTATION_DOMAINS = [
  "entity-ai",
  "entity-spawn",
  "networking",
  "persistence",
  "ui",
  "worldgen",
] as const;
const implementationDomain = z.enum(IMPLEMENTATION_DOMAINS);

export const ImplementationStudySchema = z.strictObject({
  schemaVersion: z.literal(0),
  kind: z.literal("implementation-study"),
  id: identifier,
  source: z.strictObject({
    project: boundedText,
    homepage: httpsUrl,
    repository: httpsUrl,
    revision: z.string().regex(/^[0-9a-f]{40}$/u),
    minecraftVersion: z.string().regex(/^\d+(?:\.\d+){1,2}$/u),
    loaders: z.array(z.enum(["fabric", "forge", "neoforge", "vanilla"])).min(1).max(4),
    codeLicense: z.strictObject({
      spdx: z.string().regex(/^[A-Za-z0-9.+-]{1,64}$/u),
      status: z.literal("verified"),
      evidenceUrl: httpsUrl,
    }),
    reviewedAt: z.iso.date(),
  }),
  domains: z.array(implementationDomain).min(1).max(IMPLEMENTATION_STUDY_LIMITS.maxDomains),
  inspectedFiles: z.array(z.strictObject({
    path: sourcePath,
    role: boundedText,
  })).min(1).max(IMPLEMENTATION_STUDY_LIMITS.maxFiles),
  findings: z.array(z.strictObject({
    domain: implementationDomain,
    pattern: boundedText,
    evidencePaths: z.array(sourcePath).min(1).max(IMPLEMENTATION_STUDY_LIMITS.maxEvidencePaths),
    tradeoff: boundedText,
  })).min(1).max(IMPLEMENTATION_STUDY_LIMITS.maxFindings),
  derivedRules: z.array(z.strictObject({
    id: identifier,
    appliesTo: z.array(implementationDomain).min(1).max(IMPLEMENTATION_STUDY_LIMITS.maxDomains),
    statement: boundedText,
    verification: z.enum(["automated", "code-review", "game-test", "manual-playtest"]),
  })).min(1).max(IMPLEMENTATION_STUDY_LIMITS.maxDerivedRules),
  reusePolicy: z.strictObject({
    sourceCode: z.literal("forbidden"),
    assets: z.literal("forbidden"),
    distinctiveDesign: z.literal("forbidden"),
    implementation: z.literal("abstract-rules-only"),
  }),
}).superRefine((study, context) => {
  const domainSet = new Set(study.domains);
  if (domainSet.size !== study.domains.length) {
    context.addIssue({ code: "custom", path: ["domains"], message: "Study domains must be unique." });
  }

  const filePaths = new Set<string>();
  for (const [index, file] of study.inspectedFiles.entries()) {
    if (filePaths.has(file.path)) {
      context.addIssue({ code: "custom", path: ["inspectedFiles", index, "path"], message: "Inspected file paths must be unique." });
    }
    filePaths.add(file.path);
  }

  for (const [findingIndex, finding] of study.findings.entries()) {
    if (!domainSet.has(finding.domain)) {
      context.addIssue({ code: "custom", path: ["findings", findingIndex, "domain"], message: "Finding domain must be declared by the study." });
    }
    for (const [pathIndex, path] of finding.evidencePaths.entries()) {
      if (!filePaths.has(path)) {
        context.addIssue({ code: "custom", path: ["findings", findingIndex, "evidencePaths", pathIndex], message: "Finding evidence must reference an inspected file." });
      }
    }
  }

  const ruleIds = new Set<string>();
  for (const [ruleIndex, rule] of study.derivedRules.entries()) {
    if (ruleIds.has(rule.id)) {
      context.addIssue({ code: "custom", path: ["derivedRules", ruleIndex, "id"], message: "Derived rule ids must be unique." });
    }
    ruleIds.add(rule.id);
    for (const [domainIndex, domain] of rule.appliesTo.entries()) {
      if (!domainSet.has(domain)) {
        context.addIssue({ code: "custom", path: ["derivedRules", ruleIndex, "appliesTo", domainIndex], message: "Rule domain must be declared by the study." });
      }
    }
  }
});

export type ImplementationStudy = z.infer<typeof ImplementationStudySchema>;

export const ImplementationStudyJsonSchema = Object.freeze({
  ...z.toJSONSchema(ImplementationStudySchema),
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: IMPLEMENTATION_STUDY_SCHEMA_ID,
});
