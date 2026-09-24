import type { Graph, Edge } from '../compiler.js';
import type { Box, Point } from './layout.js';
export interface Route { points: Point[]; path: string; crossings: number }
interface Segment { a: Point; b: Point }
const PAD = 18, GAP = 7, EPS = .001;
const CROSSING_COST = 500;
const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const segments = (p: Point[]): Segment[] => p.slice(1).map((b, i) => ({ a: p[i], b }));
const same = (a: Point, b: Point) => distance(a, b) < EPS;

export function hitsBox(a: Point, b: Point, box: Box, pad = 0): boolean {
  // Clip against the open interior of the rectangle, for any segment angle.
  let low = 0, high = 1;
  for (const [origin, delta, min, max] of [
    [a.x, b.x-a.x, box.x-pad+EPS, box.x+box.width+pad-EPS],
    [a.y, b.y-a.y, box.y-pad+EPS, box.y+box.height+pad-EPS]
  ]) {
    if (Math.abs(delta) < EPS) { if (origin <= min || origin >= max) return false; }
    else {
      const t1 = (min-origin)/delta, t2 = (max-origin)/delta;
      low = Math.max(low, Math.min(t1,t2)); high = Math.min(high, Math.max(t1,t2));
      if (low >= high) return false;
    }
  }
  return low < high;
}

/** Includes collinear overlap; a shared endpoint alone is not a crossing. */
export function intersects(a: Point, b: Point, c: Point, d: Point): boolean {
  const cross = (u: Point,v: Point) => u.x*v.y-u.y*v.x;
  const r = {x:b.x-a.x,y:b.y-a.y}, s = {x:d.x-c.x,y:d.y-c.y}, q = {x:c.x-a.x,y:c.y-a.y};
  const det = cross(r,s);
  if (Math.abs(det) < EPS) {
    if (Math.abs(cross(q,r)) > EPS || same(a,b) || same(c,d)) return false;
    const axis = Math.abs(r.x)>Math.abs(r.y) ? 'x' : 'y';
    return Math.min(Math.max(a[axis],b[axis]),Math.max(c[axis],d[axis])) -
      Math.max(Math.min(a[axis],b[axis]),Math.min(c[axis],d[axis])) > EPS;
  }
  const t = cross(q,s)/det, u = cross(q,r)/det;
  if (t < -EPS || t > 1+EPS || u < -EPS || u > 1+EPS) return false;
  return !((t < EPS || t > 1-EPS) && (u < EPS || u > 1-EPS));
}

function straight(a: Box, b: Box): Point[] {
  const ac = {x:a.x+a.width/2,y:a.y+a.height/2}, bc = {x:b.x+b.width/2,y:b.y+b.height/2};
  const dx = bc.x-ac.x, dy = bc.y-ac.y, length = Math.hypot(dx,dy);
  if (length < EPS) return [];
  const tip = (box: Box, center: Point, direction: number) => {
    const t = Math.min(dx ? box.width/2/Math.abs(dx) : Infinity, dy ? box.height/2/Math.abs(dy) : Infinity) + GAP/length;
    return {x:center.x+direction*dx*t,y:center.y+direction*dy*t};
  };
  return [tip(a,ac,1),tip(b,bc,-1)];
}

function simplify(points: Point[]): Point[] {
  const result: Point[] = [];
  for (const p of points) {
    if (result.length && same(result[result.length - 1], p)) continue;
    while (result.length > 1) {
      const a = result[result.length - 2], b = result[result.length - 1];
      if ((Math.abs(a.x-b.x)<EPS && Math.abs(b.x-p.x)<EPS && (b.y-a.y)*(p.y-b.y)>=0) ||
          (Math.abs(a.y-b.y)<EPS && Math.abs(b.y-p.y)<EPS && (b.x-a.x)*(p.x-b.x)>=0)) result.pop();
      else break;
    }
    result.push(p);
  }
  return result;
}
export function roundedPath(points: Point[]): string {
  if (!points.length) return '';
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i-1], b = points[i], c = points[i+1];
    const r = Math.min(10, Math.hypot(a.x-b.x,a.y-b.y)/2, Math.hypot(c.x-b.x,c.y-b.y)/2);
    const before = { x:b.x+(a.x-b.x)*r/(Math.hypot(a.x-b.x,a.y-b.y)||1), y:b.y+(a.y-b.y)*r/(Math.hypot(a.x-b.x,a.y-b.y)||1) };
    const after = { x:b.x+(c.x-b.x)*r/(Math.hypot(c.x-b.x,c.y-b.y)||1), y:b.y+(c.y-b.y)*r/(Math.hypot(c.x-b.x,c.y-b.y)||1) };
    path += ` L ${before.x} ${before.y} Q ${b.x} ${b.y} ${after.x} ${after.y}`;
  }
  const end = points[points.length-1]; return path + ` L ${end.x} ${end.y}`;
}
function ports(box: Box, slot: number) {
  const x = box.x + box.width/2 + slot*Math.min(20,box.width/4), y = box.y + box.height/2 + slot*Math.min(20,box.height/4);
  return [
    [{x:box.x+box.width+GAP,y},{x:box.x+box.width+PAD,y}],
    [{x:box.x-GAP,y},{x:box.x-PAD,y}],
    [{x,y:box.y-GAP},{x,y:box.y-PAD}],
    [{x,y:box.y+box.height+GAP},{x,y:box.y+box.height+PAD}]
  ];
}
function cost(points: Point[], boxes: Map<string, Box>, edge: Edge, existing: Segment[]): number {
  const lines = segments(points);
  let value = lines.reduce((n,s) => n+distance(s.a,s.b),0) + Math.max(0, points.length-2)*32;
  for (let i=0; i<lines.length; i++) {
    const s=lines[i];
    for (const [id,box] of boxes) {
      if ((i===0 && id===edge.source) || (i===lines.length-1 && id===edge.target)) continue;
      // Curved corners stay inside the 16px routing corridor, outside the 8px guard.
      if (hitsBox(s.a,s.b,box,8)) return Infinity;
    }
    for (let j=0; j<i-1; j++) if (intersects(s.a,s.b,lines[j].a,lines[j].b)) return Infinity;
    for (const other of existing) if (intersects(s.a,s.b,other.a,other.b)) value += CROSSING_COST;
  }
  return value;
}

/** Visibility-grid fallback for corridors requiring more than four bends. */
function search(start: Point, end: Point, boxes: Box[]): Point[] | undefined {
  const xs=[...new Set([start.x,end.x,...boxes.flatMap(b=>[b.x-PAD,b.x+b.width+PAD])])].sort((a,b)=>a-b);
  const ys=[...new Set([start.y,end.y,...boxes.flatMap(b=>[b.y-PAD,b.y+b.height+PAD])])].sort((a,b)=>a-b);
  const key=(x:number,y:number)=>y*xs.length+x;
  const origin=key(xs.indexOf(start.x),ys.indexOf(start.y)), goal=key(xs.indexOf(end.x),ys.indexOf(end.y));
  const point=(k:number)=>({x:xs[k%xs.length],y:ys[Math.floor(k/xs.length)]});
  const best=new Map<number,number>([[origin,0]]), previous=new Map<number,number>();
  const open=[{id:origin,score:distance(start,end)}];
  for(let visits=0;open.length && visits<6000;visits++) {
    let at=0;for(let i=1;i<open.length;i++)if(open[i].score<open[at].score)at=i;
    const current=open.splice(at,1)[0].id;
    if(current===goal) { const path=[point(goal)];let id=goal;while(id!==origin){id=previous.get(id)!;path.push(point(id));}return path.reverse(); }
    const x=current%xs.length,y=Math.floor(current/xs.length),a=point(current);
    for(const [nx,ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]) {
      if(nx<0||ny<0||nx>=xs.length||ny>=ys.length)continue;
      const id=key(nx,ny),b=point(id);if(boxes.some(box=>hitsBox(a,b,box,8)))continue;
      const score=best.get(current)!+distance(a,b);
      if(score >= (best.get(id)??Infinity))continue;
      best.set(id,score);previous.set(id,current);open.push({id,score:score+distance(b,end)});
    }
  }
}

export function routeEdges(graph: Graph, boxes: Map<string, Box>): Map<string, Route> {
  const routed=new Map<string,Route>(), existing: Segment[]=[];
  const all=[...boxes.values()];if(!all.length)return routed;
  const bounds={left:Math.min(...all.map(b=>b.x))-40,right:Math.max(...all.map(b=>b.x+b.width))+40,
    top:Math.min(...all.map(b=>b.y))-40,bottom:Math.max(...all.map(b=>b.y+b.height))+40};
  const degree=new Map<string,string[]>();
  for(const e of graph.edges) for(const id of [e.source,e.target]) degree.set(id,[...(degree.get(id)||[]),e.id]);
  const slot=(node:string,edge:string)=>{const ids=degree.get(node)!;return ids.length===1?0:(ids.indexOf(edge)/(ids.length-1)-.5)*2;};
  const ordered=[...graph.edges].sort((a,b)=>{
    const length=(e:Edge)=>distance(boxes.get(e.source)!,boxes.get(e.target)!);
    return length(a)-length(b)||a.id.localeCompare(b.id);
  });
  for(const edge of ordered) {
    const a=boxes.get(edge.source),b=boxes.get(edge.target);if(!a||!b)continue;
    // Try the center-to-center line first, including diagonals. Bend only
    // when another note or an already routed connection obstructs it.
    const direct = edge.source === edge.target ? [] : straight(a,b);
    if (direct.length && ![...boxes].some(([id,box]) => id !== edge.source && id !== edge.target && hitsBox(direct[0],direct[1],box,8)) &&
        !existing.some(segment => intersects(direct[0],direct[1],segment.a,segment.b))) {
      routed.set(edge.id,{points:direct,path:roundedPath(direct),crossings:0});
      existing.push(...segments(direct)); continue;
    }
    const pairs=ports(a,slot(edge.source,edge.id)).flatMap(s=>ports(b,slot(edge.target,edge.id)).map(t=>({s,t})));
    pairs.sort((p,q)=>distance(p.s[1],p.t[1])-distance(q.s[1],q.t[1]));
    let winner:Point[]|undefined,best=Infinity;
    const evaluate=(raw:Point[])=>{const points=simplify(raw);const score=cost(points,boxes,edge,existing);if(score<best){best=score;winner=points;}};
    // Compact diagonal bends around nearby obstacles precede orthogonal detours.
    // A modest crossing cost prevents a single intersection creating a huge loop.
    if (direct.length) evaluate(direct);
    const boundary=(box:Box,toward:Point)=>{
      const center={x:box.x+box.width/2,y:box.y+box.height/2};
      const dx=toward.x-center.x,dy=toward.y-center.y;
      const t=Math.min(dx?(box.width/2+GAP)/Math.abs(dx):Infinity,dy?(box.height/2+GAP)/Math.abs(dy):Infinity);
      return {x:center.x+dx*t,y:center.y+dy*t};
    };
    const via=(middle:Point[])=>evaluate([boundary(a,middle[0]),...middle,boundary(b,middle[middle.length-1])]);
    if(edge.source!==edge.target) {
      const ac={x:a.x+a.width/2,y:a.y+a.height/2},bc={x:b.x+b.width/2,y:b.y+b.height/2};
      const dx=bc.x-ac.x,dy=bc.y-ac.y,length=Math.hypot(dx,dy)||1;
      for(const offset of [24,-24,48,-48,80,-80,120,-120]) {
        via([{x:(ac.x+bc.x)/2-dy/length*offset,y:(ac.y+bc.y)/2+dx/length*offset}]);
      }
      const near=all.filter(box=>box!==a && box!==b).sort((x,y)=>distance(x,a)+distance(x,b)-distance(y,a)-distance(y,b)).slice(0,16);
      for(const box of near) {
        const tl={x:box.x-PAD,y:box.y-PAD},tr={x:box.x+box.width+PAD,y:box.y-PAD};
        const bl={x:box.x-PAD,y:box.y+box.height+PAD},br={x:box.x+box.width+PAD,y:box.y+box.height+PAD};
        for(const p of [tl,tr,bl,br]) via([p]);
        for(const pair of [[tl,tr],[bl,br],[tl,bl],[tr,br]]) {via(pair);via([...pair].reverse());}
      }
    }
    for(const {s,t} of pairs) {
      if(edge.source===edge.target && same(s[0],t[0]))continue;
      const start=s[1],end=t[1];
      const nearest=(values:number[],mid:number)=>[...new Set(values)].sort((x,y)=>Math.abs(x-mid)-Math.abs(y-mid)).slice(0,12);
      const xs=nearest(all.flatMap(box=>[box.x-PAD,box.x+box.width+PAD]),(start.x+end.x)/2);
      const ys=nearest(all.flatMap(box=>[box.y-PAD,box.y+box.height+PAD]),(start.y+end.y)/2);
      xs.push((start.x+end.x)/2,bounds.left-(routed.size % 6)*6,bounds.right+(routed.size % 6)*6);
      ys.push((start.y+end.y)/2,bounds.top-(routed.size % 6)*6,bounds.bottom+(routed.size % 6)*6);
      const attempt=(middle:Point[])=>evaluate([s[0],start,...middle,end,t[0]]);
      attempt([{x:end.x,y:start.y}]);attempt([{x:start.x,y:end.y}]);
      for(const x of xs)attempt([{x,y:start.y},{x,y:end.y}]);
      for(const y of ys)attempt([{x:start.x,y},{x:end.x,y}]);
      if(best>=CROSSING_COST) for(const x of xs.slice(-4))for(const y of ys.slice(-4)) {
        attempt([{x,y:start.y},{x,y},{x:end.x,y}]);
        attempt([{x:start.x,y},{x,y},{x,y:end.y}]);
      }
    }
    if(!winner) for(const {s,t} of pairs) {
      if(edge.source===edge.target && same(s[0],t[0]))continue;
      const path=search(s[1],t[1],all);
      if(path) { evaluate([s[0],...path,t[0]]);if(winner)break; }
    }
    if(winner) {
      const points=simplify(winner),crossings=segments(points).reduce((n,s)=>n+existing.filter(other=>intersects(s.a,s.b,other.a,other.b)).length,0);
      routed.set(edge.id,{points,path:roundedPath(points),crossings});existing.push(...segments(points));
    }
  }
  return routed;
}
