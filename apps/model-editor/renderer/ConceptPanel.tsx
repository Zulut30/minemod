import { useState } from "react";
import { MAX_CONCEPTS, type ConceptDraft, type EditorProject } from "@mcdev/editor-core";
import { useStudio } from "./store.ts";
export function ConceptPanel({project}: {project:EditorProject}) {
  const {busy,request,command}=useStudio();
  const [draft,setDraft]=useState<ConceptDraft>({label:"",role:"concept",origin:"original",attribution:"",rights:"",source:"",note:""});
  const concepts=project.design?.concepts??[];
  return <details className="concept-panel" data-testid="concept-panel">
    <summary>Концепты и references · {concepts.length}/{MAX_CONCEPTS}</summary>
    <p>Изображение задаёт направление дизайна. Редактируемая 3D-модель и её качество проверяются отдельно.</p>
    <div className="concept-list">{concepts.map(concept=><article className="concept-card" key={concept.id} data-testid={`concept-${concept.id}`}>
      <ConceptImage projectId={project.projectId} conceptId={concept.id} label={concept.label} />
      <strong>{concept.label}</strong><small>2D направление · {concept.role === "concept" ? "концепт" : "reference"}</small>
      <p>{concept.note}</p>
      <details><summary>Источник и права</summary><p>{concept.attribution}</p><p>{concept.rights}</p><p>{concept.source}</p>
        <small>Сведения введены пользователем. Это не художественная приёмка или автоматическая проверка лицензии.</small>
      </details>
      <button disabled={busy} data-testid={`concept-remove-${concept.id}`} onClick={()=>void command({type:"conceptRemove",conceptId:concept.id})}>Убрать из задания</button>
    </article>)}</div>
    <div className="concept-import">
      <label>Название<input data-testid="concept-label" maxLength={80} value={draft.label} onChange={e=>setDraft({...draft,label:e.target.value})}/></label>
      <label>Назначение<select data-testid="concept-role" value={draft.role} onChange={e=>setDraft({...draft,role:e.target.value as ConceptDraft["role"]})}>
        <option value="concept">Концепт будущей модели</option><option value="reference">Reference для сравнения</option>
      </select></label>
      <label>Происхождение<select data-testid="concept-origin" value={draft.origin} onChange={e=>setDraft({...draft,origin:e.target.value as ConceptDraft["origin"]})}>
        <option value="original">Собственная работа</option><option value="ai-generated">Создано через ИИ</option><option value="permission">Получено разрешение / лицензия</option>
      </select></label>
      <label>Автор / инструмент<input data-testid="concept-attribution" maxLength={160} value={draft.attribution} onChange={e=>setDraft({...draft,attribution:e.target.value})}/></label>
      <label>Право использования<textarea data-testid="concept-rights" rows={2} maxLength={400} value={draft.rights} onChange={e=>setDraft({...draft,rights:e.target.value})} placeholder="Например: собственный концепт; или укажите разрешение автора / лицензию"/></label>
      <label>Источник<input data-testid="concept-source" maxLength={512} value={draft.source} onChange={e=>setDraft({...draft,source:e.target.value})} placeholder="Обязателен для чужого reference"/></label>
      <label>Что перенести в модель<textarea data-testid="concept-note" rows={2} maxLength={400} value={draft.note} onChange={e=>setDraft({...draft,note:e.target.value})}/></label>
      <button data-testid="concept-import" disabled={busy||concepts.length>=MAX_CONCEPTS||!draft.label.trim()||!draft.attribution.trim()||!draft.rights.trim()||(draft.origin==="permission"&&!draft.source.trim())}
        onClick={()=>{const state=useStudio.getState().state;if(state)void request({kind:"conceptImport",control:{projectId:project.projectId,expectedRevision:state.revision,draft}});}}>Выбрать PNG и сохранить концепт</button>
      <small>Оригинальный PNG до 8 MiB, стороны до 4096 и площадь до 4 Mpx. При переносе проекта сохраните рядом его папку .assets.</small>
    </div>
  </details>;
}
function ConceptImage({projectId,conceptId,label}: {projectId:string;conceptId:string;label:string}) {
  const [failed,setFailed]=useState(false);
  return failed ? <p role="status">Исходный PNG недоступен. Восстановите его из папки .assets проекта.</p> :
    <img src={`studio://app/concepts/${projectId}/${conceptId}.png`} alt={label} onError={()=>setFailed(true)}/>;
}
