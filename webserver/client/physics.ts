import type { Graph } from '../compiler.js';
import { MIN_NODE_GAP, type Box, type Point } from './layout.js';

/** Physical relationships are undirected; arrow direction only affects rendering. */
export function neighbourhoods(graph: Graph): Map<string, Set<string>> {
  const adjacent = new Map(graph.nodes.map(n => [n.id, new Set<string>()]));
  for (const e of graph.edges) if (e.source !== e.target) {
    adjacent.get(e.source)?.add(e.target); adjacent.get(e.target)?.add(e.source);
  }
  return adjacent;
}

/** A bounded, cooled force solve. The renderer animates the resulting equilibrium. */
export function equilibrate(graph: Graph, boxes: Map<string, Box>, held?: string): Map<string, Point> {
  const ids = graph.nodes.map(n => n.id).filter(id => boxes.has(id));
  if (!ids.length) return new Map();
  const bodies = ids.map(id => ({ ...boxes.get(id)!, vx: 0, vy: 0 }));
  const adjacent = neighbourhoods(graph);
  const relations = ids.map((id, i) => ids.map((other, j) => {
    if (i === j) return 0;
    if (adjacent.get(id)?.has(other)) return 2;
    return [...(adjacent.get(id) || [])].some(mid => adjacent.get(mid)?.has(other)) ? 1 : 0;
  }));
  const center = bodies.reduce((p, b) => ({ x: p.x + (b.x + b.width / 2) / bodies.length,
    y: p.y + (b.y + b.height / 2) / bodies.length }), { x: 0, y: 0 });
  for (let iteration = 0; iteration < 240; iteration++) {
    const heat = 1 - iteration / 270;
    const forces = bodies.map((b, i) => ({ x: (center.x - b.x - b.width / 2) * .001 + (boxes.get(ids[i])!.x-b.x)*.002,
      y: (center.y - b.y - b.height / 2) * .001 + (boxes.get(ids[i])!.y-b.y)*.002 }));
    for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j];
      let dx = b.x + b.width / 2 - a.x - a.width / 2, dy = b.y + b.height / 2 - a.y - a.height / 2;
      if (Math.hypot(dx, dy) < .01) { dx = Math.cos(i * 2.4 + j); dy = Math.sin(i * 2.4 + j); }
      const distance = Math.hypot(dx, dy), ux = dx / distance, uy = dy / distance;
      const clearance = Math.min((a.width + b.width) / 2 / (Math.abs(ux) || .0001),
        (a.height + b.height) / 2 / (Math.abs(uy) || .0001));
      const relation = relations[i][j];
      const rest = clearance + MIN_NODE_GAP + (relation === 2 ? 14 : 65);
      // A direct edge pulls hardest; distance-two neighbours have a weaker spring.
      const strength = relation === 2 ? .045 / Math.sqrt(Math.max(1, Math.min(adjacent.get(ids[i])!.size, adjacent.get(ids[j])!.size))) : .006;
      const attraction = relation ? (distance - rest) * strength : 0;
      const reach = Math.max(0, 1 - Math.max(0, distance-clearance) / 260);
      const repulsion = (relation ? 600 : 3600) * reach / Math.max(60, distance) ** 2;
      const force = attraction - repulsion;
      forces[i].x += ux * force; forces[i].y += uy * force;
      forces[j].x -= ux * force; forces[j].y -= uy * force;
      const ox = (a.width + b.width) / 2 + MIN_NODE_GAP + 5 - Math.abs(dx);
      const oy = (a.height + b.height) / 2 + MIN_NODE_GAP + 5 - Math.abs(dy);
      if (ox > 0 && oy > 0) {
        if (ox < oy) { const push = (Math.sign(dx) || 1) * ox * .18; forces[i].x -= push; forces[j].x += push; }
        else { const push = (Math.sign(dy) || 1) * oy * .18; forces[i].y -= push; forces[j].y += push; }
      }
    }
    bodies.forEach((b, i) => {
      if (ids[i] === held) return;
      b.vx = (b.vx + forces[i].x * heat) * .72; b.vy = (b.vy + forces[i].y * heat) * .72;
      const speed = Math.hypot(b.vx, b.vy), limit = Math.min(1, 7 / (speed || 1));
      b.x += b.vx * limit; b.y += b.vy * limit;
    });
  }
  // Separate rectangles by the shortest displacement, instead of throwing a
  // crowded note onto a random outer ring. Keep the dragged note fixed.
  for (let pass = 0; pass < 100; pass++) {
    let overlaps = false;
    for (let i = 0; i < bodies.length; i++) for (let j = i+1; j < bodies.length; j++) {
      const a=bodies[i], b=bodies[j];
      const dx=b.x+b.width/2-a.x-a.width/2, dy=b.y+b.height/2-a.y-a.height/2;
      const ox=(a.width+b.width)/2+MIN_NODE_GAP+.01-Math.abs(dx);
      const oy=(a.height+b.height)/2+MIN_NODE_GAP+.01-Math.abs(dy);
      if (ox<=0 || oy<=0) continue;
      overlaps=true;
      const shareA=ids[i]===held?0:ids[j]===held?1:.5, shareB=1-shareA;
      if (ox<oy) { const shift=(Math.sign(dx)||1)*ox; a.x-=shift*shareA; b.x+=shift*shareB; }
      else { const shift=(Math.sign(dy)||1)*oy; a.y-=shift*shareA; b.y+=shift*shareB; }
    }
    if (!overlaps) break;
  }
  // Deterministic local fallback for unusually dense clusters.
  const occupied: Box[] = [], result = new Map<string, Point>();
  const order = ids.map((id, i) => ({ id, box: bodies[i] })).sort((a,b)=>Number(b.id===held)-Number(a.id===held));
  for (const {id,box} of order) {
    const clear=(p:Point)=>occupied.every(b=>p.x+box.width+MIN_NODE_GAP<=b.x || b.x+b.width+MIN_NODE_GAP<=p.x || p.y+box.height+MIN_NODE_GAP<=b.y || b.y+b.height+MIN_NODE_GAP<=p.y);
    let p={x:box.x,y:box.y};
    if (!clear(p)) {
      const candidates=occupied.flatMap(b=>[
        {x:b.x-box.width-MIN_NODE_GAP,y:box.y}, {x:b.x+b.width+MIN_NODE_GAP,y:box.y},
        {x:box.x,y:b.y-box.height-MIN_NODE_GAP}, {x:box.x,y:b.y+b.height+MIN_NODE_GAP}]);
      candidates.sort((a,b)=>Math.hypot(a.x-box.x,a.y-box.y)-Math.hypot(b.x-box.x,b.y-box.y));
      p=candidates.find(clear)!;
    }
    result.set(id,p); occupied.push({...box,...p});
  }
  return result;
}
