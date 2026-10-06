import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import {
  cubes,
  FACE_NAMES,
  EditorError,
  MAX_STROKE_POINTS,
  pixelLine,
  previewTexture,
  textureMask,
  texturePixels,
  type EditorProject,
  type FaceName,
  type PixelPoint,
  type TextureCommand,
} from "@mcdev/editor-core";
import { useStudio } from "./store.ts";
import { drawAtlas } from "./Viewport.tsx";
import { TexelDensityInspector } from "./TexelDensityInspector.tsx";

type Stroke = {
  project: EditorProject;
  revision: number;
  pointer: number;
  command: Extract<TextureCommand, { type: "paint" }>;
  last: PixelPoint;
  seen: Set<number>;
};
const faceLabels: Record<FaceName, string> = {
  north: "Север · −Z",
  south: "Юг · +Z",
  east: "Восток · +X",
  west: "Запад · −X",
  up: "Верх · +Y",
  down: "Низ · −Y",
};
function report(error: unknown) {
  useStudio.setState({
    error:
      error instanceof Error ? error.message : "Не удалось изменить текстуру.",
  });
}
function UvFields({
  project,
  cubeId,
  face,
}: {
  project: EditorProject;
  cubeId: string;
  face: FaceName;
}) {
  const rect = project.texturePlan.faces.find((f) => f.cubeId === cubeId)!.uv[
    face
  ];
  const [values, setValues] = useState(rect.map(String));
  const cube = cubes(project).find((c) => c.id === cubeId)!;
  const axes =
    face === "north" || face === "south"
      ? [0, 1]
      : face === "east" || face === "west"
        ? [2, 1]
        : [0, 2];
  const density = [
    Math.abs(rect[2] - rect[0]) / (cube.size[axes[0]!]! + 2 * cube.inflate),
    Math.abs(rect[3] - rect[1]) / (cube.size[axes[1]!]! + 2 * cube.inflate),
  ];
  const busy = useStudio((s) => s.busy);
  return (
    <div
      className="uv-fields"
      title={`${density.map((v) => v.toFixed(1)).join(" × ")} пикс./ед. · отступ 1 пиксель · масштаб без сглаживания`}
    >
      <div className="uv-coordinates">
        {values.map((value, i) => (
          <label key={i}>
            {["U", "V", "U₂", "V₂"][i]}
            <input
              data-testid={`uv-${i}`}
              aria-label={`UV ${["U", "V", "U2", "V2"][i]}`}
              type="number"
              step="1"
              min="0"
              max={
                i % 2 === 0
                  ? project.model.texture.width
                  : project.model.texture.height
              }
              value={value}
              disabled={busy}
              onChange={(e) =>
                setValues(values.map((v, a) => (a === i ? e.target.value : v)))
              }
            />
          </label>
        ))}
      </div>
      <button
        data-testid="move-uv"
        disabled={busy || values.some((v) => v.trim() === "")}
        onClick={() => {
          const ui = useStudio.getState(),
            state = ui.state;
          if (!state || state.project !== project) {
            useStudio.setState({
              error: "Документ обновился. Проверьте UV и повторите перенос.",
            });
            return;
          }
          void ui.request({
            kind: "apply",
            mutation: {
              projectId: project.projectId,
              expectedRevision: state.revision,
              key: crypto.randomUUID(),
              commands: [
                {
                  type: "uv",
                  cubeId,
                  face,
                  rect: values.map(Number) as [number, number, number, number],
                },
              ],
            },
          });
        }}
      >
        Перенести UV и рисунок
      </button>
      <span>
        {density.map((v) => v.toFixed(1)).join(" × ")} пикс./ед. · отступ 1
        пиксель · масштаб без сглаживания
      </span>
    </div>
  );
}

export function TextureEditor({ project }: { project: EditorProject }) {
  const selection = useStudio((s) => s.selection),
    busy = useStudio((s) => s.busy),
    draft = useStudio((s) => s.draft),
    color = useStudio((s) => s.paintColor),
    paintFocus = useStudio((s) => s.paintFocus);
  const [tool, setTool] = useState<"brush" | "eraser" | "fill" | "pick">(
      "brush",
    ),
    [size, setSize] = useState(1),
    [zoom, setZoom] = useState(2),
    [face, setFace] = useState<FaceName | "">("");
  const [drawing, setDrawing] = useState(false);
  const [sharedUv, setSharedUv] = useState<"preserve-exact" | "split">("preserve-exact");
  const canvas = useRef<HTMLCanvasElement>(null),
    overlay = useRef<HTMLCanvasElement>(null),
    scroll = useRef<HTMLDivElement>(null),
    stroke = useRef<Stroke | null>(null),
    frame = useRef<number | null>(null);
  const selectionKey = JSON.stringify(selection);
  const allowed = useMemo(
    () => textureMask(project, selection, face || undefined),
    [project, selectionKey, face],
  );
  const displayed =
    draft?.projectId === project.projectId ? draft.project : project;
  function focusSelection() {
    const el = scroll.current;
    if (!el) return;
    let minX: number = project.model.texture.width,
      minY: number = project.model.texture.height,
      maxX = 0,
      maxY = 0;
    for (let i = 0; i < allowed.length; i++)
      if (allowed[i]) {
        const x = i % project.model.texture.width,
          y = Math.floor(i / project.model.texture.width);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + 1);
        maxY = Math.max(maxY, y + 1);
      }
    if (maxX === 0) return;
    el.scrollLeft = ((minX + maxX) * zoom) / 2 + 12 - el.clientWidth / 2;
    el.scrollTop = ((minY + maxY) * zoom) / 2 + 12 - el.clientHeight / 2;
  }
  useEffect(() => {
    if (canvas.current) drawAtlas(canvas.current, displayed);
  }, [displayed]);
  useEffect(() => {
    const el = overlay.current;
    if (!el) return;
    const { width, height } = project.model.texture;
    el.width = width;
    el.height = height;
    const ctx = el.getContext("2d")!,
      pixels = ctx.createImageData(width, height);
    for (let i = 0; i < allowed.length; i++)
      if (!allowed[i]) pixels.data.set([40, 49, 43, 110], i * 4);
    ctx.putImageData(pixels, 0, 0);
    ctx.strokeStyle = "#ef805e";
    ctx.lineWidth = 0.5;
    for (const binding of project.texturePlan.faces)
      if (selection.includes(binding.cubeId))
        for (const name of FACE_NAMES)
          if (!face || face === name) {
            const r = binding.uv[name];
            ctx.strokeRect(
              Math.min(r[0], r[2]),
              Math.min(r[1], r[3]),
              Math.abs(r[2] - r[0]),
              Math.abs(r[3] - r[1]),
            );
          }
  }, [project, allowed, selectionKey, face]);
  function cancel(message?: string) {
    const active = stroke.current;
    stroke.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (active && canvas.current?.hasPointerCapture(active.pointer))
      canvas.current.releasePointerCapture(active.pointer);
    useStudio.setState({
      draft: null,
      ...(message && active ? { note: message } : {}),
    });
    setDrawing(false);
  }
  useEffect(() => {
    const active = stroke.current,
      state = useStudio.getState().state;
    if (
      active &&
      (active.project.projectId !== state?.project.projectId ||
        active.revision !== state.revision ||
        JSON.stringify(active.command.cubeIds) !== selectionKey)
    )
      cancel("Незавершённый штрих отменён: проект или выделение изменились.");
  }, [project, selectionKey]);
  useEffect(() => {
    const blur = () => cancel("Незавершённый штрих отменён.");
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel("Штрих отменён.");
    };
    window.addEventListener("blur", blur);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("blur", blur);
      window.removeEventListener("keydown", escape);
      cancel("Незавершённый штрих отменён.");
    };
  }, []);
  function point(event: PointerEvent<HTMLCanvasElement>): PixelPoint | null {
    const r = event.currentTarget.getBoundingClientRect(),
      { width, height } = project.model.texture;
    const x = Math.floor(((event.clientX - r.left) * width) / r.width),
      y = Math.floor(((event.clientY - r.top) * height) / r.height);
    return x >= 0 && y >= 0 && x < width && y < height ? [x, y] : null;
  }
  function append(active: Stroke, end: PixelPoint) {
    for (const p of pixelLine(active.last, end)) {
      const index = p[1] * active.project.model.texture.width + p[0];
      if (!active.seen.has(index)) {
        if (active.command.points.length === MAX_STROKE_POINTS)
          throw new EditorError(
            "STROKE_LIMIT",
            "Штрих отменён: превышены 4096 точек. Рисуйте более короткими штрихами.",
          );
        active.seen.add(index);
        active.command.points.push(p);
      }
    }
    active.last = end;
  }
  function renderStroke(active: Stroke) {
    try {
      const painted = previewTexture(active.project, active.command);
      useStudio.setState({
        draft: {
          projectId: active.project.projectId,
          revision: active.revision,
          project: painted,
        },
      });
      return true;
    } catch (error) {
      if (error instanceof EditorError && error.code === "NO_CHANGE")
        return false;
      cancel();
      report(error);
      return false;
    }
  }
  function down(event: PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 || busy || stroke.current) return;
    const p = point(event),
      state = useStudio.getState().state;
    if (!p || !state || state.project !== project) return;
    if (tool === "pick") {
      const picked =
        texturePixels(project)[p[1] * project.model.texture.width + p[0]];
      if (picked) {
        useStudio.setState({ paintColor: picked, error: "" });
        setTool("brush");
      } else {
        setTool("eraser");
        useStudio.setState({
          note: "Выбран прозрачный пиксель — включён ластик.",
          error: "",
        });
      }
      return;
    }
    if (!allowed[p[1] * project.model.texture.width + p[0]]) {
      useStudio.setState({
        note: "Рисуйте внутри оранжевой UV-области. Выделите часть в дереве.",
        error: "",
      });
      return;
    }
    const targets = { cubeIds: [...selection], ...(face ? { face } : {}) };
    if (tool === "fill") {
      void useStudio.getState().request({
        kind: "apply",
        mutation: {
          projectId: project.projectId,
          expectedRevision: state.revision,
          key: crypto.randomUUID(),
          commands: [{ type: "fill", ...targets, color, seed: p }],
        },
      });
      return;
    }
    const active: Stroke = {
      project,
      revision: state.revision,
      pointer: event.pointerId,
      command: {
        type: "paint",
        ...targets,
        size,
        color: tool === "eraser" ? null : color,
        points: [],
      },
      last: p,
      seen: new Set(),
    };
    stroke.current = active;
    setDrawing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    useStudio.setState({
      error: "",
      note: "Штрих: отпустите кисть для применения · Esc — отмена",
    });
    append(active, p);
    renderStroke(active);
  }
  function move(event: PointerEvent<HTMLCanvasElement>) {
    const active = stroke.current,
      p = point(event);
    if (!active || active.pointer !== event.pointerId || !p) return;
    try {
      append(active, p);
    } catch (error) {
      cancel();
      report(error);
      return;
    }
    if (frame.current === null)
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        if (stroke.current === active) renderStroke(active);
      });
  }
  function up(event: PointerEvent<HTMLCanvasElement>) {
    const active = stroke.current;
    if (!active || active.pointer !== event.pointerId) return;
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      cancel("Штрих отменён: захват указателя потерян.");
      return;
    }
    const p = point(event);
    try {
      if (p) append(active, p);
    } catch (error) {
      cancel();
      report(error);
      return;
    }
    const changed = renderStroke(active),
      state = useStudio.getState().state;
    cancel();
    if (!changed) {
      useStudio.setState({ note: "Штрих не изменил пиксели." });
      return;
    }
    if (
      !state ||
      state.project.projectId !== active.project.projectId ||
      state.revision !== active.revision
    ) {
      useStudio.setState({ note: "Штрих отменён: проект уже изменился." });
      return;
    }
    if (useStudio.getState().busy) {
      useStudio.setState({
        note: "Штрих отменён: редактор выполняет другую операцию.",
      });
      return;
    }
    void useStudio.getState().request({
      kind: "apply",
      mutation: {
        projectId: active.project.projectId,
        expectedRevision: active.revision,
        key: crypto.randomUUID(),
        commands: [active.command],
      },
    });
  }
  return (
    <div className="texture-editor" data-testid="texture-editor">
      <div className="paint-toolbar">
        <div className="paint-tools">
          {(
            [
              ["brush", "Кисть"],
              ["eraser", "Ластик"],
              ["fill", "Заливка"],
              ["pick", "Пипетка"],
            ] as const
          ).map(([name, label]) => (
            <button
              key={name}
              data-testid={`paint-${name}`}
              aria-pressed={tool === name}
              className={tool === name ? "active" : ""}
              disabled={busy || drawing}
              onClick={() => setTool(name)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="paint-color">
          <input
            aria-label="Цвет кисти"
            data-testid="brush-color"
            type="color"
            value={color}
            disabled={drawing}
            onChange={(e) => useStudio.setState({ paintColor: e.target.value })}
          />
          <span data-testid="brush-hex">{color.toUpperCase()}</span>
        </label>
        <label>
          Размер{" "}
          <select
            aria-label="Размер кисти"
            value={size}
            disabled={drawing}
            onChange={(e) => setSize(Number(e.target.value))}
          >
            {[1, 2, 3, 4, 6, 8].map((v) => (
              <option key={v} value={v}>
                {v} px
              </option>
            ))}
          </select>
        </label>
        <label>
          Масштаб{" "}
          <select
            aria-label="Масштаб текстуры"
            value={zoom}
            disabled={drawing}
            onChange={(e) => setZoom(Number(e.target.value))}
          >
            {[1, 2, 4, 8, 16].map((v) => (
              <option key={v} value={v}>
                {v * 100}%
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="paint-scope">
        <span>{selection.length} куб. выделено</span>
        <button
          data-testid="paint-focus"
          onClick={() =>
            useStudio.setState({ paintFocus: !useStudio.getState().paintFocus })
          }
        >
          {paintFocus ? "3D: часть" : "3D: предмет"}
        </button>
        <button
          data-testid="focus-uv"
          disabled={drawing || !selection.length}
          onClick={focusSelection}
        >
          К выделению
        </button>
        <select
          aria-label="Куб для UV"
          disabled={drawing || busy || !selection.length}
          value={selection.length === 1 ? selection[0] : ""}
          onChange={(e) => {
            if (e.target.value) useStudio.getState().select([e.target.value]);
          }}
        >
          <option value="">Вся выбранная часть</option>
          {cubes(project)
            .filter((c) => selection.includes(c.id))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.id}
              </option>
            ))}
        </select>
        <select
          aria-label="Грань текстуры"
          value={face}
          disabled={drawing}
          onChange={(e) => setFace(e.target.value as FaceName | "")}
        >
          <option value="">Все грани</option>
          {FACE_NAMES.map((f) => (
            <option key={f} value={f}>
              {faceLabels[f]}
            </option>
          ))}
        </select>
      </div>
      <TexelDensityInspector project={project} cubeIds={selection} />
      <details className="uv-repack">
        <summary>Упаковка UV выделения</summary>
        <p className="hint">Перенести все грани выбранных кубов без изменения рисунка, отражения и масштаба пикселей.</p>
        <label>Общие UV{" "}<select aria-label="Общие UV при перепаковке" value={sharedUv} disabled={busy || drawing}
          onChange={e => setSharedUv(e.target.value as "preserve-exact" | "split")}>
          <option value="preserve-exact">Сохранить одинаковые</option>
          <option value="split">Разделить поверхности</option>
        </select></label>
        <button data-testid="repack-uv" disabled={busy || drawing || !selection.length}
          onClick={() => { void useStudio.getState().command({ type: "repackUv", cubeIds: selection, shared: sharedUv }); }}>
          Перепаковать UV
        </button>
      </details>
      <div className="texture-scroll" ref={scroll}>
        <div
          className="texture-surface"
          style={{
            width: project.model.texture.width * zoom,
            height: project.model.texture.height * zoom,
          }}
        >
          <canvas
            data-testid="paint-canvas"
            ref={canvas}
            aria-label="Рисование на пиксельной текстуре"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={() => cancel("Штрих отменён.")}
            onLostPointerCapture={() => {
              if (stroke.current)
                cancel("Штрих отменён: захват указателя потерян.");
            }}
          />
          <canvas ref={overlay} className="uv-overlay" aria-hidden="true" />
        </div>
      </div>
      <div className="texture-palette">
        {project.texturePlan.palette.map((c) => (
          <button
            key={c.symbol}
            title={c.color}
            aria-label={`Цвет кисти ${c.color}`}
            disabled={drawing}
            style={{ background: c.color }}
            onClick={() => {
              useStudio.setState({ paintColor: c.color });
              setTool("brush");
            }}
          />
        ))}
        <span>Палитра до 32 цветов · штрих отменяется целиком</span>
      </div>
      {selection.length === 1 && face ? (
        <UvFields
          key={`${selection[0]}-${face}-${JSON.stringify(project.texturePlan.faces.find((f) => f.cubeId === selection[0])!.uv[face])}`}
          project={project}
          cubeId={selection[0]!}
          face={face}
        />
      ) : (
        <p className="uv-tip">
          Оранжевая рамка — область покраски. Для переноса UV выберите один куб
          и одну грань.
        </p>
      )}
    </div>
  );
}
