import { z } from "zod";
import { EditorError } from "./errors.ts";

export const DesignBriefSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("mcdev-design-brief"),
  target: z.literal("fabric-1.20.1-held-item"),
  purpose: z.string().trim().min(1).max(160),
  style: z.string().trim().min(1).max(160),
  silhouette: z.string().trim().min(1).max(240),
  materials: z.string().trim().min(1).max(240),
  palette: z.array(z.string().regex(/^#[0-9a-f]{6}$/iu)).min(1).max(24)
    .refine((colors) => new Set(colors.map((c) => c.toLowerCase())).size === colors.length),
  preserve: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u)).max(256)
    .refine((ids) => new Set(ids).size === ids.length),
});
export type DesignBrief = z.infer<typeof DesignBriefSchema>;

// Бриф остаётся текстовым содержимым проекта v2; старый редактор сохраняет его без миграции.
export function serializeDesignBrief(value: unknown): string {
  const brief = DesignBriefSchema.safeParse(value);
  if (!brief.success)
    throw new EditorError("INVALID_BRIEF", "Проверьте назначение, стиль, силуэт, материалы и уникальные цвета #RRGGBB.");
  const text = JSON.stringify({ ...brief.data, palette: brief.data.palette.map((c) => c.toLowerCase()) });
  if (text.length > 1200)
    throw new EditorError("BRIEF_LIMIT", "Структурированный бриф длиннее 1200 символов. Сократите описания или список деталей.");
  return text;
}

export function readDesignBrief(text: string): DesignBrief | undefined {
  if (text.length > 1200) return undefined;
  try {
    const result = DesignBriefSchema.safeParse(JSON.parse(text));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}
