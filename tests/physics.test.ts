import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../webserver/compiler.js';
import { equilibrate, neighbourhoods } from '../webserver/client/physics.js';
import { MIN_NODE_GAP } from '../webserver/client/layout.js';
const box = (x: number, y = 0) => ({ x, y, width: 100, height: 80 });
test('direct connections pull distant notes together more strongly than disjoint notes', () => {
  const boxes = new Map([['a', box(0)], ['b', box(800)]]);
  const connected = equilibrate(compile('@a\n#to b\n@b').graph, boxes);
  const disjoint = equilibrate(compile('@a\n@b').graph, boxes);
  assert.ok(connected.get('b')!.x - connected.get('a')!.x < disjoint.get('b')!.x - disjoint.get('a')!.x);
});
test('unrelated nearby notes repel, and a dragged note stays at the handoff position', () => {
  const graph = compile('@a\n@b').graph, boxes = new Map([['a', box(0)], ['b', box(150)]]);
  const result = equilibrate(graph, boxes, 'a');
  assert.deepEqual(result.get('a'), { x: 0, y: 0 }); assert.ok(result.get('b')!.x > 150);
});
test('relationships are undirected, self links do not add attraction', () => {
  const adjacent = neighbourhoods(compile('@a\n#from b\n#to a\n@b\n#use c\n@c').graph);
  assert.deepEqual([...adjacent.get('a')!], ['b']); assert.deepEqual([...adjacent.get('b')!], ['a', 'c']);
});
test('dense overlapping inputs settle to finite positions with readable clearance', () => {
  const graph = compile(Array.from({length: 18}, (_, i) => `@n${i}\n${i ? '#to n0' : ''}`).join('\n')).graph;
  const boxes = new Map(graph.nodes.map(n => [n.id, box(0)]));
  const positions = [...equilibrate(graph, boxes).values()];
  for (const a of positions) {
    assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y));
    for (const b of positions) if (a !== b) assert.ok(a.x + 100 + MIN_NODE_GAP <= b.x || b.x + 100 + MIN_NODE_GAP <= a.x ||
      a.y + 80 + MIN_NODE_GAP <= b.y || b.y + 80 + MIN_NODE_GAP <= a.y);
  }
});

test('distant connected notes settle to a short readable edge', () => {
  const graph=compile('@a\n#to b\n@b').graph;
  const p=equilibrate(graph,new Map([['a',box(0)],['b',box(800)]]));
  const gap=p.get('b')!.x-p.get('a')!.x-100;
  assert.ok(gap>=MIN_NODE_GAP && gap<90, `edge gap ${gap}`);
});
