import { createServer, type Server } from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import process from "node:process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import {
  EditorError,
  MutationSchema,
  cubes,
  assetRequest,
  MAX_COMMAND_BYTES,
  type EditorState,
  type Mutation,
  type EditorProject,
} from "@mcdev/editor-core";
import { VIEWS, type View } from "../shared/bridge.ts";
import { compileItemAssetBundleV1 } from "../../../packages/application/asset-bundles.ts";
import {
  AgentMutationSchema, CONTRACT_URI, SCENE_URI, HUMAN_COMMANDS, STUDIO_LIMITS,
  contract, sceneReference, recovery, type ToolDefinition,
} from "./discovery.ts";

export interface McpEditor {
  inspect: () => EditorState;
  selection: () => string[];
  preview: (mutation: Mutation) => EditorState;
  apply: (mutation: Mutation) => Promise<EditorState>;
  capture: (
    state: EditorState,
    view: View,
    options?: {
      referenceProject?: EditorProject;
      silhouette?: boolean;
      layout?: "review";
    },
  ) => Promise<string>;
  export: () => unknown;
  // Общая очередь также обслуживает ручные изменения и файловые операции.
  enqueue: <T>(operation: () => Promise<T> | T) => Promise<T>;
}
interface Proposal {
  mutation: Mutation;
  expires: number;
}
const refSchema = z.strictObject({
  projectId: z.uuid(),
  expectedRevision: z.number().int().min(0),
});
const MAX_RESPONSE_BYTES = STUDIO_LIMITS.responseBytes;
function json(value: unknown) {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES)
    throw new EditorError("OUTPUT_LIMIT", "Результат превышает лимит ответа.");
  return { content: [{ type: "text" as const, text }] };
}
function toolError(code: string, message: string, details?: unknown): CallToolResult {
  const error = { code, message, recovery: recovery(code), ...(details ? { details } : {}) };
  return { ...json({ error }), structuredContent: { error }, isError: true };
}
function reference(state: EditorState, args: z.infer<typeof refSchema>): void {
  if (state.project.projectId !== args.projectId)
    throw new EditorError("PROJECT_CONFLICT", "Активный проект изменился.");
  if (state.revision !== args.expectedRevision)
    throw new EditorError(
      "REVISION_CONFLICT",
      "Проект уже изменился. Сначала прочитайте его заново.",
    );
}
function summary(state: EditorState) {
  return {
    projectId: state.project.projectId,
    revision: state.revision,
    cubeCount: cubes(state.project).length,
    history: state.history,
  };
}

export async function startEditorMcp(
  editor: McpEditor,
): Promise<{ server: Server; url: string; token: string; close: () => void }> {
  const token = randomBytes(32).toString("hex");
  let enabled = true;
  const proposals = new Map<string, Proposal>();
  const definitions = new Map<string, ToolDefinition>();
  const prune = () => {
    for (const [id, proposal] of proposals)
      if (proposal.expires <= Date.now()) proposals.delete(id);
  };
  function makeServer() {
    const mcp = new McpServer(
      {
        name: "minemod-studio",
        version: process.env.MINEMOD_STUDIO_VERSION ?? "development",
      },
      {
        instructions:
          `Сначала tools/list и resources/list: актуальные schemas и ограничения доступны в ${CONTRACT_URI}, текущие IDs/revision в ${SCENE_URI}. Не придумывайте имена инструментов или кубов. Ошибка содержит code и recovery; исправьте причину, не повторяйте запрос автоматически. ` +
          "Для создания качественной модели используйте studio_model_review до правок и после каждого крупного этапа: обзор содержит четыре ракурса, силуэт и 32/64 px. Сначала сформулируйте 2-3 конкретных видимых недостатка и адресный план; меняйте пропорции отдельных деталей и рисунок нужных UV-граней, а не только общий масштаб и цвет. Сначала читаемый силуэт, затем различимые материалы и крупный акцент, затем мелкие детали. На 32 px декоративные руны не должны превращаться в шум. Сравните повторный обзор с предыдущим; если проблема осталась, исправьте именно её. Не выдумывайте визуальные оценки без просмотра изображения. Обзор не является игровым инвентарём или автоматическим художественным score. " +
          "Перед художественной правкой прочитайте project.design.brief и список вариантов. studio_variant_inspect читает исходник без изменения сцены. studio_view_capture с variantId снимает сохранённый вариант, compareToVariantId снимает рабочую модель с тем же общим кадрированием; сравнивайте одну сторону и масштаб. silhouette помогает оценить форму отдельно от покраски. Сделайте адресную правку, проверьте front/back/left/right/top/bottom/perspective/rear-perspective и исправьте конкретный видимый недостаток. side — совместимое имя right. studio_model_review остаётся быстрым обзором четырёх видов. Сохранённые варианты и задание меняет только пользователь; не пытайтесь их удалять или подменять. " +
          "Локальная сцена MineMod. Сначала studio_project_inspect и studio_selection_get. Для изменения: studio_changes_preview с projectId, expectedRevision и UUID key; затем studio_changes_apply с proposalId. Покраска: paint задаёт целочисленные points (до 4096), size 1..8, color #RRGGBB или null для ластика, cubeIds и необязательную face; fill заливает связную область одного цвета от seed. uv переносит грань одного cubeId в rect вместе с рисунком; нужен отступ 1 пиксель от других UV. Общие пиксели других поверхностей защищены, палитра до 32 цветов. Не изменяйте закреплённые части. Ручные изменения могут сделать предложение устаревшим. После применения посмотрите studio_view_capture с нескольких сторон. Техническая проверка и снимок не доказывают художественное качество или работу в Minecraft. Сохранение, смена проекта и интеграция в JAR выполняются пользователем в редакторе.",
      },
    );
    const tool = <S extends z.ZodObject>(
      name: string,
      description: string,
      schema: S,
      readOnly: boolean,
      operation: (args: z.infer<S>) => Promise<CallToolResult> | CallToolResult,
    ) => {
      definitions.set(name, { name, description, schema, readOnly });
      mcp.registerTool(
        name,
        {
          description,
          inputSchema: schema as z.ZodObject,
          _meta: { "studio/schemaId": `${CONTRACT_URI}#${name}` },
          annotations: {
            readOnlyHint: readOnly,
            destructiveHint: !readOnly,
            openWorldHint: false,
          },
        },
        async (args): Promise<CallToolResult> => {
          try {
            const result = await editor.enqueue(() => {
              if (!enabled)
                throw new EditorError(
                  "DISCONNECTED",
                  "Подключение выключено пользователем.",
                );
              return operation(args as z.infer<S>);
            });
            if (Buffer.byteLength(JSON.stringify(result)) > MAX_RESPONSE_BYTES)
              throw new EditorError("OUTPUT_LIMIT", "Результат превышает лимит ответа.");
            return result;
          } catch (error) {
            return error instanceof EditorError
              ? toolError(error.code, error.message)
              : toolError("STUDIO_ERROR", "Операция не выполнена; прочитайте актуальную сцену.");
          }
        },
      );
    };
    tool(
      "studio_project_inspect",
      "Прочитать общую сцену, кубы, UV, части и палитру. includeTexture добавляет пиксельные строки атласа.",
      z.strictObject({ includeTexture: z.boolean().default(false) }),
      true,
      ({ includeTexture }) => {
        const state = editor.inspect();
        const { rows, ...texture } = state.project.texturePlan;
        return json({
          ...state,
          project: {
            ...state.project,
            texturePlan: includeTexture ? { ...texture, rows } : texture,
            ...(state.project.design
              ? {
                  design: {
                    brief: state.project.design.brief,
                    variants: state.project.design.variants.map((v) => ({
                      id: v.id,
                      label: v.label,
                      note: v.note,
                      cubeCount: cubes(v.project).length,
                    })),
                  },
                }
              : {}),
          },
          limits: STUDIO_LIMITS,
          discovery: { contracts: CONTRACT_URI, scene: SCENE_URI },
        });
      },
    );
    tool(
      "studio_variant_inspect",
      "Прочитать неизменяемый сохранённый вариант для сравнения формы/UV/палитры. Задание и варианты редактируются только пользователем. includeTexture добавляет пиксели.",
      refSchema.extend({
        variantId: z.uuid(),
        includeTexture: z.boolean().default(false),
      }),
      true,
      (args) => {
        const state = editor.inspect();
        reference(state, args);
        const variant = state.project.design?.variants.find(
          (v) => v.id === args.variantId,
        );
        if (!variant)
          throw new EditorError(
            "VARIANT_NOT_FOUND",
            "Сохранённый вариант не найден.",
          );
        const { rows, ...texture } = variant.project.texturePlan;
        return json({
          ...summary(state),
          variant: {
            ...variant,
            project: {
              ...variant.project,
              texturePlan: args.includeTexture ? { ...texture, rows } : texture,
            },
          },
        });
      },
    );
    tool(
      "studio_selection_get",
      "Текущее ручное выделение в общей сцене.",
      z.strictObject({}),
      true,
      () => json({ ...summary(editor.inspect()), cubeIds: editor.selection() }),
    );
    tool(
      "studio_changes_preview",
      "Атомарно проверить пакет команд, включая pivot, snap, paint, fill и uv, без изменения сцены. pivot меняет одну координату центра вращения; snap переносит начало выделения на сетку без изменения формы. rotate заменяет прежний поворот: одна ось, 0/±22.5/±45 градусов. Вернуть diff и proposalId. Проверяются история, закрепления, общие UV и лимиты.",
      AgentMutationSchema,
      true,
      (mutation) => {
        const before = editor.inspect(),
          candidate = editor.preview(mutation);
        prune();
        if (proposals.size >= 64)
          throw new EditorError(
            "PROPOSAL_LIMIT",
            "Слишком много предложений; дождитесь истечения старых.",
          );
        const proposalId = randomUUID();
        proposals.set(proposalId, {
          mutation: structuredClone(mutation),
          expires: Date.now() + 300_000,
        });
        const old = new Map(
          cubes(before.project).map((cube) => [cube.id, JSON.stringify(cube)]),
        );
        const next = new Map(
          cubes(candidate.project).map((cube) => [
            cube.id,
            JSON.stringify(cube),
          ]),
        );
        return json({
          proposalId,
          projectId: before.project.projectId,
          baseRevision: before.revision,
          expiresInSeconds: 300,
          changes: {
            added: [...next.keys()].filter((id) => !old.has(id)),
            removed: [...old.keys()].filter((id) => !next.has(id)),
            geometry: [...next.keys()].filter(
              (id) => old.has(id) && old.get(id) !== next.get(id),
            ),
            textureChanged:
              JSON.stringify(before.project.texturePlan) !==
              JSON.stringify(candidate.project.texturePlan),
          },
          visualReview:
            "После применения требуются снимки и человеческая оценка.",
        });
      },
    );
    tool(
      "studio_changes_apply",
      "Применить проверенное предложение к исходному projectId/revision. Повтор с тем же proposalId не применяет правку дважды.",
      z.strictObject({ projectId: z.uuid(), proposalId: z.uuid() }),
      false,
      async ({ projectId, proposalId }) => {
        prune();
        const proposal = proposals.get(proposalId);
        if (!proposal)
          throw new EditorError(
            "PROPOSAL_EXPIRED",
            "Предложение отсутствует или истекло; выполните preview заново.",
          );
        if (proposal.mutation.projectId !== projectId)
          throw new EditorError(
            "PROJECT_CONFLICT",
            "Предложение принадлежит другому проекту.",
          );
        return json(summary(await editor.apply(proposal.mutation)));
      },
    );
    tool(
      "studio_history_undo",
      "Отменить последнюю правку агента. Ручную правку агент отменить не может. UUID key обеспечивает безопасный повтор.",
      refSchema.extend({ key: z.uuid() }),
      false,
      async (args) =>
        json(
          summary(
            await editor.apply({ ...args, commands: [{ type: "undo" }] }),
          ),
        ),
    );
    tool(
      "studio_view_capture",
      "PNG общей сцены 1024×768: front/back/left/right/top/bottom/perspective/rear-perspective; side — прежнее имя right. Общий масштаб учитывает pivot, поворот и inflate. Скрытый рендер не меняет ручную камеру, выделение и сцену. Показывает все части; revision должна совпадать.",
      refSchema.extend({
        view: z
          .enum(VIEWS)
          .default("perspective"),
        variantId: z.uuid().optional(),
        compareToVariantId: z.uuid().optional(),
        silhouette: z.boolean().default(false),
      }),
      true,
      async (args) => {
        const state = editor.inspect();
        reference(state, args);
        const variant = (id?: string) => {
          if (!id) return undefined;
          const result = state.project.design?.variants.find(
            (v) => v.id === id,
          );
          if (!result)
            throw new EditorError(
              "VARIANT_NOT_FOUND",
              "Сохранённый вариант не найден.",
            );
          return result;
        };
        const chosen = variant(args.variantId),
          compared = variant(args.compareToVariantId);
        const referenceProject =
          compared?.project ?? (chosen ? state.project : undefined);
        const data = await editor.capture(
          { ...state, project: chosen?.project ?? state.project },
          args.view,
          {
            ...(referenceProject ? { referenceProject } : {}),
            ...(args.silhouette ? { silhouette: true } : {}),
          },
        );
        if (data.length > MAX_RESPONSE_BYTES)
          throw new EditorError(
            "OUTPUT_LIMIT",
            "Снимок превышает лимит ответа.",
          );
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                ...summary(state),
                view: args.view,
                width: 1024,
                height: 768,
                ...(args.variantId ? { variantId: args.variantId } : {}),
                ...(args.compareToVariantId
                  ? { compareToVariantId: args.compareToVariantId }
                  : {}),
                silhouette: args.silhouette,
                renderedCubeCount: cubes(chosen?.project ?? state.project)
                  .length,
                visualReview: "Рендер редактора; работа в игре не проверена.",
              }),
            },
            { type: "image" as const, data, mimeType: "image/png" },
          ],
        };
      },
    );
    tool(
      "studio_model_review",
      "Единый PNG-обзор 1024×768: front/side/back/perspective, силуэт и 32/64 px. Для визуальной критики и адресного repair loop; не меняет сцену, выделение и ручную камеру. Не даёт художественную оценку автоматически.",
      refSchema.extend({
        variantId: z.uuid().optional(),
        compareToVariantId: z.uuid().optional(),
      }),
      true,
      async (args) => {
        const state = editor.inspect();
        reference(state, args);
        const find = (id?: string) => {
          if (!id) return undefined;
          const value = state.project.design?.variants.find((v) => v.id === id);
          if (!value)
            throw new EditorError(
              "VARIANT_NOT_FOUND",
              "Сохранённый вариант не найден.",
            );
          return value.project;
        };
        const rendered = find(args.variantId) ?? state.project;
        const referenceProject =
          find(args.compareToVariantId) ??
          (args.variantId ? state.project : undefined);
        const data = await editor.capture(
          { ...state, project: rendered },
          "perspective",
          {
            layout: "review",
            ...(referenceProject ? { referenceProject } : {}),
          },
        );
        const result = {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                ...summary(state),
                width: 1024,
                height: 768,
                variantId: args.variantId,
                compareToVariantId: args.compareToVariantId,
                brief: state.project.design?.brief ?? "",
                lockedParts: rendered.parts
                  .filter((p) => p.locked)
                  .map((p) => ({ id: p.id, label: p.label })),
                views: ["front", "side", "back", "perspective"],
                smallPreviews: [32, 64],
                silhouette: "front-alpha-mask",
                reviewChecklist: [
                  "Спереди: ясный силуэт, один главный акцент; крупные детали читаются на 32 px.",
                  "Сбоку: клинок не исчезает; стыки гарды и рукояти не имеют случайных зазоров.",
                  "Сзади: покраска завершена, материалы и крупные элементы согласованы со передней стороной.",
                  "Три четверти: кромки и объём читаются; UV не растянуты, материалы различимы.",
                  "Назовите видимую проблему, конкретную правку и ожидаемый эффект; повторите обзор после исправления.",
                ],
                artisticAcceptance: "requires-human-review",
                game: "not-verified",
              }),
            },
            { type: "image" as const, data, mimeType: "image/png" },
          ],
        };
        if (Buffer.byteLength(JSON.stringify(result)) > MAX_RESPONSE_BYTES)
          throw new EditorError(
            "OUTPUT_LIMIT",
            "Обзор превышает лимит ответа.",
          );
        return result;
      },
    );
    tool(
      "studio_asset_validate",
      "Технический экспортный preflight текущей версии. Не является визуальной или игровой проверкой.",
      refSchema,
      true,
      (args) => {
        const state = editor.inspect();
        reference(state, args);
        editor.export();
        return json({
          ...summary(state),
          technical: "pass",
          visual: "requires-human-review",
          game: "not-verified",
        });
      },
    );
    tool(
      "studio_asset_export",
      "Получить Minecraft JSON, PNG и bbmodel для review. format=bundle-v1 также включает source, manifest и hashes; по умолчанию legacy. Не записывает файлы, не меняет trusted pack, не собирает JAR.",
      refSchema.extend({ format: z.enum(["legacy", "bundle-v1"]).default("legacy") }),
      true,
      (args) => {
        const state = editor.inspect();
        reference(state, args);
        return json({
          ...summary(state),
          bundle: args.format === "bundle-v1"
            ? compileItemAssetBundleV1(JSON.stringify(assetRequest(state.project)))
            : editor.export(),
          integration: "requires-separate-review",
        });
      },
    );
    for (const [name, uri, description, read] of [
      ["studio-contracts-v1", CONTRACT_URI, "Фактические schemas десяти инструментов, операции, лимиты, profile и recovery.", () => contract(definitions)],
      ["studio-scene-v1", SCENE_URI, "Текущие IDs, revision, закрепления и выделение. Не изменяет сцену.", () => sceneReference(editor.inspect(), editor.selection())],
    ] as const) mcp.registerResource(name, uri, { description, mimeType: "application/json" }, async () =>
      editor.enqueue(() => {
        if (!enabled) throw new EditorError("DISCONNECTED", "Подключение выключено пользователем.");
        const result = json(read());
        return { contents: [{ uri, mimeType: "application/json", text: result.content[0]!.text }] };
      }),
    );
    return mcp;
  }
  let url = "",
    active = 0,
    requests = 0,
    rateReset = Date.now() + 60_000;
  const transports = new Set<StreamableHTTPServerTransport>();
  const http = createServer({ maxHeaderSize: 8192 }, async (req, res) => {
    const reject = (status: number) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ error: status }));
    };
    const expected = new URL(url);
    if (
      req.headers.host !== expected.host ||
      (req.headers.origin !== undefined &&
        req.headers.origin !== expected.origin)
    )
      return reject(403);
    const supplied = Buffer.from(req.headers.authorization ?? ""),
      correct = Buffer.from(`Bearer ${token}`);
    if (
      supplied.length !== correct.length ||
      !timingSafeEqual(supplied, correct)
    )
      return reject(401);
    if (req.url !== "/mcp") return reject(404);
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return reject(405);
    }
    if (
      req.headers["content-type"]?.split(";")[0]?.trim() !== "application/json"
    )
      return reject(415);
    if (Number(req.headers["content-length"]) > MAX_COMMAND_BYTES)
      return reject(413);
    if (Date.now() >= rateReset) {
      requests = 0;
      rateReset = Date.now() + 60_000;
    }
    if (active >= 8 || ++requests > 120) return reject(429);
    active++;
    let mcp: McpServer | undefined,
      transport: StreamableHTTPServerTransport | undefined;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active--;
      if (transport) transports.delete(transport);
      void mcp?.close().catch(() => undefined);
    };
    res.once("close", release);
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > MAX_COMMAND_BYTES) {
          reject(413);
          return;
        }
        chunks.push(bytes);
      }
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        reject(400);
        return;
      }
      if (Array.isArray(body)) return reject(400);
      mcp = makeServer();
      // Проверяем известный wire request до SDK: его Zod error может содержать входные значения.
      // Возвращаем bounded пути/коды ошибок без payload; SDK по-прежнему проверяет допустимые вызовы.
      if (typeof body === "object" && body !== null && "method" in body && body.method === "tools/call" &&
          "jsonrpc" in body && body.jsonrpc === "2.0" && "id" in body &&
          (typeof body.id === "string" || typeof body.id === "number")) {
        const params = "params" in body && typeof body.params === "object" && body.params !== null ? body.params : {};
        const name = "name" in params && typeof params.name === "string" ? params.name : "";
        const args = "arguments" in params ? params.arguments : {};
        const definition = definitions.get(name);
        let failure: CallToolResult | undefined;
        if (!definition) failure = toolError("UNKNOWN_TOOL", "Такого инструмента нет в Studio.", { availableTools: [...definitions.keys()] });
        else {
          const parsed = definition.schema.safeParse(args ?? {});
          if (!parsed.success) {
            const legacy = name === "studio_changes_preview" ? MutationSchema.safeParse(args) : undefined;
            const denied = legacy?.success ? legacy.data.commands.find((c) => HUMAN_COMMANDS.includes(c.type)) : undefined;
            failure = denied
              ? toolError(denied.type === "lock" ? "LOCKED" : "HUMAN_ONLY", "Операция доступна только пользователю в редакторе.")
              : toolError("INVALID_ARGUMENTS", "Параметры не соответствуют опубликованной схеме инструмента.", {
                schemaId: `${CONTRACT_URI}#${name}`,
                issues: parsed.error.issues.slice(0, 8).map((i) => ({
                  path: i.path.map((p) => String(p).slice(0, 64)).join(".").slice(0, 128), code: i.code,
                })),
                truncated: parsed.error.issues.length > 8,
              });
          }
        }
        if (failure) {
          res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: failure }));
          return;
        }
      }
      transport = new StreamableHTTPServerTransport({
        enableJsonResponse: true,
      });
      transports.add(transport);
      // SDK 1.29.0 объявляет onclose как explicit undefined; Transport использует optional.
      await mcp.connect(transport as Transport);
      res.setHeader("Cache-Control", "no-store");
      await transport.handleRequest(req, res, body);
    } catch {
      if (!res.headersSent) reject(500);
      else res.end();
    }
  });
  http.requestTimeout = 15_000;
  http.headersTimeout = 10_000;
  http.maxConnections = 16;
  http.setTimeout(20_000, (socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(0, "127.0.0.1", () => {
      http.removeListener("error", reject);
      resolve();
    });
  });
  const address = http.address();
  if (!address || typeof address === "string")
    throw new Error("Missing local MCP address");
  url = `http://127.0.0.1:${address.port}/mcp`;
  return {
    server: http,
    url,
    token,
    close: () => {
      enabled = false;
      proposals.clear();
      for (const transport of transports) void transport.close();
      http.closeAllConnections();
      http.close();
    },
  };
}
