import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../webserver/compiler.js';
import { routeEdges, hitsBox, intersects } from '../webserver/client/routing.js';
import type { Box } from '../webserver/client/layout.js';
const box = (x: number, y: number): Box => ({ x, y, width: 100, height: 60 });
test('horizontal edges bend around intervening notes', () => {
  const graph = compile('@a\n#to c\n@b\n@c').graph;
  const boxes = new Map([['a',box(0,0)],['b',box(200,0)],['c',box(400,0)]]);
  const route = routeEdges(graph,boxes).get(graph.edges[0].id)!;
  assert.ok(route); assert.ok(route.path.includes('Q'));
  for(let i=1;i<route.points.length;i++) assert.equal(hitsBox(route.points[i-1],route.points[i],boxes.get('b')!,8),false);
});
test('independent crossed chains take separate routes', () => {
  const graph = compile('@a\n#to d\n@b\n#to c\n@c\n@d').graph;
  const routes = [...routeEdges(graph,new Map([['a',box(0,0)],['b',box(0,200)],['c',box(400,0)],['d',box(400,200)]])).values()];
  assert.equal(routes.length,2);
  for(let i=1;i<routes[0].points.length;i++) for(let j=1;j<routes[1].points.length;j++)
    assert.equal(intersects(routes[0].points[i-1],routes[0].points[i],routes[1].points[j-1],routes[1].points[j]),false);
});
test('forks, reverse edges and self loops retain finite, distinct paths', () => {
  const graph = compile('@a\n#to b\n#use b\n#to a\n#to c\n@b\n#to a\n@c').graph;
  const routes = routeEdges(graph,new Map([['a',box(0,0)],['b',box(240,-100)],['c',box(240,100)]]));
  assert.equal(routes.size,graph.edges.length);
  assert.equal(new Set([...routes.values()].map(r=>r.path)).size,graph.edges.length);
  for(const route of routes.values()) assert.ok(route.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
});

test('clear horizontal and diagonal connections stay straight', () => {
  const graph = compile('@a\n#to b\n@b').graph;
  for (const y of [0, 180, -180]) {
    const route = [...routeEdges(graph,new Map([['a',box(0,0)],['b',box(400,y)]])).values()][0];
    assert.equal(route.points.length,2); assert.ok(!route.path.includes('Q'));
  }
});
test('diagonal obstacles and crossings are detected', () => {
  assert.equal(hitsBox({x:0,y:0},{x:400,y:400},box(180,180),8),true);
  assert.equal(hitsBox({x:0,y:0},{x:400,y:400},box(180,0),8),false);
  assert.equal(intersects({x:0,y:0},{x:400,y:400},{x:0,y:400},{x:400,y:0}),true);
  const graph = compile('@a\n#to c\n@b\n@c').graph;
  const route = [...routeEdges(graph,new Map([['a',box(0,0)],['b',box(200,200)],['c',box(400,400)]])).values()][0];
  assert.ok(route.points.length>2);
  for(let i=1;i<route.points.length;i++) assert.equal(hitsBox(route.points[i-1],route.points[i],box(200,200),8),false);
});

test('attribute arrows attach at measured class row centers, including self references', () => {
  const graph=compile('@a\n#to car 1\n#to car 2\n#from car 2\n@class car\n-- first\n-- second\n#to car 1').graph;
  const car={x:300,y:50,width:100,height:150,attributeCenters:[65,120]};
  const routes=routeEdges(graph,new Map([['a',box(0,0)],['car',car]]));
  assert.equal(routes.size,graph.edges.length);
  for(const edge of graph.edges) {
    const route=routes.get(edge.id)!;
    const tip=edge.sourceAttribute?route.points[0]:route.points.at(-1)!;
    const index=edge.sourceAttribute ?? edge.targetAttribute!;
    assert.equal(tip.y,car.y+car.attributeCenters[index-1]);
    assert.ok(tip.x<car.x || tip.x>car.x+car.width);
  }
});

test('an obstacle detour stays compact and advances toward its destination',()=>{
  const graph=compile('@a\n#to c\n@obstacle\n@c').graph;
  const boxes=new Map([['a',box(0,0)],['obstacle',box(200,0)],['c',box(400,0)]]);
  const route=routeEdges(graph,boxes).get(graph.edges[0].id)!;
  const length=route.points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-route.points[i].x,p.y-route.points[i].y),0);
  assert.ok(length<400,`detour length ${length}`);
  for(let i=1;i<route.points.length;i++) assert.ok(route.points[i].x>=route.points[i-1].x);
});

test('two-ended attribute routes keep exact row anchors, including self loops',()=>{
  const graph=compile('@class a\n-- first\n-- second\n#from 1 #to @b 2\n#from 2 #to @a 1\n@class b\n-- first\n-- second\n#from @a 2 #to 1').graph;
  const boxes=new Map([['a',{x:0,y:0,width:100,height:140,attributeCenters:[60,110]}],['b',{x:400,y:90,width:100,height:140,attributeCenters:[60,110]}]]);
  const routes=routeEdges(graph,boxes);assert.equal(routes.size,3);
  for(const edge of graph.edges) {
    const points=routes.get(edge.id)!.points,a=boxes.get(edge.source)!,b=boxes.get(edge.target)!;
    assert.equal(points[0].y,a.y+a.attributeCenters[edge.sourceAttribute!-1]);
    assert.equal(points.at(-1)!.y,b.y+b.attributeCenters[edge.targetAttribute!-1]);
  }
});
test('nearby parallel edges use separate corridors while keeping their row anchors',()=>{
  const graph=compile('@class a\n-- first\n-- second\n#from 1 #to @b 1\n#from 2 #to @b 2\n@class b\n-- first\n-- second').graph;
  const boxes=new Map([['a',{x:0,y:0,width:100,height:120,attributeCenters:[60,64]}],['b',{x:500,y:0,width:100,height:120,attributeCenters:[60,64]}]]);
  const routes=[...routeEdges(graph,boxes).values()];
  const centerY=(points:typeof routes[0]['points'])=>{
    const i=points.findIndex((p,j)=>j>0 && Math.min(points[j-1].x,p.x)<=300 && Math.max(points[j-1].x,p.x)>=300);
    const a=points[i-1],b=points[i];return a.y+(b.y-a.y)*(300-a.x)/(b.x-a.x);
  };
  assert.ok(Math.abs(centerY(routes[0].points)-centerY(routes[1].points))>=18);
});
test('edges avoid running close and parallel to container borders',()=>{
  const graph=compile('@a\n#to b\n@b').graph;
  const boxes=new Map([['a',box(0,0)],['b',box(500,0)]]);
  const frame={x:-40,y:25,width:680,height:200};
  const route=routeEdges(graph,boxes,[frame]).get(graph.edges[0].id)!;
  assert.ok(route.points.length>2);
  // The middle of the route should clear the frame's horizontal border.
  const segment=route.points.slice(1).map((p,i)=>[route.points[i],p]).find(([a,b])=>a.x<=300 && b.x>=300)!;
  const y=segment[0].y+(segment[1].y-segment[0].y)*(300-segment[0].x)/(segment[1].x-segment[0].x);
  assert.ok(Math.abs(y-frame.y)>=18);
});

test('with uses straight paths when clear and bends around obstacles',()=>{
  const graph=compile('@a\n#with c\n@c').graph;
  const boxes=new Map([['a',box(0,0)],['c',box(400,0)]]);
  assert.equal(routeEdges(graph,boxes).get(graph.edges[0].id)!.points.length,2);
  boxes.set('obstacle',box(200,0));
  const route=routeEdges(graph,boxes).get(graph.edges[0].id)!;
  assert.ok(route.points.length>2);
  for(let i=1;i<route.points.length;i++) assert.equal(hitsBox(route.points[i-1],route.points[i],boxes.get('obstacle')!,8),false);
});
