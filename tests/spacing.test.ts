import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../webserver/compiler.js';
import { equilibrate } from '../webserver/client/physics.js';
import { temporalLayout } from '../webserver/client/temporal.js';
import { normalizeSpacing } from '../webserver/client/spacing.js';
import { spawnPosition } from '../webserver/client/layout.js';

test('spacing clamps invalid preferences and preserves the original default', () => {
  assert.equal(normalizeSpacing(NaN), 48);
  assert.equal(normalizeSpacing(Infinity), 48);
  assert.equal(normalizeSpacing(-5), 16);
  assert.equal(normalizeSpacing(500), 200);
  assert.equal(normalizeSpacing(51), 52);
});
test('wider spacing increases connected-note clearance and can be reduced again', () => {
  const graph = compile('@a\n#to b\n@b').graph;
  const boxes = new Map([['a', {x:0,y:0,width:100,height:80}], ['b',{x:150,y:0,width:100,height:80}]]);
  const close = equilibrate(graph, boxes, undefined, 16);
  const wide = equilibrate(graph, boxes, undefined, 160);
  const distance = (positions: typeof close) => Math.hypot(positions.get('a')!.x-positions.get('b')!.x,positions.get('a')!.y-positions.get('b')!.y);
  assert.ok(distance(wide) > distance(close)+100);
  const seeds = new Map([...wide].map(([id,p]) => [id,{...boxes.get(id)!,...p}]));
  assert.ok(distance(equilibrate(graph,seeds,undefined,16)) < distance(wide)-80);
});
test('custom clearance prevents dense notes from overlapping and preserves the held note', () => {
  const graph = compile(Array.from({length:12},(_,i)=>`@n${i}`).join('\n')).graph;
  const boxes = new Map(graph.nodes.map(n=>[n.id,{x:0,y:0,width:100,height:80}]));
  const positions = equilibrate(graph,boxes,'n0',160);
  assert.deepEqual(positions.get('n0'),{x:0,y:0});
  const values=[...positions.values()];
  for (let i=0;i<values.length;i++) for (let j=i+1;j<values.length;j++) {
    const a=values[i],b=values[j];
    assert.ok(a.x+260<=b.x || b.x+260<=a.x || a.y+240<=b.y || b.y+240<=a.y);
  }
});
test('time columns and sibling lanes both respect the selected spacing', () => {
  const graph=compile('@a\n#to b\n#to c\n@b\n@c').graph;
  const sizes=new Map(graph.nodes.map(n=>[n.id,{width:100,height:80}]));
  const compact=temporalLayout(graph,sizes,16), wide=temporalLayout(graph,sizes,160);
  assert.ok(wide.get('b')!.x > compact.get('b')!.x+100);
  assert.ok(Math.abs(wide.get('b')!.y-wide.get('c')!.y)>=248);
});
test('new notes spawn with the chosen gap', () => {
  const existing=[{x:0,y:0,width:100,height:80}];
  const p=spawnPosition(existing,{width:100,height:80},()=>.5,existing,160);
  assert.ok(p.x+264<=0 || p.x>=264 || p.y+244<=0 || p.y>=244);
});
