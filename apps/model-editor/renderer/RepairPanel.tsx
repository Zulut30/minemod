import { useState } from "react";
import { MAX_REPAIR_ITERATIONS, type RepairCase } from "@mcdev/editor-core";
import { useStudio } from "./store.ts";

export function RepairPanel() {
  const { state, selection, request, busy } = useStudio();
  const [note, setNote] = useState("");
  const [area, setArea] = useState<RepairCase["area"]>("geometry");
  const [face, setFace] = useState<NonNullable<RepairCase["face"]> | "">("");
  const [limit, setLimit] = useState(MAX_REPAIR_ITERATIONS);
  if (!state) return null;
  const parts = state.project.parts.filter(part => part.cubeIds.some(id => selection.includes(id)));
  const repair = state.repair;
  return <details className="repair-panel" data-testid="repair-panel">
    <summary>Адресная правка модели</summary>
    {repair ? <>
      <p data-testid="repair-active">{repair.note}</p>
      <small>{repair.partIds.map(id => state.project.parts.find(part => part.id === id)?.label ?? id).join(", ")}</small>
      <p data-testid="repair-budget">Осталось итераций: {repair.maxIterations - repair.usedIterations} из {repair.maxIterations}</p>
      <button disabled={busy} data-testid="repair-stop" onClick={() => void request({ kind: "repair",
        control: { projectId: state.project.projectId, expectedRevision: state.revision, repair: null } })}>Завершить задание</button>
      <p>После каждой правки сравните ракурсы. Новое задание и его лимит задаёте вы.</p>
    </> : <>
      <p>Выберите части и опишите один недостаток. Остальные детали и их рисунок будут защищены.</p>
      <small data-testid="repair-parts">{parts.map(part => part.label).join(", ") || "Части не выбраны"}</small>
      <label>Что исправить<textarea data-testid="repair-note" aria-label="Замечание к модели" value={note}
        maxLength={400} rows={3} placeholder="Например: сделать гарду короче, сохранив рисунок" onChange={e => setNote(e.target.value)} /></label>
      <label>Область правки<select data-testid="repair-area" value={area} onChange={e => { setArea(e.target.value as RepairCase["area"]); setFace(""); }}>
        <option value="geometry">Форма и пропорции</option><option value="texture">Пиксельная покраска и материал</option><option value="uv">Развёртка UV</option>
      </select></label>
      {area !== "geometry" && <label>Грань<select data-testid="repair-face" value={face} onChange={e => setFace(e.target.value as typeof face)}>
        <option value="">Все грани выбранных частей</option>
        <option value="north">Передняя</option><option value="south">Задняя</option><option value="east">Правая</option>
        <option value="west">Левая</option><option value="up">Верхняя</option><option value="down">Нижняя</option>
      </select></label>}
      <label>Лимит итераций<select data-testid="repair-limit" value={limit} onChange={e => setLimit(Number(e.target.value))}>
        {[1, 2, 3].map(value => <option key={value} value={value}>{value}</option>)}
      </select></label>
      <button data-testid="repair-start" disabled={busy || !note.trim() || !parts.length || parts.length > 16 || parts.some(part => part.locked)}
        onClick={() => void request({ kind: "repair", control: { projectId: state.project.projectId, expectedRevision: state.revision,
          repair: { id: crypto.randomUUID(), note, area, maxIterations: limit, partIds: parts.map(part => part.id), ...(face ? { face } : {}) } } })}>
        Разрешить адресную правку
      </button>
      <p>Лимит расходуется только при применении правки ИИ. Просмотр предложения и ручная работа его не расходуют.</p>
    </>}
  </details>;
}
