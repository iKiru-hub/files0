import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../webserver/compiler.js';
import { temporalLayout } from '../webserver/client/temporal.js';
function positions(source: string) {
  const graph = compile(source).graph;
  return temporalLayout(graph, new Map(graph.nodes.map(n => [n.id, { width: 100, height: 80 }])));
}
test('chains run left to right on the same line, including reversed from declarations', () => {
  const p = positions('@a\n#to b\n@b\n@c\n#from b\n#to d\n@d');
  assert.deepEqual(['a','b','c','d'].map(id => p.get(id)!.x), [0,180,360,540]);
  assert.equal(new Set([...p.values()].map(p => p.y)).size, 1);
});
test('forks co-occur and continue on separate parallel lines', () => {
  const p = positions('@a\n#to b\n#to c\n@b\n#to d\n@c\n#to e\n@d\n@e');
  assert.equal(p.get('b')!.x, p.get('c')!.x); assert.notEqual(p.get('b')!.y, p.get('c')!.y);
  assert.equal(p.get('b')!.y, p.get('d')!.y); assert.equal(p.get('c')!.y, p.get('e')!.y);
});
test('a later disconnected head aligns with the preceding note’s temporal position', () => {
  const p = positions('@a\n#to b\n@b\n#to c\n@x\n#to y\n@c\n@y');
  assert.equal(p.get('x')!.x, p.get('b')!.x); assert.equal(p.get('y')!.x, p.get('c')!.x);
  assert.notEqual(p.get('x')!.y, p.get('b')!.y);
});
test('use and inheritance do not advance time; cycles share a column safely', () => {
  const p = positions('@a\n#use b\n@b\n#inherit c\n@c');
  assert.equal(new Set([...p.values()].map(p => p.x)).size, 1);
  const cycle = positions('@a\n#to b\n@b\n#to a\n#to c\n@c');
  assert.equal(cycle.get('a')!.x, cycle.get('b')!.x); assert.ok(cycle.get('c')!.x > cycle.get('b')!.x);
  assert.notEqual(cycle.get('a')!.y, cycle.get('b')!.y);
});


test('independent notes and chains sit just beyond normal co-occurring lane spacing', () => {
  const p = positions('@a\n#to b\n#to c\n@b\n@c\n@solo\n@x\n#to y\n@y');
  const siblingSpacing = Math.abs(p.get('c')!.y - p.get('b')!.y);
  assert.ok(siblingSpacing > 0);
  assert.equal(p.get('solo')!.y - Math.max(p.get('b')!.y, p.get('c')!.y), siblingSpacing + 16);
  assert.equal(p.get('x')!.y - p.get('solo')!.y, siblingSpacing + 16);
  assert.equal(p.get('x')!.y, p.get('y')!.y);
});


test('new siblings alternate above and below, keeping their parent centered', () => {
  for (let count = 1; count <= 6; count++) {
    const ids = Array.from({length:count}, (_,i)=>'child'+i);
    const p = positions('@parent\n'+ids.map(id=>'@'+id+'\n#from parent').join('\n'));
    const ys = ids.map(id=>p.get(id)!.y);
    assert.equal(p.get('parent')!.y, (Math.min(...ys)+Math.max(...ys))/2);
    if(count>1) {
      const latest=ys.at(-1)!;
      assert.equal(latest, count%2===0 ? Math.min(...ys) : Math.max(...ys));
    }
  }
});

test('a tall independent note does not stretch the lanes of other components', () => {
  const graph=compile('@a\n#to b\n#to c\n@b\n@c\n@tall').graph;
  const sizes=new Map(graph.nodes.map(n=>[n.id,{width:100,height:n.id==='tall'?600:80}]));
  const p=temporalLayout(graph,sizes);
  assert.equal(Math.abs(p.get('b')!.y-p.get('c')!.y),136);
  const bottom=Math.max(...['a','b','c'].map(id=>p.get(id)!.y+80));
  assert.ok(p.get('tall')!.y-bottom>=48);
});

test('competing fork families stay contiguous even with interleaved declarations', () => {
  const graph=compile('@root\n#to p\n#to q\n@p\n@q\n@a\n#from p\n@x\n#from q\n@b\n#from p\n@y\n#from q\n@c\n#from p\n@z\n#from q').graph;
  const sizes=new Map(graph.nodes.map(n=>[n.id,{width:100,height:n.id==='b'?180:80}]));
  const p=temporalLayout(graph,sizes);
  const column=['a','b','c','x','y','z'].sort((a,b)=>p.get(a)!.y-p.get(b)!.y);
  const families=column.map(id=>'abc'.includes(id)?'p':'q');
  assert.ok(families.join('')==='pppqqq' || families.join('')==='qqqppp');
  for(const ids of [['a','b','c'],['x','y','z']]) {
    ids.sort((a,b)=>p.get(a)!.y-p.get(b)!.y);
    assert.equal(new Set(ids.map(id=>p.get(id)!.x)).size,1);
    for(let i=1;i<ids.length;i++) assert.equal(p.get(ids[i])!.y-p.get(ids[i-1])!.y-sizes.get(ids[i-1])!.height,56);
  }
});

test('a tall note elsewhere in the same timeline does not stretch a sibling list', () => {
  const graph=compile('@root\n#to a\n#to b\n#to c\n@a\n#to tall\n@b\n@c\n@tall').graph;
  const sizes=new Map(graph.nodes.map(n=>[n.id,{width:100,height:n.id==='tall'?700:80}]));
  const p=temporalLayout(graph,sizes), ids=['a','b','c'].sort((a,b)=>p.get(a)!.y-p.get(b)!.y);
  assert.equal(p.get(ids[1])!.y-p.get(ids[0])!.y,136);
  assert.equal(p.get(ids[2])!.y-p.get(ids[1])!.y,136);
});
