import { cubes, bounds, FACE_NAMES } from "@mcdev/editor-core";

// Авторский замысел текущей сессии Codex: широкие плечи, поднятая гарда,
// короткий ступенчатый кончик и один крупный знак вместо мелких рун.
export function qualityStudyCommands(project) {
  const all = cubes(project),
    commands = [];
  const reshape = (id, origin, size) => {
    const cube = all.find((c) => c.id === id);
    if (!cube) throw new Error(`Нет детали ${id}`);
    commands.push({
      type: "transform",
      cubeIds: [id],
      translation: origin.map((v, a) => v - cube.origin[a]),
      scale: size.map((v, a) => v / cube.size[a]),
    });
  };
  reshape("blade_ricasso", [5.75, 9.4, 7.5], [4.5, 1.8, 1]);
  reshape("blade_fuller", [6.35, 11.2, 7.55], [3.3, 9.8, 0.9]);
  reshape("blade_edge_left", [5.75, 11.2, 7.64], [0.6, 9.8, 0.72]);
  reshape("blade_edge_right", [9.65, 11.2, 7.64], [0.6, 9.8, 0.72]);
  const taper = [
    4.5, 4.25, 4, 3.75, 3.25, 2.75, 2.25, 1.875, 1.5, 1.125, 0.85, 0.5, 0.25,
  ];
  for (const cube of all.filter((c) => c.id.startsWith("tip_"))) {
    const index = Number(cube.id.match(/\d+$/)[0]),
      width = taper[index],
      y = 21 + index * 0.5;
    if (cube.id.startsWith("tip_core_"))
      reshape(
        cube.id,
        [8 - (width - 0.8) / 2, y, 7.55],
        [width - 0.8, 0.5, 0.9],
      );
    else if (cube.id.startsWith("tip_left_"))
      reshape(cube.id, [8 - width / 2, y, 7.64], [0.4, 0.5, 0.72]);
    else if (cube.id.startsWith("tip_right_"))
      reshape(cube.id, [8 + width / 2 - 0.4, y, 7.64], [0.4, 0.5, 0.72]);
    else reshape(cube.id, [8 - width / 2, y, 7.64], [width, 0.5, 0.72]);
  }
  reshape("guard_center", [5.9, 8.55, 7.1], [4.2, 1.1, 1.8]);
  reshape("guard_left", [3.15, 8.45, 7.25], [3.9, 0.9, 1.5]);
  reshape("guard_right", [8.95, 8.45, 7.25], [3.9, 0.9, 1.5]);
  reshape("guard_tip_left", [2.85, 9.8, 7.25], [0.85, 1.2, 1.5]);
  reshape("guard_tip_right", [12.3, 9.8, 7.25], [0.85, 1.2, 1.5]);
  for (const [id, angle] of [
    ["guard_left", -22.5],
    ["guard_right", 22.5],
    ["guard_tip_left", 0],
    ["guard_tip_right", 0],
  ])
    commands.push({ type: "rotate", cubeIds: [id], axis: "z", angle });

  // Прямоугольники ищутся по фактическим UV с отступом; UV-команда переносит рисунок.
  const occupied = project.texturePlan.faces.flatMap((f) =>
    FACE_NAMES.map((face) => f.uv[face]),
  );
  const allocate = (w, h) => {
    for (let y = 1; y + h < project.model.texture.height; y++)
      for (let x = 1; x + w < project.model.texture.width; x++) {
        const rect = [x, y, x + w, y + h];
        if (
          occupied.every(
            ([u, v, U, V]) =>
              rect[2] <= Math.min(u, U) - 1 ||
              rect[0] >= Math.max(u, U) + 1 ||
              rect[3] <= Math.min(v, V) - 1 ||
              rect[1] >= Math.max(v, V) + 1,
          )
        ) {
          occupied.push(rect);
          return rect;
        }
      }
    throw new Error("Нет свободного места для рисунка клинка");
  };
  for (const face of ["north", "south"]) {
    const rect = allocate(12, 40);
    commands.push({ type: "uv", cubeId: "blade_fuller", face, rect });
    commands.push(...paintBlade(rect, face, false));
  }
  return commands;
}

function paintBlade(rect, face, repair) {
  const groups = new Map();
  for (let y = 0; y < 40; y++)
    for (let x = 0; x < 12; x++) {
      let color =
        x === 0 || x === 11
          ? "#aac6c6"
          : x <= 2 || x >= 9
            ? "#5b8790"
            : x === 5 || x === 6
              ? "#162f3c"
              : "#294955";
      const diamond = Math.abs(x - 5.5) + Math.abs(y - 27.5);
      if (diamond <= (repair ? 5 : 4))
        color = x + y <= 33 ? "#92e1d3" : "#53b9ba";
      if ((x === 5 || x === 6) && y >= 32 && y <= (repair ? 36 : 34))
        color = "#53b9ba";
      if (!groups.has(color)) groups.set(color, []);
      groups.get(color).push([rect[0] + x, rect[1] + y]);
    }
  return Array.from(groups, ([color, points]) => ({
    type: "paint",
    cubeIds: ["blade_fuller"],
    face,
    color,
    size: 1,
    points,
  }));
}

// Правки после просмотра первого обзора: мелкий знак и тонкий боковой профиль.
export function qualityRepairCommands(project) {
  const blade = cubes(project).filter((c) => /^(blade|tip)/u.test(c.id));
  const depth = bounds(blade).size[2];
  const commands = [
    {
      type: "transform",
      cubeIds: blade.map((c) => c.id),
      scale: [1, 1, 1.22],
      translation: [0, 0, (-depth * 0.22) / 2],
    },
  ];
  const uv = project.texturePlan.faces.find(
    (f) => f.cubeId === "blade_fuller",
  ).uv;
  const palette = new Map(
    project.texturePlan.palette.map((p) => [p.symbol, p.color.toLowerCase()]),
  );
  for (const face of ["north", "south"]) {
    if (
      Math.abs(uv[face][2] - uv[face][0]) !== 12 ||
      Math.abs(uv[face][3] - uv[face][1]) !== 40
    )
      throw new Error("Правка предназначена для нового рисунка клинка 12×40");
    for (const paint of paintBlade(uv[face], face, true)) {
      paint.points = paint.points.filter(
        ([x, y]) => palette.get(project.texturePlan.rows[y][x]) !== paint.color,
      );
      if (paint.points.length) commands.push(paint);
    }
  }
  return commands;
}
