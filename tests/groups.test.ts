import {arrangeGroups} from '../webserver/client/group-layout.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compile} from '../webserver/compiler.js';
import {groupBounds} from '../webserver/client/groups.js';
test('named boxes include nested and intersecting sets and keep their captions separate',()=>{
  const r=compile('@boxopen A\nSubtitle\n@a\nNote A\n@boxopen B\n@b\n@boxclose A\nAfter A\n@c\n@boxclose B\nAfter B');
  assert.deepEqual(r.diagnostics,[]);
  assert.deepEqual(r.graph.groups!.map(g=>[g.id,g.members,g.subtitle,g.footer]),[['A',['a','b'],'Subtitle','After A'],['B',['b','c'],'','After B']]);
  assert.equal(r.graph.nodes[0].text,'Note A');
  const nested=compile('@boxopen outer\n@a\n@boxopen inner\n@b\n@boxclose inner\n@boxclose outer');
  assert.deepEqual(nested.diagnostics,[]);assert.deepEqual(nested.graph.groups!.map(g=>g.members),[['a','b'],['b']]);
});
test('invalid box boundaries produce source diagnostics',()=>{
  for(const text of ['@boxclose absent','@boxopen empty\n@boxclose empty','@boxopen open\n@a','@boxopen A\n@a\n@boxopen A\n@boxclose A']) assert.ok(compile(text).diagnostics.length);
});
test('nested enclosures reserve label space and intersecting groups retain separate bounds',()=>{
  const graph=compile('@boxopen outer\n@a\n@boxopen inner\n@b\n@boxclose inner\nFooter\n@boxclose outer').graph;
  const nodes=new Map([['a',{x:0,y:0,width:100,height:60}],['b',{x:200,y:100,width:100,height:80}]]);
  const bounds=groupBounds(graph.groups!,nodes,new Map([['inner',{header:50,footer:40}]]));
  const outer=bounds.get('outer')!.frame,inner=bounds.get('inner')!.outer;
  assert.ok(outer.x<inner.x && outer.y<inner.y && outer.x+outer.width>inner.x+inner.width && outer.y+outer.height>inner.y+inner.height);
  const overlapping=compile('@boxopen A\n@a\n@boxopen B\n@b\n@boxclose A\n@c\n@boxclose B').graph;
  nodes.set('c',{x:400,y:0,width:100,height:60});
  const overlap=groupBounds(overlapping.groups!,nodes,new Map()),a=overlap.get('A')!.frame,b=overlap.get('B')!.frame;
  assert.ok(a.x<b.x && a.x+a.width>b.x && a.x+a.width<b.x+b.width);
});

test('disjoint boxes separate as units and keep a held note fixed',()=>{
  const graph=compile('@boxopen A\n@a\n@b\n@boxclose A\n@boxopen B\n@c\n@d\n@boxclose B').graph;
  const sizes=new Map(graph.nodes.map(n=>[n.id,{width:100,height:60}]));
  const initial=new Map([['a',{x:0,y:0}],['b',{x:200,y:200}],['c',{x:200,y:0}],['d',{x:0,y:200}]]);
  const p=arrangeGroups(graph,sizes,initial,'a');
  assert.deepEqual(p.get('a'),initial.get('a'));
  const bounds=groupBounds(graph.groups!,new Map([...p].map(([id,pos])=>[id,{...pos,...sizes.get(id)!}])),new Map());
  const a=bounds.get('A')!.outer,b=bounds.get('B')!.outer;
  assert.ok(a.x+a.width<=b.x || b.x+b.width<=a.x || a.y+a.height<=b.y || b.y+b.height<=a.y);
});
test('temporal boxes compact vertically without changing time columns',()=>{
  const graph=compile('@boxopen A\n@a\n@b\n@boxclose A\n@outside').graph;
  const sizes=new Map(graph.nodes.map(n=>[n.id,{width:100,height:60}]));
  const initial=new Map([['a',{x:0,y:0}],['b',{x:200,y:1000}],['outside',{x:0,y:500}]]);
  const p=arrangeGroups(graph,sizes,initial,undefined,true);
  for(const [id,pos] of p) assert.equal(pos.x,initial.get(id)!.x);
  assert.ok(Math.abs(p.get('a')!.y-p.get('b')!.y)<150);
});
test('explicitly intersecting boxes retain shared membership',()=>{
  const graph=compile('@boxopen A\n@a\n@boxopen B\n@b\n@boxclose A\n@c\n@boxclose B').graph;
  const sizes=new Map(graph.nodes.map(n=>[n.id,{width:100,height:60}]));
  const p=arrangeGroups(graph,sizes,new Map([['a',{x:0,y:0}],['b',{x:200,y:0}],['c',{x:400,y:0}]]));
  const bounds=groupBounds(graph.groups!,new Map([...p].map(([id,pos])=>[id,{...pos,...sizes.get(id)!}])),new Map());
  const a=bounds.get('A')!.frame,b=bounds.get('B')!.frame;
  assert.ok(a.x+a.width>b.x && b.x+b.width>a.x);
  assert.equal(p.size,3);
});

test('temporal box compaction preserves sibling order and parallel chain alignment',()=>{
  const graph=compile('@boxopen A\n@a\n#to b\n@b\n@c\n#to d\n@d\n@boxclose A').graph;
  // Simulate geometry carrying stale x/y as renderer particles do.
  const sizes=new Map(graph.nodes.map(n=>[n.id,{width:100,height:60,x:-900,y:-900}]));
  const initial=new Map([['a',{x:0,y:0}],['b',{x:200,y:0}],['c',{x:0,y:500}],['d',{x:200,y:500}]]);
  const p=arrangeGroups(graph,sizes,initial,undefined,true);
  assert.equal(p.get('a')!.y,p.get('b')!.y);
  assert.equal(p.get('c')!.y,p.get('d')!.y);
  assert.ok(p.get('a')!.y<p.get('c')!.y);
  assert.equal(p.get('c')!.y-p.get('a')!.y,108);
  for(const [id,pos] of p) assert.equal(pos.x,initial.get(id)!.x);
});
