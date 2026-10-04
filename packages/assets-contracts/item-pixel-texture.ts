import { z } from "zod";

const pixelCoordinate = z.number().int().min(0).max(256);
const rectangle = z.tuple([pixelCoordinate, pixelCoordinate, pixelCoordinate, pixelCoordinate])
  .refine(([left, top, right, bottom]) => left !== right && top !== bottom, "Face UV must have nonzero area.");

export const ItemPixelTexturePlanSchema = z.strictObject({
  schemaVersion: z.literal(0),
  kind: z.literal("item-pixel-texture-plan"),
  modelId: z.string().min(3).max(193),
  palette: z.array(z.strictObject({
    symbol: z.string().regex(/^[0-9a-v]$/u),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/u),
  })).min(1).max(32),
  rows: z.array(z.string().min(1).max(256).regex(/^[.0-9a-v]+$/u)).min(1).max(256),
  faces: z.array(z.strictObject({
    cubeId: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),
    uv: z.strictObject({ north: rectangle, south: rectangle, east: rectangle, west: rectangle, up: rectangle, down: rectangle }),
  })).min(1).max(256),
}).superRefine((plan, context) => {
  if (new Set(plan.palette.map(({ symbol }) => symbol)).size !== plan.palette.length) {
    context.addIssue({ code: "custom", path: ["palette"], message: "Palette symbols must be unique." });
  }
  if (new Set(plan.faces.map(({ cubeId }) => cubeId)).size !== plan.faces.length) {
    context.addIssue({ code: "custom", path: ["faces"], message: "Cube face bindings must be unique." });
  }
});

export type ItemPixelTexturePlan = z.infer<typeof ItemPixelTexturePlanSchema>;
export const ItemPixelTexturePlanJsonSchema = Object.freeze({
  ...z.toJSONSchema(ItemPixelTexturePlanSchema),
  $id: "https://mcdev.local/schemas/item-pixel-texture-plan-v0.json",
});
