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
      {job?.layout === "review" ? (
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
