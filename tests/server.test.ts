import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rename, unlink, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createApp } from '../webserver/server.js';
import { DocumentStore, validName } from '../webserver/store.js';

test('store sees atomic saves, additions, deletions and live width changes', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'files0-store-')), config = join(dir, 'constants.yaml');
  await writeFile(join(dir, 'a.txt'), '@a\nhello'); await writeFile(config, 'note_width: 140px');
  const store = new DocumentStore(dir, config); await store.start();
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  assert.equal(store.documents.get('a.txt')?.width, 140);
  const change = once(store, 'change');
  await writeFile(join(dir, '.save-temp'), '@a\nchanged\n#to b\n@b');
  await rename(join(dir, '.save-temp'), join(dir, 'a.txt'));
  await Promise.race([change, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Save did not trigger a live update')), 3500); timer.unref(); })]);
  assert.equal(store.documents.get('a.txt')?.graph.nodes.length, 2);
  await writeFile(join(dir, 'new.graph'), '@new'); await store.refresh(); assert.equal(store.list().length, 2);
  await writeFile(config, 'note_width: 180px'); await store.refresh(); assert.equal(store.documents.get('a.txt')?.width, 180);
  await unlink(join(dir, 'a.txt')); await store.refresh(); assert.equal(store.documents.has('a.txt'), false);
});
test('store ignores editor artifacts and symlinks, limits oversized files', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'files0-safe-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, '.hidden.txt'), '@hidden'); await writeFile(join(dir, 'a.txt~'), '@backup');
  await writeFile(join(dir, 'big.txt'), 'x'.repeat(1024 * 1024 + 1));
  await symlink('/etc/hosts', join(dir, 'link.txt'));
  const store = new DocumentStore(dir, join(dir, 'missing')); await store.refresh();
  assert.equal(store.list().length, 1); assert.match(store.documents.get('big.txt')!.diagnostics[0].message, /1 MB/);
  for (const name of ['../secret.txt', '.secret.txt', 'x\\secret.txt', 'file.txt\0', 'file.txt~']) assert.equal(validName(name), false);
});
test('HTTP API serves compiled files and SSE delivers filesystem changes', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'files0-http-')); await writeFile(join(dir, 'a.txt'), '@a');
  const { app, store } = await createApp(dir, join(dir, 'missing'));
  const server = createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const abort = new AbortController();
  t.after(async () => { abort.abort(); store.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(dir, { recursive: true, force: true }); });
  const response = await fetch(`${base}/api/document?file=a.txt`); assert.equal(response.status, 200);
  assert.equal((await response.json()).graph.nodes[0].id, 'a');
  assert.equal((await fetch(`${base}/api/document?file=..%2Fsecret.txt`)).status, 400);
  assert.equal((await fetch(`${base}/api/document?file=missing.txt`)).status, 404);
  const stream = await fetch(`${base}/api/events`, { signal: abort.signal });
  const reader = stream.body!.getReader(), decoder = new TextDecoder();
  assert.match(decoder.decode((await reader.read()).value), /event: ready/);
  await writeFile(join(dir, 'a.txt'), '@a\n#to b\n@b');
  const result = await Promise.race([reader.read(), new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error('SSE update timed out')), 4000); timer.unref(); })]);
  assert.match(decoder.decode(result.value), /"changed":\["a.txt"\]/);
  await reader.cancel();
});

test('linked external files survive restart, duplicate names, atomic saves and missing files', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'files0-library-'));
  const external = await mkdtemp(join(tmpdir(), 'files0-external-'));
  const registry = join(dir, 'library.json'), config = join(dir, 'config.yaml');
  const file = join(external, 'notes.md');
  await writeFile(file, '@external\nFrom another folder.');
  let store = new DocumentStore(dir, config, registry); await store.start();
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); await rm(external, { recursive: true, force: true }); });
  const id = await store.addPath(file);
  assert.equal(await store.addPath(file), id); assert.equal(store.list().length, 1);
  assert.equal(store.documents.get(id)?.displayName, 'notes.md');
  assert.equal(store.documents.get(id)?.graph.nodes[0].id, 'external');
  store.close(); store = new DocumentStore(dir, config, registry); await store.start();
  assert.ok(store.documents.has(id));
  await writeFile(join(external, '.atomic'), '@updated'); await rename(join(external, '.atomic'), file);
  await store.refresh(); assert.equal(store.documents.get(id)?.graph.nodes[0].id, 'updated');
  await unlink(file); await store.refresh(); assert.match(store.documents.get(id)!.diagnostics[0].message, /missing/);
  await writeFile(file, '@restored'); await store.refresh(); assert.deepEqual(store.documents.get(id)?.diagnostics, []);
  await writeFile(join(dir, 'notes.md'), '@separate');
  const second = await store.addPath(join(dir, 'notes.md')); assert.notEqual(id, second);
  await writeFile(join(external, 'bad.bin'), Buffer.from([0, 1, 2]));
  await assert.rejects(store.addPath(join(external, 'bad.bin')), /binary/);
});


test('library removal persists for local and linked files without deleting sources; add restores them', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'files0-remove-'));
  const external = await mkdtemp(join(tmpdir(), 'files0-remove-external-'));
  const local = join(dir, 'a.txt'), linked = join(external, 'b.txt'), registry = join(dir, '.library.json');
  await writeFile(local, '@local'); await writeFile(linked, '@external');
  // Original array-format libraries remain readable and migrate on mutation.
  await writeFile(registry, JSON.stringify([linked]));
  let store = new DocumentStore(dir, join(dir,'config'), registry); await store.start();
  t.after(async () => { store.close(); await rm(dir,{recursive:true,force:true}); await rm(external,{recursive:true,force:true}); });
  const id = store.list().find(f=>f.linked)!.name;
  await Promise.all([store.remove('a.txt'), store.remove(id)]);
  assert.equal(store.list().length,0);
  assert.equal(await readFile(local,'utf8'),'@local'); assert.equal(await readFile(linked,'utf8'),'@external');
  store.close(); store = new DocumentStore(dir,join(dir,'config'),registry); await store.start();
  await writeFile(local,'@changed'); await store.refresh(); assert.equal(store.list().length,0);
  await store.addPath(local); await store.addPath(linked); assert.equal(store.list().length,2);
});
