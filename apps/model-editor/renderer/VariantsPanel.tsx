import { useMemo, useState } from "react";
import { MAX_VARIANTS, cubes, type EditorProject } from "@mcdev/editor-core";
import { useStudio } from "./store.ts";
import { Viewport, comparisonFrame } from "./Viewport.tsx";
import { BriefEditor } from "./BriefEditor.tsx";
import { ConceptPanel } from "./ConceptPanel.tsx";

export function VariantsPanel({ project }: { project: EditorProject }) {
  const busy = useStudio((s) => s.busy),
    command = useStudio((s) => s.command);
  const view = useStudio((s) => s.view);
  const canUndo = useStudio((s) => s.state?.canUndo),
    canRedo = useStudio((s) => s.state?.canRedo);
  const variants = project.design?.variants ?? [];
  const [label, setLabel] = useState(
    variants.length ? "Вариант A" : "Исходник",
  );
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState(variants[0]?.id ?? "");
  const [silhouette, setSilhouette] = useState(false);
  const [leftThumb, setLeftThumb] = useState(""),
    [rightThumb, setRightThumb] = useState("");
  const chosen = variants.find((v) => v.id === selected) ?? variants[0];
  const framing = useMemo(
    () => comparisonFrame(chosen ? [chosen.project, project] : [project]),
    [chosen?.project, project],
  );
  const create = async () => {
    const state = useStudio.getState().state;
    if (!state) return;
    const result = await useStudio.getState().request({
      kind: "apply",
      mutation: {
        projectId: state.project.projectId,
        expectedRevision: state.revision,
        key: crypto.randomUUID(),
        commands: [
          {
            type: "checkpoint",
            variantId: crypto.randomUUID(),
            label: label.trim(),
            note,
          },
        ],
      },
    });
    if (result?.ok) {
      setLabel(
        `Вариант ${String.fromCharCode(64 + (result.state.project.design?.variants.length ?? 1))}`,
      );
      setNote("");
    }
  };
  return (
    <div className="variants-panel" data-testid="variants-panel">
      <details className="design-brief-wrap" open={!variants.length}>
        <summary>
          Задание для агента{" "}
          <small>
            {project.design?.brief
              ? "Сохранено в проекте"
              : "Опишите форму и стиль"}
          </small>
        </summary>
        <BriefEditor key={project.projectId} project={project} />
      </details>
      <ConceptPanel key={project.projectId} project={project} />
      <div className="variant-history">
        <button
          disabled={busy || !canUndo}
          title="Ctrl+Z"
          onClick={() => void command({ type: "undo" })}
        >
          Отмена
        </button>
        <button
          disabled={busy || !canRedo}
          title="Ctrl+Shift+Z"
          onClick={() => void command({ type: "redo" })}
        >
          Повтор
        </button>
      </div>
      <div className="variant-create">
        <input
          aria-label="Название варианта"
          maxLength={48}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <input
          aria-label="Идея варианта"
          maxLength={400}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Что изменено и зачем"
        />
        <button
          data-testid="save-variant"
          disabled={busy || !label.trim() || variants.length >= MAX_VARIANTS}
          onClick={() => void create()}
        >
          Сохранить вариант · {variants.length}/{MAX_VARIANTS}
        </button>
      </div>
      {!chosen ? (
        <div className="variants-empty">
          Сохраните исходник перед изменениями. Затем создавайте варианты формы
          и покраски: снимки сохраняются вместе с проектом.
        </div>
      ) : (
        <>
          <div className="comparison-tools">
            <label>
              Сравнить с{" "}
              <select
                aria-label="Вариант для сравнения"
                value={chosen.id}
                onChange={(e) => setSelected(e.target.value)}
              >
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="view-tabs">
              {(
                [
                  ["perspective", "3D"],
                  ["front", "Спереди"],
                  ["side", "Сбоку"],
                  ["back", "Сзади"],
                ] as const
              ).map(([angle, text]) => (
                <button
                  key={angle}
                  data-testid={`compare-${angle}`}
                  className={view === angle ? "active" : ""}
                  onClick={() =>
                    useStudio.setState({
                      view: angle,
                      frame: useStudio.getState().frame + 1,
                    })
                  }
                >
                  {text}
                </button>
              ))}
            </div>
            <button
              data-testid="compare-silhouette"
              className={silhouette ? "active" : ""}
              onClick={() => setSilhouette(!silhouette)}
            >
              {silhouette ? "Показать текстуру" : "Силуэт"}
            </button>
          </div>
          <div className={`comparison-pair ${silhouette ? "is-silhouette" : ""}`}>
            <div className="comparison-item" data-testid="comparison-source">
              <strong>
                {chosen.label}
                <small>Сохранённый · {cubes(chosen.project).length} куб.</small>
              </strong>
              <div className="comparison-canvas">
                <Viewport
                  project={chosen.project}
                  review={{ framing, silhouette, onThumbnail: setLeftThumb }}
                />
              </div>
              <div className="comparison-small">
                {leftThumb && (
                  <img
                    src={leftThumb}
                    width={64}
                    height={64}
                    alt="Сохранённый вариант на 64 пикселях"
                  />
                )}
                <span>64 × 64 px</span>
              </div>
            </div>
            <div className="comparison-item" data-testid="comparison-working">
              <strong>
                Текущая модель
                <small>Рабочая · {cubes(project).length} куб.</small>
              </strong>
              <div className="comparison-canvas">
                <Viewport
                  project={project}
                  review={{ framing, silhouette, onThumbnail: setRightThumb }}
                />
              </div>
              <div className="comparison-small">
                {rightThumb && (
                  <img
                    src={rightThumb}
                    width={64}
                    height={64}
                    alt="Текущая модель на 64 пикселях"
                  />
                )}
                <span>64 × 64 px</span>
              </div>
            </div>
          </div>
          <p className="comparison-note">
            {chosen.note ||
              "Проверьте силуэт, стыки и контраст с разных сторон."}{" "}
            Одинаковые камера, масштаб и свет. Вид на 64 px — предпросмотр
            редактора; игровой инвентарь ещё не проверен.
          </p>
          <div className="variant-actions">
            <button
              data-testid="restore-variant"
              disabled={busy}
              onClick={() =>
                void command({ type: "restoreVariant", variantId: chosen.id })
              }
            >
              Редактировать этот вариант
            </button>
            <button
              data-testid="delete-variant"
              disabled={busy}
              onClick={() =>
                void command({ type: "deleteVariant", variantId: chosen.id })
              }
            >
              Удалить снимок
            </button>
            <small>
              Возврат и удаление отменяются через Ctrl+Z. Снимки не меняются при
              дальнейшей правке.
            </small>
          </div>
        </>
      )}
    </div>
  );
}
