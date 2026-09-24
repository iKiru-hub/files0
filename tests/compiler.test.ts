import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compile } from '../webserver/compiler.js';
import { layout, edgePath, spawnPosition, SPAWN_RADIUS, MIN_NODE_GAP } from '../webserver/client/layout.js';

test('the original example compiles unchanged, including bare references', async () => {
  const result = compile(await readFile(new URL('./fixtures/original.txt', import.meta.url), 'utf8'));
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.graph.nodes.length, 4);
  assert.equal(result.graph.nodes[1].border, 'rectangle');
  assert.deepEqual(result.graph.nodes[1].attributes, ['wheels', 'steering wheel']);
  assert.deepEqual(result.graph.edges.map(e => [e.source, e.target, e.kind]), [['vehicle', 'car', 'inherit'], ['descr1', 'car', 'to']]);
});
test('forward references, unicode, CRLF, BOM, blank lines and comments', () => {
  const r = compile('\uFEFF// comment\r\n@café\r\nfirst\r\n\r\nsecond\r\n#to @終点\r\n@終点\r\n#border none');
  assert.deepEqual(r.diagnostics, []); assert.equal(r.graph.nodes[0].text, 'first\n\nsecond');
  assert.equal(r.graph.nodes[1].border, 'none');
});
test('borders and literal reserved characters', () => {
  const r = compile('@a\n#border rectangle\n\\#literal\n\\@literal\n\\-- literal\n\\// literal\n@b\n#noborder\n@class::c\n#border rounded');
  assert.deepEqual(r.diagnostics, []);
  assert.deepEqual(r.graph.nodes.map(n => n.border), ['rectangle', 'none', 'rounded']);
  assert.equal(r.graph.nodes[0].text, '#literal\n@literal\n-- literal\n// literal');
});
test('diagnostics identify duplicate names and unresolved references at source lines', () => {
  const r = compile('@a\n#to @missing\n@a\n#inherit @absent');
  assert.deepEqual(r.diagnostics.map(d => d.line), [2, 3, 4]);
});
test('malformed syntax does not silently drop user text', () => {
  const r = compile('orphan\n@bad name\n@ok\n#oops\n-- bad\n@class::car\n--');
  assert.deepEqual(r.diagnostics.map(d => d.line), [1, 2, 4, 5, 7]);
});
test('cycles, self references and duplicate connections are valid', () => {
  const r = compile('@a\n#to @b\n#to b\n#to @a\n@b\n#to @a');
  assert.deepEqual(r.diagnostics, []); assert.equal(r.graph.edges.length, 3);
});
test('empty files compile and HTML stays literal text', () => {
  assert.deepEqual(compile('').graph, { nodes: [], edges: [] });
  assert.equal(compile('@a\n<script>alert(1)</script>').graph.nodes[0].text, '<script>alert(1)</script>');
});
test('layout handles cycles, disconnected nodes, tall notes and dependencies without overlap', () => {
  const graph = compile('@a\n#to b\n@b\n#to a\n#to c\n@c\n@lonely').graph;
  const sizes = new Map(graph.nodes.map(n => [n.id, { width: 100, height: n.id === 'a' ? 270 : 80 }]));
  const positions = layout(graph, sizes);
  assert.equal(positions.size, 4); assert.ok(positions.get('c')!.x > positions.get('b')!.x);
  for (const [id, a] of positions) for (const [other, b] of positions) {
    if (id === other) continue;
    assert.ok(a.x + 100 <= b.x || b.x + 100 <= a.x || a.y + sizes.get(id)!.height <= b.y || b.y + sizes.get(other)!.height <= a.y);
  }
});
test('edges end outside the destination and self-loops have a visible curve', () => {
  const a = { x: 0, y: 0, width: 100, height: 80 }, b = { ...a, x: 300 };
  assert.match(edgePath(a, b, false), /293 40$/); assert.match(edgePath(a, a, true), /C 170/);
});

test('new note centers spawn within a disk around the mean of existing note centers', () => {
  const existing = [{ x: 100, y: 200, width: 100, height: 80 }, { x: 500, y: -100, width: 200, height: 120 }];
  const center = { x: 375, y: 100 }, size = { width: 100, height: 60 };
  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const points = Array.from({ length: 500 }, () => spawnPosition(existing, size, random));
  for (const p of points) assert.ok(Math.hypot(p.x + size.width / 2 - center.x, p.y + size.height / 2 - center.y) <= SPAWN_RADIUS);
  // Both directions are populated; placement isn't biased toward a neighbour or rank.
  assert.ok(points.some(p => p.x + size.width / 2 < center.x - 100));
  assert.ok(points.some(p => p.x + size.width / 2 > center.x + 100));
});


test('plain notes default to no border, explicit borders and class defaults remain available', () => {
  const r = compile('@plain\nText\n@outlined\n#border\n@class::Class\n-- value');
  assert.deepEqual(r.diagnostics, []);
  assert.deepEqual(r.graph.nodes.map(n => n.border), ['none', 'rounded', 'rectangle']);
});

test('from reverses direction and use preserves direction with its own arrow type', () => {
  const r = compile('@a\n#from @b\n#use @b\n@b');
  assert.deepEqual(r.diagnostics, []);
  assert.deepEqual(r.graph.edges.map(e => [e.source, e.target, e.kind]), [['b', 'a', 'from'], ['a', 'b', 'use']]);
  assert.deepEqual(compile('@a\n#from @missing\n#use @absent').diagnostics.map(d => d.line), [2, 3]);
});

test('crowded and simultaneous insertions always keep a minimum edge-to-edge gap', () => {
  const anchors = [{ x: -300, y: -300, width: 600, height: 600 }];
  const occupied = [...anchors];
  for (let i = 0; i < 40; i++) {
    const size = { width: 100, height: i % 2 ? 210 : 70 };
    // A constant random source also exercises rejection fallback deterministically.
    const p = spawnPosition(occupied, size, () => .5, anchors);
    for (const box of occupied) assert.ok(p.x + size.width + MIN_NODE_GAP <= box.x ||
      box.x + box.width + MIN_NODE_GAP <= p.x || p.y + size.height + MIN_NODE_GAP <= box.y || box.y + box.height + MIN_NODE_GAP <= p.y);
    occupied.push({ ...p, ...size });
  }
});

test('six-digit colors enable borders and preserve shape; later border directives override', () => {
  const result = compile('@a\n#color 222C3A\n@class::b\n#color ABCDEF\n@c\n#color 123456\n#noborder');
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.graph.nodes.map(n=>[n.color,n.border]), [['222c3a','rounded'],['abcdef','rectangle'],['123456','none']]);
  for(const color of ['12345','1234567','#222c3a','gggggg','red','']) {
    const result = compile('@a\n#color '+color);
    assert.equal(result.diagnostics[0].line,2); assert.equal(result.graph.nodes[0].color,undefined);
  }
});
