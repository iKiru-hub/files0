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
  const r = compile('@a\n#border rectangle\n\\#literal\n\\@literal\n\\-- literal\n\\// literal\n@b\n#noborder\n@class c\n#border rounded');
  assert.deepEqual(r.diagnostics, []);
  assert.deepEqual(r.graph.nodes.map(n => n.border), ['rectangle', 'none', 'rounded']);
  assert.equal(r.graph.nodes[0].text, '#literal\n@literal\n-- literal\n// literal');
});
test('diagnostics identify duplicate names and unresolved references at source lines', () => {
  const r = compile('@a\n#to @missing\n@a\n#inherit @absent');
  assert.deepEqual(r.diagnostics.map(d => d.line), [2, 3, 4]);
});
test('malformed syntax does not silently drop user text', () => {
  const r = compile('orphan\n@bad name\n@ok\n#oops\n-- bad\n@class car\n--');
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
  const r = compile('@plain\nText\n@outlined\n#border\n@class Class\n-- value');
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
  const result = compile('@a\n#color 222C3A\n@class b\n#color ABCDEF\n@c\n#color 123456\n#noborder');
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.graph.nodes.map(n=>[n.color,n.border]), [['222c3a','rounded'],['abcdef','rectangle'],['123456','none']]);
  for(const color of ['12345','1234567','#222c3a','gggggg','red','']) {
    const result = compile('@a\n#color '+color);
    assert.equal(result.diagnostics[0].line,2); assert.equal(result.graph.nodes[0].color,undefined);
  }
});

test('attribute references resolve forward classes, keep direction and distinguish indices', () => {
  const r=compile('@a\n#to @car 1\n#to @car 2\n#to car 1\n#from @car 2\n@class car\n-- wheels\n-- doors');
  assert.deepEqual(r.diagnostics,[]); assert.equal(r.graph.edges.length,3);
  assert.deepEqual(r.graph.edges.map(e=>[e.source,e.target,e.sourceAttribute,e.targetAttribute]),[
    ['a','car',undefined,1],['a','car',undefined,2],['car','a',2,undefined]
  ]);
});
test('attribute references diagnose missing rows, non-classes and unsupported arrow kinds', () => {
  const r=compile('@a\n#to @car 0\n#to @car 2\n#from @plain 1\n#use @car 1\n@class car\n-- wheels\n@plain');
  assert.deepEqual(r.diagnostics.map(d=>d.line),[2,3,4,5]);
  assert.match(r.diagnostics[0].message,/numbered from 1/);
  assert.match(r.diagnostics[2].message,/must be a class/);
});

test('PNG notes accept relative paths, captions and outgoing edges', () => {
  const r=compile('@image "images/my sketch.png"\nA **caption**.\n#to idea\n@idea\n@image ../other.png');
  assert.deepEqual(r.diagnostics,[]);assert.equal(r.graph.nodes[0].imagePath,'images/my sketch.png');
  assert.equal(r.graph.nodes[0].kind,'image');assert.equal(r.graph.nodes[0].text,'A **caption**.');
  assert.equal(r.graph.edges[0].source,r.graph.nodes[0].id);
  for(const path of ['/tmp/a.png','https://example.com/a.png','a.jpg','C:\\a.png']) assert.equal(compile('@image '+path).diagnostics.length,1);
});

test('raw-source comments never become content, declarations, attributes or dependencies', () => {
  const source = '// @hidden\n@boxopen Group\nSubtitle\n  // hidden subtitle\n@class car\nVisible body.\n// -- hidden attribute\n-- wheels\n// #to missing\n@image sketch.png\nCaption.\n\t// hidden caption\n@boxclose Group\nFooter.\n// hidden footer';
  const r=compile(source);
  assert.deepEqual(r.diagnostics,[]);
  assert.deepEqual(r.graph.nodes.map(n=>n.kind),['class','image']);
  assert.equal(r.graph.nodes[0].line,5);
  assert.equal(r.graph.nodes[0].text,'Visible body.');
  assert.deepEqual(r.graph.nodes[0].attributes,['wheels']);
  assert.equal(r.graph.nodes[1].text,'Caption.');
  assert.deepEqual(r.graph.edges,[]);
  assert.equal(r.graph.groups![0].subtitle,'Subtitle');assert.equal(r.graph.groups![0].footer,'Footer.');
  assert.deepEqual(compile('// only a comment\n  // another').graph,{nodes:[],edges:[]});
});
test('escaped comment lines and URLs remain literal, and comments preserve diagnostic line numbers', () => {
  const r=compile('@a\n\\// visible\nhttps://example.com\n// hidden\n#to missing');
  assert.equal(r.graph.nodes[0].text,'// visible\nhttps://example.com');
  assert.equal(r.diagnostics[0].line,5);
});

test('space-separated class syntax accepts tabs, Unicode and bare attribute references',()=>{
  const r=compile('@classmate\n#to @車 2\n#from 車\t1\n@class\t 車\n-- wheels\n-- doors\n@class\nA plain note named class.');
  assert.deepEqual(r.diagnostics,[]);
  assert.deepEqual(r.graph.nodes.map(n=>[n.id,n.kind]),[['classmate','note'],['車','class'],['class','note']]);
  assert.equal(r.graph.edges[0].targetAttribute,2);
  assert.equal(r.graph.edges[1].sourceAttribute,1);
});
test('legacy class spellings share identities with space-separated syntax',()=>{
  const old=compile('@a\n#to @class::car::2\n#from car::1\n@class::car\n-- wheels\n-- doors');
  const modern=compile('@a\n#to @car 2\n#from car 1\n@class car\n-- wheels\n-- doors');
  assert.deepEqual(old,modern);
  const mixed=compile('@a\n#to car 1\n#to car::1\n@class car\n-- wheels');
  assert.deepEqual(mixed.diagnostics,[]);assert.equal(mixed.graph.edges.length,1);
});
test('invalid spaced class declarations and indices are diagnosed without swallowing text',()=>{
  for(const heading of ['@class two words','@class @car']) assert.ok(compile(heading).diagnostics.length);
  for(const suffix of ['-1','1.5','first','1 extra','9007199254740993']) {
    const result=compile(`@a\n#to @car ${suffix}\n@class car\n-- wheels`);
    assert.deepEqual(result.diagnostics.map(d=>d.line),[2]);
  }
  const r=compile('@a\n#inherit @car 1\n@class car\n-- wheels');
  assert.match(r.diagnostics[0].message,/only with #to and #from/);
});

test('two-ended attribute declarations resolve both directions and deduplicate equivalent spellings',()=>{
  const r=compile('@class source\n#from 1 #to @target 2\n-- one\n-- two\n@class target\n-- first\n-- second\n#from @source 1 #to 2\n#from @source 2 #to 1');
  assert.deepEqual(r.diagnostics,[]);assert.equal(r.graph.edges.length,2);
  assert.deepEqual(r.graph.edges.map(e=>[e.source,e.sourceAttribute,e.target,e.targetAttribute,e.kind]),[
    ['source',1,'target',2,'to'],['source',2,'target',1,'from']
  ]);
  const self=compile('@class self\n-- first\n-- second\n#from 1 #to @self 2');
  assert.deepEqual(self.diagnostics,[]);assert.equal(self.graph.edges[0].targetAttribute,2);
});
test('two-ended attributes validate both classes and both row indices at the directive line',()=>{
  const r=compile('@class a\n-- one\n#from 0 #to @b 3\n@class b\n-- first\n-- second');
  assert.deepEqual(r.diagnostics.map(d=>d.line),[3,3]);
  assert.match(r.diagnostics[0].message,/in “a”/);assert.match(r.diagnostics[1].message,/in “b”/);
  for(const declaration of ['#from 1 #to @b 1','#from @b 1 #to 1']) {
    const plain=compile(`@a\n${declaration}\n@b`);
    assert.equal(plain.diagnostics.length,2);
    assert.ok(plain.diagnostics.every(d=>d.line===2 && /must be a class/.test(d.message)));
  }
  const missing=compile('@class a\n-- first\n#from 1 #to @missing 1');
  assert.match(missing.diagnostics[0].message,/not defined/);
  for(const declaration of ['#from -1 #to @b 1','#from 1 #to @b','#from @b 1 #to','#from 1 #to @b 1 extra'])
    assert.match(compile(`@class a\n${declaration}\n-- first\n@class b\n-- first`).diagnostics[0].message,/Use #from 1/);
});

test('target-first attribute syntax preserves direction, row indices and edge identity',()=>{
  const prefix='@class a\n-- first\n-- second\n';
  const suffix='\n@class b\n-- one\n-- two\n-- three';
  const sourceFirst=compile(prefix+'#from 2 #to @b 3'+suffix);
  const targetFirst=compile(prefix+'#to @b 3 #from 2'+suffix);
  assert.deepEqual(targetFirst,sourceFirst);
  assert.deepEqual(targetFirst.diagnostics,[]);
  assert.deepEqual(compile(prefix+'#to\tb 3\t#from\t2'+suffix),sourceFirst);
  const mixed=compile(prefix+'#to @b 3 #from 2\n#from 2 #to @b 3'+suffix);
  assert.equal(mixed.graph.edges.length,1);
  for(const directive of ['#to @b 0 #from 2','#to @b 3 #from 0','#to @b 9 #from 2','#to @b 3 #from 9','#to @b 3 #from -1','#to @b 3 #from','#to @b #from 2','#to @b 3 #from 2 extra']) {
    const r=compile(prefix+directive+suffix);
    assert.ok(r.diagnostics.length,directive);assert.ok(r.diagnostics.every(d=>d.line===4));
  }
  const nonClass=compile('@a\n#to @b 1 #from 1\n@b');
  assert.equal(nonClass.diagnostics.length,2);
});

test('with connects whole notes without direction and deduplicates either declaration end',()=>{
  const r=compile('@a\n#with @b\n#with b\n#to b\n@b\n#with @a\n#with @b');
  assert.deepEqual(r.diagnostics,[]);
  assert.deepEqual(r.graph.edges.map(e=>[e.source,e.target,e.kind]),[['a','b','with'],['a','b','to'],['b','b','with']]);
  assert.equal(compile('@a\n#with missing').diagnostics[0].line,2);
  assert.match(compile('@a\n#with @b 1\n@class b\n-- value').diagnostics[0].message,/only with #to and #from/);
});
