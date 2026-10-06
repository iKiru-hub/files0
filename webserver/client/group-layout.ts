import type { Graph } from '../compiler.js';
import { groupBounds } from './groups.js';
import { MIN_NODE_GAP, type Box, type Point } from './layout.js';

/** Pack disjoint memberships as whole units. Shared members deliberately join
 * units, so explicitly intersecting sets remain free to overlap. */
export function arrangeGroups(graph: Graph, sizes: Map<string,{width:number;height:number}>, positions: Map<string,Point>, held?: string, vertical=false,
  labels = new Map<string,{header:number;footer:number}>(), nodeGap = MIN_NODE_GAP): Map<string,Point> {
  if (!graph.groups?.length) return positions;
  const result=new Map([...positions].map(([id,p])=>[id,{...p}]));
  const groups=graph.groups;
  const bounds=(ids:string[]):Box=>{
    const nodes=new Map(ids.map(id=>[id,{...result.get(id)!,width:sizes.get(id)!.width,height:sizes.get(id)!.height}]));
    const included=groups.filter(g=>g.members.length && g.members.every(id=>nodes.has(id)));
    const all=[...nodes.values(),...[...groupBounds(included,nodes,labels).values()].map(b=>b.outer)];
    const x=Math.min(...all.map(b=>b.x)),y=Math.min(...all.map(b=>b.y));
    return {x,y,width:Math.max(...all.map(b=>b.x+b.width))-x,height:Math.max(...all.map(b=>b.y+b.height))-y};
  };
  const pack=(scope:string[])=>{
    const owner=new Map(scope.map(id=>[id,id]));
    const root=(id:string):string=>{let p=id;while(owner.get(p)!==p)p=owner.get(p)!;return p;};
    for(const group of groups) {
      if(!group.members.length || group.members.length>=scope.length || !group.members.every(id=>owner.has(id)))continue;
      const first=root(group.members[0]);for(const id of group.members)owner.set(root(id),first);
    }
    const sets=new Map<string,string[]>();
    for(const id of scope) {const key=root(id);sets.set(key,[...(sets.get(key)||[]),id]);}
    const units=[...sets.values()];
    if(units.length===1) return;
    for(const unit of units) if(unit.length>1) pack(unit);
    units.sort((a,b)=>Number(b.includes(held||''))-Number(a.includes(held||'')) || bounds(a).y-bounds(b).y);
    // Close empty vertical bands without reversing siblings or breaking aligned
    // chains. Nested boxes move as units; time columns remain untouched.
    if(vertical && !scope.includes(held||'') && groups.some(g=>g.members.length===scope.length && g.members.every(id=>owner.has(id)))) {
      const envelope=bounds(scope);
      const bands:{top:number;bottom:number;ids:string[]}[]=[];
      for(const unit of units) {
        const box=bounds(unit),previous=bands.at(-1);
        if(previous && box.y<=previous.bottom) {
          previous.bottom=Math.max(previous.bottom,box.y+box.height);previous.ids.push(...unit);
        } else bands.push({top:box.y,bottom:box.y+box.height,ids:[...unit]});
      }
      let bottom=bands[0].top;
      for(const [i,band] of bands.entries()) {
        const top=i?Math.min(band.top,bottom+nodeGap):band.top;
        for(const id of band.ids) result.get(id)!.y+=top-band.top;
        bottom=top+band.bottom-band.top;
      }
      const compact=bounds(scope),dy=envelope.y+envelope.height/2-compact.y-compact.height/2;
      for(const id of scope) result.get(id)!.y+=dy;
    }
    const placed:Box[]=[];
    for(const unit of units) {
      const box=bounds(unit);
      const clear=(p:Point)=>placed.every(b=>p.x+box.width+nodeGap<=b.x || b.x+b.width+nodeGap<=p.x || p.y+box.height+nodeGap<=b.y || b.y+b.height+nodeGap<=p.y);
      let point:Point=box;
      if(!clear(box)) {
        const candidates=placed.flatMap(b=>[
          {x:box.x,y:b.y-box.height-nodeGap},{x:box.x,y:b.y+b.height+nodeGap},
          ...(vertical?[]:[{x:b.x-box.width-nodeGap,y:box.y},{x:b.x+b.width+nodeGap,y:box.y}])]);
        candidates.sort((a,b)=>Math.hypot(a.x-box.x,a.y-box.y)-Math.hypot(b.x-box.x,b.y-box.y));
        point=candidates.find(clear)!;
      }
      for(const id of unit) {const p=result.get(id)!;p.x+=point.x-box.x;p.y+=point.y-box.y;}
      placed.push({...box,x:point.x,y:point.y});
    }
  };
  pack([...result.keys()]);return result;
}
