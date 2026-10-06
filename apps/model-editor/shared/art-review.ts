import { z } from "zod";
const reference = { projectId: z.uuid(), expectedRevision: z.number().int().min(0) };
export const ArtReviewControlSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("get") }),
  z.strictObject({ action: z.literal("prepare"), ...reference }),
  z.strictObject({ action: z.literal("request"), ...reference, expectedHeadSha256: z.string().regex(/^[a-f0-9]{64}$/u) }),
]);
export type ArtReviewControl = z.infer<typeof ArtReviewControlSchema>;
export interface ArtReviewSummary {
  readonly candidateSha256: string;
  readonly headSha256: string;
  readonly sequence: number;
  readonly decision: "DRAFT" | "NEEDS_REPAIR";
  readonly reviewRequested: boolean;
  readonly matchesCurrentProject: boolean;
  readonly bindingsAccepted: boolean;
  readonly fileCount: number;
  readonly unratedCriteria: number;
  readonly artSpecSha256: string;
  readonly diagnostics: readonly { readonly id: string; readonly message: string }[];
  readonly history: readonly { readonly sequence: number; readonly reviewRequested: boolean }[];
  readonly releaseEligible: false;
}
