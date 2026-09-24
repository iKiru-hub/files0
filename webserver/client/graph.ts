import { renderInlineMath } from './math.js';
import { routeEdges, roundedPath, type Route } from './routing.js';
import { temporalLayout } from './temporal.js';
import { equilibrate } from './physics.js';
import type { Graph, Note } from '../compiler.js';
import { layout, edgePath, spawnPosition, type Box } from './layout.js';
interface Particle extends Box { element: HTMLElement; tx: number; ty: number; vx: number; vy: number; held: boolean }
const ns = 'http://www.w3.org/2000/svg';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

export class GraphView {
  private nodes = new Map<string, Particle>();
  private graph: Graph = { nodes: [], edges: [] };
  private paths: SVGPathElement[] = [];
  private bends = new Map<string, number>();
  private frame = 0;
  private steps = 0;
  private scale = 1;
  private offset = { x: 0, y: 0 };
  private key = '';
  private temporal = false;
  private focusId?: string;
  private routes = new Map<string, Route>();
  private routeBoxes = new Map<string, Box>();
  private pointer?: { id: number; node?: Particle; x: number; y: number; startX: number; startY: number };
  constructor(private viewport: HTMLElement, private world: HTMLElement, private container: HTMLElement, private edges: SVGGElement, private onZoom: (scale: number) => void) {
    try { const zoom = Number(localStorage.getItem('files0:zoom')); if (zoom >= .08 && zoom <= 3) this.scale = zoom; } catch {}
    this.transform();
    document.fonts.addEventListener('loadingdone', () => { if (this.nodes.size) this.resizeText(); });
    viewport.addEventListener('wheel', event => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      this.zoom(Math.exp(-event.deltaY * .002), event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });
    viewport.addEventListener('pointerdown', event => {
      if (event.button !== 0 || this.pointer) return;
      this.focusId = undefined;
      const element = (event.target as HTMLElement).closest<HTMLElement>('.node');
      const node = element ? this.nodes.get(element.dataset.id!) : undefined;
      if (node) { node.held = true; node.element.classList.add('dragging'); node.element.focus({ preventScroll: true }); }
      this.pointer = { id: event.pointerId, node, x: event.clientX, y: event.clientY, startX: node?.x ?? this.offset.x, startY: node?.y ?? this.offset.y };
      viewport.setPointerCapture(event.pointerId); viewport.classList.add('panning');
    });
    viewport.addEventListener('pointermove', event => {
      const p = this.pointer;
      if (!p || p.id !== event.pointerId) return;
      if (p.node) {
        p.node.x = p.node.tx = p.startX + (event.clientX - p.x) / this.scale;
        p.node.y = p.node.ty = p.startY + (event.clientY - p.y) / this.scale;
        p.node.vx = p.node.vy = 0; this.paint();
      } else { this.offset = { x: p.startX + event.clientX - p.x, y: p.startY + event.clientY - p.y }; this.transform(); }
    });
    const release = () => {
      if (this.pointer?.node) { this.pointer.node.held = false; this.pointer.node.element.classList.remove('dragging'); this.reconfigure(this.pointer.node.element.dataset.id); this.settle(); }
      this.pointer = undefined; viewport.classList.remove('panning');
    };
    viewport.addEventListener('pointerup', release); viewport.addEventListener('pointercancel', release); viewport.addEventListener('lostpointercapture', release);
    viewport.addEventListener('keydown', event => {
      const element = (event.target as HTMLElement).closest<HTMLElement>('.node');
      const node = element && this.nodes.get(element.dataset.id!);
      if (node && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault(); this.focusId = undefined; const distance = event.shiftKey ? 30 : 10;
        node.x = node.tx += event.key === 'ArrowLeft' ? -distance : event.key === 'ArrowRight' ? distance : 0;
        node.y = node.ty += event.key === 'ArrowUp' ? -distance : event.key === 'ArrowDown' ? distance : 0;
        this.reconfigure(element!.dataset.id); this.settle();
      }
    });
    new ResizeObserver(() => { if (this.focusId && this.viewport.clientWidth) this.settle(); }).observe(viewport);
  }
  clear() { this.focusId = undefined; this.routes.clear(); this.routeBoxes.clear(); cancelAnimationFrame(this.frame); this.frame = 0; this.nodes.clear(); this.container.replaceChildren(); this.edges.replaceChildren(); this.graph = { nodes: [], edges: [] }; this.paths = []; }
  update(graph: Graph, width: number, key: string) {
    const changedFile = key !== this.key;
    if (changedFile) { this.clear(); this.key = key; }
    const oldOrder = this.graph.nodes.map(n => n.id).join('|');
    const oldEdges = this.graph.edges.map(e => e.id).join('|');
    const oldSizes = new Map([...this.nodes].map(([id,n]) => [id, `${n.width}:${n.height}`]));
    this.graph = graph;
    const saved = this.saved();
    const keep = new Set(graph.nodes.map(n => n.id));
    for (const [id, node] of this.nodes) if (!keep.has(id)) { node.element.remove(); this.nodes.delete(id); }
    const first = this.nodes.size === 0;
    const fresh: string[] = [];
    for (const note of graph.nodes) {
      let node = this.nodes.get(note.id);
      if (!node) {
        const element = document.createElement('article'); element.dataset.id = note.id; element.tabIndex = 0;
        element.setAttribute('aria-roledescription', 'graph note');
        node = { element, x: 0, y: 0, tx: 0, ty: 0, vx: 0, vy: 0, width, height: 70, held: false };
        this.nodes.set(note.id, node); this.container.append(element); fresh.push(note.id);
      }
      this.renderNote(node.element, note, width);
      node.width = width; node.height = node.element.offsetHeight;
    }
    // Use current dimensions and one shared pre-insertion center for the batch.
    const existing = [...this.nodes].filter(([id]) => !fresh.includes(id)).map(([, { x, y, width, height }]) => ({ x, y, width, height }));
    const positions = layout(graph, this.nodes);
    const occupied = [...existing];
    for (const id of fresh) {
      const node = this.nodes.get(id)!;
      const previous = first && Object.hasOwn(saved, id) ? saved[id] : undefined;
      const pos = previous || (first ? positions.get(id)! : spawnPosition(occupied, node, Math.random, existing));
      node.tx = pos.x; node.ty = pos.y; node.x = pos.x;
      node.y = pos.y - (first && !reducedMotion.matches ? 26 : 0);
      node.vy = !first && !reducedMotion.matches ? .9 : 0;
      occupied.push({ ...pos, width: node.width, height: node.height });
      node.element.classList.add('entering');
    }
    this.edges.replaceChildren();
    this.bends.clear();
    const pairs = new Map<string, Graph['edges']>();
    for (const edge of graph.edges) {
      const pair = [edge.source, edge.target].sort().join(':');
      pairs.set(pair, [...(pairs.get(pair) || []), edge]);
    }
    for (const edges of pairs.values()) if (edges.length > 1) edges.forEach((edge, i) => {
      this.bends.set(edge.id, 60 * (i - (edges.length - 1) / 2) * (edge.source > edge.target ? -1 : 1));
    });
    this.paths = graph.edges.map(edge => {
      const path = document.createElementNS(ns, 'path'); path.classList.add(edge.kind);
      path.dataset.source = edge.source; path.dataset.target = edge.target;
      path.setAttribute('marker-end', `url(#${edge.kind === 'inherit' ? 'diamond' : edge.kind === 'use' ? 'triangle' : 'arrow'})`);
      const title = document.createElementNS(ns, 'title'); title.textContent = `${edge.source} → ${edge.target}${edge.kind === 'inherit' ? ' (inheritance)' : edge.kind === 'use' ? ' (uses)' : ''}`;
      path.append(title); this.edges.append(path); return path;
    });
    const layoutChanged = oldOrder !== graph.nodes.map(n => n.id).join('|') || fresh.length || oldSizes.size !== this.nodes.size || oldEdges !== graph.edges.map(e => e.id).join('|') ||
      [...this.nodes].some(([id,n]) => oldSizes.get(id) !== `${n.width}:${n.height}`);
    if (layoutChanged) this.reconfigure();
    if (fresh.length) this.focusId = fresh[fresh.length - 1];
    else if (this.focusId && !this.nodes.has(this.focusId)) this.focusId = graph.nodes.at(-1)?.id;
    if (first) this.followCamera(true);
    this.paint(); this.settle();
  }
  private reconfigure(held?: string) {
    const positions = this.temporal ? temporalLayout(this.graph, this.nodes) : equilibrate(this.graph, this.nodes, held);
    for (const [id, p] of positions) { const node = this.nodes.get(id)!; node.tx = p.x; node.ty = p.y; }
    this.rebuildRoutes();
  }
  setTemporal(enabled: boolean) {
    if (enabled === this.temporal) return;
    this.persist(); this.temporal = enabled;
    this.viewport.dataset.mode = enabled ? 'temporal' : 'spatial';
    if (enabled) this.reconfigure();
    else {
      const saved = this.saved();
      const seeds = new Map([...this.nodes].map(([id, node]) => [id, { ...node, ...(Object.hasOwn(saved, id) ? saved[id] : {}) }]));
      const fallback = equilibrate(this.graph, seeds);
      for (const [id, node] of this.nodes) {
        const p = Object.hasOwn(saved, id) ? saved[id] : fallback.get(id)!;
        node.tx = p.x; node.ty = p.y;
      }
    }
    for (const node of this.nodes.values()) node.vx = node.vy = 0;
    if (!enabled) this.rebuildRoutes();
    this.focusId = this.graph.nodes.at(-1)?.id; this.settle();
  }
  private rebuildRoutes() {
    this.routeBoxes = new Map([...this.nodes].map(([id, n]) => [id, { x:n.tx, y:n.ty, width:n.width, height:n.height }]));
    this.routes = routeEdges(this.graph, this.routeBoxes);
  }
  private followCamera(immediate = false): boolean {
    const node = this.focusId && this.nodes.get(this.focusId);
    if (!node || !this.viewport.clientWidth) return false;
    const x = this.viewport.clientWidth * 2 / 3 - (node.x + node.width / 2) * this.scale;
    const y = this.viewport.clientHeight / 2 - (node.y + node.height / 2) * this.scale;
    const snap = immediate || reducedMotion.matches || this.steps > 160 || Math.abs(x-this.offset.x)+Math.abs(y-this.offset.y)<.15;
    this.offset.x = snap ? x : this.offset.x + (x-this.offset.x)*.13;
    this.offset.y = snap ? y : this.offset.y + (y-this.offset.y)*.13;
    this.transform(); return !snap;
  }
  private renderNote(element: HTMLElement, note: Note, width: number) {
    element.className = `node ${note.kind} ${note.border}`;
    element.classList.toggle('colored', !!note.color);
    if (note.color) element.style.setProperty('--note-color', `#${note.color}`);
    else element.style.removeProperty('--note-color');
    element.style.setProperty('--note-width', `${width}px`);
    const relationships = this.graph.edges.filter(e => e.source === note.id).map(e => `${e.kind === 'inherit' ? 'parent of' : e.kind === 'use' ? 'uses' : 'points to'} ${e.target}`).join(', ');
    element.setAttribute('aria-label', `${note.kind} ${note.id}. ${note.text} ${note.attributes.join(', ')}${relationships ? '. ' + relationships : ''}. Use arrow keys to move.`);
    element.title = `@${note.kind === 'class' ? 'class::' : ''}${note.id} · line ${note.line}`;
    const title = document.createElement('div'); title.className = 'node-title'; title.textContent = note.id.replaceAll('_', ' ');
    element.replaceChildren(title);
    if (note.text) { const body = document.createElement('div'); body.className = 'node-body'; renderInlineMath(body, note.text); element.append(body); }
    for (const attribute of note.attributes) {
      const row = document.createElement('div'); row.className = 'attribute';
      const plus = document.createElement('span'); plus.textContent = '+';
      const text = document.createElement('span'); renderInlineMath(text, attribute); row.append(plus, text); element.append(row);
    }
  }
  private settle() {
    cancelAnimationFrame(this.frame); this.steps = 0;
    const tick = () => {
      let moving = false;
      for (const node of this.nodes.values()) {
        if (node.held) continue;
        node.vx = (node.vx + (node.tx - node.x) * .065) * .60;
        node.vy = (node.vy + (node.ty - node.y) * .065) * .60;
        if (reducedMotion.matches || this.steps > 110 || Math.abs(node.tx - node.x) + Math.abs(node.ty - node.y) + Math.abs(node.vx) + Math.abs(node.vy) < .04) {
          node.x = node.tx; node.y = node.ty; node.vx = node.vy = 0;
        } else { node.x += node.vx; node.y += node.vy; moving = true; }
      }
      const cameraMoving = this.followCamera();
      moving = moving || cameraMoving;
      this.paint(); this.steps++;
      if (moving) this.frame = requestAnimationFrame(tick);
      else { this.frame = 0; this.persist(); }
    };
    tick();
  }
  private paint() {
    for (const node of this.nodes.values()) node.element.style.transform = `translate(${node.x}px,${node.y}px)`;
    this.graph.edges.forEach((edge, i) => {
      const a = this.nodes.get(edge.source), b = this.nodes.get(edge.target);
      if (!a || !b) return;
      const route = this.routes.get(edge.id), origin = this.routeBoxes.get(edge.source), destination = this.routeBoxes.get(edge.target);
      if (route && origin && destination) {
        // Interpolate bends with their endpoints while notes settle. Routing is
        // computed once per layout change, never once per animation frame.
        const lengths = route.points.map((p, j) => j ? Math.hypot(p.x-route.points[j-1].x,p.y-route.points[j-1].y) : 0);
        const total = lengths.reduce((sum, n) => sum+n, 0) || 1;
        let traversed = 0;
        const points = route.points.map((p, j) => {
          traversed += lengths[j]; const t = traversed/total;
          return { x:p.x+(a.x-origin.x)*(1-t)+(b.x-destination.x)*t,
            y:p.y+(a.y-origin.y)*(1-t)+(b.y-destination.y)*t };
        });
        this.paths[i]?.setAttribute('d', roundedPath(points));
        this.paths[i]?.setAttribute('data-routing', 'obstacle-aware');
      } else {
        this.paths[i]?.setAttribute('d', edgePath(a, b, edge.source === edge.target, this.bends.get(edge.id) || 0));
        this.paths[i]?.setAttribute('data-routing', 'fallback');
      }
    });
  }
  resizeText() {
    let changed = false;
    for (const node of this.nodes.values()) { const height = node.element.offsetHeight; if (height !== node.height) changed = true; node.height = height; }
    if (changed) { this.reconfigure(); this.settle(); }
  }
  fit(clearPreference = false) {
    this.focusId = undefined;
    if (clearPreference) { try { localStorage.removeItem('files0:zoom'); } catch {} }
    if (!this.nodes.size) { this.scale = 1; this.offset = { x: 0, y: 0 }; this.transform(); return; }
    const nodes = [...this.nodes.values()];
    const bends = [...this.routes.values()].flatMap(route => route.points);
    const minX = Math.min(...nodes.map(n => n.tx), ...bends.map(p => p.x)), minY = Math.min(...nodes.map(n => n.ty), ...bends.map(p => p.y));
    const maxX = Math.max(...nodes.map(n => n.tx + n.width), ...bends.map(p => p.x)) + (this.graph.edges.some(e => e.source === e.target) ? 70 : 0);
    const maxY = Math.max(...nodes.map(n => n.ty + n.height), ...bends.map(p => p.y));
    const width = this.viewport.clientWidth, height = this.viewport.clientHeight;
    this.scale = Math.max(.08, Math.min(1.5, (width - 130) / (maxX - minX), (height - 190) / (maxY - minY)));
    try {
      const preferred = Number(localStorage.getItem('files0:zoom'));
      if (preferred >= .08 && preferred <= 3) this.scale = preferred;
    } catch {}
    this.offset = { x: width / 2 - (minX + maxX) / 2 * this.scale, y: height / 2 - (minY + maxY) / 2 * this.scale - 10 };
    this.transform();
  }
  zoom(factor: number, x = this.viewport.clientWidth / 2, y = this.viewport.clientHeight / 2) {
    this.focusId = undefined;
    const scale = Math.max(.08, Math.min(3, this.scale * factor));
    this.offset.x = x - (x - this.offset.x) * scale / this.scale;
    this.offset.y = y - (y - this.offset.y) * scale / this.scale;
    this.scale = scale; this.transform();
    try { localStorage.setItem('files0:zoom', String(scale)); } catch {}
  }
  pan(dx: number, dy: number) {
    this.focusId = undefined;
    // Move the camera in screen pixels; the canvas moves in the opposite direction.
    this.offset.x -= dx; this.offset.y -= dy; this.transform();
  }
  resetZoom() { this.zoom(1 / this.scale); }
  private transform() { this.world.style.transform = `translate(${this.offset.x}px,${this.offset.y}px) scale(${this.scale})`; this.onZoom(this.scale); }
  private saved(): Record<string, { x: number; y: number }> {
    try {
      const value = JSON.parse(localStorage.getItem(`files0:positions:${this.key}${this.temporal ? ":temporal" : ""}`) || '{}');
      const result: Record<string, { x: number; y: number }> = Object.create(null);
      for (const [id, p] of Object.entries(value)) {
        if (p && typeof p === 'object' && 'x' in p && 'y' in p && typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y)) result[id] = { x: p.x, y: p.y };
      }
      return result;
    } catch { return {}; }
  }
  private persist() {
    try { localStorage.setItem(`files0:positions:${this.key}${this.temporal ? ":temporal" : ""}`, JSON.stringify(Object.fromEntries([...this.nodes].map(([id, n]) => [id, { x: n.tx, y: n.ty }])))); } catch { /* Storage is optional. */ }
  }
}
