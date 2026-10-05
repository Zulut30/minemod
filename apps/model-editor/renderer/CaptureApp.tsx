import { useEffect, useMemo, useState } from "react";
import type { CaptureJob } from "../shared/bridge.ts";
import { useStudio } from "./store.ts";
import { Viewport, comparisonFrame } from "./Viewport.tsx";
import { ReviewBoard } from "./ReviewBoard.tsx";
export function CaptureApp() {
  const [job, setJob] = useState<CaptureJob | null>(null);
  const review = useMemo(
    () =>
      job && (job.referenceProject || job.silhouette)
        ? {
            framing: comparisonFrame([
              job.project,
              ...(job.referenceProject ? [job.referenceProject] : []),
            ]),
            silhouette: !!job.silhouette,
          }
        : undefined,
    [job],
  );
  useEffect(() => {
    const unsubscribe = window.studio.onCapture((value) => {
      useStudio.setState({
        view: value.view,
        selection: [],
        hidden: [],
        frame: useStudio.getState().frame + 1,
      });
      setJob(value);
    });
    window.studio.captureReady("loaded");
    return unsubscribe;
  }, []);
  return (
    <div className={`capture-stage ${job?.silhouette ? "is-silhouette" : ""}`}>
      {job?.conceptId ? <ConceptCapture key={job.id} job={job} /> : job?.layout === "review" ? (
        <ReviewBoard
          key={job.id}
          project={job.project}
          {...(job.referenceProject
            ? { referenceProject: job.referenceProject }
            : {})}
          onReady={() => window.studio.captureReady(job.id)}
        />
      ) : (
        job && (
          <Viewport
            project={job.project}
            captureId={job.id}
            {...(review ? { review } : {})}
          />
        )
      )}
    </div>
  );
}
function ConceptCapture({job}: {job:CaptureJob}) {
  const concept=job.project.design?.concepts?.find(c=>c.id===job.conceptId);
  const [loaded,setLoaded]=useState(false);
  useEffect(()=>{
    if(!loaded)return;
    let cancelled=false;
    requestAnimationFrame(()=>requestAnimationFrame(()=>{if(!cancelled)window.studio.captureReady(job.id);}));
    return ()=>{cancelled=true;};
  },[loaded,job.id]);
  return <figure className="concept-capture">
    <figcaption><strong>{concept?.label}</strong><span>Концепт · 2D изображение-направление</span></figcaption>
    <img src={`studio://app/concepts/${job.project.projectId}/${job.conceptId}.png?capture=${job.id}`} alt={concept?.label}
      onError={()=>window.studio.captureReady(job.id,true)}
      onLoad={e=>void e.currentTarget.decode().then(()=>setLoaded(true)).catch(()=>window.studio.captureReady(job.id,true))} />
    <p>Это не готовая 3D-модель. Геометрия, рисунок и игровой вид проверяются отдельно.</p>
  </figure>;
}
