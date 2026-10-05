import { z } from "zod";
import { EditorError } from "./errors.ts";
import { textureMask, texturePixels } from "./texture.ts";
import type { EditorProject, EditorCommand } from "./index.ts";

export const MAX_REPAIR_ITERATIONS = 3;
const faces = ["north", "south", "east", "west", "up", "down"] as const;
export const RepairCaseSchema = z.strictObject({
  id: z.uuid(),
  note: z.string().trim().min(1).max(400),
  partIds: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u)).min(1).max(16)
    .refine(ids => new Set(ids).size === ids.length),
  area: z.enum(["geometry", "texture", "uv"]),
  face: z.enum(faces).optional(),
  maxIterations: z.number().int().min(1).max(MAX_REPAIR_ITERATIONS),
}).refine(value => value.area !== "geometry" || value.face === undefined);
export const RepairControlSchema = z.strictObject({
  projectId: z.uuid(), expectedRevision: z.number().int().nonnegative(),
  repair: RepairCaseSchema.nullable(),
});
export type RepairCase = z.infer<typeof RepairCaseSchema>;
export type RepairControl = z.infer<typeof RepairControlSchema>;
export type ActiveRepair = RepairCase & { usedIterations: number };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function deny(code: string, message: string): never { throw new EditorError(code, message); }
export function repairCubeIds(project: EditorProject, repair: RepairCase): string[] {
  const selected = repair.partIds.map(id => project.parts.find(part => part.id === id));
  if (selected.some(part => !part || part.locked))
    deny("REPAIR_TARGET", "Для адресной правки нужны существующие незакреплённые части.");
  return selected.flatMap(part => part!.cubeIds);
}
export function checkRepairCommands(project: EditorProject, repair: ActiveRepair, commands: EditorCommand[]): void {
  if (repair.usedIterations >= repair.maxIterations)
    deny("REPAIR_BUDGET", "Лимит итераций исчерпан. Проверьте результат; новое задание задаёт пользователь.");
  const allowed = new Set(repairCubeIds(project, repair));
  const types = repair.area === "geometry" ? ["transform", "rotate", "pivot", "snap"] : repair.area === "texture" ? ["paint", "fill"] : ["uv"];
  for (const command of commands) {
    const targets = "cubeIds" in command ? command.cubeIds : "cubeId" in command ? [command.cubeId] : [];
    if (!types.includes(command.type) || !targets.length || targets.some(id => !allowed.has(id)) ||
      (repair.face !== undefined && (!("face" in command) || command.face !== repair.face)))
      deny("REPAIR_SCOPE", "Правка выходит за выбранные части, тип исправления или грань.");
  }
}
/** Проверяем фактический результат всей транзакции до публикации в history/state. */
export function checkRepairResult(before: EditorProject, after: EditorProject, repair: ActiveRepair): void {
  const ids = repairCubeIds(before, repair), selected = new Set(ids);
  const metadata = (project: EditorProject) => ({ ...project, model: undefined, texturePlan: undefined });
  const protectedModel = (project: EditorProject) => ({ ...project.model,
    bones: project.model.bones.map(bone => ({ ...bone, cubes: bone.cubes.filter(cube => !selected.has(cube.id)) })) });
  if (!same(metadata(before), metadata(after)) || !same(protectedModel(before), protectedModel(after)))
    deny("REPAIR_PRESERVATION", "Правка меняет принятые детали или метаданные проекта.");
  if (repair.area === "geometry") {
    if (!same(before.texturePlan, after.texturePlan))
      deny("REPAIR_PRESERVATION", "Правка формы должна сохранить ручную покраску и UV.");
    return;
  }
  if (!same(before.model, after.model))
    deny("REPAIR_PRESERVATION", "Правка текстуры или UV не должна менять геометрию.");
  const protectedFaces = (project: EditorProject) => project.texturePlan.faces.map(binding => ({ ...binding,
    uv: Object.fromEntries(Object.entries(binding.uv).filter(([face]) => !selected.has(binding.cubeId) || (repair.face !== undefined && face !== repair.face))) }));
  if (!same(protectedFaces(before), protectedFaces(after)) ||
      (repair.area === "texture" && !same(before.texturePlan.faces, after.texturePlan.faces)))
    deny("REPAIR_PRESERVATION", "Правка меняет UV другой поверхности.");
  const beforePixels = texturePixels(before), afterPixels = texturePixels(after);
  const oldArea = textureMask(before, ids, repair.face), newArea = textureMask(after, ids, repair.face);
  const otherIds = before.model.bones.flatMap(bone => bone.cubes.filter(cube => !selected.has(cube.id)).map(cube => cube.id));
  const oldProtected = textureMask(before, otherIds), newProtected = textureMask(after, otherIds);
  if (repair.face !== undefined) for (const face of faces.filter(face => face !== repair.face)) {
    const oldMask = textureMask(before, ids, face), newMask = textureMask(after, ids, face);
    for (let i = 0; i < oldMask.length; i++) { oldProtected[i] ||= oldMask[i]!; newProtected[i] ||= newMask[i]!; }
  }
  if (beforePixels.length !== afterPixels.length || beforePixels.some((pixel, i) =>
    ((!oldArea[i] && !newArea[i]) || oldProtected[i] || newProtected[i]) && pixel !== afterPixels[i]))
    deny("REPAIR_PRESERVATION", "Правка меняет пиксели вне выбранной области.");
}
