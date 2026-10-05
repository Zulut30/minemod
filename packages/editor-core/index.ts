import { z } from "zod";
import { EditorError } from "./errors.ts";
import { DesignBriefSchema, serializeDesignBrief } from "./design-brief.ts";
export { DesignBriefSchema, serializeDesignBrief, readDesignBrief } from "./design-brief.ts";
export type { DesignBrief } from "./design-brief.ts";
import {
  applyTexture,
  textureMask,
  MAX_STROKE_POINTS,
  type TextureCommand,
} from "./texture.ts";
export { EditorError } from "./errors.ts";
export {
  textureMask,
  texturePixels,
  pixelLine,
  MAX_STROKE_POINTS,
} from "./texture.ts";
export type { TextureCommand, PixelPoint } from "./texture.ts";
import {
  CuboidModelSpecSchema,
  ItemPixelTexturePlanSchema,
  CUBOID_MODEL_LIMITS,
} from "@mcdev/assets-contracts";

export const MAX_PROJECT_BYTES = 1_048_576;
export const MAX_COMMAND_BYTES = 262_144;
export const CURRENT_PROJECT_VERSION = 2;
const id = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u);
const vector = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
const pixelPlan = z.strictObject({
  ...ItemPixelTexturePlanSchema.shape,
  faces: z.array(ItemPixelTexturePlanSchema.shape.faces.element).max(256),
});
const BaseProjectSchema = z.strictObject({
  schemaVersion: z.literal(CURRENT_PROJECT_VERSION),
  kind: z.literal("mcdev-editor-project"),
  projectId: z.uuid(),
  model: CuboidModelSpecSchema,
  texturePlan: pixelPlan,
  parts: z
    .array(
      z.strictObject({
        id,
        label: z.string().min(1).max(80),
        cubeIds: z.array(id).min(1).max(256),
        locked: z.boolean(),
      }),
    )
    .max(256),
});
export const MAX_VARIANTS = 4;
export const ProjectSchema = BaseProjectSchema.extend({
  design: z
    .strictObject({
      brief: z.string().max(1200),
      variants: z
        .array(
          z.strictObject({
            id: z.uuid(),
            label: z.string().trim().min(1).max(48),
            note: z.string().max(400),
            project: BaseProjectSchema,
          }),
        )
        .max(MAX_VARIANTS),
    })
    .optional(),
});
export type EditorProject = z.infer<typeof ProjectSchema>;
const LegacyBaseProjectV1Schema = BaseProjectSchema.extend({ schemaVersion: z.literal(1) });
const designShape = ProjectSchema.shape.design.unwrap().shape;
const LegacyProjectV1Schema = LegacyBaseProjectV1Schema.extend({
  design: z.strictObject({ ...designShape, variants: z.array(
    designShape.variants.element.extend({ project: LegacyBaseProjectV1Schema }),
  ).max(MAX_VARIANTS) }).optional(),
});
export type Cube = EditorProject["model"]["bones"][number]["cubes"][number];
export type FaceName =
  keyof EditorProject["texturePlan"]["faces"][number]["uv"];
export const FACE_NAMES: FaceName[] = [
  "north",
  "south",
  "east",
  "west",
  "up",
  "down",
];
const targets = z.array(id).min(1).max(256);
const faceName = z.enum(["north", "south", "east", "west", "up", "down"]);
const pixelPoint = z.tuple([
  z.number().int().min(0).max(255),
  z.number().int().min(0).max(255),
]);
const paintColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/u)
  .nullable();
export const GridStepSchema = z.union([z.literal(0.125), z.literal(0.25), z.literal(0.5), z.literal(1)]);
export type GridStep = z.infer<typeof GridStepSchema>;
/** Половина шага округляется от нуля; отрицательные координаты симметричны. */
export function snapToGrid(value: number, step: GridStep): number {
  if (!Number.isFinite(value) || !GridStepSchema.safeParse(step).success)
    fail("INVALID_GRID", "Нужны конечная координата и шаг 0.125, 0.25, 0.5 или 1.");
  const rounded = Math.round(Math.abs(value) / step) * step;
  return rounded === 0 ? 0 : Math.sign(value) * rounded;
}
export const CommandSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("transform"),
    cubeIds: targets,
    translation: vector,
    scale: z.tuple([
      z.number().min(0.01).max(20),
      z.number().min(0.01).max(20),
      z.number().min(0.01).max(20),
    ]),
  }),
  z.strictObject({
    type: z.literal("recolor"),
    cubeIds: targets,
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/u),
  }),
  z.strictObject({
    type: z.literal("pivot"),
    cubeIds: targets,
    axis: z.enum(["x", "y", "z"]),
    value: z.number().finite().min(-CUBOID_MODEL_LIMITS.maxCoordinateMagnitude).max(CUBOID_MODEL_LIMITS.maxCoordinateMagnitude),
  }),
  z.strictObject({ type: z.literal("snap"), cubeIds: targets, step: GridStepSchema }),
  z.strictObject({
    type: z.literal("rotate"),
    cubeIds: targets,
    axis: z.enum(["x", "y", "z"]),
    angle: z.union([
      z.literal(-45),
      z.literal(-22.5),
      z.literal(0),
      z.literal(22.5),
      z.literal(45),
    ]),
  }),
  z.strictObject({ type: z.literal("add"), cubeId: id }),
  z.strictObject({ type: z.literal("delete"), cubeIds: targets }),
  z.strictObject({ type: z.literal("duplicate"), cubeId: id, newId: id }),
  z.strictObject({ type: z.literal("lock"), partId: id, locked: z.boolean() }),
  z.strictObject({
    type: z.literal("paint"),
    cubeIds: targets,
    face: faceName.optional(),
    color: paintColor,
    size: z.number().int().min(1).max(8),
    points: z.array(pixelPoint).min(1).max(MAX_STROKE_POINTS),
  }),
  z.strictObject({
    type: z.literal("fill"),
    cubeIds: targets,
    face: faceName.optional(),
    color: paintColor,
    seed: pixelPoint,
  }),
  z.strictObject({
    type: z.literal("uv"),
    cubeId: id,
    face: faceName,
    rect: z
      .tuple([
        z.number().int().min(0).max(256),
        z.number().int().min(0).max(256),
        z.number().int().min(0).max(256),
        z.number().int().min(0).max(256),
      ])
      .refine(([u, v, U, V]) => u !== U && v !== V),
  }),
  z.strictObject({ type: z.literal("undo") }),
  z.strictObject({ type: z.literal("redo") }),
  z.strictObject({ type: z.literal("brief"), text: z.string().max(1200) }),
  z.strictObject({ type: z.literal("designBrief"), brief: DesignBriefSchema }),
  z.strictObject({
    type: z.literal("checkpoint"),
    variantId: z.uuid(),
    label: z.string().trim().min(1).max(48),
    note: z.string().max(400).default(""),
  }),
  z.strictObject({ type: z.literal("restoreVariant"), variantId: z.uuid() }),
  z.strictObject({ type: z.literal("deleteVariant"), variantId: z.uuid() }),
]);
export type EditorCommand = z.infer<typeof CommandSchema>;
export const MutationSchema = z.strictObject({
  projectId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  key: z.uuid(),
  commands: z.array(CommandSchema).min(1).max(32),
});
export type Mutation = z.infer<typeof MutationSchema>;
export interface EditorState {
  project: EditorProject;
  revision: number;
  savedRevision: number;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  history: { label: string; actor: string }[];
}
function fail(code: string, message: string): never {
  throw new EditorError(code, message);
}
export function cubes(project: EditorProject): Cube[] {
  return project.model.bones.flatMap((bone) => bone.cubes);
}
export function bounds(items: readonly Cube[]): {
  min: [number, number, number];
  size: [number, number, number];
} {
  if (!items.length) return { min: [0, 0, 0], size: [0, 0, 0] };
  const min = [0, 1, 2].map((a) =>
    Math.min(...items.map((cube) => cube.origin[a]!)),
  ) as [number, number, number];
  const size = [0, 1, 2].map(
    (a) =>
      Math.max(...items.map((cube) => cube.origin[a]! + cube.size[a]!)) -
      min[a]!,
  ) as [number, number, number];
  return { min, size };
}
export function validateProject(value: unknown): EditorProject {
  const parsed = ProjectSchema.safeParse(value);
  if (!parsed.success)
    fail("INVALID_PROJECT", "Проект не соответствует формату редактора.");
  const p = parsed.data;
  if (p.design) {
    if (
      new Set(p.design.variants.map((v) => v.id)).size !==
      p.design.variants.length
    )
      fail("VARIANT_ID", "Идентификаторы вариантов должны быть уникальными.");
    for (const variant of p.design.variants) validateProject(variant.project);
    // Варианты не содержат вложенных снимков; лимит включает сохраняемые отступы.
    if (
      new TextEncoder().encode(JSON.stringify(p, null, 2) + "\n").length >
      MAX_PROJECT_BYTES
    )
      fail(
        "SIZE_LIMIT",
        "Проект с вариантами превышает 1 MiB. Удалите ненужный снимок.",
      );
  }
  if (p.model.modelType !== "held-item" || p.model.id !== p.texturePlan.modelId)
    fail("PROFILE", "Нужен согласованный профиль 3D-предмета.");
  const all = cubes(p),
    cubeIds = new Set(all.map((c) => c.id));
  const { width, height } = p.model.texture;
  if (
    p.texturePlan.rows.length !== height ||
    p.texturePlan.rows.some((r) => r.length !== width)
  )
    fail("ATLAS_SIZE", "Размер покраски не совпадает с атласом.");
  const symbols = new Set(p.texturePlan.palette.map((c) => c.symbol));
  if (
    symbols.size !== p.texturePlan.palette.length ||
    p.texturePlan.rows.some((row) =>
      [...row].some((s) => s !== "." && !symbols.has(s)),
    )
  )
    fail("PALETTE", "Некорректная палитра.");
  const bindingIds = new Set(p.texturePlan.faces.map((f) => f.cubeId));
  if (
    bindingIds.size !== all.length ||
    p.texturePlan.faces.length !== all.length ||
    [...bindingIds].some((s) => !cubeIds.has(s))
  )
    fail("UV_BINDINGS", "Для каждого куба требуется ровно одна UV-привязка.");
  for (const f of p.texturePlan.faces)
    for (const uv of Object.values(f.uv)) {
      if (uv.some((v, a) => v > (a % 2 === 0 ? width : height)))
        fail("UV_BOUNDS", "UV выходит за границы текстуры.");
    }
  const assigned = p.parts.flatMap((part) => part.cubeIds);
  if (
    new Set(p.parts.map((part) => part.id)).size !== p.parts.length ||
    assigned.length !== all.length ||
    new Set(assigned).size !== all.length ||
    assigned.some((s) => !cubeIds.has(s))
  )
    fail("PARTS", "Кубы должны принадлежать ровно одной части.");
  if (p.model.bones.some((b) => b.rotation.some((v) => v !== 0)))
    fail("ROTATION", "Вращение костей не поддерживается native item профилем.");
  for (const c of all) {
    if (
      c.rotation.filter((v) => v !== 0).length > 1 ||
      c.rotation.some((v) => ![-45, -22.5, 0, 22.5, 45].includes(v))
    )
      fail(
        "ROTATION",
        "Предмет поддерживает вращение одной оси на 0, ±22.5 или ±45°.",
      );
    if (
      c.origin.some(
        (v, a) => v - c.inflate < -16 || v + c.size[a]! + c.inflate > 32,
      )
    )
      fail("BOUNDS", "Геометрия должна оставаться в диапазоне −16…32.");
  }
  return p;
}
export function parseProject(text: string): EditorProject {
  if (new TextEncoder().encode(text).length > MAX_PROJECT_BYTES)
    fail("SIZE_LIMIT", "Файл проекта превышает 1 MiB.");
  try {
    return migrateProject(JSON.parse(text) as unknown);
  } catch (error) {
    if (error instanceof EditorError) throw error;
    return fail("INVALID_JSON", "Не удалось прочитать JSON проекта.");
  }
}
/** Единственная миграция v1 -> v2: сохраняет идентичности и asset data, обновляет версии snapshots. */
export function migrateProject(value: unknown): EditorProject {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return fail("INVALID_PROJECT", "Нужен объект проекта редактора.");
  const version = (value as { schemaVersion?: unknown }).schemaVersion;
  if (version === undefined) return fail("INVALID_PROJECT", "В проекте отсутствует schemaVersion.");
  if (version !== 1 && version !== CURRENT_PROJECT_VERSION)
    return fail("UNSUPPORTED_PROJECT_VERSION", "Версия проекта не поддерживается. Оригинал сохранён; откройте его совместимой версией Studio.");
  const design = (value as { design?: unknown }).design;
  if (typeof design === "object" && design !== null && "variants" in design && Array.isArray(design.variants)) {
    for (const variant of design.variants) {
      if (typeof variant !== "object" || variant === null || !("project" in variant)) continue;
      const snapshot = variant.project as unknown;
      if (typeof snapshot !== "object" || snapshot === null || !("schemaVersion" in snapshot)) continue;
      if (snapshot.schemaVersion !== 1 && snapshot.schemaVersion !== CURRENT_PROJECT_VERSION)
        return fail("UNSUPPORTED_PROJECT_VERSION", "Вариант проекта имеет неподдерживаемую версию. Исходный файл сохранён.");
    }
  }
  if (version === CURRENT_PROJECT_VERSION) return validateProject(value);
  const legacy = LegacyProjectV1Schema.safeParse(value);
  if (!legacy.success) return fail("INVALID_PROJECT", "Исходный проект v1 не соответствует согласованному формату.");
  const p = legacy.data;
  return validateProject({ ...p, schemaVersion: CURRENT_PROJECT_VERSION,
    ...(p.design ? { design: { ...p.design, variants: p.design.variants.map((v) => ({
      ...v, project: { ...v.project, schemaVersion: CURRENT_PROJECT_VERSION },
    })) } } : {}),
  });
}
export function projectFromAsset(
  value: unknown,
  projectId: string,
): EditorProject {
  const asset = z
    .strictObject({
      schemaVersion: z.literal(0),
      kind: z.literal("minecraft-item-asset"),
      model: CuboidModelSpecSchema,
      texturePlan: ItemPixelTexturePlanSchema,
    })
    .parse(value);
  const groups = new Map<string, string[]>();
  for (const c of asset.model.bones.flatMap((b) => b.cubes)) {
    const group = /^(blade|tip)/u.test(c.id)
      ? "blade"
      : c.id.startsWith("guard")
        ? "guard"
        : c.id.startsWith("grip")
          ? "grip"
          : c.id.startsWith("pommel")
            ? "pommel"
            : c.id.startsWith("gem")
              ? "gem"
              : "details";
    groups.set(group, [...(groups.get(group) ?? []), c.id]);
  }
  const labels: Record<string, string> = {
    blade: "Клинок",
    guard: "Гарда",
    grip: "Рукоять",
    pommel: "Навершие",
    gem: "Кристалл",
    details: "Детали",
  };
  return validateProject({
    schemaVersion: CURRENT_PROJECT_VERSION,
    kind: "mcdev-editor-project",
    projectId,
    model: asset.model,
    texturePlan: asset.texturePlan,
    parts: [...groups].map(([group, cubeIds]) => ({
      id: group,
      label: labels[group]!,
      cubeIds,
      locked: false,
    })),
  });
}
export function emptyProject(projectId: string): EditorProject {
  return validateProject({
    schemaVersion: CURRENT_PROJECT_VERSION,
    kind: "mcdev-editor-project",
    projectId,
    model: {
      schemaVersion: 0,
      kind: "cuboid-model",
      id: "mcdev:new_item",
      name: "Новый предмет",
      modelType: "held-item",
      texture: { width: 256, height: 256 },
      bones: [
        {
          id: "root",
          parent: null,
          pivot: [8, 8, 8],
          rotation: [0, 0, 0],
          cubes: [],
        },
      ],
    },
    texturePlan: {
      schemaVersion: 0,
      kind: "item-pixel-texture-plan",
      modelId: "mcdev:new_item",
      palette: [{ symbol: "0", color: "#8fc7c2" }],
      rows: Array<string>(256).fill(".".repeat(256)),
      faces: [],
    },
    parts: [],
  });
}
export function assetRequest(p: EditorProject): object {
  validateProject(p);
  if (!cubes(p).length)
    fail("EMPTY_MODEL", "Добавьте хотя бы один куб перед экспортом.");
  return {
    schemaVersion: 0,
    kind: "minecraft-item-asset",
    model: p.model,
    texturePlan: p.texturePlan,
  };
}
function mask(p: EditorProject, ids: ReadonlySet<string>): Uint8Array {
  return textureMask(p, [...ids]);
}
function allocate(
  p: EditorProject,
  w: number,
  h: number,
  used: Uint8Array,
): [number, number, number, number] {
  const { width, height } = p.model.texture;
  for (let y = 1; y + h < height; y++)
    for (let x = 1; x + w < width; x++) {
      let free = true;
      for (let v = y - 1; v <= y + h && free; v++)
        for (let u = x - 1; u <= x + w; u++)
          if (used[v * width + u]) {
            free = false;
            break;
          }
      if (!free) continue;
      for (let v = y - 1; v <= y + h; v++)
        for (let u = x - 1; u <= x + w; u++) used[v * width + u] = 1;
      return [x, y, x + w, y + h];
    }
  return fail(
    "ATLAS_FULL",
    "В атласе нет свободного места. Перепаковка UV будет добавлена отдельно.",
  );
}
function newFaces(
  p: EditorProject,
  source?: EditorProject["texturePlan"]["faces"][number],
): EditorProject["texturePlan"]["faces"][number]["uv"] {
  const used = mask(p, new Set(cubes(p).map((c) => c.id)));
  const rows = p.texturePlan.rows.map((r) => [...r]);
  const faces = {} as EditorProject["texturePlan"]["faces"][number]["uv"];
  for (const face of FACE_NAMES) {
    const old = source?.uv[face],
      w = old ? Math.abs(old[2] - old[0]) : 8,
      h = old ? Math.abs(old[3] - old[1]) : 8;
    const rect = allocate(p, w, h, used);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        rows[rect[1] + y]![rect[0] + x] = old
          ? p.texturePlan.rows[Math.min(old[1], old[3]) + y]![
              Math.min(old[0], old[2]) + x
            ]!
          : p.texturePlan.palette[0]!.symbol;
    faces[face] = old
      ? [
          old[0] > old[2] ? rect[2] : rect[0],
          old[1] > old[3] ? rect[3] : rect[1],
          old[0] > old[2] ? rect[0] : rect[2],
          old[1] > old[3] ? rect[1] : rect[3],
        ]
      : rect;
  }
  p.texturePlan.rows = rows.map((r) => r.join(""));
  return faces;
}
function recolor(p: EditorProject, ids: Set<string>, color: string): void {
  const chosen = mask(p, ids),
    other = mask(
      p,
      new Set(
        cubes(p)
          .filter((c) => !ids.has(c.id))
          .map((c) => c.id),
      ),
    );
  if (chosen.some((v, i) => v && other[i]))
    fail(
      "SHARED_UV",
      "Эта часть делит UV с другими. Сначала нужна отдельная развёртка.",
    );
  const old = new Map(
    p.texturePlan.palette.map((c) => [c.symbol, c.color.toLowerCase()]),
  );
  const rgb = (c: string): number[] =>
    [1, 3, 5].map((v) => Number.parseInt(c.slice(v, v + 2), 16));
  const luma = (c: string): number => {
    const [r, g, b] = rgb(c);
    return r! * 0.2126 + g! * 0.7152 + b! * 0.0722;
  };
  const flat = p.texturePlan.rows.join("");
  const luminosities = [...flat].flatMap((s, i) =>
    chosen[i] && s !== "." ? [luma(old.get(s)!)] : [],
  );
  const max = Math.max(1, ...luminosities),
    target = rgb(color);
  const palette: { symbol: string; color: string }[] = [],
    byColor = new Map<string, string>();
  const pixels = [...flat].map((symbol, i) => {
    if (symbol === ".") return ".";
    let result = old.get(symbol)!;
    if (chosen[i])
      result =
        "#" +
        target
          .map((v) =>
            Math.round(v * Math.max(0.22, luma(result) / max))
              .toString(16)
              .padStart(2, "0"),
          )
          .join("");
    let next = byColor.get(result);
    if (!next) {
      if (palette.length === 32)
        fail(
          "PALETTE_FULL",
          "Перекраска потребует больше 32 цветов. Выберите близкий цвет или меньше деталей.",
        );
      next = palette.length.toString(32);
      byColor.set(result, next);
      palette.push({ symbol: next, color: result });
    }
    return next;
  });
  p.texturePlan.palette = palette.length ? palette : [{ symbol: "0", color }];
  p.texturePlan.rows = Array.from({ length: p.model.texture.height }, (_, y) =>
    pixels
      .slice(y * p.model.texture.width, (y + 1) * p.model.texture.width)
      .join(""),
  );
}
function applyCommand(
  p: EditorProject,
  command: EditorCommand,
  actor: "human" | "agent",
): void {
  if (command.type === "undo" || command.type === "redo")
    return fail("HISTORY_BATCH", "История меняется отдельной командой.");
  if (
    ["brief", "designBrief", "checkpoint", "restoreVariant", "deleteVariant"].includes(
      command.type,
    )
  ) {
    if (actor !== "human")
      fail(
        "HUMAN_ONLY",
        "Задание и сохранённые варианты управляются пользователем.",
      );
    p.design ??= { brief: "", variants: [] };
    if (command.type === "brief") p.design.brief = command.text;
    else if (command.type === "designBrief") {
      for (const id of command.brief.preserve) {
        const part = p.parts.find((part) => part.id === id);
        if (!part || !part.locked)
          fail("BRIEF_PROTECTION", "Деталь брифа отсутствует или не закреплена. Сверьте замки в дереве модели.");
      }
      p.design.brief = serializeDesignBrief(command.brief);
    }
    else if (command.type === "checkpoint") {
      if (p.design.variants.length >= MAX_VARIANTS)
        fail("VARIANT_LIMIT", "Можно сохранить до четырёх вариантов.");
      if (p.design.variants.some((v) => v.id === command.variantId))
        fail("VARIANT_ID", "Вариант с таким идентификатором уже существует.");
      p.design.variants.push({
        id: command.variantId,
        label: command.label,
        note: command.note,
        project: {
          schemaVersion: p.schemaVersion,
          kind: p.kind,
          projectId: p.projectId,
          model: structuredClone(p.model),
          texturePlan: structuredClone(p.texturePlan),
          parts: structuredClone(p.parts),
        },
      });
    } else if (
      command.type === "restoreVariant" ||
      command.type === "deleteVariant"
    ) {
      const variant = p.design.variants.find((v) => v.id === command.variantId);
      if (!variant) fail("VARIANT_NOT_FOUND", "Сохранённый вариант не найден.");
      if (command.type === "deleteVariant")
        p.design.variants = p.design.variants.filter(
          (v) => v.id !== command.variantId,
        );
      else {
        p.model = structuredClone(variant.project.model);
        p.texturePlan = structuredClone(variant.project.texturePlan);
        p.parts = structuredClone(variant.project.parts);
      }
    }
    return;
  }
  const all = cubes(p),
    requested =
      "cubeIds" in command
        ? command.cubeIds
        : "cubeId" in command && command.type !== "add"
          ? [command.cubeId]
          : [];
  if (
    new Set(requested).size !== requested.length ||
    requested.some((s) => !all.some((c) => c.id === s))
  )
    fail("TARGET", "Выбранный куб не существует или указан дважды.");
  const ids = new Set(requested),
    selected = all.filter((c) => ids.has(c.id));
  if (
    actor === "agent" &&
    (command.type === "lock" ||
      p.parts.some(
        (part) => part.locked && part.cubeIds.some((s) => ids.has(s)),
      ))
  )
    fail("LOCKED", "Агент не может менять закреплённую часть.");
  switch (command.type) {
    case "transform": {
      const { min } = bounds(selected);
      for (const c of selected)
        for (const a of [0, 1, 2] as const) {
          c.origin[a] =
            min[a] +
            (c.origin[a] - min[a]) * command.scale[a] +
            command.translation[a];
          c.pivot[a] =
            min[a] +
            (c.pivot[a] - min[a]) * command.scale[a] +
            command.translation[a];
          c.size[a] *= command.scale[a];
        }
      break;
    }
    case "rotate":
      for (const c of selected) {
        c.rotation = [0, 0, 0];
        c.rotation[{ x: 0, y: 1, z: 2 }[command.axis]] = command.angle;
      }
      break;
    case "pivot":
      for (const c of selected)
        c.pivot[{ x: 0, y: 1, z: 2 }[command.axis]] = command.value;
      break;
    case "snap": {
      // Двигаем выделение целиком: форма, интервалы и рисунок сохраняются.
      const { min } = bounds(selected);
      const delta = min.map((v) => snapToGrid(v, command.step) - v);
      for (const c of selected)
        for (const a of [0, 1, 2] as const) {
          c.origin[a] += delta[a]!;
          c.pivot[a] += delta[a]!;
        }
      break;
    }
    case "recolor":
      recolor(p, ids, command.color);
      break;
    case "paint":
    case "fill":
    case "uv":
      applyTexture(p, command);
      break;
    case "lock": {
      const part = p.parts.find((v) => v.id === command.partId);
      if (!part) fail("TARGET", "Часть не найдена.");
      part.locked = command.locked;
      break;
    }
    case "delete":
      for (const bone of p.model.bones)
        bone.cubes = bone.cubes.filter((c) => !ids.has(c.id));
      p.parts = p.parts
        .map((part) => ({
          ...part,
          cubeIds: part.cubeIds.filter((s) => !ids.has(s)),
        }))
        .filter((part) => part.cubeIds.length);
      p.texturePlan.faces = p.texturePlan.faces.filter(
        (f) => !ids.has(f.cubeId),
      );
      break;
    case "add":
    case "duplicate": {
      const nextId = command.type === "add" ? command.cubeId : command.newId;
      if (
        all.some((c) => c.id === nextId) ||
        p.parts.some((part) => part.id === nextId)
      )
        fail("DUPLICATE_ID", "Этот ID уже занят.");
      const source = command.type === "duplicate" ? selected[0]! : null;
      const cube: Cube = source
        ? {
            ...structuredClone(source),
            id: nextId,
            origin: [source.origin[0] + 1, source.origin[1], source.origin[2]],
            pivot: [source.pivot[0] + 1, source.pivot[1], source.pivot[2]],
          }
        : {
            id: nextId,
            origin: [7, 8, 7],
            size: [2, 2, 2],
            pivot: [8, 8, 8],
            rotation: [0, 0, 0],
            uv: [0, 0],
            inflate: 0,
            mirror: false,
          };
      const uv = newFaces(
        p,
        source
          ? p.texturePlan.faces.find((f) => f.cubeId === source.id)
          : undefined,
      );
      const bone = p.model.bones.find((b) => b.cubes.length < 64);
      if (!bone) fail("BONE_LIMIT", "Достигнут лимит кубов в костях.");
      bone.cubes.push(cube);
      p.texturePlan.faces.push({ cubeId: nextId, uv });
      p.parts.push({
        id: nextId,
        label: source ? "Копия куба" : "Новый куб",
        cubeIds: [nextId],
        locked: false,
      });
      break;
    }
  }
}
const labels: Record<EditorCommand["type"], string> = {
  transform: "Изменение формы",
  recolor: "Смена цвета",
  rotate: "Поворот",
  pivot: "Центр вращения",
  snap: "Привязка к сетке",
  add: "Новый куб",
  delete: "Удаление",
  duplicate: "Копия куба",
  lock: "Закрепление части",
  paint: "Пиксельный штрих",
  fill: "Заливка пикселей",
  uv: "Развёртка UV",
  undo: "Отмена",
  redo: "Повтор",
  brief: "Задание для модели",
  designBrief: "Структурированный бриф",
  checkpoint: "Сохранение варианта",
  restoreVariant: "Возврат к варианту",
  deleteVariant: "Удаление варианта",
};
interface Entry {
  before: EditorProject;
  after: EditorProject;
  label: string;
  actor: "human" | "agent";
}
export function previewTexture(
  project: EditorProject,
  value: TextureCommand,
): EditorProject {
  const command = CommandSchema.parse(value);
  const candidate = structuredClone(project);
  applyCommand(candidate, command, "human");
  return validateProject(candidate);
}
export class EditorSession {
  private project: EditorProject;
  private revision = 0;
  private savedRevision = -1;
  private savedProject: string | null = null;
  private dirty = true;
  private past: Entry[] = [];
  private future: Entry[] = [];
  private replay = new Map<string, { signature: string; revision: number }>();
  constructor(project: EditorProject) {
    this.project = validateProject(project);
  }
  state(): EditorState {
    return structuredClone({
      project: this.project,
      revision: this.revision,
      savedRevision: this.savedRevision,
      dirty: this.dirty,
      canUndo: !!this.past.length,
      canRedo: !!this.future.length,
      history: this.past
        .slice(-8)
        .map(({ label, actor }) => ({ label, actor })),
    });
  }
  markSaved(): void {
    this.savedRevision = this.revision;
    this.savedProject = JSON.stringify(this.project);
    this.dirty = false;
  }
  preview(value: unknown, actor: "human" | "agent" = "agent"): EditorState {
    // Изолированная копия сохраняет все проверки истории, revision и ключей повтора.
    const fork = new EditorSession(this.project);
    fork.revision = this.revision;
    fork.savedRevision = this.savedRevision;
    fork.savedProject = this.savedProject;
    fork.dirty = this.dirty;
    fork.past = structuredClone(this.past);
    fork.future = structuredClone(this.future);
    fork.replay = structuredClone(this.replay);
    return fork.apply(value, actor);
  }
  apply(value: unknown, actor: "human" | "agent" = "human"): EditorState {
    const text = JSON.stringify(value);
    if (
      typeof text !== "string" ||
      new TextEncoder().encode(text).length > MAX_COMMAND_BYTES
    )
      fail("SIZE_LIMIT", "Запрос превышает лимит размера.");
    const parsed = MutationSchema.safeParse(value);
    if (!parsed.success)
      fail("INVALID_COMMAND", "Команда не соответствует формату редактора.");
    const request = parsed.data;
    if (request.projectId !== this.project.projectId)
      fail("PROJECT_CONFLICT", "Активный проект изменился.");
    const signature = JSON.stringify({ actor, request }),
      replay = this.replay.get(request.key);
    if (replay) {
      if (replay.signature !== signature)
        fail("KEY_CONFLICT", "Ключ повтора уже использован другой командой.");
      return this.state();
    }
    if (request.expectedRevision !== this.revision)
      fail(
        "REVISION_CONFLICT",
        "Проект уже изменился. Обновите данные и повторите действие.",
      );
    const first = request.commands[0]!;
    if (first.type === "undo" || first.type === "redo") {
      if (request.commands.length !== 1)
        fail("HISTORY_BATCH", "История меняется отдельной командой.");
      const from = first.type === "undo" ? this.past : this.future,
        entry = from.at(-1);
      if (!entry) fail("EMPTY_HISTORY", "Нет действий для отмены или повтора.");
      if (actor === "agent" && entry.actor !== "agent")
        fail("HUMAN_HISTORY", "Агент не может отменить ручное действие.");
      const candidate = first.type === "undo" ? entry.before : entry.after;
      if (
        actor === "agent" &&
        this.project.parts.some(
          (part) =>
            part.locked &&
            JSON.stringify(
              part.cubeIds.map((s) =>
                cubes(this.project).find((c) => c.id === s),
              ),
            ) !==
              JSON.stringify(
                part.cubeIds.map((s) =>
                  cubes(candidate).find((c) => c.id === s),
                ),
              ),
        )
      )
        fail("LOCKED", "История меняет закреплённую часть.");
      from.pop();
      (first.type === "undo" ? this.future : this.past).push(entry);
      this.project = structuredClone(candidate);
    } else {
      const candidate = structuredClone(this.project);
      for (const command of request.commands)
        applyCommand(candidate, command, actor);
      const valid = validateProject(candidate);
      this.past.push({
        before: this.project,
        after: valid,
        label: labels[first.type],
        actor,
      });
      if (this.past.length > 50) this.past.shift();
      this.future = [];
      this.project = valid;
    }
    this.revision++;
    this.dirty = JSON.stringify(this.project) !== this.savedProject;
    this.replay.set(request.key, { signature, revision: this.revision });
    if (this.replay.size > 100)
      this.replay.delete(this.replay.keys().next().value!);
    return this.state();
  }
}
