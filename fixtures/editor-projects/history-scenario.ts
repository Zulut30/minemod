import type { EditorProject, EditorCommand } from "../../packages/editor-core/index.ts";

/** Фиксированный сложный сценарий для нашего painted weapon fixture. */
export function historyScenario(project: EditorProject, variantId: string): EditorCommand[][] {
  const cubeId = "guard_center";
  const [u, v, U, V] = project.texturePlan.faces.find((f) => f.cubeId === cubeId)!.uv.north;
  const seed: [number, number] = [Math.min(u, U), Math.min(v, V)];
  return [
    [{ type: "lock", partId: "guard", locked: true }],
    [{ type: "lock", partId: "guard", locked: false }],
    [{ type: "brief", text: "Проверка полной истории: геометрия, рисунок, UV, части и варианты." }],
    [{ type: "checkpoint", variantId, label: "Контроль истории", note: "До правок" }],
    [{ type: "transform", cubeIds: [cubeId], translation: [.25, 0, 0], scale: [1, 1, 1] }],
    [{ type: "paint", cubeIds: [cubeId], face: "north", color: "#fa6723", size: 1, points: [seed] }],
    [{ type: "fill", cubeIds: [cubeId], face: "north", color: "#29c8b0", seed }],
    [{ type: "uv", cubeId, face: "north", rect: [U, v, u, V] }],
    [{ type: "duplicate", cubeId, newId: "history_copy" }],
    [{ type: "rotate", cubeIds: ["history_copy"], axis: "y", angle: 22.5 }],
    [{ type: "add", cubeId: "history_added" }],
    [{ type: "lock", partId: "history_added", locked: true }],
    [{ type: "lock", partId: "history_added", locked: false }],
    [{ type: "delete", cubeIds: ["history_added"] }],
    [{ type: "restoreVariant", variantId }],
    [{ type: "deleteVariant", variantId }],
    [{ type: "transform", cubeIds: [cubeId], translation: [.125, 0, 0], scale: [1, 1, 1] }],
  ];
}
