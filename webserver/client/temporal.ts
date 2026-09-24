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
    const head = headLine(component);
    const preceding = [...times.keys()].filter(id => notes.get(id)!.line < head).sort((a, b) => notes.get(b)!.line - notes.get(a)!.line)[0];
    const offset = preceding ? times.get(preceding)! : 0;
    const centers = new Map<string, number>();
    const gap = MIN_NODE_GAP + 8;
    const height = (id: string) => sizes.get(id)?.height || 70;
    const ordered = [...component].sort((a,b) => rank(a)-rank(b) || notes.get(a)!.line-notes.get(b)!.line);
    for (const time of [...new Set(ordered.map(rank))]) {
      // Reserve one continuous block per parent, not one free lane per child.
      // This prevents other branches from interleaving a sibling list.
      const families = new Map<string | undefined, string[]>();
      for (const id of ordered.filter(id => rank(id) === time)) {
        const predecessor = parents.get(id)!.find(p => centers.has(p) && rank(p) < time);
        families.set(predecessor, [...(families.get(predecessor) || []), id]);
      }
      const blocks = [...families].map(([parent, siblings]) => {
        const spiral = (i: number) => i === 0 ? 0 : (i%2 ? -1 : 1)*Math.ceil(i/2);
        const ids = siblings.map((id,i) => ({id, order:spiral(i)})).sort((a,b)=>a.order-b.order).map(n=>n.id);
        const total = ids.reduce((sum,id)=>sum+height(id),0) + gap*(ids.length-1);
        const preferred = (parent ? centers.get(parent)! : 0) - total/2;
        return {ids,total,preferred,top:preferred};
      }).sort((a,b)=>a.preferred+a.total/2-b.preferred-b.total/2);
      for (let i=1;i<blocks.length;i++) {
        blocks[i].top = Math.max(blocks[i].top,blocks[i-1].top+blocks[i-1].total+gap);
      }
      // Balance collision displacement across whole families, preserving order.
      const shift = blocks.reduce((sum,b)=>sum+b.top-b.preferred,0)/blocks.length;
      for (const block of blocks) {
        let y=block.top-shift;
        for (const id of block.ids) {
          centers.set(id,y+height(id)/2); times.set(id,time+offset);
          result.set(id,{x:(time+offset)*stride,y});
          y+=height(id)+gap;
        }
      }
    }
    const top = Math.min(...component.map(id => result.get(id)!.y));
    for (const id of component) result.get(id)!.y += componentY - top;
    componentY = Math.max(...component.map(id => result.get(id)!.y + (sizes.get(id)?.height || 70))) + MIN_NODE_GAP + 8 + 16;
  }
  return result;
}
