import { useEffect, useState } from "react";
import type { ArtReviewSummary, ArtReviewControl } from "../shared/art-review.ts";
import { useStudio } from "./store.ts";

function reviewNotes(review: ArtReviewSummary): string[] {
  return [...new Set(review.diagnostics.flatMap(item => {
    if (item.message === "Критерий ещё не оценён." || review.unratedCriteria > 0 && item.id.startsWith("ART_SCORE_")) return [];
    if (item.id === "ART_RESOURCE_REFERENCE_INVALID") return ["ID модели не совпадает с заданием. Согласуйте имя ресурса в модели и ArtSpec."];
    if (item.message.includes("ролью provenance")) return ["Добавьте сведения об источниках модели, текстуры и концепта."];
    if (item.message.includes("ролью in-game")) return ["Добавьте результаты проверки модели в Minecraft."];
    if (item.id === "ART_REVIEW_REQUIRED") return ["Форму, материалы и игровые виды предстоит оценить человеку."];
    if (item.id === "ART_HUMAN_APPROVAL_MISSING") return [];
    return [item.message];
  }))].slice(0, 8);
}

export function ArtReviewPanel() {
  const state = useStudio(value => value.state), busy = useStudio(value => value.busy), request = useStudio(value => value.request);
  const [review, setReview] = useState<ArtReviewSummary | null>(null), [loading, setLoading] = useState(false);
  const projectId = state?.project.projectId, revision = state?.revision;
  useEffect(() => {
    let cancelled = false; setReview(null); setLoading(true);
    void request({ kind: "artReview", control: { action: "get" } }).then(result => {
      if (!cancelled) { if (result?.ok) setReview(result.artReview ?? null); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [projectId, revision, request]);
  const act = async (control: ArtReviewControl) => {
    setLoading(true);
    try { const result = await request({ kind: "artReview", control }); if (result?.ok) setReview(result.artReview ?? null); }
    finally { setLoading(false); }
  };
  return <details className="art-review-panel" data-testid="art-review-panel">
    <summary>Материалы арт-проверки <span>{loading ? "Загрузка…" : review?.reviewRequested ? "Нужна доработка" : review ? "Черновик" : "Не подготовлены"}</span></summary>
    <div className="art-review-body">
      <p>Экспорт, восемь ракурсов и ArtSpec одной версии. Оценки формы, текстуры и работы в игре заполняются после проверки.</p>
      <div className="art-review-actions">
        <button data-testid="art-review-prepare" disabled={busy || loading || !state} onClick={() => state && void act({ action: "prepare", projectId: state.project.projectId, expectedRevision: state.revision })}>Подготовить материалы</button>
        <button data-testid="art-review-request" disabled={busy || loading || !state || !review || !review.matchesCurrentProject || review.reviewRequested}
          onClick={() => state && review && void act({ action: "request", projectId: state.project.projectId, expectedRevision: state.revision, expectedHeadSha256: review.headSha256 })}>Запросить проверку</button>
      </div>
      {review && <>
        <dl className="art-review-facts" data-testid="art-review-status">
          <div><dt>Версия модели</dt><dd>{review.matchesCurrentProject ? "Совпадает" : "Изменилась · подготовьте заново"}</dd></div>
          <div><dt>Материалы</dt><dd>{review.fileCount} файлов · 8 ракурсов</dd></div>
          <div><dt>Оценки</dt><dd>{review.unratedCriteria} из 19 ещё без оценки</dd></div>
          <div><dt>Связь с ArtSpec</dt><dd>{review.bindingsAccepted ? "Подтверждена" : "Есть несоответствия"}</dd></div>
        </dl>
        <p className="art-review-identity" title={review.candidateSha256}>Версия материалов {review.candidateSha256.slice(0, 12)} · запись {review.sequence}</p>
        <ul className="art-review-diagnostics" data-testid="art-review-diagnostics">{reviewNotes(review).map(message => <li key={message}>{message}</li>)}</ul>
        <details className="art-review-history"><summary>Технические сведения</summary><ul className="art-review-diagnostics">{review.diagnostics.map((item, index) => <li key={`${item.id}-${index}`}><code>{item.id}</code> {item.message}</li>)}</ul></details>
        <details className="art-review-history"><summary>История · {review.history.length}</summary><ol>{review.history.map(event => <li key={event.sequence}>Запись {event.sequence} · {event.reviewRequested ? "Проверка запрошена" : "Материалы подготовлены"}</li>)}</ol></details>
      </>}
      <p className="art-review-limit">Запрос сохраняется локально. Художественная приёмка и проверка в Minecraft ещё не подтверждены.</p>
    </div>
  </details>;
}
