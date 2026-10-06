import { useMemo, useState } from "react";
import { inspectTexelDensity, TexelDensityProfileSchema, type EditorProject } from "@mcdev/editor-core";

const names = { north: "−Z", south: "+Z", east: "+X", west: "−X", up: "+Y", down: "−Y" };
export function TexelDensityInspector({ project, cubeIds }: { project: EditorProject; cubeIds: string[] }) {
  const [opened, setOpened] = useState(false), [density, setDensity] = useState("16"), [tolerance, setTolerance] = useState("10");
  const selectionKey = JSON.stringify(cubeIds);
  const report = useMemo(() => {
    if (!opened || !density.trim() || !tolerance.trim()) return undefined;
    const profile = TexelDensityProfileSchema.safeParse({ pixelsPerBlock: Number(density), tolerancePercent: Number(tolerance) });
    return profile.success ? inspectTexelDensity(project, profile.data, cubeIds.length ? cubeIds : undefined) : undefined;
  }, [opened, density, tolerance, project, selectionKey]);
  const worst = report ? [...report.faces].sort((a, b) => {
    const deviation = (face: typeof a) => Math.max(...face.axes.map(axis => axis.pixelsPerBlock === null ? Infinity : Math.abs(axis.pixelsPerBlock / report.profile.pixelsPerBlock - 1)));
    return deviation(b) - deviation(a);
  }).slice(0, cubeIds.length === 1 ? 6 : 4) : [];
  return <details className="texel-density" onToggle={event => setOpened(event.currentTarget.open)}>
    <summary>Масштаб пикселей</summary>
    {opened && <>
      <p className="hint">Укажите профиль из задания. 16 единиц модели = 1 блок. Измерение учитывает реальные размеры граней; художественное качество оценивается по виду модели.</p>
      <div className="density-controls">
        <label>Пикс./блок<input aria-label="Плотность пикселей на блок" type="number" min="1" max="256" step="1" value={density} onChange={event => setDensity(event.target.value)} /></label>
        <label>Допуск, %<input aria-label="Допуск плотности пикселей" type="number" min="0" max="100" step="1" value={tolerance} onChange={event => setTolerance(event.target.value)} /></label>
      </div>
      {!report ? <p className="hint" role="status">Введите целые значения: 1–256 пикс./блок и допуск 0–100%.</p> : <>
        <p className="density-summary" data-testid="density-summary" role="status">{cubeIds.length ? "Выделение" : "Модель целиком"} · кубов: {report.selectedCubes} · граней: {report.summary.faces}. За пределами профиля: {report.summary.axesOutsideTolerance} из {report.summary.axes} направлений.</p>
        {!!report.summary.axesWithoutIntegerCoverage && <p className="density-warning">Для {report.summary.axesWithoutIntegerCoverage} направлений положительный целый UV не укладывается в допуск. Перепаковка сохраняет масштаб и не исправляет это отклонение.</p>}
        {!!report.summary.axesWithoutAtlasCapacity && <p className="density-warning">Для {report.summary.axesWithoutAtlasCapacity} направлений нужное число пикселей превышает размер текущего атласа.</p>}
        {!!report.summary.unmeasurableAxes && <p className="density-warning">Есть грани слишком малого размера для численного измерения.</p>}
        {worst.length > 0 && <div className="density-faces">
          <span className="hint">{cubeIds.length === 1 ? "Все грани куба" : "Грани с наибольшим отклонением"} · пикс./блок</span>
          {worst.map(face => <div key={face.cubeId + face.face} data-testid="density-face" className={face.axes.every(axis => axis.withinTolerance) ? "density-match" : "density-warning"}>
            <span>{face.cubeId} · {names[face.face]}</span><span>{face.axes.map(axis => axis.pixelsPerBlock === null ? "не измеряется" : axis.pixelsPerBlock.toFixed(1)).join(" × ")}</span>
          </div>)}
        </div>}
      </>}
    </>}
  </details>;
}
