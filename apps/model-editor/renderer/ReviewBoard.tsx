import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { EditorProject } from "@mcdev/editor-core";
import type { View } from "../shared/bridge.ts";
import { Viewport, comparisonFrame, type NativePreviews } from "./Viewport.tsx";
import { ArtReviewPanel } from "./ArtReviewPanel.tsx";

const angles: [View, string, string][] = [
  ["front", "Спереди", "Силуэт и акцент"],
  ["side", "Сбоку", "Толщина и стыки"],
  ["back", "Сзади", "Покраска обеих сторон"],
  ["perspective", "Три четверти", "Объём и материалы"],
];

export function ReviewBoard({
  project,
  referenceProject,
  onReady,
  materials = false,
}: {
  project: EditorProject;
  referenceProject?: EditorProject;
  onReady?: () => void;
  materials?: boolean;
}) {
  const framing = useMemo(
    () =>
      comparisonFrame([
        project,
        ...(referenceProject ? [referenceProject] : []),
      ]),
    [project, referenceProject],
  );
  const [thumbs, setThumbs] = useState<Partial<Record<View, NativePreviews>>>({});
  const [silhouettes, setSilhouettes] = useState<Partial<NativePreviews>>({});
  const [pixelRatio, setPixelRatio] = useState(() => window.devicePixelRatio);
  const root = useRef<HTMLDivElement>(null);
  const ready = useRef(false);
  useEffect(() => {
    let media: MediaQueryList;
    const update = () => {
      media?.removeEventListener("change", update);
      const ratio = window.devicePixelRatio;
      setPixelRatio(ratio);
      // Учитывает перенос на другой монитор и изменение масштаба страницы.
      media = window.matchMedia(`(resolution: ${ratio}dppx)`);
      media.addEventListener("change", update);
    };
    update();
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    ready.current = false;
    setThumbs({});
    setSilhouettes({});
  }, [project, referenceProject]);
  useEffect(() => {
    if (!thumbs.front) return;
    let canceled = false;
    const mask = (url: string, resolution: 32 | 64) => {
      const image = new Image();
      image.onload = () => {
        if (canceled || image.naturalWidth !== resolution || image.naturalHeight !== resolution) return;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = resolution;
        const context = canvas.getContext("2d")!;
        // Меняется только цвет: alpha и разрешение нативного рендера сохраняются.
        context.drawImage(image, 0, 0);
        context.globalCompositeOperation = "source-in";
        context.fillStyle = "#000000";
        context.fillRect(0, 0, resolution, resolution);
        const png = canvas.toDataURL();
        setSilhouettes((old) => ({ ...old, [resolution]: png }));
      };
      image.src = url;
    };
    setSilhouettes({});
    mask(thumbs.front[32], 32);
    mask(thumbs.front[64], 64);
    return () => {
      canceled = true;
    };
  }, [thumbs.front]);
  useEffect(() => {
    if (
      !onReady ||
      ready.current ||
      angles.some(([v]) => !thumbs[v]) ||
      !silhouettes[32] ||
      !silhouettes[64]
    )
      return;
    let canceled = false;
    const finish = async () => {
      await Promise.all(
        Array.from(root.current!.querySelectorAll("img"), (img) =>
          img.decode(),
        ),
      );
      await new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      );
      if (!canceled && !ready.current) {
        ready.current = true;
        onReady();
      }
    };
    void finish().catch(() => undefined);
    return () => {
      canceled = true;
    };
  }, [thumbs, silhouettes, onReady]);
  return (
    <div className="review-board" data-testid="review-board" ref={root}
      style={{ "--native-pixel-ratio": pixelRatio } as CSSProperties}>
      <div className="review-heading">
        <div>
          <strong>Обзор модели</strong>
          <span>Форма → материалы → детали</span>
        </div>
        <span className="review-badge">Визуальная проверка</span>
      </div>
      {materials && <ArtReviewPanel />}
      <div className="review-grid">
        {angles.map(([view, title, hint]) => (
          <section className="review-angle" key={view} data-view={view}>
            <div className="review-caption">
              <strong>{title}</strong>
              <span>{hint}</span>
            </div>
            <div className="review-canvas">
              <Viewport
                project={project}
                review={{
                  framing,
                  view,
                  silhouette: false,
                  onNativePreviews: (previews) =>
                    setThumbs((old) =>
                      old[view]?.[32] === previews[32] && old[view]?.[64] === previews[64]
                        ? old : { ...old, [view]: previews },
                    ),
                }}
              />
            </div>
          </section>
        ))}
      </div>
      <div className="review-readability">
        {([32, 64] as const).map((resolution) => (
          <div key={`silhouette-${resolution}`}>
            <div className="review-preview-image review-silhouette-image">
              {silhouettes[resolution] && (
                <img data-testid={`review-silhouette-${resolution}`}
                  src={silhouettes[resolution]} width={resolution} height={resolution}
                  style={{ width: resolution / pixelRatio, height: resolution / pixelRatio }}
                  alt={`Чёрный силуэт спереди, ${resolution} пикселя`} />
              )}
            </div>
            <span>Силуэт · {resolution} px<small>Спереди · 1:1</small></span>
          </div>
        ))}
        {([32, 64] as const).map((resolution) => (
          <div key={`color-${resolution}`}>
            <div className="review-preview-image">
              {thumbs.perspective && (
                <img data-testid={`review-color-${resolution}`}
                  src={thumbs.perspective[resolution]} width={resolution} height={resolution}
                  style={{ width: resolution / pixelRatio, height: resolution / pixelRatio }}
                  alt={`Три четверти, ${resolution} пикселя`} />
              )}
            </div>
            <span>Цвет · {resolution} px<small>Три четверти · 1:1</small></span>
          </div>
        ))}
      </div>
      <p className="review-limit">
        Предпросмотр редактора. Вид в игровом инвентаре и работа в Minecraft ещё
        не проверены.
      </p>
    </div>
  );
}
