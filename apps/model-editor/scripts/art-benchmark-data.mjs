import { z } from 'zod';
import { TextEncoder } from 'node:util';

export const BENCHMARK_CLASSES = Object.freeze(['weapon', 'armor', 'building-block', 'decorative-prop', 'creature']);
export const BENCHMARK_VIEWS = Object.freeze(['front', 'back', 'left', 'right', 'top', 'bottom', 'perspective', 'rear-perspective']);
const text = (max) => z.string().min(1).max(max).regex(/^[\u0020-\uD7FF\uE000-\uFFFF]+$/u).regex(/\S/u);
const vec = z.tuple([z.number().finite().min(-64).max(64), z.number().finite().min(-64).max(64), z.number().finite().min(-64).max(64)]);
const size = z.tuple([z.number().positive().max(32), z.number().positive().max(32), z.number().positive().max(32)]);
const box = z.object({id: text(48).regex(/^[a-z][a-z0-9-]*$/u), role: text(60), origin: vec, size, material: z.enum(['steel', 'leather', 'ice', 'stone', 'copper', 'coral', 'joint']), armorPart: z.enum(['head', 'body', 'arm', 'leg']).optional()}).strict();
const example = z.object({id: text(48).regex(/^[a-z][a-z0-9-]*$/u), modelClass: z.enum(BENCHMARK_CLASSES), briefId: text(48), variant: z.enum(['trait', 'counterexample']), label: text(100), representation: z.enum(['reference-cuboids', 'wearable-layer-mannequin', 'six-face-block-reference', 'static-creature-reference']), pattern: z.enum(['calm', 'noise']), palette: z.array(z.string().regex(/^#[0-9a-f]{6}$/u)).min(4).max(16), boxes: z.array(box).min(1).max(64), observations: z.array(z.object({criterion: z.enum(['silhouette', 'construction', 'volume', 'hierarchy', 'materials', 'tiling', 'wearable-layout']), view: z.enum([...BENCHMARK_VIEWS, 'native-32-64', 'wall', 'layers']), observation: text(500), question: text(400)}).strict()).min(2).max(6)}).strict();
export const BenchmarkSchema = z.object({schemaVersion: z.literal(1), kind: z.literal('mcdev-art-reference-benchmark'), purpose: text(600), provenance: z.object({origin: z.literal('original-procedural-reference'), authorMode: z.literal('ai-assisted'), provider: z.literal('Codex'), model: z.literal('not-recorded'), license: z.literal('Apache-2.0'), externalAssets: z.literal(false), source: z.literal('fixtures/art/benchmark-scenes.v1.json')}).strict(), evidenceState: z.object({generationComparison: z.literal('not-run'), humanRatings: z.literal('not-recorded'), artisticApproval: z.literal('not-performed'), game: z.literal('not-run'), runtimeExport: z.literal('not-produced')}).strict(), examples: z.array(example).length(10)}).strict().superRefine((data, ctx) => {
  const ids = new Set();
  for (const [index, item] of data.examples.entries()) {
    const issue = (message) => ctx.addIssue({code: 'custom', path: ['examples', index], message});
    if (ids.has(item.id)) issue('Повторный example ID');
    ids.add(item.id);
    if (new Set(item.boxes.map(b => b.id)).size !== item.boxes.length) issue('Повторный part ID');
    if (new Set(item.palette).size !== item.palette.length) issue('Повторный цвет');
    const representation = item.modelClass === 'armor' ? 'wearable-layer-mannequin' : item.modelClass === 'building-block' ? 'six-face-block-reference' : item.modelClass === 'creature' ? 'static-creature-reference' : 'reference-cuboids';
    if (item.representation !== representation) issue('Класс и reference representation не согласованы');
    if (item.modelClass === 'armor') {
      if (item.boxes.length !== 6 || item.boxes.some(b => b.armorPart === undefined)) issue('Манекен требует шесть native body parts');
      for (const part of ['head', 'body', 'arm', 'leg']) if (!item.boxes.some(b => b.armorPart === part)) issue('Нет native body part');
    } else if (item.boxes.some(b => b.armorPart !== undefined)) issue('Armor UV разрешён только для манекена');
    if (item.modelClass === 'building-block' && (item.boxes.length !== 1 || item.boxes[0].size.some(v => v !== 16))) issue('Строительный reference — один полный блок');
    for (const b of item.boxes) if (b.origin.some((v, axis) => v + b.size[axis] > 64)) issue('Part выходит за reference bounds');
  }
  for (const modelClass of BENCHMARK_CLASSES) {
    const pair = data.examples.filter(x => x.modelClass === modelClass);
    if (pair.length !== 2 || new Set(pair.map(x => x.variant)).size !== 2 || new Set(pair.map(x => x.briefId)).size !== 1 || JSON.stringify(pair[0]?.palette) !== JSON.stringify(pair[1]?.palette)) ctx.addIssue({code: 'custom', path: ['examples'], message: `Нужна согласованная пара ${modelClass}`});
  }
});

export function parseBenchmark(payload) {
  if (typeof payload !== 'string' || new TextEncoder().encode(payload).byteLength > 262144) throw new TypeError('Reference catalog exceeds 262144 UTF-8 bytes');
  return BenchmarkSchema.parse(JSON.parse(payload));
}

// Единый union framing пары, включая намеренно слабую форму. Число boxes не оценивается.
export function pairFrame(examples) {
  const lower = [Infinity, Infinity, Infinity], upper = [-Infinity, -Infinity, -Infinity];
  for (const item of examples) for (const b of item.boxes) for (let axis = 0; axis < 3; axis++) {
    lower[axis] = Math.min(lower[axis], b.origin[axis]);
    upper[axis] = Math.max(upper[axis], b.origin[axis] + b.size[axis]);
  }
  return {center: lower.map((v, axis) => (v + upper[axis]) / 2), span: Math.hypot(...lower.map((v, axis) => upper[axis] - v)) * 1.12};
}
