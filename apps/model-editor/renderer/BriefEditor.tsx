import { useEffect, useState } from "react";
import { readDesignBrief, serializeDesignBrief, type DesignBrief, type EditorProject } from "@mcdev/editor-core";
import { useStudio } from "./store.ts";

const fields = [
  ["purpose", "Назначение", 160, "Короткий ледяной топор"],
  ["style", "Стиль", 160, "Выразительный Minecraft"],
  ["silhouette", "Силуэт", 240, "Широкая кромка, короткий обух, асимметричная гарда"],
  ["materials", "Материалы и акценты", 240, "Холодная сталь, лёд, кожаная обмотка"],
] as const;
type Draft = Pick<DesignBrief, "purpose" | "style" | "silhouette" | "materials"> & {palette: string};
const draftFrom = (brief: DesignBrief | undefined, project: EditorProject): Draft => ({
  purpose: brief?.purpose ?? "", style: brief?.style ?? "Выразительный Minecraft",
  silhouette: brief?.silhouette ?? "", materials: brief?.materials ?? "",
  palette: (brief?.palette ?? project.texturePlan.palette).join(", "),
});
const readable = (text: string) => {
  const brief = readDesignBrief(text);
  return brief ? `Назначение: ${brief.purpose}\nСтиль: ${brief.style}\nСилуэт: ${brief.silhouette}\nМатериалы: ${brief.materials}\nПалитра: ${brief.palette.join(", ")}` : text;
};

export function BriefEditor({project}: {project: EditorProject}) {
  const busy = useStudio(s => s.busy);
  const revision = useStudio(s => s.state?.revision ?? 0);
  const saved = project.design?.brief ?? "";
  const [structured, setStructured] = useState(!!readDesignBrief(saved));
  const [raw, setRaw] = useState(readable(saved));
  const [draft, setDraft] = useState(() => draftFrom(readDesignBrief(saved), project));
  const [dirty, setDirty] = useState(false);
  const [baseRevision, setBaseRevision] = useState(revision);
  const [error, setError] = useState("");
  const locked = project.parts.filter(p => p.locked);
  useEffect(() => {
    if (dirty) return;
    setRaw(readable(saved));
    setDraft(draftFrom(readDesignBrief(saved), project));
    setStructured(!!readDesignBrief(saved));
    setBaseRevision(revision);
  }, [saved, project, revision, dirty]);
  const edit = () => {
    if (!dirty) setBaseRevision(revision);
    setDirty(true); setError("");
  };
  const save = async () => {
    const state = useStudio.getState().state;
    if (!state || state.project.projectId !== project.projectId) return;
    try {
      const brief: DesignBrief = {
        schemaVersion: 1, kind: "mcdev-design-brief", target: "fabric-1.20.1-held-item",
        ...draft, palette: draft.palette.split(/[,\s]+/u).filter(Boolean), preserve: locked.map(p => p.id),
      };
      if (structured) serializeDesignBrief(brief);
      const result = await useStudio.getState().request({kind: "apply", mutation: {
        projectId: project.projectId, expectedRevision: baseRevision, key: crypto.randomUUID(),
        commands: [structured ? {type: "designBrief", brief} : {type: "brief", text: raw}],
      }});
      if (result?.ok) {setDirty(false);setError("");}
      else setError(result && !result.ok ? result.error.message : "Не удалось сохранить задание.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Проверьте поля брифа.");
    }
  };
  return (
    <div className="brief-editor" data-testid="brief-editor">
      <div className="brief-modes" aria-label="Формат задания">
        <button type="button" aria-pressed={!structured} onClick={() => {if (structured) {setStructured(false);edit();}}}>Свободный текст</button>
        <button type="button" data-testid="structured-brief-mode" aria-pressed={structured} onClick={() => {if (!structured) {setStructured(true);edit();}}}>По полям</button>
      </div>
      {structured ? (
        <div className="structured-brief" data-testid="structured-brief">
          <span className="brief-target">Предмет в руке · Fabric 1.20.1</span>
          {fields.map(([key, label, limit, placeholder]) => (
            <label key={key}>
              {label}
              <textarea data-testid={`brief-${key}`} rows={2} maxLength={limit} value={draft[key]} placeholder={placeholder}
                onChange={e => {edit();setDraft({...draft, [key]: e.target.value});}} />
            </label>
          ))}
          <label className="brief-wide">
            Палитра · до 24 цветов
            <input data-testid="brief-palette" value={draft.palette} maxLength={256} placeholder="#172333, #b8e5ed, #e9f8ed"
              onChange={e => {edit();setDraft({...draft, palette: e.target.value});}} />
          </label>
          <div className="brief-wide brief-protection" data-testid="brief-protected-parts">
            <strong>Закреплённые детали</strong>
            <span>{locked.length ? locked.map(p => p.label).join(", ") : "Нет закреплённых деталей"}</span>
            <small>Замки в дереве защищают реальные части. Текст брифа их не заменяет.</small>
          </div>
        </div>
      ) : (
        <div className="design-brief">
          <label htmlFor="design-brief">Задание для агента</label>
          <textarea id="design-brief" data-testid="design-brief" rows={2} maxLength={1200} value={raw}
            onChange={e => {edit();setRaw(e.target.value);}} placeholder="Опишите форму и стиль. Сохраните задание перед работой агента." />
        </div>
      )}
      {dirty && revision !== baseRevision && (
        <div className="brief-conflict" role="status">
          Сцена изменилась во время ввода. Сверьте текущие детали перед сохранением.
          <button type="button" data-testid="refresh-brief-reference" onClick={() => {setBaseRevision(revision);setError("");}}>Использовать текущую сцену</button>
        </div>
      )}
      {error && <p className="brief-error" role="alert">{error}</p>}
      <button type="button" data-testid="save-brief" disabled={busy || !dirty} onClick={() => void save()}>Сохранить задание</button>
      <small>Поля меняют только задание. Геометрия и покраска сохраняются. Бриф не является художественной приёмкой.</small>
    </div>
  );
}
