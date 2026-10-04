import { useEffect, useMemo, useRef, useState } from "react";
import type { EditorProject } from "@mcdev/editor-core";
import type { View } from "../shared/bridge.ts";
import { Viewport, comparisonFrame } from "./Viewport.tsx";

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
}: {
  project: EditorProject;
  referenceProject?: EditorProject;
  onReady?: () => void;
}) {
  const framing = useMemo(
    () =>
      comparisonFrame([
        project,
        ...(referenceProject ? [referenceProject] : []),
      ]),
    [project, referenceProject],
  );
  const [thumbs, setThumbs] = useState<Partial<Record<View, string>>>({});
  const [small, setSmall] = useState("");
  const [silhouette, setSilhouette] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const ready = useRef(false);
  useEffect(() => {
    ready.current = false;
    setThumbs({});
    setSmall("");
    setSilhouette("");
  }, [project, referenceProject]);
  useEffect(() => {
    if (!thumbs.front || !thumbs.perspective) return;
    const convert = (
      url: string,
      size: number,
      mask: boolean,
      done: (url: string) => void,
    ) => {
      const image = new Image();
      let canceled = false;
      image.onload = () => {
        if (canceled) return;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const context = canvas.getContext("2d")!;
        context.imageSmoothingEnabled = false;
        context.drawImage(image, 0, 0, size, size);
        if (mask) {
          context.globalCompositeOperation = "source-in";
          context.fillStyle = "#e6edf5";
          context.fillRect(0, 0, size, size);
        }
        done(canvas.toDataURL());
      };
      image.src = url;
      return () => {
        canceled = true;
      };
    };
    const cleanSmall = convert(thumbs.perspective, 32, false, setSmall);
    const cleanMask = convert(thumbs.front, 64, true, setSilhouette);
    return () => {
      cleanSmall();
      cleanMask();
    };
  }, [thumbs.front, thumbs.perspective]);
  useEffect(() => {
    if (
      !onReady ||
      ready.current ||
      angles.some(([v]) => !thumbs[v]) ||
      !small ||
      !silhouette
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
  }, [thumbs, small, silhouette, onReady]);
  return (
    <div className="review-board" data-testid="review-board" ref={root}>
      <div className="review-heading">
        <div>
          <strong>Обзор модели</strong>
          <span>Форма → материалы → детали</span>
        </div>
        <span className="review-badge">Визуальная проверка</span>
      </div>
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
                  onThumbnail: (url) =>
                    setThumbs((old) =>
                      old[view] === url ? old : { ...old, [view]: url },
                    ),
                }}
              />
            </div>
          </section>
        ))}
      </div>
      <div className="review-readability">
        <div>
          {silhouette && (
            <img src={silhouette} width={64} height={64} alt="Силуэт спереди" />
          )}
          <span>
            Силуэт<small>Форма без цвета</small>
          </span>
        </div>
        <div>
          {small && (
            <img
              src={small}
              width={64}
              height={64}
              alt="Три четверти на 32 пикселях"
            />
          )}
          <span>
            32 px<small>Крупные акценты</small>
          </span>
        </div>
        <div>
          {thumbs.perspective && (
            <img
              src={thumbs.perspective}
              width={64}
              height={64}
              alt="Три четверти на 64 пикселях"
            />
          )}
          <span>
            64 px<small>Рисунок и контраст</small>
          </span>
        </div>
      </div>
      <p className="review-limit">
        Предпросмотр редактора. Вид в игровом инвентаре и работа в Minecraft ещё
        не проверены.
      </p>
    </div>
  );
}
