import { EventEmitter } from 'node:events';
import { watch, type FSWatcher, constants } from 'node:fs';
import { open, readdir, readFile, realpath, mkdir, writeFile, rename } from 'node:fs/promises';
import { basename, join, dirname, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { compile, type DocumentSnapshot } from './compiler.js';

const MAX_BYTES = 1024 * 1024;
export const validName = (name: string) => name === basename(name) && !name.startsWith('.') &&
  !/[\\/\x00-\x1f]/.test(name) && /\.(txt|graph)$/.test(name);

/** Watch the directory, not an inode: editors often save by replacing the file. */
export class DocumentStore extends EventEmitter {
  documents = new Map<string, DocumentSnapshot>();
  width = 100;
  private watcher?: FSWatcher;
  private poll?: ReturnType<typeof setInterval>;
  private debounce?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private again = false;
  private hidden = new Set<string>();
  private linked = new Map<string, string>();
  private linkedWatchers = new Map<string, FSWatcher>();
  private registration: Promise<string> = Promise.resolve('');
  constructor(readonly directory: string, readonly config: string, readonly registry?: string) { super(); }
  async start() {
    await readdir(this.directory); // Fail early for a misspelled --dir.
    if (this.registry) {
      try {
        const saved = JSON.parse(await readFile(this.registry, 'utf8'));
        const paths: unknown = Array.isArray(saved) ? saved : saved.links;
        const hidden: unknown = Array.isArray(saved) ? [] : saved.hidden;
        if (!Array.isArray(hidden) || hidden.some(name => typeof name !== 'string' || !validName(name))) throw new Error('Invalid saved file library.');
        this.hidden = new Set(hidden);
        if (!Array.isArray(paths) || paths.some(p => typeof p !== 'string' || !isAbsolute(p))) throw new Error('Invalid saved file library.');
        for (const path of paths as string[]) this.linked.set(this.linkId(path), path);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    for (const path of this.linked.values()) this.watchLinked(path);
    await this.refresh();
    try { this.watcher = watch(this.directory, () => this.schedule()); this.watcher.on('error', () => {}); } catch { /* Polling remains available. */ }
    this.poll = setInterval(() => void this.refresh(), 1000);
  }
  private linkId(path: string) { return `linked-${createHash('sha256').update(path).digest('hex').slice(0, 24)}.graph`; }
  private watchLinked(path: string) {
    const folder = dirname(path);
    if (this.linkedWatchers.has(folder) || folder === this.directory) return;
    try {
      const watcher = watch(folder, () => this.schedule());
      watcher.on('error', () => {}); this.linkedWatchers.set(folder, watcher);
    } catch { /* Polling also follows missing/recreated parent directories. */ }
  }
  addPath(raw: string): Promise<string> {
    const next = this.registration.catch(() => '').then(() => this.register(raw));
    this.registration = next; return next;
  }
  private async saveLibrary(links = this.linked, hidden = this.hidden) {
    if (!this.registry) throw new Error('A saved library is not configured.');
    await mkdir(dirname(this.registry), { recursive: true });
    const temporary = `${this.registry}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify({ links: [...links.values()], hidden: [...hidden] }, null, 2) + '\n', { mode: 0o600 });
    await rename(temporary, this.registry);
  }
  remove(name: string): Promise<string> {
    const next = this.registration.catch(() => '').then(async () => {
      if (!validName(name)) throw new Error('Invalid file name.');
      const links = new Map(this.linked), hidden = new Set(this.hidden);
      if (!links.delete(name)) hidden.add(name);
      await this.saveLibrary(links, hidden);
      this.linked = links; this.hidden = hidden;
      for (const [folder, watcher] of this.linkedWatchers) {
        if (![...links.values()].some(path => dirname(path) === folder)) { watcher.close(); this.linkedWatchers.delete(folder); }
      }
      if (this.running) await this.running;
      await this.refresh(); return name;
    });
    this.registration = next; return next;
  }
  private async register(raw: string): Promise<string> {
    if (!this.registry) throw new Error('A saved library is not configured.');
    if (!isAbsolute(raw)) throw new Error('Enter the full absolute path to your file.');
    const path = await realpath(raw);
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile()) throw new Error('Choose a regular text file.');
      if (stat.size > MAX_BYTES) throw new Error('This file exceeds the 1 MB limit.');
      const bytes = await file.readFile();
      if (bytes.includes(0)) throw new Error('Choose a UTF-8 text file, not a binary file.');
      try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { throw new Error('Choose a UTF-8 text file.'); }
    } finally { await file.close(); }
    if (dirname(path) === this.directory && validName(basename(path))) {
      const hidden = new Set(this.hidden); hidden.delete(basename(path));
      await this.saveLibrary(this.linked, hidden); this.hidden = hidden;
      if (this.running) await this.running;
      await this.refresh(); return basename(path);
    }
    const id = this.linkId(path);
    if (!this.linked.has(id)) {
      const links = new Map(this.linked); links.set(id, path);
      await this.saveLibrary(links);
      this.linked.set(id, path); this.watchLinked(path);
    }
    // Wait out any scan already in flight before publishing the newly linked file.
    if (this.running) await this.running;
    await this.refresh();
    return id;
  }
  private schedule() {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.refresh(), 90);
  }
  refresh(): Promise<void> {
    if (this.running) { this.again = true; return this.running; }
    this.running = (async () => {
      do { this.again = false; await this.scan(); } while (this.again);
    })().finally(() => { this.running = undefined; });
    return this.running;
  }
  private async scan() {
    let width = 100;
    try {
      const config = await readFile(this.config, 'utf8');
      const value = /^\s*note_width:\s*(\d+)(?:px)?\s*(?:#.*)?$/m.exec(config);
      if (value) width = Math.max(80, Math.min(480, Number(value[1])));
    } catch { /* Original 100px width is the fallback. */ }
    this.width = width;
    let localNames: string[];
    try { localNames = (await readdir(this.directory, { withFileTypes: true })).filter(e => e.isFile() && validName(e.name)).map(e => e.name); }
    catch { localNames = [...this.documents.keys()].filter(name => !this.linked.has(name)); }
    // External links keep updating even if the default folder is temporarily absent.
    const names = [...new Set([...localNames.filter(name => !this.hidden.has(name)), ...this.linked.keys()])].sort();
    const next = new Map<string, DocumentSnapshot>();
    for (const name of names) {
      let source = '', problem = '';
      const filePath = this.linked.get(name) || join(this.directory, name);
      try {
        const file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const stat = await file.stat();
          if (!stat.isFile()) throw new Error('Not a regular file.');
          if (stat.size > MAX_BYTES) throw new Error('This file exceeds the 1 MB limit. Split it into smaller graphs.');
          source = await file.readFile('utf8');
        } finally { await file.close(); }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !this.linked.has(name)) { const old = this.documents.get(name); if (old) next.set(name, old); continue; }
        problem = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'Linked file is missing. Restore it at its original path to resume live updates.' : error instanceof Error ? error.message : 'Could not read this file.';
      }
      const revision = createHash('sha256').update(source + '\0' + width + '\0' + problem).digest('hex').slice(0, 16);
      const old = this.documents.get(name);
      if (old?.revision === revision) { next.set(name, old); continue; }
      const compiled = compile(source);
      if (problem) compiled.diagnostics.push({ line: 0, message: problem });
      next.set(name, { name, path: filePath, displayName: basename(filePath), source, width, revision, ...compiled });
    }
    const changed = [...next].filter(([name, doc]) => this.documents.get(name)?.revision !== doc.revision).map(([name]) => name);
    const removed = [...this.documents.keys()].filter(name => !next.has(name));
    const listChanged = removed.length > 0 || [...next.keys()].some(name => !this.documents.has(name));
    this.documents = next;
    if (listChanged || changed.length) this.emit('change', { changed, removed, listChanged });
  }
  list() {
    return [...this.documents.values()].map(doc => ({ name: doc.name, displayName: doc.displayName, path: doc.path, linked: this.linked.has(doc.name), nodes: doc.graph.nodes.length,
      edges: doc.graph.edges.length, errors: doc.diagnostics.length }));
  }
  close() { this.watcher?.close(); for (const watcher of this.linkedWatchers.values()) watcher.close(); clearInterval(this.poll); clearTimeout(this.debounce); }
}
