import type { NoteGroup } from '../compiler.js';
import type { Box } from './layout.js';
export interface GroupBounds { frame: Box; outer: Box }
/** Boxes follow member bounds; contained sets reserve room for inner labels too. */
export function groupBounds(groups: NoteGroup[], nodes: Map<string, Box>, labels: Map<string,{header:number;footer:number}>): Map<string,GroupBounds> {
  const result=new Map<string,GroupBounds>();
  const contains=(a:NoteGroup,b:NoteGroup)=>a!==b && b.members.every(id=>a.members.includes(id)) &&
    (a.members.length>b.members.length || (a.line<b.line && (a.endLine||Infinity)>(b.endLine||Infinity)));
  const ordered=[...groups].sort((a,b)=>a.members.length-b.members.length || b.line-a.line);
  for(const group of ordered) {
    const boxes=group.members.map(id=>nodes.get(id)).filter((b):b is Box=>!!b);
    if(!boxes.length) continue;
    const children=ordered.filter(child=>contains(group,child)).flatMap(child=>result.has(child.id)?[result.get(child.id)!.outer]:[]);
    const all=[...boxes,...children],pad=children.length?36:44;
    const x=Math.min(...all.map(b=>b.x))-pad, y=Math.min(...all.map(b=>b.y))-pad;
    const width=Math.max(160,Math.max(...all.map(b=>b.x+b.width))-x+pad);
    const height=Math.max(...all.map(b=>b.y+b.height))-y+pad;
    const label=labels.get(group.id)||{header:28,footer:0};
    result.set(group.id,{frame:{x,y,width,height},outer:{x,y:y-label.header,width,height:height+label.header+label.footer}});
  }
  return result;
}
