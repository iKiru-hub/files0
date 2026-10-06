import type { Graph } from '../compiler.js';
export interface Point { x: number; y: number }
export interface Box extends Point { width: number; height: number; attributeCenters?: number[] }

export const SPAWN_RADIUS = 180;

export { DEFAULT_NOTE_SPACING as MIN_NODE_GAP } from './spacing.js';
import { DEFAULT_NOTE_SPACING as MIN_NODE_GAP } from './spacing.js';

/** Prefer the barycenter disk; expand outward when the disk has no free space. */
export function spawnPosition(existing: readonly Box[], size: { width: number; height: number }, random = Math.random, anchors: readonly Box[] = existing, nodeGap = MIN_NODE_GAP): Point {
  const count = anchors.length || 1;
  const center = anchors.reduce((sum, box) => ({ x: sum.x + (box.x + box.width / 2) / count,
    y: sum.y + (box.y + box.height / 2) / count }), { x: 0, y: 0 });
  // Extra breathing room covers the tiny settling motion as well.
  const gap = nodeGap + 4;
  const clear = (p: Point) => existing.every(box => p.x + size.width + gap <= box.x ||
    box.x + box.width + gap <= p.x || p.y + size.height + gap <= box.y || box.y + box.height + gap <= p.y);
  const point = (angle: number, distance: number) => ({ x: center.x + Math.cos(angle) * distance - size.width / 2,
    y: center.y + Math.sin(angle) * distance - size.height / 2 });
  for (let attempt = 0; attempt < 96; attempt++) {
    const p = point(random() * Math.PI * 2, Math.sqrt(random()) * SPAWN_RADIUS);
    if (clear(p)) return p;
  }
  const phase = random() * Math.PI * 2;
  for (let ring = 1; ring <= 24; ring++) for (let step = 0; step < 32; step++) {
    const p = point(phase + step / 32 * Math.PI * 2, SPAWN_RADIUS + ring * gap);
    if (clear(p)) return p;
  }
  // Bounded search with a guaranteed clear fallback, including very tall notes.
  return { x: Math.max(center.x, ...existing.map(box => box.x + box.width)) + gap, y: center.y - size.height / 2 };
}

/** Condense cycles before assigning ranks, so cyclic dependencies are ordinary graphs. */
export function layout(graph: Graph, sizes: Map<string, { width: number; height: number }>): Map<string, Point> {
  const outgoing = new Map(graph.nodes.map(n => [n.id, [] as string[]]));
  const adjacent = new Map(graph.nodes.map(n => [n.id, [] as string[]]));
  for (const e of graph.edges) {
    outgoing.get(e.source)?.push(e.target);
    adjacent.get(e.source)?.push(e.target); adjacent.get(e.target)?.push(e.source);
  }
  const indices = new Map<string, number>(), low = new Map<string, number>(), stack: string[] = [], active = new Set<string>();
  const groups: string[][] = [], groupOf = new Map<string, number>();
  let index = 0;
  function visit(id: string) {
    indices.set(id, index); low.set(id, index++); stack.push(id); active.add(id);
    for (const next of outgoing.get(id) || []) {
      if (!indices.has(next)) { visit(next); low.set(id, Math.min(low.get(id)!, low.get(next)!)); }
      else if (active.has(next)) low.set(id, Math.min(low.get(id)!, indices.get(next)!));
    }
    if (low.get(id) === indices.get(id)) {
      const group: string[] = []; let next: string;
      do { next = stack.pop()!; active.delete(next); groupOf.set(next, groups.length); group.push(next); } while (next !== id);
      groups.push(group.reverse());
    }
  }
  for (const n of graph.nodes) if (!indices.has(n.id)) visit(n.id);
  const incoming = groups.map(() => new Set<number>()), nextGroups = groups.map(() => new Set<number>());
  for (const e of graph.edges) {
    const a = groupOf.get(e.source)!, b = groupOf.get(e.target)!;
    if (a !== b) { incoming[b].add(a); nextGroups[a].add(b); }
  }
  const ranks = groups.map(() => 0), degrees = incoming.map(s => s.size), queue = degrees.flatMap((n, i) => n === 0 ? [i] : []);
  for (let i = 0; i < queue.length; i++) for (const next of nextGroups[queue[i]]) {
    ranks[next] = Math.max(ranks[next], ranks[queue[i]] + 1);
    if (--degrees[next] === 0) queue.push(next);
  }
  const result = new Map<string, Point>(), seen = new Set<string>();
  const maxWidth = Math.max(100, ...[...sizes.values()].map(s => s.width));
  let top = 0;
  for (const node of graph.nodes) {
    if (seen.has(node.id)) continue;
    const component = [node.id]; seen.add(node.id);
    for (let i = 0; i < component.length; i++) for (const next of adjacent.get(component[i]) || []) {
      if (!seen.has(next)) { seen.add(next); component.push(next); }
    }
    const columns = new Map<number, string[]>();
    for (const id of component) { const rank = ranks[groupOf.get(id)!]; columns.set(rank, [...(columns.get(rank) || []), id]); }
    const heights = new Map([...columns].map(([rank, ids]) => [rank, ids.reduce((sum, id) => sum + (sizes.get(id)?.height || 70) + 45, -45)]));
    const height = Math.max(...heights.values());
    for (const [rank, ids] of columns) {
      let y = top + (height - heights.get(rank)!) / 2;
      for (const id of ids) { result.set(id, { x: rank * (maxWidth + 125), y }); y += (sizes.get(id)?.height || 70) + 45; }
    }
    top += height + 85;
  }
  return result;
}

function boundary(box: Box, toward: Point, gap = 5): Point {
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const dx = toward.x - cx, dy = toward.y - cy;
  const factor = 1 / Math.max(Math.abs(dx) / (box.width / 2 + gap), Math.abs(dy) / (box.height / 2 + gap), .00001);
  return { x: cx + dx * factor, y: cy + dy * factor };
}

export function edgePath(a: Box, b: Box, self: boolean, bend = 0): string {
  if (self) {
    const x = a.x + a.width, y = a.y + a.height / 2;
    return `M ${x + 4} ${y - 12} C ${x + 70} ${y - 70}, ${x + 70} ${y + 70}, ${x + 4} ${y + 12}`;
  }
  const centerA = { x: a.x + a.width / 2, y: a.y + a.height / 2 }, centerB = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const dx = centerB.x - centerA.x, dy = centerB.y - centerA.y, len = Math.hypot(dx, dy) || 1;
  const mid = { x: (centerA.x + centerB.x) / 2 - dy / len * bend, y: (centerA.y + centerB.y) / 2 + dx / len * bend };
  const start = boundary(a, mid), end = boundary(b, mid, 7);
  if (bend) return `M ${start.x} ${start.y} Q ${mid.x} ${mid.y} ${end.x} ${end.y}`;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  return horizontal
    ? `M ${start.x} ${start.y} C ${(start.x + end.x) / 2} ${start.y}, ${(start.x + end.x) / 2} ${end.y}, ${end.x} ${end.y}`
    : `M ${start.x} ${start.y} C ${start.x} ${(start.y + end.y) / 2}, ${end.x} ${(start.y + end.y) / 2}, ${end.x} ${end.y}`;
}
