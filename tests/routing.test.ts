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
