// Три самостоятельных авторских силуэта. Результат — данные, без кода в MCP.
const FACE_NAMES = ["north", "south", "east", "west", "up", "down"];
const DENSITY = 2;
const ATLAS = 128;

const colors = {
  ink: "#162137",
  dark: "#26364c",
  darkLight: "#49617a",
  steelShadow: "#597e9b",
  steel: "#93b7cf",
  steelLight: "#c4dfe7",
  edge: "#edf8ed",
  bronzeShadow: "#704337",
  bronze: "#b96e49",
  bronzeLight: "#edac70",
  bronzeEdge: "#ffdb9a",
  crystalShadow: "#146473",
  crystal: "#23bbb8",
  crystalLight: "#7aeee0",
  crystalEdge: "#d3fff0",
  leatherShadow: "#182438",
  leather: "#2d3e54",
  leatherLight: "#526780",
};

function author(key, name, ember = false) {
  const cubes = [],
    materials = new Map(),
    regions = new Map();
  const paletteColors = { ...colors };
  if (ember)
    Object.assign(paletteColors, {
      crystalShadow: "#8c4033",
      crystal: "#dc7443",
      crystalLight: "#ffc279",
      crystalEdge: "#ffedb2",
      leatherShadow: "#3a242d",
      leather: "#773b3c",
      leatherLight: "#b6604c",
    });
  const cube = (id, origin, size, material, rotation = 0) => {
    cubes.push({
      id,
      origin,
      size,
      pivot: origin.map((v, i) => v + size[i] / 2),
      rotation: [0, 0, rotation],
      uv: [0, 0],
      inflate: 0,
      mirror: false,
    });
    materials.set(id, material);
  };
  // Профили состоят из крупных ступеней; стыки имеют одинаковую плотность пикселей.
  const profile = (id, sections, depth, material, z = 8) => {
    const region = {
      minY: Math.min(...sections.map(([y]) => y)),
      maxY: Math.max(...sections.map(([y, h]) => y + h)),
    };
    sections.forEach(([y, h, left, width], index) => {
      cube(
        `${id}_${index}`,
        [left, y, z - depth / 2],
        [width, h, depth],
        material,
      );
      regions.set(`${id}_${index}`, region);
    });
  };
  const socket = (id, y, size, z, back = false) => {
    const frame = [
      [y, 0.5, 8 - size / 2 + 0.5, size - 1],
      [y + 0.5, size - 1, 8 - size / 2, size],
      [y + size - 0.5, 0.5, 8 - size / 2 + 0.5, size - 1],
    ];
    profile(`${id}_frame`, frame, 0.4, "dark", z);
    const inset = [
      [y + 0.4, 0.4, 8 - size / 2 + 0.8, size - 1.6],
      [y + 0.8, size - 1.6, 8 - size / 2 + 0.4, size - 0.8],
      [y + size - 0.8, 0.4, 8 - size / 2 + 0.8, size - 1.6],
    ];
    profile(`${id}_inset`, inset, 0.24, "crystal", z + (back ? -0.28 : 0.28));
  };
  const hilt = (heavy = false) => {
    cube("grip_core", [7.1, 3.5, 7.1], [1.8, 5.3, 1.8], "leather");
    for (let i = 0; i < 4; i++)
      cube(
        `grip_wrap_${i}`,
        [6.98, 4 + i * 1.05, 6.98],
        [2.04, 0.38, 2.04],
        "wrap",
      );
    cube("grip_upper_collar", [6.8, 8.15, 6.8], [2.4, 0.65, 2.4], "bronze");
    cube("grip_lower_collar", [6.8, 3.35, 6.8], [2.4, 0.65, 2.4], "bronze");
    cube(
      "pommel_core",
      [6.65, 1.35, 6.65],
      [2.7, 2.3, 2.7],
      "dark",
      heavy ? 0 : 45,
    );
    for (const back of [false, true]) {
      const z = back ? 6.48 : 9.52;
      cube(
        `pommel_frame_${back ? "back" : "front"}`,
        [7.03, 1.55, z - 0.18],
        [1.94, 1.94, 0.36],
        "bronze",
        45,
      );
      cube(
        `pommel_gem_${back ? "back" : "front"}`,
        [7.42, 1.94, z + (back ? -0.35 : 0.15)],
        [1.16, 1.16, 0.2],
        "crystal",
        45,
      );
    }
  };
  const finish = () => {
    const pixels = Array.from({ length: ATLAS }, () => Array(ATLAS).fill("."));
    const palette = Object.entries(paletteColors).map(
      ([key, color], index) => ({ key, color, symbol: index.toString(32) }),
    );
    const symbol = Object.fromEntries(palette.map((p) => [p.key, p.symbol]));
    let u = 1,
      v = 1,
      rowHeight = 0;
    const colorAt = (c, material, face, x, y, w, h) => {
      const front = face === "north" || face === "south";
      // Координаты рисунка относятся к поверхности модели, а не к номеру ступени.
      const wx =
        c.origin[0] +
        (face === "north" ? 1 - (x + 0.5) / w : (x + 0.5) / w) * c.size[0];
      const wy = c.origin[1] + (1 - (y + 0.5) / h) * c.size[1];
      const px = Math.floor(wx * DENSITY),
        py = Math.floor(wy * DENSITY);
      const region = regions.get(c.id);
      if (material === "crystal") {
        if (!front) return "crystalShadow";
        if (region ? wy > region.maxY - 0.35 : y === 0) return "crystalEdge";
        if (wx < 8 && wy > (region?.minY ?? c.origin[1]) + 0.55)
          return "crystalLight";
        return wx > 8.45 ? "crystalShadow" : "crystal";
      }
      if (material === "leather" || material === "wrap") {
        if (!front) return "leatherShadow";
        if (material === "wrap")
          return y === 0 ? "leatherLight" : "leatherShadow";
        return x === 0
          ? "leatherLight"
          : x === w - 1
            ? "leatherShadow"
            : "leather";
      }
      if (material === "bronze") {
        if (face === "down" || face === "west") return "bronzeShadow";
        if (face === "up" || y === 0) return "bronzeEdge";
        if (x === 0) return "bronzeLight";
        if (y === h - 1 || x === w - 1) return "bronzeShadow";
        return "bronze";
      }
      if (material === "dark") {
        if (!front) return face === "up" ? "darkLight" : "ink";
        if (region) {
          if (wy < region.minY + 0.3) return "ink";
          if (wx < c.origin[0] + 0.5) return "darkLight";
          if (wx > c.origin[0] + c.size[0] - 0.5) return "ink";
          if ((py === 35 && px >= 12 && px <= 13) || (py === 36 && px === 12))
            return "darkLight";
          return "dark";
        }
        if (x === 0 || y === 0) return "darkLight";
        if (x === w - 1 || y === h - 1) return "ink";
        // Два-три отдельных скола вместо случайного шума по всей поверхности.
        if (py === 34 && px % 9 === 3) return "darkLight";
        return "dark";
      }
      if (material === "ember") {
        if (!front) return face === "up" ? "crystalLight" : "crystalShadow";
        if (x >= w - 2) return "crystalEdge";
        if (x === 0) return "crystalShadow";
        return x + (y % 3) > w / 2 ? "crystalLight" : "crystal";
      }
      if (!front) return face === "up" ? "steelLight" : "steelShadow";
      if (material === "blade") {
        // Один широкий скос и светлый край, без симметричных тонких полос.
        if (wx < c.origin[0] + 0.55) return "edge";
        if (wx < c.origin[0] + 1.4) return "steelLight";
        if (wx >= c.origin[0] + c.size[0] - 0.55) return "steelShadow";
        if ((py === 32 && px >= 12 && px <= 14) || (py === 42 && px === 13))
          return "steelLight";
        return wx < 6.5 ? "steelLight" : "steel";
      }
      if (x === 0 || y === 0) return "edge";
      return x === w - 1 ? "steelShadow" : "steelLight";
    };
    const dimensionsFor = (c, face) => {
      const [W, H, D] = c.size;
      const dimensions =
        face === "north" || face === "south"
          ? [W, H]
          : face === "east" || face === "west"
            ? [D, H]
            : [W, D];
      return dimensions.map((value) =>
        Math.max(1, Math.round(value * DENSITY)),
      );
    };
    // Высокие грани идут первыми: узкий обух не расходует высоту следующих рядов.
    const slots = new Map();
    const surfaces = cubes
      .flatMap((c) =>
        FACE_NAMES.map((face) => {
          const [w, h] = dimensionsFor(c, face);
          return { c, face, w, h };
        }),
      )
      .sort((a, b) => b.h - a.h || b.w - a.w);
    for (const { c, face, w, h } of surfaces) {
      if (u + w + 1 >= ATLAS) {
        u = 1;
        v += rowHeight + 2;
        rowHeight = 0;
      }
      if (v + h + 1 >= ATLAS) throw new Error(`Нет места в атласе ${key}`);
      for (let y = -1; y <= h; y++)
        for (let x = -1; x <= w; x++)
          pixels[v + y][u + x] =
            symbol[
              colorAt(
                c,
                materials.get(c.id),
                face,
                Math.max(0, Math.min(w - 1, x)),
                Math.max(0, Math.min(h - 1, y)),
                w,
                h,
              )
            ];
      const rect = [u, v, u + w, v + h];
      u += w + 2;
      rowHeight = Math.max(rowHeight, h);
      slots.set(`${c.id}:${face}`, rect);
    }
    const faces = cubes.map((c) => ({
      cubeId: c.id,
      uv: Object.fromEntries(
        FACE_NAMES.map((face) => [face, slots.get(`${c.id}:${face}`)]),
      ),
    }));
    // У модели может быть больше 64 элементов, но бюджет каждой кости сохранён.
    const bones = [];
    for (let start = 0; start < cubes.length; start += 64)
      bones.push({
        id: `weapon_${bones.length}`,
        parent: null,
        pivot: [8, 9, 8],
        rotation: [0, 0, 0],
        cubes: cubes.slice(start, start + 64),
      });
    const id = `mcdev:${key}`;
    return {
      schemaVersion: 0,
      kind: "minecraft-item-asset",
      model: {
        schemaVersion: 0,
        kind: "cuboid-model",
        id,
        name,
        modelType: "held-item",
        texture: { width: ATLAS, height: ATLAS },
        bones,
      },
      texturePlan: {
        schemaVersion: 0,
        kind: "item-pixel-texture-plan",
        modelId: id,
        palette: palette.map(({ symbol, color }) => ({ symbol, color })),
        rows: pixels.map((row) => row.join("")),
        faces,
      },
    };
  };
  return { cube, profile, socket, hilt, finish };
}

function cleaver() {
  const a = author("arctic_cleaver", "A · Полярный тесак");
  a.hilt(true);
  a.profile(
    "blade_body",
    [
      [10, 2, 5.5, 5],
      [12, 3, 4.5, 6],
      [15, 3, 3.5, 7],
      [18, 3, 3, 7.5],
      [21, 2, 3.5, 7],
      [23, 1, 4.5, 6],
      [24, 1, 5.5, 5],
      [25, 1, 6.5, 4],
      [26, 1, 7.5, 3],
    ],
    1.6,
    "blade",
  );
  a.cube("blade_spine", [9.6, 10, 6.9], [1.8, 16.8, 2.2], "dark");
  for (let i = 0; i < 2; i++)
    a.cube(
      `blade_spine_hook_${i}`,
      [10.5, 13.5 + i * 5.5, 7.1],
      [1.6, 0.9, 1.8],
      "dark",
    );
  a.cube("guard_bar", [3.9, 8.8, 6.7], [7.4, 1.25, 2.6], "bronze");
  a.cube("guard_left_hook", [3.35, 7.8, 6.7], [1.2, 3, 2.6], "bronze");
  a.cube("guard_right_block", [10.6, 8.45, 6.5], [1.3, 2.15, 3], "bronze");
  a.cube("guard_dark_mount", [6.5, 9.65, 6.7], [3.6, 0.75, 2.6], "dark");
  a.socket("gem_front", 10.4, 3, 8.95);
  a.socket("gem_back", 10.4, 3, 7.05, true);
  return a.finish();
}

function sentinel() {
  const a = author("crystal_sentinel", "B · Кристальный страж");
  a.hilt();
  a.profile(
    "blade_body",
    [
      [10, 2, 5.3, 5.4],
      [12, 1, 4.8, 6.4],
      [13, 8, 5.3, 5.4],
      [21, 1, 4.8, 6.4],
      [22, 1, 5.3, 5.4],
      [23, 1, 5.8, 4.4],
      [24, 1, 6.8, 2.4],
      [25, 1, 7.5, 1],
    ],
    1.6,
    "blade",
  );
  a.cube("blade_fuller", [6.75, 11, 7], [2.5, 10.5, 2], "dark");
  a.cube(
    "blade_upper_socket",
    [7.25, 20.55, 7.05],
    [1.5, 1.5, 1.9],
    "dark",
    45,
  );
  for (const back of [false, true]) {
    const z = back ? 6.7 : 8.9;
    a.cube(
      `blade_chevron_left_${back ? "back" : "front"}`,
      [6.1, 12.2, z],
      [2.55, 0.75, 0.4],
      "edge",
      45,
    );
    a.cube(
      `blade_chevron_right_${back ? "back" : "front"}`,
      [7.35, 12.2, z],
      [2.55, 0.75, 0.4],
      "edge",
      -45,
    );
  }
  a.cube("guard_center", [6.1, 8.65, 6.55], [3.8, 1.7, 2.9], "bronze");
  for (const [side, x, angle] of [
    ["left", 3.3, -22.5],
    ["right", 8.9, 22.5],
  ]) {
    a.cube(
      `guard_wing_${side}`,
      [x, 9.1, 6.8],
      [3.8, 1.35, 2.4],
      "bronze",
      angle,
    );
    a.cube(
      `guard_tip_${side}`,
      [side === "left" ? 2.85 : 12.05, 9.8, 6.7],
      [1.1, 1.65, 2.6],
      "bronze",
    );
  }
  a.socket("gem_front", 9.5, 3.15, 9.12);
  a.socket("gem_back", 9.5, 3.15, 6.88, true);
  return a.finish();
}

function ember() {
  const a = author("ember_broadsword", "C · Кованый жар", true);
  a.hilt(true);
  a.profile(
    "blade_body",
    [
      [10, 3, 5.6, 4.8],
      [13, 3, 5.1, 5.3],
      [16, 3, 4.6, 5.8],
      [19, 3, 4.6, 6.3],
      [22, 1, 5.1, 5.8],
      [23, 1, 5.6, 4.8],
      [24, 1, 6.1, 3.8],
      [25, 1, 6.6, 2.8],
      [26, 1, 7.1, 1.8],
    ],
    2,
    "dark",
  );
  a.profile(
    "blade_edge",
    [
      [10, 3, 9.65, 1],
      [13, 3, 9.65, 1.5],
      [16, 3, 9.65, 1.5],
      [19, 3, 10.15, 1.5],
      [22, 1, 9.65, 1.5],
      [23, 1, 9.15, 1.5],
      [24, 1, 8.65, 1.5],
      [25, 1, 8.15, 1.5],
      [26, 1, 7.65, 1.25],
    ],
    2.4,
    "ember",
  );
  for (let i = 0; i < 3; i++) {
    const y = 11.2 + i * 4.1;
    a.cube(`blade_spine_lug_${i}`, [4.3, y, 6.8], [2.1, 1.35, 2.4], "dark");
    for (const back of [false, true])
      a.cube(
        `blade_rivet_${i}_${back ? "back" : "front"}`,
        [5.15, y + 0.4, back ? 6.53 : 9.27],
        [0.6, 0.6, 0.2],
        "bronze",
        45,
      );
  }
  a.cube("guard_center", [6.5, 8.6, 6.35], [3, 1.8, 3.3], "dark");
  a.cube("guard_bar", [3.8, 8.85, 6.7], [8.4, 1.3, 2.6], "dark");
  for (const [side, x] of [
    ["left", 3.8],
    ["right", 10.7],
  ])
    a.cube(`guard_end_${side}`, [x, 8.4, 6.6], [1.5, 2.2, 2.8], "dark");
  for (const back of [false, true])
    a.cube(
      `guard_seal_${back ? "back" : "front"}`,
      [7.2, 9, back ? 6.15 : 9.65],
      [1.6, 1.25, 0.2],
      "bronze",
    );
  return a.finish();
}

export function weaponDirectionAssets() {
  return [cleaver(), sentinel(), ember()];
}
