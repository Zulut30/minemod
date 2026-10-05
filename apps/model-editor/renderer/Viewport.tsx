import { useEffect, useMemo, useRef, Component } from "react";
import type { ReactNode } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import * as THREE from "three";
import {
  cubes,
  FACE_NAMES,
  type Cube,
  type EditorProject,
} from "@mcdev/editor-core";
import { useStudio } from "./store.ts";
import type { View } from "../shared/bridge.ts";
import { frameCubes, cameraSettings, viewUp, type CameraFrame } from "./camera.ts";
export { comparisonFrame } from "./camera.ts";

export type NativePreviews = Record<32 | 64, string>;

export interface ReviewRender {
  framing: CameraFrame;
  silhouette: boolean;
  view?: View;
  onThumbnail?: (png: string) => void;
  onNativePreviews?: (previews: NativePreviews) => void;
}
const quads = {
  north: [3, 2, 1, 0],
  south: [6, 7, 4, 5],
  east: [2, 6, 5, 1],
  west: [7, 3, 0, 4],
  up: [7, 6, 2, 3],
  down: [0, 1, 5, 4],
};
function geometry(cube: Cube, project: EditorProject): THREE.BufferGeometry {
  const [x, y, z] = cube.origin.map((v) => v - cube.inflate),
    [X, Y, Z] = cube.origin.map((v, a) => v + cube.size[a]! + cube.inflate);
  const vertices = [
    [x, y, z],
    [X, y, z],
    [X, Y, z],
    [x, Y, z],
    [x, y, Z],
    [X, y, Z],
    [X, Y, Z],
    [x, Y, Z],
  ];
  const positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  const binding = project.texturePlan.faces.find((f) => f.cubeId === cube.id)!;
  for (const [index, face] of FACE_NAMES.entries()) {
    for (const vertex of quads[face])
      positions.push(...vertices[vertex]!.map((v, a) => v! - cube.pivot[a]!));
    const [u, v, U, V] = binding.uv[face],
      w = project.model.texture.width,
      h = project.model.texture.height;
    uv.push(
      u / w,
      1 - v / h,
      U / w,
      1 - v / h,
      U / w,
      1 - V / h,
      u / w,
      1 - V / h,
    );
    indices.push(
      index * 4,
      index * 4 + 1,
      index * 4 + 2,
      index * 4,
      index * 4 + 2,
      index * 4 + 3,
    );
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}
export function drawAtlas(
  canvas: HTMLCanvasElement,
  project: EditorProject,
): void {
  const { width, height } = project.model.texture;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const data = ctx.createImageData(width, height);
  const palette = new Map(
    project.texturePlan.palette.map((c) => [
      c.symbol,
      [1, 3, 5].map((a) => Number.parseInt(c.color.slice(a, a + 2), 16)),
    ]),
  );
  project.texturePlan.rows.forEach((row, y) =>
    [...row].forEach((symbol, x) => {
      const rgb = palette.get(symbol);
      if (rgb) data.data.set([...rgb, 255], (y * width + x) * 4);
    }),
  );
  ctx.putImageData(data, 0, 0);
}
function ItemCube({
  cube,
  project,
  texture,
  review,
}: {
  cube: Cube;
  project: EditorProject;
  texture: THREE.Texture;
  review?: ReviewRender;
}) {
  const selected = useStudio((s) => s.selection.includes(cube.id)),
    wire = useStudio((s) => s.wire);
  const g = useMemo(() => geometry(cube, project), [cube, project]);
  const edges = useMemo(() => new THREE.EdgesGeometry(g), [g]);
  useEffect(
    () => () => {
      g.dispose();
      edges.dispose();
    },
    [g, edges],
  );
  return (
    <group
      position={cube.pivot}
      rotation={
        cube.rotation.map((v) => (v * Math.PI) / 180) as [
          number,
          number,
          number,
        ]
      }
    >
      <mesh
        geometry={g}
        onClick={(event) => {
          event.stopPropagation();
          if (!review) useStudio.getState().select([cube.id], event.ctrlKey || event.metaKey || event.shiftKey);
        }}
      >
        {review?.silhouette ? (
          <meshBasicMaterial map={texture} color="#000000" alphaTest={0.5} />
        ) : (
          <meshLambertMaterial map={texture} alphaTest={0.5} />
        )}
      </mesh>
      {!review && (selected || wire) && (
        <lineSegments geometry={edges} raycast={() => {}}>
          <lineBasicMaterial
            color={selected ? "#e98770" : "#527c82"}
            transparent
            opacity={selected ? 0.95 : 0.35}
          />
        </lineSegments>
      )}
    </group>
  );
}
function Camera({
  project,
  review,
  captureId,
}: {
  project: EditorProject;
  review?: ReviewRender;
  captureId?: string;
}) {
  const { camera, gl, invalidate, size } = useThree(),
    sharedView = useStudio((s) => s.view),
    frame = useStudio((s) => s.frame);
  const view = review?.view ?? sharedView;
  const hasGeometry = cubes(project).length > 0;
  const controls = useRef<OrbitControls | null>(null);
  const selection = useStudio((s) => s.selection);
  const paintFocus = useStudio((s) => s.mode === "texture" && s.paintFocus);
  const focus = !review && paintFocus;
  const chosen = focus
    ? cubes(project).filter((c) => selection.includes(c.id))
    : [];
  const selectionKey = focus ? JSON.stringify(selection) : "";
  const framing = review?.framing ?? frameCubes(chosen.length ? chosen : cubes(project));
  const settings = cameraSettings(framing, view, size.width, size.height);
  const recordCamera = (orbit: OrbitControls | null) => {
    const ortho = camera as THREE.OrthographicCamera;
    gl.domElement.dataset.camera = JSON.stringify({ view, position: camera.position.toArray(),
      up: camera.up.toArray(), quaternion: camera.quaternion.toArray(), zoom: ortho.zoom,
      target: orbit?.target.toArray() ?? framing.center, near: ortho.near, far: ortho.far });
  };
  useEffect(() => {
    // OrbitControls сохраняет camera.up в конструкторе: новый ракурс создаёт новый control.
    camera.up.set(...viewUp(view));
    const orbit = new OrbitControls(camera, gl.domElement);
    controls.current = orbit;
    orbit.enableDamping = false;
    orbit.enabled = !review;
    orbit.minZoom = 0.001;
    orbit.maxZoom = 512;
    orbit.addEventListener("change", () => { recordCamera(orbit); invalidate(); });
    return () => {
      orbit.dispose();
      controls.current = null;
    };
  }, [camera, gl, invalidate, !!review, view]);
  useEffect(() => {
    camera.position.set(...settings.position);
    camera.up.set(...settings.up);
    const ortho = camera as THREE.OrthographicCamera;
    ortho.zoom = settings.zoom;
    ortho.near = settings.near;
    ortho.far = settings.far;
    controls.current?.target.set(...framing.center);
    camera.lookAt(...framing.center);
    camera.updateProjectionMatrix();
    controls.current?.update();
    recordCamera(controls.current);
    invalidate();
    // Перестройка геометрии не сбрасывает ручной orbit; смена проекта и ракурса сбрасывает.
  }, [
    camera,
    invalidate,
    view,
    frame,
    project.projectId,
    hasGeometry,
    focus,
    selectionKey,
    size.width,
    size.height,
    review?.framing,
    // Новый job может прийти после обновления shared frame; кадрируем его фактический snapshot.
    captureId,
  ]);
  return null;
}
function CaptureSignal({ id }: { id: string }) {
  const { invalidate } = useThree();
  const counter = useRef(0);
  useEffect(() => {
    counter.current = 0;
    invalidate();
  }, [id, invalidate]);
  useFrame(() => {
    counter.current++;
    if (counter.current === 1) invalidate();
    if (counter.current === 2)
      setTimeout(() => window.studio.captureReady(id), 0);
  });
  return null;
}
function Scene({
  project,
  captureId,
  review,
}: {
  project: EditorProject;
  captureId?: string;
  review?: ReviewRender;
}) {
  const hidden = useStudio((s) => s.hidden),
    grid = useStudio((s) => s.grid);
  const draft = useStudio((s) => s.draft);
  const painted =
    !captureId && !review && draft?.projectId === project.projectId
      ? draft.project
      : project;
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    drawAtlas(canvas, painted);
    const t = new THREE.CanvasTexture(canvas);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [painted]);
  useEffect(() => () => texture.dispose(), [texture]);
  const invisible = new Set(
    project.parts
      .filter((p) => !review && hidden.includes(p.id))
      .flatMap((p) => p.cubeIds),
  );
  return (
    <>
      <Camera project={project} {...(review ? { review } : {})} {...(captureId ? { captureId } : {})} />
      {(review?.onThumbnail || review?.onNativePreviews) && review && (
        <ReviewThumbnail project={project} review={review} />
      )}
      {captureId && <CaptureSignal id={captureId} />}
      <ambientLight intensity={1.15} />
      <directionalLight position={[25, 35, 45]} intensity={1.1} />
      {grid && !review && (
        <gridHelper
          args={[48, 24, "#42576c", "#293747"]}
          position={[8, 0, 8]}
        />
      )}
      {cubes(project)
        .filter((c) => !invisible.has(c.id))
        .map((c) => (
          <ItemCube
            key={c.id}
            cube={c}
            project={project}
            texture={texture}
            {...(review ? { review } : {})}
          />
        ))}
    </>
  );
}
function ReviewThumbnail({
  project,
  review,
}: {
  project: EditorProject;
  review: ReviewRender;
}) {
  const { gl, scene, camera, invalidate, size } = useThree();
  const sharedView = useStudio((s) => s.view);
  const view = review.view ?? sharedView;
  const counter = useRef(0);
  const generation = useRef(0);
  useEffect(() => {
    counter.current = 0;
    generation.current++;
    invalidate();
    return () => {
      generation.current++;
    };
  }, [
    project,
    review.framing,
    review.silhouette,
    view,
    size.width,
    size.height,
    invalidate,
  ]);
  useFrame(() => {
    counter.current++;
    if (counter.current < 3) invalidate();
    if (counter.current === 3) {
      const current = generation.current;
      queueMicrotask(() => {
        if (generation.current !== current) return;
        const previousTarget = gl.getRenderTarget();
        const previousViewport = gl.getViewport(new THREE.Vector4());
        const previousScissor = gl.getScissor(new THREE.Vector4());
        const previousScissorTest = gl.getScissorTest();
        const renderNative = (resolution: 32 | 64) => {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = resolution;
          const ctx = canvas.getContext("2d")!;
          // Квадратная проекция с общим framing; каждый размер рендерится отдельно.
          const thumbnailCamera = (camera as THREE.OrthographicCamera).clone();
          thumbnailCamera.left = thumbnailCamera.bottom = -resolution / 2;
          thumbnailCamera.right = thumbnailCamera.top = resolution / 2;
          thumbnailCamera.zoom = cameraSettings(
            review.framing, view, resolution, resolution,
          ).zoom;
          thumbnailCamera.updateProjectionMatrix();
          const target = new THREE.WebGLRenderTarget(resolution, resolution);
          target.texture.colorSpace = THREE.SRGBColorSpace;
          try {
            gl.setRenderTarget(target);
            gl.setScissorTest(false);
            gl.render(scene, thumbnailCamera);
            const pixels = new Uint8Array(resolution * resolution * 4);
            gl.readRenderTargetPixels(target, 0, 0, resolution, resolution, pixels);
            const data = ctx.createImageData(resolution, resolution);
            const stride = resolution * 4;
            // WebGL начинает строки снизу; PNG — сверху. Масштабирования нет.
            for (let y = 0; y < resolution; y++)
              data.data.set(
                pixels.subarray((resolution - 1 - y) * stride, (resolution - y) * stride),
                y * stride,
              );
            ctx.putImageData(data, 0, 0);
            return canvas.toDataURL();
          } finally {
            gl.setRenderTarget(previousTarget);
            gl.setViewport(previousViewport);
            gl.setScissor(previousScissor);
            gl.setScissorTest(previousScissorTest);
            target.dispose();
          }
        };
        const large = renderNative(64);
        if (review.onNativePreviews)
          review.onNativePreviews({ 32: renderNative(32), 64: large });
        review.onThumbnail?.(large);
      });
    }
  });
  return null;
}
class CanvasBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="gpu-error">
        3D недоступно. Проверьте поддержку WebGL; проект можно сохранить через
        верхнюю панель.
      </div>
    ) : (
      this.props.children
    );
  }
}
export function Viewport({
  project,
  captureId,
  review,
}: {
  project: EditorProject;
  captureId?: string;
  review?: ReviewRender;
}) {
  return (
    <CanvasBoundary>
      <Canvas
        orthographic
        frameloop="demand"
        dpr={[1, 1.5]}
        camera={{ position: [40, 20, 60], zoom: 22, near: 0.1, far: 500 }}
        gl={{
          antialias: true,
          preserveDrawingBuffer: true,
          toneMapping: THREE.NoToneMapping,
        }}
        onCreated={({ gl }) => {
          gl.domElement.dataset.ready = "true";
        }}
        onPointerMissed={() => {
          if (!review) useStudio.getState().select([]);
        }}
      >
        <Scene
          project={project}
          {...(captureId ? { captureId } : {})}
          {...(review ? { review } : {})}
        />
      </Canvas>
    </CanvasBoundary>
  );
}
