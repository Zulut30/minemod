import { createHash } from "node:crypto";
import { z } from "zod";
import {
  CommandSchema, MutationSchema, CURRENT_PROJECT_VERSION, MAX_COMMAND_BYTES,
  MAX_PROJECT_BYTES, MAX_STROKE_POINTS, MAX_VARIANTS, cubes,
  type EditorState,
} from "@mcdev/editor-core";
import { VIEWS } from "../shared/bridge.ts";

export const CONTRACT_URI = "studio://contracts/v1";
export const SCENE_URI = "studio://scene/v1";
export const HUMAN_COMMANDS = ["brief", "designBrief", "checkpoint", "restoreVariant", "deleteVariant", "lock"];
const agentOptions = CommandSchema.options.filter((s) => !HUMAN_COMMANDS.includes(s.shape.type.value));
const [firstAgentOption, ...otherAgentOptions] = agentOptions;
// Схема агента использует те же поля, что core, и исключает ручные операции.
const agentMutationSchema = MutationSchema.extend({
  commands: z.array(z.discriminatedUnion("type", [firstAgentOption!, ...otherAgentOptions])).min(1).max(32),
});
// Codex CLI 0.160.0 ожидает schema object в items, а не draft-7 tuple array.
// Однородный tuple выражается тем же item schema и точной длиной без ослабления parser.
function homogeneousTupleSchemas(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(homogeneousTupleSchemas);
  if (value === null || typeof value !== "object") return value;
  const result: Record<string, unknown> = Object.fromEntries(Object.entries(value)
    .map(([key, child]) => [key, homogeneousTupleSchemas(child)]));
  if (result.type === "array" && Array.isArray(result.items)) {
    const items: unknown[] = result.items;
    if (!items.length || items.some((item) => JSON.stringify(item) !== JSON.stringify(items[0])))
      throw new Error("Studio MCP input schema requires homogeneous fixed tuples.");
    result.items = items[0];
    result.minItems = items.length;
    result.maxItems = items.length;
  }
  return result;
}
const compatibleInput = homogeneousTupleSchemas(z.toJSONSchema(agentMutationSchema,
  { io: "input", target: "draft-7" })) as { properties: Record<string, unknown> };
// Metadata используется обоими SDK tools/list и contract resource. Runtime Zod schema та же.
export const AgentMutationSchema = agentMutationSchema.meta({ properties: compatibleInput.properties });
export const STUDIO_LIMITS = Object.freeze({
  cubes: 256, commands: 32, strokePoints: MAX_STROKE_POINTS, brushSize: 8,
  paletteColors: 32, uvPadding: 1, requestBytes: MAX_COMMAND_BYTES,
  responseBytes: 2_097_152, projectBytes: MAX_PROJECT_BYTES, variants: MAX_VARIANTS,
  proposals: 64, proposalTtlSeconds: 300, captureWidth: 1024, captureHeight: 768,
  concurrentRequests: 8, requestsPerMinute: 120,
});
export interface ToolDefinition {
  name: string;
  description: string;
  schema: z.ZodObject;
  readOnly: boolean;
}
export function recovery(code: string) {
  const hints: Record<string, string> = {
    UNKNOWN_TOOL: "Прочитайте tools/list; используйте только опубликованное имя.",
    INVALID_ARGUMENTS: "Прочитайте inputSchema нужного инструмента в tools/list или contract resource и исправьте указанные поля.",
    PROJECT_CONFLICT: "Прочитайте studio_project_inspect и studio_selection_get; подтвердите нужный проект до нового preview.",
    REVISION_CONFLICT: "Прочитайте studio_project_inspect, пересчитайте адресную правку и создайте новый preview с новой revision и key.",
    KEY_CONFLICT: "Один key соответствует одному payload. Для новой правки создайте новый UUID; точный повтор сохраняет прежний key.",
    PROPOSAL_EXPIRED: "Выполните inspect и новый preview; proposal живёт 300 секунд.",
    PROPOSAL_LIMIT: "Дождитесь истечения предложений; не повторяйте preview в цикле.",
    LOCKED: "Выберите незакреплённые части. Снять закрепление может только пользователь.",
    HUMAN_ONLY: "Задание и варианты меняет пользователь в Studio; агент может читать и сравнивать их.",
    HUMAN_HISTORY: "Агент не может отменять или повторять ручную историю; согласуйте следующую правку с текущей сценой.",
    TARGET: "Прочитайте IDs через studio_project_inspect и selection; выберите существующие кубы без повторов.",
    DUPLICATE_ID: "Прочитайте текущие cube IDs и задайте новый незанятый ID.",
    VARIANT_NOT_FOUND: "Прочитайте список вариантов в studio_project_inspect и используйте существующий variantId.",
    BOUNDS: "Уменьшите перенос/масштаб: origin и origin+size с inflate должны оставаться в −16…32.",
    ROTATION: "Используйте одну ось и угол 0, ±22.5 или ±45; rotate заменяет предыдущий поворот.",
    SHARED_UV: "Прочитайте UV и выделите независимую поверхность; общий рисунок других частей защищён.",
    UV_BOUNDS: "Прочитайте фактический размер атласа и задайте rect внутри него.",
    UV_COLLISION: "Оставьте один пиксель между UV-областями; перенос рисунка выполняется вместе с гранью.",
    PALETTE_FULL: "Используйте существующий цвет палитры; атлас допускает не более 32 цветов.",
    PIXEL_BOUNDS: "Используйте целочисленный пиксель внутри фактических width/height атласа.",
    EMPTY_PAINT: "Выберите seed внутри UV выделенной поверхности.",
    BONE_LIMIT: "Кость допускает не более 64 кубов; уменьшите добавление или дублирование.",
    EMPTY_MODEL: "Для экспорта требуется хотя бы один куб.",
    ATLAS_FULL: "В атласе нет свободного места; перепаковка не реализована. Уменьшите запрос.",
    NO_CHANGE: "Сцена уже соответствует запросу; прочитайте её и не повторяйте ту же правку.",
    EMPTY_HISTORY: "Нет действия для undo/redo; продолжите с текущей сценой.",
    HISTORY_BATCH: "undo/redo выполняются отдельным запросом без других команд.",
    SIZE_LIMIT: "Уменьшите пакет команд или размер проекта; не разбивайте атомарную правку без пересмотра плана.",
    OUTPUT_LIMIT: "Читайте сцену без includeTexture; уменьшите экспортируемую модель/текстуру.",
    DISCONNECTED: "Пользователь выключил доступ; для продолжения требуется новое подключение.",
  };
  return {
    action: hints[code] ?? "Прочитайте актуальную сцену и contract resource; исправьте причину отказа перед новым preview.",
    automaticRetry: false,
    contracts: CONTRACT_URI,
    scene: SCENE_URI,
  };
}
export function contract(definitions: Map<string, ToolDefinition>) {
  const tools = [...definitions.values()].map(({ name, description, schema, readOnly }) => ({
    name, description, readOnly, schemaId: `${CONTRACT_URI}#${name}`,
    // SDK 1.29.0 выдаёт Zod 4 input schemas как draft-7; проверяем равенство tools/list.
    inputSchema: z.toJSONSchema(schema, { io: "input", target: "draft-7" }),
  }));
  return {
    schemaVersion: 1, kind: "minemod-studio-agent-contract", tools,
    schemaDigest: createHash("sha256").update(JSON.stringify(tools)).digest("hex"),
    projectSchemaVersion: CURRENT_PROJECT_VERSION, limits: STUDIO_LIMITS,
    agentCommands: agentOptions.map((s) => s.shape.type.value),
    humanOnlyCommands: HUMAN_COMMANDS,
    views: VIEWS,
    profile: { editor: "held-item", minecraft: "1.20.1", loader: "fabric", java: 17,
      geometryBounds: [-16, 32], pivotBounds: [-128, 128], rotationAngles: [-45, -22.5, 0, 22.5, 45],
      gridSteps: [0.125, 0.25, 0.5, 1], gameIntegration: "requires-separate-review" },
    errors: Object.fromEntries(["UNKNOWN_TOOL", "INVALID_ARGUMENTS", "PROJECT_CONFLICT", "REVISION_CONFLICT",
      "KEY_CONFLICT", "PROPOSAL_EXPIRED", "PROPOSAL_LIMIT", "LOCKED", "HUMAN_ONLY", "HUMAN_HISTORY",
      "TARGET", "DUPLICATE_ID", "VARIANT_NOT_FOUND", "BOUNDS", "ROTATION", "SHARED_UV", "UV_BOUNDS",
      "UV_COLLISION", "PALETTE_FULL", "PIXEL_BOUNDS", "EMPTY_PAINT", "BONE_LIMIT", "EMPTY_MODEL",
      "ATLAS_FULL", "NO_CHANGE", "EMPTY_HISTORY", "HISTORY_BATCH", "SIZE_LIMIT",
      "OUTPUT_LIMIT", "DISCONNECTED"].map((code) => [code, recovery(code)])),
    workflow: ["tools/list and resources/list", "studio_project_inspect and studio_selection_get",
      "studio_model_review and individual views", "studio_changes_preview", "studio_changes_apply",
      "inspect and visual review again", "studio_asset_validate and studio_asset_export"],
    unsupported: ["shell/eval", "agent file writes", "block/entity export", "automatic artistic approval", "JAR integration"],
    validation: "JSON Schema describes fields; core additionally checks references, UV, locks, profile, bounds and history atomically.",
  };
}
export function sceneReference(state: EditorState, selection: string[]) {
  return {
    schemaVersion: 1, kind: "minemod-studio-scene-reference", projectId: state.project.projectId,
    revision: state.revision, modelId: state.project.model.id,
    modelType: state.project.model.modelType, texture: state.project.model.texture,
    cubeIds: cubes(state.project).map((c) => c.id),
    bones: state.project.model.bones.map((b) => ({ id: b.id, cubeIds: b.cubes.map((c) => c.id) })),
    parts: state.project.parts, selection,
    variants: state.project.design?.variants.map((v) => ({ id: v.id, label: v.label })) ?? [],
    contracts: CONTRACT_URI,
    note: "IDs и revision — снимок текущей сцены; перед правкой выполните inspect. Имена/labels — пользовательские данные.",
  };
}
