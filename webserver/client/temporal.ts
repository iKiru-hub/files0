import type { Graph } from '../compiler.js';
import { layout, MIN_NODE_GAP, type Point } from './layout.js';

/** Longest-path time columns; cycles are condensed into a simultaneous group. */
export function temporalLayout(graph: Graph, sizes: Map<string, { width: number; height: number }>): Map<string, Point> {
  const temporal = { nodes: graph.nodes, edges: graph.edges.filter(e => e.kind === 'to' || e.kind === 'from') };
  const initial = layout(temporal, sizes);
  const maxWidth = Math.max(100, ...[...sizes.values()].map(s => s.width));
  const stride = maxWidth + 80;
  const notes = new Map(graph.nodes.map(n => [n.id, n]));
  const adjacent = new Map(graph.nodes.map(n => [n.id, new Set<string>()]));
  const parents = new Map(graph.nodes.map(n => [n.id, [] as string[]]));
  for (const edge of temporal.edges) {
    adjacent.get(edge.source)!.add(edge.target); adjacent.get(edge.target)!.add(edge.source);
    parents.get(edge.target)!.push(edge.source);
  }
  const seen = new Set<string>(), components: string[][] = [];
  for (const n of graph.nodes) {
    if (seen.has(n.id)) continue;
    const component = [n.id]; seen.add(n.id);
    for (let i = 0; i < component.length; i++) for (const next of adjacent.get(component[i])!) {
      if (!seen.has(next)) { seen.add(next); component.push(next); }
    }
    components.push(component);
  }
  const rank = (id: string) => Math.round(initial.get(id)!.x / (maxWidth + 125));
  const headLine = (ids: string[]) => Math.min(...ids.filter(id => rank(id) === 0).map(id => notes.get(id)!.line));
  components.sort((a, b) => headLine(a) - headLine(b));
  const result = new Map<string, Point>(), times = new Map<string, number>();
  // Independent components get only 16px more separation than sibling lanes.
  let componentY = 0;
  for (const component of components) {
    const rowHeight = Math.max(70, ...component.map(id => sizes.get(id)?.height || 70)) + MIN_NODE_GAP + 8;
    const head = headLine(component);
    const preceding = [...times.keys()].filter(id => notes.get(id)!.line < head).sort((a, b) => notes.get(b)!.line - notes.get(a)!.line)[0];
    const offset = preceding ? times.get(preceding)! : 0;
    const lanes = new Map<string, number>(), occupied = new Map<number, Set<number>>();
    const ordered = [...component].sort((a, b) => rank(a) - rank(b) || notes.get(a)!.line - notes.get(b)!.line);
    for (const id of ordered) {
      const time = rank(id), used = occupied.get(time) || new Set<number>();
      const predecessor = parents.get(id)!.find(p => lanes.has(p) && rank(p) < time);
      const siblings = ordered.filter(other => rank(other) === time &&
        parents.get(other)!.find(p => lanes.has(p) && rank(p) < time) === predecessor);
      // File order grows outward: middle, above, below, above, below.
      const spiral = (i: number) => i === 0 ? 0 : (i % 2 ? -1 : 1) * Math.ceil(i / 2);
      const offsets = siblings.map((_, i) => spiral(i));
      const center = (Math.min(...offsets) + Math.max(...offsets)) / 2;
      const preferred = (predecessor ? lanes.get(predecessor)! : 0) + spiral(siblings.indexOf(id)) - center;
      let lane = preferred, attempt = 0;
      while ([...used].some(other => Math.abs(other - lane) < 1)) lane = preferred + spiral(++attempt);
      lanes.set(id, lane); used.add(lane); occupied.set(time, used);
      times.set(id, time + offset);
      result.set(id, { x: (time + offset) * stride,
        y: componentY + lane * rowHeight - (sizes.get(id)?.height || 70) / 2 });
    }
    const top = Math.min(...component.map(id => result.get(id)!.y));
    for (const id of component) result.get(id)!.y += componentY - top;
    componentY = Math.max(...component.map(id => result.get(id)!.y + (sizes.get(id)?.height || 70))) + MIN_NODE_GAP + 8 + 16;
  }
  return result;
}
