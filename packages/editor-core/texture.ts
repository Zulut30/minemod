import type { EditorProject, EditorCommand, FaceName } from "./index.ts";
import { EditorError } from "./errors.ts";
export const MAX_STROKE_POINTS = 4096;
export type TextureCommand = Extract<
  EditorCommand,
  { type: "paint" | "fill" | "uv" | "repackUv" }
>;
export const UV_PACK_LIMITS = Object.freeze({ prefixCells: 100_663_296, placementChecks: 4_000_000 });
export type PixelPoint = [number, number];
type Rect = [number, number, number, number];
function pixelsIn(rect: Rect, width: number, visit: (i: number) => void): void {
  for (let y = Math.min(rect[1], rect[3]); y < Math.max(rect[1], rect[3]); y++)
    for (
      let x = Math.min(rect[0], rect[2]);
      x < Math.max(rect[0], rect[2]);
      x++
    )
      visit(y * width + x);
}
function area(
  project: EditorProject,
  selected: (cubeId: string, face: FaceName) => boolean,
): Uint8Array {
  const out = new Uint8Array(
    project.model.texture.width * project.model.texture.height,
  );
  for (const binding of project.texturePlan.faces)
    for (const [face, rect] of Object.entries(binding.uv))
      if (selected(binding.cubeId, face as FaceName))
        pixelsIn(rect, project.model.texture.width, (i) => {
          out[i] = 1;
        });
  return out;
}
export function textureMask(
  project: EditorProject,
  cubeIds: readonly string[],
  face?: FaceName,
): Uint8Array {
  const ids = new Set(cubeIds);
  return area(
    project,
    (cubeId, name) => ids.has(cubeId) && (!face || name === face),
  );
}
export function texturePixels(project: EditorProject): (string | null)[] {
  const palette = new Map(
    project.texturePlan.palette.map((c) => [c.symbol, c.color.toLowerCase()]),
  );
  return [...project.texturePlan.rows.join("")].map((symbol) =>
    symbol === "." ? null : palette.get(symbol)!,
  );
}
function writePixels(project: EditorProject, pixels: (string | null)[]): void {
  const palette: { symbol: string; color: string }[] = [],
    byColor = new Map<string, string>();
  const symbols = pixels.map((color) => {
    if (color === null) return ".";
    let symbol = byColor.get(color);
    if (!symbol) {
      if (palette.length === 32)
        throw new EditorError(
          "PALETTE_FULL",
          "Нужно больше 32 цветов. Возьмите цвет из палитры или пипеткой.",
        );
      symbol = palette.length.toString(32);
      byColor.set(color, symbol);
      palette.push({ symbol, color });
    }
    return symbol;
  });
  project.texturePlan.palette = palette.length
    ? palette
    : [project.texturePlan.palette[0]!];
  project.texturePlan.rows = Array.from(
    { length: project.model.texture.height },
    (_, y) =>
      symbols
        .slice(
          y * project.model.texture.width,
          (y + 1) * project.model.texture.width,
        )
        .join(""),
  );
}
// Целочисленная линия закрывает промежутки при быстром движении кисти, без сглаживания.
export function pixelLine(from: PixelPoint, to: PixelPoint): PixelPoint[] {
  let [x, y] = from;
  const dx = Math.abs(to[0] - x),
    dy = -Math.abs(to[1] - y),
    sx = x < to[0] ? 1 : -1,
    sy = y < to[1] ? 1 : -1;
  let error = dx + dy;
  const out: PixelPoint[] = [];
  while (true) {
    out.push([x, y]);
    if (x === to[0] && y === to[1]) return out;
    const twice = 2 * error;
    if (twice >= dy) {
      error += dy;
      x += sx;
    }
    if (twice <= dx) {
      error += dx;
      y += sy;
    }
  }
}
export function applyTexture(
  project: EditorProject,
  command: TextureCommand,
): void {
  if (command.type === "repackUv") {
    repackUv(project, command);
    return;
  }
  if (command.type === "uv") {
    moveUv(project, command);
    return;
  }
  const { width, height } = project.model.texture;
  const ids = new Set(command.cubeIds),
    selected = (cubeId: string, face: FaceName) =>
      ids.has(cubeId) && (!command.face || command.face === face);
  const allowed = area(project, selected),
    other = area(project, (cubeId, face) => !selected(cubeId, face));
  const pixels = texturePixels(project),
    touched = new Uint8Array(pixels.length);
  const point = ([x, y]: PixelPoint) => {
    if (x >= width || y >= height)
      throw new EditorError(
        "PIXEL_BOUNDS",
        "Пиксель выходит за границы атласа.",
      );
    return y * width + x;
  };
  if (command.type === "paint") {
    const offset = Math.floor((command.size - 1) / 2);
    for (const center of command.points) {
      point(center);
      for (let v = 0; v < command.size; v++)
        for (let u = 0; u < command.size; u++) {
          const x = center[0] + u - offset,
            y = center[1] + v - offset;
          if (
            x >= 0 &&
            y >= 0 &&
            x < width &&
            y < height &&
            allowed[y * width + x]
          )
            touched[y * width + x] = 1;
        }
    }
  } else {
    const seed = point(command.seed),
      original = pixels[seed];
    if (!allowed[seed])
      throw new EditorError(
        "EMPTY_PAINT",
        "Выберите пиксель внутри выделенной поверхности.",
      );
    const pending = [seed];
    touched[seed] = 1;
    for (let cursor = 0; cursor < pending.length; cursor++) {
      const i = pending[cursor]!,
        x = i % width,
        y = Math.floor(i / width);
      const adjacent = [
        x > 0 ? i - 1 : -1,
        x + 1 < width ? i + 1 : -1,
        y > 0 ? i - width : -1,
        y + 1 < height ? i + width : -1,
      ];
      for (const next of adjacent)
        if (
          next >= 0 &&
          !touched[next] &&
          allowed[next] &&
          pixels[next] === original
        ) {
          touched[next] = 1;
          pending.push(next);
        }
    }
  }
  const color = command.color?.toLowerCase() ?? null;
  let changed = false;
  for (let i = 0; i < touched.length; i++)
    if (touched[i] && pixels[i] !== color) {
      if (other[i])
        throw new EditorError(
          "SHARED_UV",
          "Пиксель используется другой поверхностью. Сначала перенесите выбранную UV-грань.",
        );
      pixels[i] = color;
      changed = true;
    }
  if (!changed)
    throw new EditorError("NO_CHANGE", "Штрих не меняет выбранные пиксели.");
  writePixels(project, pixels);
}
function moveUv(
  project: EditorProject,
  command: Extract<TextureCommand, { type: "uv" }>,
): void {
  const binding = project.texturePlan.faces.find(
    (f) => f.cubeId === command.cubeId,
  )!;
  const old = binding.uv[command.face],
    next = command.rect;
  if (JSON.stringify(old) === JSON.stringify(next))
    throw new EditorError("NO_CHANGE", "UV уже имеет эти координаты.");
  const { width, height } = project.model.texture;
  if (next.some((v, a) => v > (a % 2 === 0 ? width : height)))
    throw new EditorError("UV_BOUNDS", "UV выходит за границы атласа.");
  const other = area(
    project,
    (cubeId, face) => cubeId !== command.cubeId || face !== command.face,
  );
  const [left, top, right, bottom] = [
    Math.min(next[0], next[2]),
    Math.min(next[1], next[3]),
    Math.max(next[0], next[2]),
    Math.max(next[1], next[3]),
  ];
  for (let y = Math.max(0, top - 1); y < Math.min(height, bottom + 1); y++)
    for (let x = Math.max(0, left - 1); x < Math.min(width, right + 1); x++)
      if (other[y * width + x])
        throw new EditorError(
          "UV_COLLISION",
          "Новая UV-грань пересекает другую поверхность или её отступ в 1 пиксель.",
        );
  const source = texturePixels(project),
    result = [...source];
  // Общие старые пиксели сохраняются; только свободная область прежней грани очищается.
  pixelsIn(old, width, (i) => {
    if (!other[i]) result[i] = null;
  });
  const oldWidth = Math.abs(old[2] - old[0]),
    oldHeight = Math.abs(old[3] - old[1]);
  for (let y = top; y < bottom; y++)
    for (let x = left; x < right; x++) {
      let u = (x - left + 0.5) / (right - left),
        v = (y - top + 0.5) / (bottom - top);
      if (next[0] > next[2]) u = 1 - u;
      if (next[1] > next[3]) v = 1 - v;
      if (old[0] > old[2]) u = 1 - u;
      if (old[1] > old[3]) v = 1 - v;
      const sx =
        Math.min(old[0], old[2]) +
        Math.min(oldWidth - 1, Math.floor(u * oldWidth));
      const sy =
        Math.min(old[1], old[3]) +
        Math.min(oldHeight - 1, Math.floor(v * oldHeight));
      result[y * width + x] = source[sy * width + sx]!;
    }
  binding.uv[command.face] = [...next];
  writePixels(project, result);
}

function repackUv(project: EditorProject, command: Extract<TextureCommand, { type: "repackUv" }>): void {
  const { width, height } = project.model.texture, ids = new Set(command.cubeIds);
  const selected = area(project, id => ids.has(id)), other = area(project, id => !ids.has(id));
  const source = texturePixels(project);
  // Защищаем также неиспользуемый рисунок вне выбранных UV.
  const occupied = Uint8Array.from(source, (color, i) => other[i] || color !== null && !selected[i] ? 1 : 0);
  type Face = { binding: EditorProject["texturePlan"]["faces"][number]; face: FaceName; old: Rect };
  type Group = { order: string; left: number; top: number; width: number; height: number; faces: Face[]; destination?: [number, number] };
  const groups = new Map<string, Group>();
  for (const binding of project.texturePlan.faces) {
    if (!ids.has(binding.cubeId)) continue;
    for (const [name, rect] of Object.entries(binding.uv)) {
      const left = Math.min(rect[0], rect[2]), top = Math.min(rect[1], rect[3]);
      const w = Math.abs(rect[2] - rect[0]), h = Math.abs(rect[3] - rect[1]);
      const key = command.shared === "split" ? binding.cubeId + ":" + name : [left, top, w, h].join(",");
      const order = binding.cubeId + ":" + name;
      const face = { binding, face: name as FaceName, old: [...rect] as Rect };
      const group = groups.get(key);
      if (group) { group.faces.push(face); if (order < group.order) group.order = order; }
      else groups.set(key, { order, left, top, width: w, height: h, faces: [face] });
    }
  }
  const ordered = [...groups.values()].sort((a, b) => b.height - a.height || b.width - a.width || (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
  const stride = width + 1, prefix = new Uint32Array(stride * (height + 1));
  let prefixCells = 0, placementChecks = 0;
  const exhausted = () => { throw new EditorError("UV_PACK_BUDGET", "Перепаковка достигла предела вычислений. Выберите меньше поверхностей."); };
  for (const group of ordered) {
    prefixCells += width * height;
    if (prefixCells > UV_PACK_LIMITS.prefixCells) exhausted();
    prefix.fill(0);
    for (let y = 0; y < height; y++) {
      let row = 0;
      for (let x = 0; x < width; x++) {
        row += occupied[y * width + x]!;
        prefix[(y + 1) * stride + x + 1] = prefix[y * stride + x + 1]! + row;
      }
    }
    placement: for (let y = 0; y + group.height <= height; y++) for (let x = 0; x + group.width <= width; x++) {
      if (++placementChecks > UV_PACK_LIMITS.placementChecks) exhausted();
      const left = Math.max(0, x - 1), top = Math.max(0, y - 1);
      const right = Math.min(width, x + group.width + 1), bottom = Math.min(height, y + group.height + 1);
      const used = prefix[bottom * stride + right]! - prefix[top * stride + right]!
        - prefix[bottom * stride + left]! + prefix[top * stride + left]!;
      if (used) continue;
      group.destination = [x, y];
      for (let v = y; v < y + group.height; v++) for (let u = x; u < x + group.width; u++) occupied[v * width + u] = 1;
      break placement;
    }
    if (!group.destination) throw new EditorError("UV_PACK_FULL", "Не хватает свободного места с отступом 1 пиксель. Разделите выделение; рисунок сохранён.");
  }
  const placements = ordered.flatMap(group => group.faces.map(face => {
    const [x, y] = group.destination!, [u0, v0, u1, v1] = face.old;
    const rect: Rect = [u0 > u1 ? x + group.width : x, v0 > v1 ? y + group.height : y,
      u0 > u1 ? x : x + group.width, v0 > v1 ? y : y + group.height];
    return { ...face, rect };
  }));
  if (placements.every(face => face.rect.every((v, i) => v === face.old[i])))
    throw new EditorError("NO_CHANGE", "UV уже размещены в этих позициях.");
  const result = [...source];
  for (let i = 0; i < result.length; i++) if (selected[i] && !other[i]) result[i] = null;
  for (const group of ordered) {
    const [x, y] = group.destination!;
    for (let v = 0; v < group.height; v++) for (let u = 0; u < group.width; u++)
      result[(y + v) * width + x + u] = source[(group.top + v) * width + group.left + u]!;
  }
  // Публикуем план только после размещения всех групп. EditorSession дополнительно обеспечивает rollback/history.
  for (const face of placements) face.binding.uv[face.face] = face.rect;
  writePixels(project, result);
}
