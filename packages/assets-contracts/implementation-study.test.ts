import assert from "node:assert/strict";
import {
  ImplementationStudyJsonSchema,
  ImplementationStudySchema,
  type ImplementationStudy,
} from "./implementation-study.ts";

const validStudy: ImplementationStudy = {
  schemaVersion: 0,
  kind: "implementation-study",
  id: "fabric_entity_patterns",
  source: {
    project: "Example Fabric Project",
    homepage: "https://example.com/project",
    repository: "https://example.com/project.git",
    revision: "0123456789abcdef0123456789abcdef01234567",
    minecraftVersion: "1.20.1",
    loaders: ["fabric"],
    codeLicense: {
      spdx: "MIT",
      status: "verified",
      evidenceUrl: "https://example.com/project/license",
    },
    reviewedAt: "2026-07-22",
  },
  domains: ["entity-ai", "entity-spawn"],
  inspectedFiles: [
    { path: "src/main/java/example/InfectedEntity.java", role: "Declares goals and state transitions." },
    { path: "src/main/java/example/EntitySpawns.java", role: "Registers biome spawn restrictions." },
  ],
  findings: [{
    domain: "entity-ai",
    pattern: "Keep target selection independent from movement goals.",
    evidencePaths: ["src/main/java/example/InfectedEntity.java"],
    tradeoff: "More registrations, but deterministic priority ordering.",
  }],
  derivedRules: [{
    id: "separate_target_priority",
    appliesTo: ["entity-ai"],
    statement: "Generate target selectors and action goals as separate ordered lists.",
    verification: "automated",
  }],
  reusePolicy: {
    sourceCode: "forbidden",
    assets: "forbidden",
    distinctiveDesign: "forbidden",
    implementation: "abstract-rules-only",
  },
};

assert.equal(ImplementationStudySchema.safeParse(validStudy).success, true);
assert.equal(ImplementationStudyJsonSchema.additionalProperties, false);
assert.equal(ImplementationStudySchema.safeParse({ ...validStudy, command: "clone" }).success, false);
assert.equal(ImplementationStudySchema.safeParse({
  ...validStudy,
  findings: [{ ...validStudy.findings[0]!, evidencePaths: ["src/main/java/example/Missing.java"] }],
}).success, false, "finding evidence must point to an inspected file");
assert.equal(ImplementationStudySchema.safeParse({
  ...validStudy,
  derivedRules: [{ ...validStudy.derivedRules[0]!, appliesTo: ["ui"] }],
}).success, false, "rules cannot escape the declared study domains");
assert.equal(ImplementationStudySchema.safeParse({
  ...validStudy,
  reusePolicy: { ...validStudy.reusePolicy, sourceCode: "allowed" },
}).success, false, "implementation studies cannot authorize copying source code");
assert.equal(ImplementationStudySchema.safeParse({
  ...validStudy,
  inspectedFiles: [{ path: "../outside.java", role: "Traversal attempt." }],
}).success, false, "evidence paths must be traversal-free");
