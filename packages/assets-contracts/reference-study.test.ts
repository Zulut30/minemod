import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ReferenceStudyJsonSchema, ReferenceStudySchema, type ReferenceStudy } from "./index.ts";

const fixturePath = new URL("../../fixtures/reference-studies/farmers-delight-rice-1.20.1.json", import.meta.url);
const riceStudy = JSON.parse(readFileSync(fileURLToPath(fixturePath), "utf8")) as unknown;
const parsed = ReferenceStudySchema.parse(riceStudy);
assert.equal(parsed.derivedRules.length, 2);
assert.equal(ReferenceStudyJsonSchema.additionalProperties, false);

const unknownLicenses: ReferenceStudy = {
  ...parsed,
  source: {
    ...parsed.source,
    codeLicense: { ...parsed.source.codeLicense, spdx: "NOASSERTION", status: "unknown" },
    assetLicense: { ...parsed.source.assetLicense, spdx: "NOASSERTION", status: "unknown" },
  },
};
assert.equal(ReferenceStudySchema.safeParse(unknownLicenses).success, false,
  "source inspection must stop when either license is unresolved");
assert.equal(ReferenceStudySchema.safeParse({ ...unknownLicenses, analysisMode: "visual-only" }).success, true,
  "unknown licenses permit only high-level visual analysis");
assert.equal(ReferenceStudySchema.safeParse({ ...parsed, command: "download-assets" }).success, false,
  "reference studies reject executable or undeclared fields");
assert.equal(ReferenceStudySchema.safeParse({
  ...parsed,
  reusePolicy: { ...parsed.reusePolicy, textures: "allowed" },
}).success, false, "reference studies cannot authorize copying source textures");
assert.equal(ReferenceStudySchema.safeParse({
  ...parsed,
  derivedRules: [...parsed.derivedRules, parsed.derivedRules[0]],
}).success, false, "derived rule ids must be unique");
