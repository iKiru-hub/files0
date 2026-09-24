import express from 'express';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { DocumentStore, validName } from './store.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
export async function createApp(directory = resolve(root, 'vsfiles'), config = resolve(root, 'notes/constants.yaml'), registry = resolve(directory, '.files0-library.json')) {
  const store = new DocumentStore(await import('node:fs/promises').then(fs => fs.realpath(directory)), config, registry);
  await store.start();
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.use('/api', (req, res, next) => {
    const host = req.get('host') || '';
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) { res.status(403).json({ error: 'Local access only.' }); return; }
    if (req.method !== 'GET' && (req.get('X-Files0-Request') !== '1' || (req.get('origin') && req.get('origin') !== `http://${host}`))) {
      res.status(403).json({ error: 'Add files from the local files0 page.' }); return;
    }
    next();
  });
  app.post('/api/library', async (req, res) => {
    if (typeof req.body?.path !== 'string') { res.status(400).json({ error: 'Enter a file path.' }); return; }
    try { res.json({ name: await store.addPath(req.body.path.trim()) }); }
    catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  app.delete('/api/library', async (req, res) => {
    if (typeof req.body?.name !== 'string' || !validName(req.body.name)) { res.status(400).json({ error: 'Choose a file from the library.' }); return; }
    try { await store.remove(req.body.name); res.json({ removed: true }); }
    catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  let picking = false;
  app.post('/api/library/pick', async (_req, res) => {
    if (process.platform !== 'darwin') { res.status(400).json({ error: 'Paste the full file path below on this platform.' }); return; }
    if (picking) { res.status(409).json({ error: 'A file chooser is already open.' }); return; }
    picking = true;
    try {
      const { stdout } = await promisify(execFile)('/usr/bin/osascript', ['-e', 'POSIX path of (choose file with prompt "Link a text file to files0")'], { timeout: 120000 });
      res.json({ name: await store.addPath(stdout.trim()) });
    } catch (error) {
      const message = (error as Error).message;
      if (message.includes('-128')) res.json({ cancelled: true });
      else res.status(400).json({ error: 'Could not open the file chooser. Paste the full file path below instead.' });
    } finally { picking = false; }
  });
  app.get('/api/files', (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ files: store.list(), directory: store.directory, nativePicker: process.platform === 'darwin' }); });
  app.get('/api/document', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const name = req.query.file;
    if (typeof name !== 'string' || !validName(name)) { res.status(400).json({ error: 'Choose a .txt or .graph file from the watched directory.' }); return; }
    const document = store.documents.get(name);
    if (!document) { res.status(404).json({ error: 'This file is no longer in the watched directory.' }); return; }
    res.json(document);
  });
  app.get('/api/events', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write('event: ready\ndata: {}\n\n');
    const update = (data: unknown) => res.write(`event: change\ndata: ${JSON.stringify(data)}\n\n`);
    store.on('change', update);
    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15000);
    req.on('close', () => { clearInterval(heartbeat); store.off('change', update); });
  });
  app.use(express.static(resolve(root, 'dist/public')));
  return { app, store };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const arg = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
  if (args.includes('--help')) {
    console.log('files0 — plain text, quietly connected\n\n  npm start -- [--dir ./vsfiles] [--port 3000]\n\nOpen http://127.0.0.1:3000 and edit a .txt or .graph file in Neovim.');
  } else {
    try {
      const port = Number(arg('--port') || process.env.PORT || 3000);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be a number between 1 and 65535.');
      const { app, store } = await createApp(resolve(arg('--dir') || process.env.VSFILES_DIR || resolve(root, 'vsfiles')), resolve(root, 'notes/constants.yaml'), resolve(root, '.files0/library.json'));
      const server = createServer(app);
      server.on('error', error => { console.error(`files0: ${error.message}`); store.close(); process.exitCode = 1; });
      server.listen(port, '127.0.0.1', () => console.log(`\n  files0  →  http://127.0.0.1:${port}\n  watching ${store.directory}\n  Edit · save · see. Ctrl+C to stop.\n`));
      const stop = () => { store.close(); server.close(); server.closeAllConnections(); };
      process.on('SIGINT', stop); process.on('SIGTERM', stop);
    } catch (error) { console.error(`files0: ${(error as Error).message}`); process.exitCode = 1; }
  }
}
