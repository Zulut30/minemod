import * as THREE from "three";
import { cubes, type Cube, type EditorProject } from "@mcdev/editor-core";
import type { View } from "../shared/bridge.ts";

export interface CameraFrame {
  center: [number, number, number];
  extent: number;
  diameter: number;
}
export function frameCubes(items: readonly Cube[]): CameraFrame {
  const box = new THREE.Box3();
  for (const cube of items) {
    const pivot = new THREE.Vector3(...cube.pivot);
    const rotation = new THREE.Euler(...cube.rotation.map((v) => v * Math.PI / 180) as [number, number, number]);
    for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) {
      const point = new THREE.Vector3(...cube.origin.map((v, a) => v +
        ([x, y, z][a] ? cube.size[a]! + cube.inflate : -cube.inflate)) as [number, number, number]);
      box.expandByPoint(point.sub(pivot).applyEuler(rotation).add(pivot));
    }
  }
  if (box.isEmpty()) return { center: [8, 8, 8], extent: 16, diameter: 16 * Math.sqrt(3) };
  const size = box.getSize(new THREE.Vector3());
  return { center: box.getCenter(new THREE.Vector3()).toArray() as [number, number, number],
    extent: Math.max(4, size.x, size.y, size.z), diameter: Math.max(4, size.length()) };
}
/** Один sphere bound даёт одинаковый масштаб всем ракурсам и обоим вариантам. */
export function comparisonFrame(projects: readonly EditorProject[]): CameraFrame {
  return frameCubes(projects.flatMap((project) => cubes(project)));
}
const direction: Record<View, [number, number, number]> = {
  perspective: [1, 0.25, 1], front: [0, 0, 1], back: [0, 0, -1],
  side: [1, 0, 0], right: [1, 0, 0], left: [-1, 0, 0],
  top: [0, 1, 0], bottom: [0, -1, 0], "rear-perspective": [-1, 0.25, -1],
};
export function viewUp(view: View): [number, number, number] {
  return view === "top" ? [0, 0, -1] : view === "bottom" ? [0, 0, 1] : [0, 1, 0];
}
export function cameraSettings(frame: CameraFrame, view: View, width: number, height: number) {
  const distance = Math.max(60, frame.diameter * 2);
  const position = new THREE.Vector3(...direction[view]).normalize().multiplyScalar(distance)
    .add(new THREE.Vector3(...frame.center)).toArray() as [number, number, number];
  return { position, up: viewUp(view), near: 0.1, far: Math.max(500, distance * 4),
    zoom: Math.min(Math.max(1, width), Math.max(1, height)) / (frame.diameter * 1.12) };
}
