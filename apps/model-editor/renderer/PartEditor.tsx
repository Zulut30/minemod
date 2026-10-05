import { useEffect, useState } from "react";
import type { EditorCommand, EditorProject } from "@mcdev/editor-core";
import { useStudio } from "./store.ts";

export function PartEditor({ project }: { project: EditorProject }) {
  const selection = useStudio(s => s.selection), busy = useStudio(s => s.busy);
  const revision = useStudio(s => s.state?.revision ?? 0);
  const part = project.parts.find(p => p.cubeIds.length === selection.length && p.cubeIds.every(id => selection.includes(id)));
  const [label, setLabel] = useState(part?.label ?? "");
  const [dirty, setDirty] = useState(false), [baseRevision, setBaseRevision] = useState(revision);
  const [error, setError] = useState("");
  const protectedSelection = project.parts.some(p => p.locked && p.cubeIds.some(id => selection.includes(id)));
  useEffect(() => {
    if (!dirty) { setLabel(part?.label ?? ""); setBaseRevision(revision); }
  }, [part?.label, revision, dirty]);
  const save = async (group: boolean) => {
    const name = label.trim();
    if (!name || name.length > 80) { setError("Введите название: 1–80 символов."); return; }
    if (!group && !part) return;
    const command: EditorCommand = group ? {
      type: "groupPart", partId: `part_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`,
      label: name, cubeIds: [...selection],
    } : { type: "renamePart", partId: part!.id, label: name };
    const result = await useStudio.getState().request({ kind: "apply", mutation: {
      projectId: project.projectId, expectedRevision: baseRevision, key: crypto.randomUUID(), commands: [command],
    } });
    if (result?.ok) { setDirty(false); setError(""); }
    else setError(result && !result.ok ? result.error.message : "Не удалось сохранить название.");
  };
  return <div className="inspector-section part-editor" data-testid="part-editor">
    <h3>Название и состав</h3>
    <label>Название части
      <input type="text" data-testid="part-label" value={label} maxLength={80} disabled={busy || !selection.length}
        placeholder="Например, кожаная рукоять"
        onChange={e => { if (!dirty) setBaseRevision(revision); setDirty(true); setLabel(e.target.value); setError(""); }} />
    </label>
    <div className="part-editor-actions">
      <button data-testid="rename-part" disabled={busy || !part || !dirty} onClick={() => { void save(false); }}>Сохранить имя</button>
      <button data-testid="group-part" disabled={busy || !selection.length || protectedSelection} onClick={() => { void save(true); }}>Собрать в часть</button>
    </div>
    <p className="hint">Ctrl или Shift в дереве добавляет кубы к выделению. {protectedSelection ? "Для объединения сначала снимите замки выбранных частей." : "Объединение сохраняет форму, рисунок и UV."}</p>
    {dirty && revision !== baseRevision && <button data-testid="refresh-part-reference" disabled={busy}
      onClick={() => { setBaseRevision(revision); setError(""); }}>Сверено · использовать текущую версию</button>}
    {error && <p className="part-error" role="alert">{error}</p>}
  </div>;
}
