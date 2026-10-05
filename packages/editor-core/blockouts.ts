import type { EditorProject } from "./index.ts";

export const AGENT_DRAFT_PREFIX = "ИИ-черновик · ";
export const AGENT_DRAFT_NOTE = "Черновик агента. Художественная приёмка человеком не выполнена. ";
export const MAX_AGENT_DRAFTS = 3;

/** Сравниваем размещённые кубоиды без IDs, UV, цвета и служебного pivot при rotation=0. */
export function blockoutGeometry(project: Pick<EditorProject, "model">): string {
  const boxes = project.model.bones.flatMap(bone => bone.cubes.map(cube => {
    const rotation = cube.rotation.map(angle => angle * Math.PI / 180);
    const [x, y, z] = rotation;
    const points: string[] = [];
    for (const X of [0, 1]) for (const Y of [0, 1]) for (const Z of [0, 1]) {
      const local = cube.origin.map((origin, axis) => origin +
        ([X, Y, Z][axis] ? cube.size[axis]! + cube.inflate : -cube.inflate) - cube.pivot[axis]!);
      // Euler XYZ, как renderer; native held-item допускает одну вращаемую ось.
      const px = local[0]!, py = local[1]!, pz = local[2]!;
      const a = px * Math.cos(z!) - py * Math.sin(z!);
      const b = px * Math.sin(z!) + py * Math.cos(z!);
      const c = a * Math.cos(y!) + pz * Math.sin(y!);
      const d = -a * Math.sin(y!) + pz * Math.cos(y!);
      const e = b * Math.cos(x!) - d * Math.sin(x!);
      const f = b * Math.sin(x!) + d * Math.cos(x!);
      points.push([c, e, f].map((value, axis) =>
        // Одинаковые представления координат не создают новый вариант из-за float noise.
        Math.round((value + cube.pivot[axis]!) * 1_000_000) / 1_000_000).join(","));
    }
    return points.sort().join(";");
  }));
  // Полное дублирование одинакового кубоида не меняет blockout.
  return [...new Set(boxes)].sort().join("|");
}
