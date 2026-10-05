import { z } from "zod";
export const MAX_CONCEPTS = 3;
export const MAX_CONCEPT_BYTES = 8_388_608;
export const MAX_CONCEPT_DIMENSION = 4096;
const draftShape = {
  label: z.string().trim().min(1).max(80),
  role: z.enum(["concept", "reference"]),
  origin: z.enum(["original", "ai-generated", "permission"]),
  attribution: z.string().trim().min(1).max(160),
  rights: z.string().trim().min(1).max(400),
  source: z.string().trim().max(512),
  note: z.string().trim().max(400),
};
export const ConceptDraftSchema = z.strictObject(draftShape).refine(value => value.origin !== "permission" || value.source.length > 0,
  { message: "Для чужого reference укажите источник и разрешение." });
export const ConceptDescriptorSchema = z.strictObject({ ...draftShape,
  id: z.uuid(), mime: z.literal("image/png"), sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  bytes: z.number().int().min(1).max(MAX_CONCEPT_BYTES),
  width: z.number().int().min(1).max(MAX_CONCEPT_DIMENSION), height: z.number().int().min(1).max(MAX_CONCEPT_DIMENSION),
  review: z.literal("direction-only"),
}).refine(value => value.origin !== "permission" || value.source.length > 0)
  .refine(value => value.width*value.height <= 4_194_304);
export const ConceptImportSchema = z.strictObject({ projectId: z.uuid(), expectedRevision: z.number().int().nonnegative(), draft: ConceptDraftSchema });
export type Concept = z.infer<typeof ConceptDescriptorSchema>;
export type ConceptDraft = z.infer<typeof ConceptDraftSchema>;
export type ConceptImport = z.infer<typeof ConceptImportSchema>;
