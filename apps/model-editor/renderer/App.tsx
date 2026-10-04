import { useEffect, useRef, useState } from "react";
import { ConnectionPanel } from "./ConnectionPanel.tsx";
import { TextureEditor } from "./TextureEditor.tsx";
import { VariantsPanel } from "./VariantsPanel.tsx";
import { ReviewBoard } from "./ReviewBoard.tsx";
import type { ReactNode } from "react";
import { bounds, cubes, type EditorProject } from "@mcdev/editor-core";
import { useStudio, saveProject } from "./store.ts";
import { Viewport, drawAtlas } from "./Viewport.tsx";

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    cube: "M12 2 3 7v10l9 5 9-5V7l-9-5ZM3 7l9 5 9-5M12 12v10",
    plus: "M12 5v14M5 12h14",
    undo: "M8 5 3 10l5 5M3 10h11a6 6 0 0 1 0 12",
    redo: "m16 5 5 5-5 5M21 10H10a6 6 0 0 0 0 12",
    save: "M5 3h12l4 4v14H3V3h2Zm2 0v7h10V3M7 21v-7h10v7",
    folder: "M3 6V4h7l2 3h9v14H3V6Z",
    export: "M12 15V3m-4 4 4-4 4 4M5 12v9h14v-9",
    eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm7 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0",
    lock: "M6 10h12v11H6V10Zm2 0V6a4 4 0 0 1 8 0v4M12 14v3",
    chevron: "m8 4 8 8-8 8",
    grid: "M3 3h18v18H3V3Zm6 0v18m6-18v18M3 9h18M3 15h18",
    copy: "M8 8h13v13H8V8Zm8-4H3v13",
    trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
    check: "m5 12 4 4L19 6",
    agent: "M8 3h8M12 3V1M4 7h16v14H4V7Zm4 5h1m6 0h1M8 17h8",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.cube} />
    </svg>
  );
}
function ToolButton({
  children,
  icon,
  onClick,
  disabled = false,
  testId,
  primary = false,
  title,
  keepInputFocus = false,
}: {
  children: ReactNode;
  icon: string;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
  primary?: boolean;
  title?: string;
  keepInputFocus?: boolean;
}) {
  return (
    <button
      className={`tool-button ${primary ? "primary" : ""}`}
      onClick={onClick}
      onMouseDown={(event) => {
        if (keepInputFocus) event.preventDefault();
      }}
      disabled={disabled}
      data-testid={testId}
      title={title}
    >
      <Icon name={icon} />
      {children}
    </button>
  );
}
function Atlas({ project }: { project: EditorProject }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawAtlas(ref.current, project);
  }, [project]);
  return (
    <div className="atlas-card">
      <div className="section-title">
        Пиксельный атлас{" "}
        <span>
          {project.model.texture.width} × {project.model.texture.height}
        </span>
      </div>
      <div className="atlas-image">
        <canvas ref={ref} aria-label="Текстура модели" />
      </div>
      <div className="palette-strip">
        {project.texturePlan.palette.map((c) => (
          <button
            key={c.symbol}
            style={{ background: c.color }}
            title={c.color}
            aria-label={`Рисовать цветом ${c.color}`}
            onClick={() =>
              useStudio.setState({ mode: "texture", paintColor: c.color })
            }
          />
        ))}
      </div>
      <p className="hint">
        Выберите цвет, чтобы рисовать на текстуре. Покраска ограничена
        выделенной частью.
      </p>
    </div>
  );
}
function Inspector({ project }: { project: EditorProject }) {
  const selection = useStudio((s) => s.selection),
    busy = useStudio((s) => s.busy),
    command = useStudio((s) => s.command);
  const selected = cubes(project).filter((c) => selection.includes(c.id)),
    box = bounds(selected);
  const part = project.parts.find(
    (p) =>
      p.cubeIds.length === selection.length &&
      p.cubeIds.every((id) => selection.includes(id)),
  );
  const [color, setColor] = useState("#c58d5d"),
    [angle, setAngle] = useState("0"),
    [axis, setAxis] = useState<"x" | "y" | "z">("z");
  return (
    <aside className="inspector panel">
      <div className="panel-heading">
        Свойства <span className="tiny-tag">ITEM</span>
      </div>
      <div className="selection-heading">
        <div className="selection-icon">
          <Icon name="cube" size={24} />
        </div>
        <div>
          <strong>
            {part?.label ??
              (selected.length === 1 ? selected[0]!.id : "Выберите часть")}
          </strong>
          <p>
            {selected.length
              ? `${selected.length} куб. · ${part ? "часть модели" : "геометрия"}`
              : "В дереве или на модели"}
          </p>
        </div>
      </div>
      <div className="inspector-section">
        <h3>Форма</h3>
        {(["min", "size"] as const).map((property) => (
          <div className="vector-group" key={property}>
            <label>{property === "min" ? "Положение" : "Размер"}</label>
            <div className="vector-row">
              {([0, 1, 2] as const).map((a) => (
                <label key={a} className="axis-field">
                  <span>{["X", "Y", "Z"][a]}</span>
                  <input
                    key={`${property}-${a}-${selection.join(",")}-${box[property][a]}`}
                    aria-label={`${property === "min" ? "Положение" : "Размер"} ${["X", "Y", "Z"][a]}`}
                    type="number"
                    step="0.25"
                    defaultValue={Number(box[property][a].toFixed(3))}
                    disabled={!selected.length || busy}
                    onFocus={(event) => {
                      event.currentTarget.dataset.commitError = "";
                      const state = useStudio.getState().state!;
                      event.currentTarget.dataset.projectId =
                        state.project.projectId;
                      event.currentTarget.dataset.revision = String(
                        state.revision,
                      );
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.currentTarget.value = String(
                          Number(box[property][a].toFixed(3)),
                        );
                        event.currentTarget.blur();
                      } else if (event.key === "Enter")
                        event.currentTarget.blur();
                    }}
                    onBlur={(event) => {
                      const input = event.currentTarget;
                      input.dataset.commitError = "";
                      const text = input.value.trim();
                      const next = Number(text);
                      event.currentTarget.value = String(
                        Number(box[property][a].toFixed(3)),
                      );
                      if (
                        !text ||
                        !Number.isFinite(next) ||
                        next === Number(box[property][a].toFixed(3))
                      )
                        return;
                      const state = useStudio.getState().state!;
                      if (
                        input.dataset.projectId !== state.project.projectId ||
                        Number(input.dataset.revision) !== state.revision
                      ) {
                        input.dataset.commitError = "STALE_REVISION";
                        useStudio.setState({
                          error:
                            "Проект изменился во время ввода. Повторите правку. (STALE_REVISION)",
                        });
                        return;
                      }
                      const translation: [number, number, number] = [0, 0, 0],
                        scale: [number, number, number] = [1, 1, 1];
                      if (property === "min")
                        translation[a] = next - box.min[a];
                      else scale[a] = next / box.size[a];
                      void useStudio.getState().request({
                        kind: "apply",
                        mutation: {
                          projectId: state.project.projectId,
                          expectedRevision: state.revision,
                          key: crypto.randomUUID(),
                          commands: [
                            {
                              type: "transform",
                              cubeIds: selection,
                              translation,
                              scale,
                            },
                          ],
                        },
                      });
                    }}
                  />
                </label>
              ))}
            </div>
          </div>
        ))}
        <div className="rotation-row">
          <select
            aria-label="Ось вращения"
            value={axis}
            onChange={(e) => setAxis(e.target.value as typeof axis)}
          >
            <option value="x">Ось X</option>
            <option value="y">Ось Y</option>
            <option value="z">Ось Z</option>
          </select>
          <select
            aria-label="Угол вращения"
            value={angle}
            onChange={(e) => setAngle(e.target.value)}
          >
            {[-45, -22.5, 0, 22.5, 45].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
          <button
            title="Применить поворот"
            disabled={!selected.length || busy}
            onClick={() => {
              void command({
                type: "rotate",
                cubeIds: selection,
                axis,
                angle: Number(angle) as -45 | -22.5 | 0 | 22.5 | 45,
              });
            }}
          >
            ↻
          </button>
        </div>
        <p className="hint">Единицы Minecraft · допустимые координаты −16…32</p>
      </div>
      <div className="inspector-section">
        <h3>Цвет выбранной части</h3>
        <div className="color-picker">
          <input
            aria-label="Цвет части"
            data-testid="part-color"
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
          <span>{color.toUpperCase()}</span>
          <span className="tiny-tag">RGB</span>
        </div>
        <div className="color-presets">
          {[
            "#c58d5d",
            "#85c8c7",
            "#aa8ccd",
            "#d96f65",
            "#bedb80",
            "#e5c679",
          ].map((c) => (
            <button
              key={c}
              aria-label={`Выбрать ${c}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
              className={color === c ? "chosen" : ""}
            />
          ))}
        </div>
        <button
          className="apply-color"
          data-testid="apply-color"
          disabled={!selected.length || busy}
          onClick={() => {
            void command({ type: "recolor", cubeIds: selection, color });
          }}
        >
          Применить цвет <span>↗</span>
        </button>
        <p className="hint">
          Меняется только выделенная область атласа. Рисунок и прозрачность
          сохраняются.
        </p>
      </div>
      <div className="inspector-section">
        <h3>Действия</h3>
        <div className="action-pair">
          <ToolButton
            icon="copy"
            disabled={selected.length !== 1 || busy}
            onClick={() => {
              void command({
                type: "duplicate",
                cubeId: selection[0]!,
                newId: `copy_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`,
              });
            }}
          >
            Копия
          </ToolButton>
          <ToolButton
            icon="trash"
            disabled={!selected.length || busy}
            onClick={() => {
              void command({ type: "delete", cubeIds: selection });
            }}
          >
            Удалить
          </ToolButton>
        </div>
      </div>
      <ConnectionPanel />
    </aside>
  );
}
export function App() {
  const ui = useStudio(),
    [expanded, setExpanded] = useState<string[]>([]);
  useEffect(() => {
    const unsubscribe = window.studio.onState((result) =>
      useStudio.getState().receive(result),
    );
    void useStudio.getState().request({ kind: "inspect" });
    return unsubscribe;
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveProject(event.shiftKey);
        return;
      }
      if ((event.target as HTMLElement)?.matches("input,textarea,select"))
        return;
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        void useStudio
          .getState()
          .command({ type: event.shiftKey ? "redo" : "undo" });
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const project = ui.state?.project,
    items = project ? cubes(project) : [];
  return (
    <div className="studio-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="cube" size={24} />
          </span>
          <div>
            MineMod <span>Studio</span>
            <small>МАСТЕРСКАЯ МОДЕЛЕЙ</small>
          </div>
        </div>
        <div className="topbar-tools">
          <ToolButton
            icon="plus"
            testId="new-project"
            disabled={ui.busy}
            onClick={() => {
              void ui.request({ kind: "new" });
            }}
          >
            Новый
          </ToolButton>
          <ToolButton
            icon="folder"
            testId="open-project"
            disabled={ui.busy}
            onClick={() => {
              void ui.request({ kind: "open" });
            }}
          >
            Открыть
          </ToolButton>
          <ToolButton
            icon="save"
            testId="save-project"
            keepInputFocus
            title="Сохранить · Ctrl+S. Сохранить как… · Ctrl+Shift+S"
            disabled={ui.busy}
            onClick={() => {
              void saveProject();
            }}
          >
            Сохранить
          </ToolButton>
          <button
            className="save-as"
            data-testid="save-as"
            disabled={ui.busy}
            title="Сохранить как… · Ctrl+Shift+S"
            aria-label="Сохранить как…"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              void saveProject(true);
            }}
          >
            …
          </button>
          <div className="tool-divider" />
          <ToolButton
            icon="export"
            primary
            testId="export-assets"
            disabled={ui.busy || !items.length}
            onClick={() => {
              void ui.request({ kind: "export" });
            }}
          >
            Экспорт
          </ToolButton>
          <ToolButton
            icon="agent"
            testId="agent-settings"
            onClick={() =>
              document
                .querySelector('[data-testid="agent-panel"]')
                ?.scrollIntoView({ block: "start" })
            }
          >
            {ui.connection.enabled ? "AI · доступ включён" : "Подключить AI"}
          </ToolButton>
        </div>
        <span className="version">
          LOCAL · {import.meta.env.VITE_STUDIO_VERSION}
        </span>
      </header>
      <div className="document-bar">
        <div>
          <span className="document-dot" />
          <strong>{project?.model.name ?? "Загрузка мастерской…"}</strong>
          <span className="muted">{ui.fileName || "Рабочий проект"}</span>
          {ui.state?.dirty && <span className="unsaved">Не сохранён</span>}
        </div>
        <span className="target-pill">
          <span /> Minecraft 1.20.1
        </span>
      </div>
      <main className="workspace">
        <aside className="outliner panel">
          <div className="panel-heading">
            Структура <span className="count">{items.length}</span>
          </div>
          <div className="tree-tools">
            <span>Части предмета</span>
            <button
              title="Добавить куб"
              data-testid="add-cube"
              disabled={ui.busy}
              onClick={() => {
                void ui.command({
                  type: "add",
                  cubeId: `cube_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`,
                });
              }}
            >
              <Icon name="plus" size={16} />
            </button>
          </div>
          <div className="parts-tree">
            {project?.parts.map((part) => {
              const active =
                part.cubeIds.length === ui.selection.length &&
                part.cubeIds.every((id) => ui.selection.includes(id));
              return (
                <div key={part.id}>
                  <div
                    className={`part-row ${active ? "active" : ""} ${ui.hidden.includes(part.id) ? "is-hidden" : ""}`}
                  >
                    <button
                      className={`expand-button ${expanded.includes(part.id) ? "expanded" : ""}`}
                      title="Кубы части"
                      onClick={() =>
                        setExpanded(
                          expanded.includes(part.id)
                            ? expanded.filter((p) => p !== part.id)
                            : [...expanded, part.id],
                        )
                      }
                    >
                      <Icon name="chevron" size={12} />
                    </button>
                    <button
                      className="part-select"
                      data-testid={`part-${part.id}`}
                      onClick={() => ui.select(part.cubeIds)}
                    >
                      <Icon name="cube" size={16} />
                      <span>{part.label}</span>
                      <small>{part.cubeIds.length}</small>
                    </button>
                    <button
                      className={ui.hidden.includes(part.id) ? "toggled" : ""}
                      title="Скрыть часть"
                      onClick={() => ui.toggleHidden(part.id)}
                    >
                      <Icon name="eye" size={14} />
                    </button>
                    <button
                      data-testid={`lock-${part.id}`}
                      className={part.locked ? "toggled" : ""}
                      title={
                        part.locked
                          ? "Снять закрепление от AI"
                          : "Закрепить от AI"
                      }
                      disabled={ui.busy}
                      onClick={() => {
                        void ui.command({
                          type: "lock",
                          partId: part.id,
                          locked: !part.locked,
                        });
                      }}
                    >
                      <Icon name="lock" size={13} />
                    </button>
                  </div>
                  {expanded.includes(part.id) &&
                    part.cubeIds.map((id) => (
                      <button
                        className={`cube-row ${ui.selection.length === 1 && ui.selection[0] === id ? "active" : ""}`}
                        key={id}
                        onClick={() => ui.select([id])}
                      >
                        <Icon name="cube" size={12} />
                        {id}
                      </button>
                    ))}
                </div>
              );
            })}
            {!items.length && project && (
              <div className="empty-tree">
                Добавьте первый куб, чтобы начать модель.
              </div>
            )}
          </div>
          <button
            className="example-button"
            data-testid="load-example"
            disabled={ui.busy}
            onClick={() => {
              void ui.request({ kind: "example" });
            }}
          >
            <Icon name="cube" size={16} />
            Открыть пример меча
          </button>
          {project && <Atlas project={project} />}
        </aside>
        <section
          className={`viewport-panel panel ${ui.mode === "texture" ? "painting-mode" : ""}`}
        >
          <div className="editor-mode">
            <button
              data-testid="mode-model"
              className={ui.mode === "model" ? "active" : ""}
              onClick={() => useStudio.setState({ mode: "model" })}
            >
              Модель
            </button>
            <button
              data-testid="mode-texture"
              className={ui.mode === "texture" ? "active" : ""}
              onClick={() => useStudio.setState({ mode: "texture" })}
            >
              Текстура / UV
            </button>
            <button
              data-testid="mode-variants"
              className={ui.mode === "variants" ? "active" : ""}
              onClick={() =>
                useStudio.setState({ mode: "variants", draft: null })
              }
            >
              Варианты
            </button>
            <button
              data-testid="mode-review"
              className={ui.mode === "review" ? "active" : ""}
              onClick={() =>
                useStudio.setState({ mode: "review", draft: null })
              }
            >
              Обзор
            </button>
            <span>
              {ui.mode === "review"
                ? "Читаемость модели"
                : ui.mode === "variants"
                  ? "Форма и покраска"
                  : ui.mode === "texture"
                    ? "Пиксельная мастерская"
                    : "Геометрия предмета"}
            </span>
          </div>
          {ui.mode === "variants" && project && (
            <VariantsPanel key={project.projectId} project={project} />
          )}
          {ui.mode === "review" && project && (
            <ReviewBoard key={project.projectId} project={project} />
          )}
          {ui.mode !== "variants" && ui.mode !== "review" && (
            <>
              {ui.mode === "texture" && project && (
                <TextureEditor project={project} />
              )}
              <div className="viewport-toolbar">
                <div className="view-tabs">
                  {(
                    [
                      ["perspective", "3D"],
                      ["front", "Спереди"],
                      ["side", "Сбоку"],
                      ["back", "Сзади"],
                    ] as const
                  ).map(([view, label]) => (
                    <button
                      data-testid={`view-${view}`}
                      key={view}
                      className={ui.view === view ? "active" : ""}
                      onClick={() =>
                        useStudio.setState({ view, frame: ui.frame + 1 })
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="viewport-options">
                  <button
                    title="Сетка"
                    className={ui.grid ? "active" : ""}
                    onClick={() => useStudio.setState({ grid: !ui.grid })}
                  >
                    <Icon name="grid" size={16} />
                  </button>
                  <button
                    title="Каркас"
                    className={ui.wire ? "active" : ""}
                    onClick={() => useStudio.setState({ wire: !ui.wire })}
                  >
                    <Icon name="cube" size={16} />
                  </button>
                </div>
              </div>
              <div className="viewport" data-testid="viewport">
                {project && <Viewport project={project} />}
                <div className="viewport-label">
                  <span>ПРЕДМЕТ / КУБОИДЫ</span>
                  <small>Пиксельная текстура · ближайший пиксель</small>
                </div>
                <div className="axis-gizmo">
                  <b>X</b>
                  <b>Y</b>
                  <b>Z</b>
                </div>
                {project && !items.length && (
                  <div className="empty-scene">
                    Ваш новый предмет
                    <button
                      onClick={() => {
                        void ui.command({ type: "add", cubeId: "first_cube" });
                      }}
                    >
                      Добавить куб
                    </button>
                  </div>
                )}
              </div>
              <div className="viewport-footer">
                <span>ЛКМ — вращение · колесо — масштаб · ПКМ — панорама</span>
                <div>
                  <button
                    data-testid="undo"
                    title="Отмена · Ctrl+Z"
                    disabled={!ui.state?.canUndo || ui.busy}
                    onClick={() => {
                      void ui.command({ type: "undo" });
                    }}
                  >
                    <Icon name="undo" size={17} />
                  </button>
                  <button
                    data-testid="redo"
                    title="Повтор · Ctrl+Shift+Z"
                    disabled={!ui.state?.canRedo || ui.busy}
                    onClick={() => {
                      void ui.command({ type: "redo" });
                    }}
                  >
                    <Icon name="redo" size={17} />
                  </button>
                </div>
              </div>
              <div className="history-strip">
                <span>ИСТОРИЯ</span>
                {ui.state?.history.length ? (
                  ui.state.history.slice(-3).map((entry, i) => (
                    <span className="history-chip" key={`${i}-${entry.label}`}>
                      <Icon name="check" size={12} />
                      {entry.actor === "agent" ? "AI · " : ""}
                      {entry.label}
                    </span>
                  ))
                ) : (
                  <span className="history-empty">
                    Изменения появятся здесь
                  </span>
                )}
                <small data-testid="revision">r{ui.state?.revision ?? 0}</small>
              </div>
            </>
          )}
        </section>
        {project && <Inspector project={project} />}
      </main>
      <footer
        className={`statusbar ${ui.error ? "error" : ui.warning ? "warning" : ""}`}
        role="status"
      >
        <span className="status-light" />
        <span
          data-testid="status-message"
          title={ui.error || ui.warning || ui.note}
        >
          {ui.error || (ui.busy ? "Выполняется…" : ui.warning || ui.note)}
        </span>
        <span className="status-details">
          {items.length} куб. · {project?.texturePlan.palette.length ?? 0}{" "}
          цветов · экспорт требует проверки в игре
        </span>
      </footer>
    </div>
  );
}
