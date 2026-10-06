import { arrangeGroups } from './group-layout.js';
import { groupBounds } from './groups.js';
import { renderInlineMath } from './math.js';
import { routeEdges, roundedPath, type Route } from './routing.js';
import { temporalLayout } from './temporal.js';
import { equilibrate } from './physics.js';
import { DEFAULT_NOTE_SPACING, normalizeSpacing } from './spacing.js';
import type { Graph, Note } from '../compiler.js';
import { layout, edgePath, spawnPosition, type Box } from './layout.js';
interface Particle extends Box { element: HTMLElement; tx: number; ty: number; vx: number; vy: number; held: boolean }
const ns = 'http://www.w3.org/2000/svg';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

export class GraphView {
  private groupLayer = document.createElement('div');
  private groupElements = new Map<string, HTMLElement>();
  private groupLabels = new Map<string, {header:number;footer:number;headerWidth:number;footerWidth:number}>();
  private routeProgress = new Map<string, number[]>();
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
  private spacing = DEFAULT_NOTE_SPACING;
  private focusId?: string;
  private routes = new Map<string, Route>();
  private routeBoxes = new Map<string, Box>();
  private pointer?: { id: number; node?: Particle; x: number; y: number; startX: number; startY: number; resize?: number };
  constructor(private viewport: HTMLElement, private world: HTMLElement, private container: HTMLElement, private edges: SVGGElement, private onZoom: (scale: number) => void) {
    this.groupLayer.id = 'groups'; this.world.prepend(this.groupLayer);
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
      this.pointer = { id: event.pointerId, node, x: event.clientX, y: event.clientY, startX: node?.x ?? this.offset.x, startY: node?.y ?? this.offset.y, resize: node && (event.target as HTMLElement).closest('.image-resize') ? node.width - node.element.clientLeft*2 : undefined };
      viewport.setPointerCapture(event.pointerId); viewport.classList.add('panning');
    });
    viewport.addEventListener('pointermove', event => {
      const p = this.pointer;
      if (!p || p.id !== event.pointerId) return;
      if (p.node && p.resize !== undefined) {
        const img = p.node.element.querySelector('img')!;
        const ratio = img.naturalWidth / img.naturalHeight || 1;
        const delta = ((event.clientX-p.x) + (event.clientY-p.y)/ratio) / (1+1/(ratio*ratio)) / this.scale;
        this.sizeImage(p.node.element, img, Math.max(80, Math.min(1920, (p.resize+delta)/Math.max(1,ratio))), true);
        p.node.width=p.node.element.offsetWidth; p.node.height=p.node.element.offsetHeight;
        this.rebuildRoutes(); this.paint();
      } else if (p.node) {
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
  clear() { this.groupLabels.clear(); this.routeProgress.clear(); this.groupElements.clear(); this.groupLayer.replaceChildren(); this.focusId = undefined; this.routes.clear(); this.routeBoxes.clear(); cancelAnimationFrame(this.frame); this.frame = 0; this.nodes.clear(); this.container.replaceChildren(); this.edges.replaceChildren(); this.graph = { nodes: [], edges: [] }; this.paths = []; }
  update(graph: Graph, width: number, key: string) {
    const changedFile = key !== this.key;
    if (changedFile) { this.clear(); this.key = key; }
    const oldGroups = JSON.stringify(this.graph.groups);
    const oldOrder = this.graph.nodes.map(n => n.id).join('|');
    const oldEdges = this.graph.edges.map(e => e.id).join('|');
    const oldSizes = new Map([...this.nodes].map(([id,n]) => [id, `${n.width}:${n.height}:${n.attributeCenters}`]));
    this.graph = graph; this.renderGroups();
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
      node.width = node.element.offsetWidth; node.height = node.element.offsetHeight; node.attributeCenters = this.measureAttributes(node.element);
    }
    // Use current dimensions and one shared pre-insertion center for the batch.
    const existing = [...this.nodes].filter(([id]) => !fresh.includes(id)).map(([, { x, y, width, height }]) => ({ x, y, width, height }));
    const positions = layout(graph, this.nodes);
    const occupied = [...existing];
    for (const id of fresh) {
      const node = this.nodes.get(id)!;
      const previous = first && Object.hasOwn(saved, id) ? saved[id] : undefined;
      const pos = previous || (first ? positions.get(id)! : spawnPosition(occupied, node, Math.random, existing, this.spacing));
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
      if (edge.sourceAttribute) path.dataset.sourceAttribute = String(edge.sourceAttribute);
      if (edge.targetAttribute) path.dataset.targetAttribute = String(edge.targetAttribute);
      if (edge.kind !== 'with') path.setAttribute('marker-end', `url(#${edge.kind === 'inherit' ? 'diamond' : edge.kind === 'use' ? 'triangle' : 'arrow'})`);
      const title = document.createElementNS(ns, 'title'); title.textContent = `${edge.source}${edge.sourceAttribute ? ` ${edge.sourceAttribute}` : ''} ${edge.kind === 'with' ? '—' : '→'} ${edge.target}${edge.targetAttribute ? ` ${edge.targetAttribute}` : ''}${edge.kind === 'inherit' ? ' (inheritance)' : edge.kind === 'use' ? ' (uses)' : ''}`;
      path.append(title); this.edges.append(path); return path;
    });
    const layoutChanged = oldGroups !== JSON.stringify(graph.groups) || oldOrder !== graph.nodes.map(n => n.id).join('|') || fresh.length || oldSizes.size !== this.nodes.size || oldEdges !== graph.edges.map(e => e.id).join('|') ||
      [...this.nodes].some(([id,n]) => oldSizes.get(id) !== `${n.width}:${n.height}:${n.attributeCenters}`);
    if (layoutChanged) this.reconfigure();
    if (fresh.length) this.focusId = fresh[fresh.length - 1];
    else if (this.focusId && !this.nodes.has(this.focusId)) this.focusId = graph.nodes.at(-1)?.id;
    if (first) this.followCamera(true);
    this.paint(); this.settle();
  }
  setSpacing(value: number) {
    const next = normalizeSpacing(value);
    if (next === this.spacing) return;
    const previous = this.spacing;
    this.spacing = next;
    this.focusId = undefined;
    if (!this.nodes.size) return;
    // Scale centers gently to make unrelated notes respond too. The solver
    // then enforces rectangle clearance, box membership, and arrow constraints.
    const nodes = [...this.nodes.values()];
    const center = nodes.reduce((p,n) => ({x:p.x+(n.tx+n.width/2)/nodes.length,
      y:p.y+(n.ty+n.height/2)/nodes.length}), {x:0,y:0});
    const size = nodes.reduce((sum,n) => sum+(n.width+n.height)/2/nodes.length,0);
    const ratio = (size+next)/(size+previous);
    const seeds = new Map([...this.nodes].map(([id,n]) => [id,{...n,
      x:center.x+(n.tx+n.width/2-center.x)*ratio-n.width/2,
      y:center.y+(n.ty+n.height/2-center.y)*ratio-n.height/2}]));
    this.reconfigure(undefined, seeds);
    this.settle();
  }
  private reconfigure(held?: string, boxes: Map<string, Box> = this.nodes) {
    const rawPositions = this.temporal ? temporalLayout(this.graph, boxes, this.spacing) : equilibrate(this.graph, boxes, held, this.spacing);
    const positions=arrangeGroups(this.graph,boxes,rawPositions,held,this.temporal,this.groupLabels,this.spacing);
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
      const fallback = equilibrate(this.graph, seeds, undefined, this.spacing);
      for (const [id, node] of this.nodes) {
        const p = fallback.get(id)!;
        node.tx = p.x; node.ty = p.y;
      }
    }
    for (const node of this.nodes.values()) node.vx = node.vy = 0;
    if (!enabled) this.rebuildRoutes();
    this.focusId = this.graph.nodes.at(-1)?.id; this.settle();
  }
  private rebuildRoutes() {
    this.routeBoxes = new Map([...this.nodes].map(([id, n]) => [id, { x:n.tx, y:n.ty, width:n.width, height:n.height, attributeCenters:n.attributeCenters }]));
    this.routes = routeEdges(this.graph, this.routeBoxes, [...groupBounds(this.graph.groups||[],this.routeBoxes,this.groupLabels).values()].map(b=>b.frame));
    this.routeProgress.clear();
    for (const [id,route] of this.routes) {
      let total=0;
      const cumulative=route.points.map((p,i)=>total+=i?Math.hypot(p.x-route.points[i-1].x,p.y-route.points[i-1].y):0);
      this.routeProgress.set(id,cumulative.map(n=>n/(total||1)));
    }
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
  private sizeImage(element: HTMLElement, img: HTMLImageElement, shortSide: number, save: boolean) {
    const ratio = img.naturalWidth / img.naturalHeight || 1;
    element.style.setProperty('--note-width', `${shortSide*Math.max(1,ratio)+element.clientLeft*2}px`);
    if (save) { try { localStorage.setItem(element.dataset.imageSizeKey!, String(shortSide)); } catch {} }
  }
  private renderGroups() {
    this.groupElements.clear(); this.groupLayer.replaceChildren();
    // Larger sets paint first, keeping inner outlines crisp.
    for (const group of [...(this.graph.groups || [])].sort((a,b)=>b.members.length-a.members.length || a.line-b.line)) {
      const element=document.createElement('section'); element.className='graph-box'; element.dataset.box=group.id;
      element.setAttribute('aria-label', `Box ${group.id.replaceAll('_',' ')}: ${group.members.length} notes`);
      const header=document.createElement('div'); header.className='box-header';
      const title=document.createElement('div'); title.className='box-title'; title.textContent=group.id.replaceAll('_',' '); header.append(title);
      if(group.subtitle) {const subtitle=document.createElement('div');subtitle.className='box-subtitle';renderInlineMath(subtitle,group.subtitle);header.append(subtitle);}
      const footer=document.createElement('div');footer.className='box-footer';renderInlineMath(footer,group.footer);
      element.append(header,footer);this.groupLayer.append(element);this.groupElements.set(group.id,element);
    }
    this.measureGroups();
  }
  private measureGroups() {
    // Captions have intrinsic widths capped in CSS, independent of their frame.
    // Measure after content/font changes, never inside an animation frame.
    this.groupLabels=new Map([...this.groupElements].map(([id,el])=>{
      const header=el.firstElementChild as HTMLElement,footer=el.lastElementChild as HTMLElement;
      return [id,{header:header.offsetHeight+10,footer:footer.textContent?footer.offsetHeight+10:0,
        headerWidth:header.offsetWidth,footerWidth:footer.offsetWidth}];
    }));
  }
  private paintGroups(targets = false) {
    const boxes=new Map([...this.nodes].map(([id,n])=>[id,{x:targets?n.tx:n.x,y:targets?n.ty:n.y,width:n.width,height:n.height}]));
    const bounds=groupBounds(this.graph.groups||[],boxes,this.groupLabels);
    // When overlapping sets put two captions on the same line, give each
    // label its own horizontal space and extend its enclosure to match.
    const occupied: Box[] = [];
    for (const [id,el] of this.groupElements) {
      const b=bounds.get(id); if(!b) continue;
      for(const [label,isHeader] of [[el.firstElementChild,true],[el.lastElementChild,false]] as const) {
        const text=label as HTMLElement; if(!text.textContent) continue;
        const size=this.groupLabels.get(id)!;
        const width=isHeader?size.headerWidth:size.footerWidth,height=(isHeader?size.header:size.footer)-10;
        const y=isHeader?b.frame.y-10-height:b.frame.y+b.frame.height+10;
        let x=b.frame.x;
        for(let step=0;step<occupied.length+1;step++) {
          const collision=occupied.find(o=>x<o.x+o.width+10 && x+width+10>o.x && y<o.y+o.height+4 && y+height+4>o.y);
          if(!collision) break; x=collision.x+collision.width+12;
        }
        text.style.left=`${x-b.frame.x}px`;
        b.frame.width=Math.max(b.frame.width,x-b.frame.x+width);
        b.outer.width=b.frame.width;
        occupied.push({x,y,width,height});
      }
    }
    for (const parent of [...(this.graph.groups||[])].sort((a,b)=>a.members.length-b.members.length || b.line-a.line)) {
      const p=bounds.get(parent.id); if(!p) continue;
      for (const child of this.graph.groups||[]) {
        const nested=child!==parent && child.members.every(id=>parent.members.includes(id)) &&
          (parent.members.length>child.members.length || (parent.line<child.line && (parent.endLine||Infinity)>(child.endLine||Infinity)));
        const c=bounds.get(child.id);
        if(nested && c) p.frame.width=Math.max(p.frame.width,c.outer.x+c.outer.width+36-p.frame.x);
      }
      p.outer.width=p.frame.width;
    }
    for(const [id,b] of bounds) {
      const el=this.groupElements.get(id)!;
      el.style.width=`${b.frame.width}px`;el.style.height=`${b.frame.height}px`;
      el.style.transform=`translate(${b.frame.x}px,${b.frame.y}px)`;
    }
    return bounds;
  }
  private measureAttributes(element: HTMLElement): number[] {
    return [...element.querySelectorAll<HTMLElement>('.attribute')].map(row => row.offsetTop + row.offsetHeight / 2 + element.clientTop);
  }
  private renderNote(element: HTMLElement, note: Note, width: number) {
    element.className = `node ${note.kind} ${note.border}`;
    element.classList.toggle('colored', !!note.color);
    if (note.color) element.style.setProperty('--note-color', `#${note.color}`);
    else element.style.removeProperty('--note-color');
    element.style.setProperty('--note-width', `${width}px`);
    const relationships = this.graph.edges.filter(e => e.source === note.id || (e.kind === 'with' && e.target === note.id)).map(e => e.kind === 'with' ? `connected to ${e.source === note.id ? e.target : e.source}` : `${e.kind === 'inherit' ? 'parent of' : e.kind === 'use' ? 'uses' : 'points to'} ${e.target}`).join(', ');
    element.setAttribute('aria-label', `${note.kind} ${note.id}. ${note.text} ${note.attributes.join(', ')}${relationships ? '. ' + relationships : ''}. Use arrow keys to move.`);
    element.title = note.kind === 'image' ? `@image ${note.imagePath} · line ${note.line}` : `@${note.kind === 'class' ? 'class ' : ''}${note.id} · line ${note.line}`;
    const title = document.createElement('div'); title.className = 'node-title'; title.textContent = (note.imagePath?.split('/').at(-1) || note.id).replaceAll('_', ' ');
    element.replaceChildren(title);
    if (note.kind === 'image') {
      const img = document.createElement('img'); img.className = 'note-image'; img.alt = note.imagePath || 'Image'; img.draggable = false;
      element.style.setProperty('--note-width','480px');
      const status = document.createElement('div'); status.className = 'image-status'; status.textContent = 'Loading image…';
      const handle = document.createElement('button'); handle.className = 'image-resize'; handle.textContent = '↘';
      handle.setAttribute('aria-label','Resize image'); handle.title = 'Drag to resize · arrow keys adjust · double-click to reset'; handle.hidden = true;
      const storageKey = `files0:image-size:${this.key}:${note.id}`;
      element.dataset.imageSizeKey = storageKey;
      const update = (shortSide: number, save = true) => {
        this.sizeImage(element,img,shortSide,save);
        const node=this.nodes.get(note.id); if (!node) return;
        node.width=element.offsetWidth; node.height=element.offsetHeight;
        this.reconfigure(note.id); this.settle();
      };
      img.addEventListener('load', () => {
        if (!img.isConnected) return;
        status.remove(); handle.hidden=false;
        let size=480; try { const saved=Number(localStorage.getItem(storageKey)); if (saved>=80 && saved<=1920) size=saved; } catch {}
        update(size,false);
      });
      img.addEventListener('error', () => { if (!img.isConnected) return; img.hidden=true; status.textContent=`Could not load ${note.imagePath}. Check the relative path and PNG file.`; this.resizeText(); });
      handle.addEventListener('keydown', event => {
        if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation(); this.focusId=undefined;
        const size=img.offsetWidth/Math.max(1,img.naturalWidth/img.naturalHeight);
        update(Math.max(80,Math.min(1920,size+(['ArrowRight','ArrowDown'].includes(event.key)?1:-1)*(event.shiftKey?80:20))));
      });
      handle.addEventListener('dblclick', event => { event.stopPropagation(); update(480); });
      element.append(img,status,handle); img.src=note.imageUrl || '';
    }
    if (note.text) { const body = document.createElement('div'); body.className = 'node-body'; renderInlineMath(body, note.text); element.append(body); }
    for (const [index, attribute] of note.attributes.entries()) {
      const row = document.createElement('div'); row.className = 'attribute'; row.title = `Attribute ${index + 1} · #to @${note.id} ${index + 1}`;
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
        node.vx = (node.vx + (node.tx - node.x) * .10) * .58;
        node.vy = (node.vy + (node.ty - node.y) * .10) * .58;
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
    this.paintGroups();
    for (const node of this.nodes.values()) node.element.style.transform = `translate(${node.x}px,${node.y}px)`;
    this.graph.edges.forEach((edge, i) => {
      const a = this.nodes.get(edge.source), b = this.nodes.get(edge.target);
      if (!a || !b) return;
      const route = this.routes.get(edge.id), origin = this.routeBoxes.get(edge.source), destination = this.routeBoxes.get(edge.target);
      if (route && origin && destination) {
        // Interpolate bends with their endpoints while notes settle. Routing is
        // computed once per layout change, never once per animation frame.
        const progress=this.routeProgress.get(edge.id)!;
        const points = route.points.map((p, j) => {
          const t=progress[j];
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
    this.measureGroups();
    let changed = false;
    for (const node of this.nodes.values()) { const height = node.element.offsetHeight, centers = this.measureAttributes(node.element); if (height !== node.height || String(centers) !== String(node.attributeCenters)) changed = true; node.height = height; node.attributeCenters = centers; }
    this.paintGroups();
    if (changed) { this.reconfigure(); this.settle(); }
  }
  fit(clearPreference = false) {
    this.focusId = undefined;
    if (clearPreference) { try { localStorage.removeItem('files0:zoom'); } catch {} }
    if (!this.nodes.size) { this.scale = 1; this.offset = { x: 0, y: 0 }; this.transform(); return; }
    const nodes = [...this.nodes.values()];
    const bends = [...this.routes.values()].flatMap(route => route.points);
    for(const {outer:b} of this.paintGroups(true).values()) bends.push({x:b.x,y:b.y},{x:b.x+b.width,y:b.y+b.height});
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
