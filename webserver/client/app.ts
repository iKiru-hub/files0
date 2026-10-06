import { GraphView } from './graph.js';
import { DEFAULT_NOTE_SPACING, normalizeSpacing } from './spacing.js';
import type { DocumentSnapshot } from '../compiler.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const home = $('home'), workspace = $('workspace'), sourcePanel = $('source-panel');
const help = $<HTMLDialogElement>('help');
const addFileDialog = $<HTMLDialogElement>('add-file-dialog');
const view = new GraphView($('viewport'), $('world'), $('nodes'), document.getElementById('edge-paths') as unknown as SVGGElement,
  scale => { $('zoom-reset').textContent = `${Math.round(scale * 100)}%`; });
const spacingInput = $<HTMLInputElement>('note-spacing');
let spacing = DEFAULT_NOTE_SPACING;
try {
  const saved = localStorage.getItem('files0:note-spacing');
  if (saved !== null) spacing = normalizeSpacing(Number(saved));
} catch {}
function updateSpacing(value: number) {
  spacing = normalizeSpacing(value);
  spacingInput.value = String(spacing);
  spacingInput.setAttribute('aria-valuetext', `${spacing} pixels preferred gap`);
  $('spacing-value').textContent = `${spacing} px`;
  $<HTMLButtonElement>('reset-spacing').disabled = spacing === DEFAULT_NOTE_SPACING;
  view.setSpacing(spacing);
  try { localStorage.setItem('files0:note-spacing', String(spacing)); } catch {}
}
updateSpacing(spacing);
// Coalesce slider scrubbing; the force solver runs once after a short pause.
let spacingTimer: ReturnType<typeof setTimeout> | undefined;
spacingInput.addEventListener('input', () => {
  $('spacing-value').textContent = `${spacingInput.value} px`;
  spacingInput.setAttribute('aria-valuetext', `${spacingInput.value} pixels preferred gap`);
  clearTimeout(spacingTimer);
  spacingTimer = setTimeout(() => updateSpacing(Number(spacingInput.value)), 120);
});
spacingInput.addEventListener('change', () => {
  clearTimeout(spacingTimer); updateSpacing(Number(spacingInput.value));
});
$('reset-spacing').addEventListener('click', () => {
  clearTimeout(spacingTimer); updateSpacing(DEFAULT_NOTE_SPACING);
});
const noteWidth = $<HTMLInputElement>('note-width');
let preferredWidth: number | undefined;
try {
  const saved = Number(localStorage.getItem('files0:note-width'));
  if (Number.isFinite(saved) && saved >= 80 && saved <= 480) preferredWidth = saved;
} catch {}
noteWidth.value = preferredWidth === undefined ? '' : String(preferredWidth);
noteWidth.addEventListener('change', () => {
  if (noteWidth.value && !noteWidth.checkValidity()) { noteWidth.reportValidity(); return; }
  preferredWidth = noteWidth.value ? Number(noteWidth.value) : undefined;
  try {
    if (preferredWidth === undefined) localStorage.removeItem('files0:note-width');
    else localStorage.setItem('files0:note-width', String(preferredWidth));
  } catch {}
});
$('reset-note-width').addEventListener('click', () => {
  noteWidth.value = ''; noteWidth.dispatchEvent(new Event('change'));
});
let fileHistory: string[] = [], historyIndex = -1;
try {
  const saved = JSON.parse(sessionStorage.getItem('files0:file-history') || 'null');
  if (saved && Array.isArray(saved.entries) && saved.entries.every((name: unknown) => typeof name === 'string') && Number.isInteger(saved.index) && saved.index >= -1 && saved.index < saved.entries.length) {
    fileHistory = saved.entries; historyIndex = saved.index;
  }
} catch {}
const saveHistory = () => { try { sessionStorage.setItem('files0:file-history', JSON.stringify({ entries:fileHistory, index:historyIndex })); } catch {} };
let availableFiles = new Set<string>();
let homeSelection = '', focusHome = false;
function moveFileHistory(direction: number) {
  let index = !selected && direction < 0 ? historyIndex : historyIndex + direction;
  while (index >= 0 && index < fileHistory.length) {
    if (availableFiles.has(fileHistory[index])) {
      historyIndex = index; saveHistory(); openFile(fileHistory[index], true, false); return;
    }
    index += direction;
  }
}
function moveHomeSelection(direction: number) {
  const cards = [...$('file-list').querySelectorAll<HTMLButtonElement>('.file-card')];
  if (!cards.length) return;
  const current = cards.findIndex(card => card.dataset.file === homeSelection);
  const next = current < 0 ? (direction > 0 ? 0 : cards.length - 1) : Math.max(0, Math.min(cards.length - 1, current + direction));
  homeSelection = cards[next].dataset.file!;
  cards[next].focus({ preventScroll:true }); cards[next].scrollIntoView({block:'nearest'});
}
let selected = '', directory = 'vsfiles', current: DocumentSnapshot | undefined;
let lastGood = false, generation = 0, connected = false;
let request: AbortController | undefined;
type FileEntry = { name: string; displayName?: string; path?: string; linked?: boolean; nodes: number; edges: number; errors: number };
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

async function files() {
  try {
    const response = await fetch('/api/files');
    if (!response.ok) throw new Error('Could not list files.');
    const data: { files: FileEntry[]; directory: string; nativePicker: boolean } = await response.json();
    directory = data.directory;
    $('choose-file').hidden = !data.nativePicker;
    $('directory').textContent = directory + '/'; $('file-count').textContent = String(data.files.length);
    const list = $('file-list');
    const restoreFocus = !home.hidden && ((focusHome && !home.contains(document.activeElement)) || !!(document.activeElement as HTMLElement)?.closest('.file-card'));
    availableFiles = new Set(data.files.map(file => file.name));
    list.replaceChildren();
    for (const file of data.files) {
      const button = document.createElement('button'); button.className = 'file-card'; button.dataset.file = file.name;
      button.addEventListener('focus', () => { homeSelection = file.name; });
      const icon = document.createElement('span'); icon.className = 'file-icon'; icon.textContent = '≋'; icon.setAttribute('aria-hidden', 'true');
      const info = document.createElement('span'); info.className = 'file-info';
      const name = document.createElement('span'); name.className = 'file-name'; name.textContent = file.displayName || file.name;
      const description = document.createElement('span'); description.className = 'file-description';
      description.textContent = file.errors ? `${plural(file.errors, 'source issue')} · open to inspect` : `${plural(file.nodes, 'note')} · ${plural(file.edges, 'connection')}`;
      info.append(name, description);
      if (file.linked && file.path) {
        const location = document.createElement('span'); location.className = 'file-location'; location.textContent = file.path; info.append(location);
      }
      const arrow = document.createElement('span'); arrow.className = 'file-arrow'; arrow.textContent = '↗'; arrow.setAttribute('aria-hidden', 'true');
      button.append(icon, info, arrow); button.addEventListener('click', () => openFile(file.name));
      const row = document.createElement('div'); row.className = 'file-row';
      const remove = document.createElement('button'); remove.className = 'remove-file'; remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${file.displayName || file.name} from list`);
      remove.title = 'Remove from list; keep the original file on disk';
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        try {
          const response = await fetch('/api/library', { method: 'DELETE', headers: { 'Content-Type': 'application/json', 'X-Files0-Request': '1' }, body: JSON.stringify({ name: file.name }) });
          if (!response.ok) throw new Error((await response.json()).error || 'Could not remove file.');
          $('library-status').textContent = 'Removed from list. File kept on disk; use + to add it again.';
          await files();
        } catch (error) { $('library-status').textContent = (error as Error).message; remove.disabled = false; }
      });
      row.append(button, remove); list.append(row);
    }
    if (restoreFocus) {
      const cards = [...list.querySelectorAll<HTMLButtonElement>('.file-card')];
      (cards.find(card => card.dataset.file === homeSelection) || cards[0])?.focus({preventScroll:true});
      focusHome = false;
    }
    if (!data.files.length) {
      const empty = document.createElement('p'); empty.className = 'file-empty';
      empty.textContent = 'A clean slate. Create a .txt or .graph file in the watched directory. It will appear here automatically.'; list.append(empty);
    }
  } catch (error) {
    if (!$('file-list').children.length) { $('file-list').textContent = 'Waiting for the local server. Your files will appear when it reconnects.'; }
  }
}

function openFile(name: string, navigate = true, record = true) {
  if (record && fileHistory[historyIndex] !== name) {
    fileHistory = fileHistory.slice(0, historyIndex + 1); fileHistory.push(name);
    historyIndex = fileHistory.length - 1; saveHistory();
  }
  focusHome = false; homeSelection = name;
  const isNew = selected !== name;
  if (isNew) { generation++; request?.abort(); current = undefined; lastGood = false; view.clear(); }
  selected = name; home.hidden = true; workspace.hidden = false; $('source-button').hidden = false; $('zen-button').hidden = false; $('time-button').hidden = false;
  $('breadcrumb').textContent = name; document.title = `${name} · files0`;
  $('source-name').textContent = name; $('diagnostics').hidden = true;
  if (isNew) {
    $('save-status').textContent = 'Opening file…'; $('graph-summary').textContent = '';
    $('empty-graph').hidden = true; $('source-code').replaceChildren(); sourcePanel.hidden = true;
  }
  if (navigate) history.pushState({ fileHistoryIndex:historyIndex }, '', `/?file=${encodeURIComponent(name)}`);
  else history.replaceState({ fileHistoryIndex:historyIndex }, '', location.href);
  $('viewport').focus({preventScroll:true});
  void loadDocument();
}
function goHome(navigate = true) {
  if (selected) homeSelection = selected;
  focusHome = true;
  generation++; request?.abort(); selected = ''; current = undefined; lastGood = false; view.clear();
  home.hidden = false; workspace.hidden = true; sourcePanel.hidden = true; $('source-button').hidden = true; $('zen-button').hidden = true; $('time-button').hidden = true; setZen(false);
  $('breadcrumb').textContent = 'your thoughts, connected'; document.title = 'files0 · plain text, connected';
  if (navigate) history.pushState({}, '', '/');
  void files();
}
function route() {
  const file = new URLSearchParams(location.search).get('file');
  const index = history.state?.fileHistoryIndex;
  if (file && Number.isInteger(index) && fileHistory[index] === file) { historyIndex = index; saveHistory(); openFile(file, false, false); }
  else if (file) openFile(file, false);
  else goHome(false);
}

async function loadDocument() {
  if (!selected) return;
  request?.abort(); request = new AbortController();
  const version = generation, name = selected;
  try {
    const response = await fetch(`/api/document?file=${encodeURIComponent(name)}`, { signal: request.signal });
    if (version !== generation || name !== selected) return;
    if (!response.ok) {
      const body = await response.json();
      showError(body.error || 'Could not read this file.'); return;
    }
    const doc: DocumentSnapshot = await response.json();
    if (version !== generation || name !== selected) return;
    if (doc.revision === current?.revision) return;
    current = doc; renderSource();
    $('breadcrumb').textContent = doc.displayName || doc.name;
    document.title = `${doc.displayName || doc.name} · files0`;
    const diagnostics = $('diagnostics'); diagnostics.replaceChildren(); diagnostics.hidden = !doc.diagnostics.length;
    if (doc.diagnostics.length) {
      const title = document.createElement('strong'); title.textContent = lastGood ? 'A small source issue. Keeping your last valid graph.' : 'A small source issue. Fix it in your editor, then save.';
      const list = document.createElement('ul');
      for (const problem of doc.diagnostics) {
        const item = document.createElement('li'), button = document.createElement('button');
        button.textContent = `${problem.line ? `Line ${problem.line}: ` : ''}${problem.message}`;
        button.addEventListener('click', () => { showSource(); $('source-code').children[Math.max(0, problem.line - 1)]?.scrollIntoView({ block: 'center' }); });
        item.append(button); list.append(item);
      }
      diagnostics.append(title, list); $('save-status').textContent = 'Waiting for a valid save';
      if (!lastGood) $('graph-summary').textContent = 'Source needs attention';
    } else {
      view.update(doc.graph, preferredWidth ?? doc.width, doc.path || `${directory}/${name}`);
      lastGood = true; $('empty-graph').hidden = doc.graph.nodes.length > 0;
      $('graph-summary').textContent = `${plural(doc.graph.nodes.length, 'note')} / ${plural(doc.graph.edges.length, 'connection')}`;
      $('save-status').textContent = 'Up to date · save to see changes';
    }
  } catch (error) {
    if ((error as Error).name === 'AbortError') return;
    if (version === generation) showError('The local server is unavailable. Reconnecting automatically.');
  }
}
function showError(message: string) {
  $('diagnostics').hidden = false; $('diagnostics').textContent = message + (lastGood ? ' Keeping your last valid graph.' : '');
  $('save-status').textContent = 'Waiting for file';
  // Force a fresh render if the same file is recreated or the server restarts.
  current = undefined;
}
function renderSource() {
  if (!current) return;
  $('source-name').textContent = current.displayName || current.name;
  $('editor-command').textContent = `nvim ${shellQuote(current.path || `${directory}/${current.name}`)}`;
  const errors = new Set(current.diagnostics.map(d => d.line));
  const sourceLines = current.source.split(/\r?\n/);
  const lines = sourceLines.slice(0, 5000).map((line, index) => {
    const element = document.createElement('span'); element.className = 'source-line';
    if (errors.has(index + 1)) element.classList.add('error');
    if (line.trim().startsWith('@')) element.classList.add('heading');
    if (line.trim().startsWith('#')) element.classList.add('directive');
    element.textContent = line || '\u200b'; return element;
  });
  $('source-code').replaceChildren(...lines);
  if (sourceLines.length > 5000) {
    const remainder = document.createElement('span'); remainder.textContent = '\nPreview limited to 5,000 lines. The full source remains in your editor.';
    $('source-code').append(remainder);
  }
}
function showSource() { renderSource(); sourcePanel.hidden = false; $('close-source').focus(); }
function connection(live: boolean) {
  connected = live;
  $('connection').classList.toggle('offline', !live);
  $('connection').querySelector('span')!.textContent = live ? 'Watching files' : 'Reconnecting';
  if (!live && selected) $('save-status').textContent = 'Offline · reconnecting automatically';
  else if (live && current && !current.diagnostics.length) $('save-status').textContent = 'Up to date · save to see changes';
}
const events = new EventSource('/api/events');
events.addEventListener('ready', () => { connection(true); void files().then(() => loadDocument()); });
events.addEventListener('error', () => connection(false));
events.addEventListener('change', event => {
  const change = JSON.parse((event as MessageEvent).data) as { changed: string[]; removed: string[]; listChanged: boolean };
  void files();
  if (selected && (change.changed.includes(selected) || change.removed.includes(selected))) void loadDocument();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && connected) { void files(); void loadDocument(); } });
$('add-file').addEventListener('click', () => { $('add-file-error').hidden = true; addFileDialog.showModal(); });
$('close-add-file').addEventListener('click', () => addFileDialog.close());
async function linkFile(pick: boolean) {
  const controls = [$<HTMLButtonElement>('choose-file'), $<HTMLButtonElement>('link-file')];
  controls.forEach(button => { button.disabled = true; });
  $('add-file-error').hidden = true;
  try {
    const response = await fetch(pick ? '/api/library/pick' : '/api/library', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Files0-Request': '1' },
      body: JSON.stringify(pick ? {} : { path: $<HTMLInputElement>('file-path').value })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not add this file.');
    if (result.cancelled) return;
    addFileDialog.close(); $<HTMLInputElement>('file-path').value = '';
    await files(); openFile(result.name);
  } catch (error) {
    $('add-file-error').textContent = (error as Error).message; $('add-file-error').hidden = false;
  } finally { controls.forEach(button => { button.disabled = false; }); }
}
$('choose-file').addEventListener('click', () => void linkFile(true));
$('add-file-form').addEventListener('submit', event => { event.preventDefault(); void linkFile(false); });
$('home-button').addEventListener('click', () => goHome()); $('files-button').addEventListener('click', () => goHome());
$('source-button').addEventListener('click', () => { if (sourcePanel.hidden) showSource(); else sourcePanel.hidden = true; });
$('close-source').addEventListener('click', () => { sourcePanel.hidden = true; $('source-button').focus(); });
$('copy-command').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('editor-command').textContent || ''); $('copy-command').textContent = 'Copied'; }
  catch { $('copy-command').textContent = 'Select and copy the command above'; }
  setTimeout(() => { $('copy-command').textContent = 'Copy command'; }, 2200);
});
$('help-button').addEventListener('click', () => help.showModal()); $('close-help').addEventListener('click', () => help.close());
help.addEventListener('click', event => { const r = help.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) help.close(); });
let temporal = false;
function toggleTime() {
  temporal = !temporal;
  $('time-button').setAttribute('aria-pressed', String(temporal));
  $('time-button').textContent = temporal ? 'Time on' : 'Time';
  view.setTemporal(temporal);
}
$('time-button').addEventListener('click', toggleTime);
function setZen(enabled: boolean) {
  document.body.classList.toggle('zen', enabled);
  $('zen-button').setAttribute('aria-pressed', String(enabled));
  if (enabled) { sourcePanel.hidden = true; help.close(); $('viewport').focus({ preventScroll: true }); }
}
$('zen-button').addEventListener('click', () => setZen(!document.body.classList.contains('zen')));
function updateThemeButton() {
  const dark = document.documentElement.dataset.theme === 'dark';
  $('theme-button').textContent = dark ? 'Light' : 'Dark';
  $('theme-button').setAttribute('aria-pressed', String(dark));
  $('theme-button').setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
}
updateThemeButton();
$('theme-button').addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('files0:theme', theme); } catch {}
  updateThemeButton();
});
const fontSize = $<HTMLSelectElement>('font-size');
fontSize.value = getComputedStyle(document.documentElement).getPropertyValue('--note-font-size').trim().replace('px', '');
fontSize.addEventListener('change', () => {
  const size = Number(fontSize.value);
  if (![10, 12, 14, 16, 18].includes(size)) return;
  document.documentElement.style.setProperty('--note-font-size', `${size}px`);
  try { localStorage.setItem('files0:font-size', String(size)); } catch {}
  view.resizeText();
});
$('fit').addEventListener('click', () => view.fit(true)); $('zoom-in').addEventListener('click', () => view.zoom(1.2));
$('zoom-out').addEventListener('click', () => view.zoom(1 / 1.2)); $('zoom-reset').addEventListener('click', () => view.resetZoom());
document.addEventListener('keydown', event => {
  if (help.open || addFileDialog.open || event.isComposing || event.metaKey || event.altKey || (event.target as HTMLElement).closest('input,textarea,[contenteditable]')) return;
  const key = event.key.toLowerCase();
  if (event.ctrlKey) {
    if (['h', 'p', 'n'].includes(key)) {
      event.preventDefault();
      if (key === 'h') { if (selected) goHome(); }
      else moveFileHistory(key === 'p' ? -1 : 1);
    }
    return;
  }
  if (!selected && !home.hidden && !(event.target as HTMLElement).matches('select') && (key === 'j' || key === 'k')) {
    event.preventDefault(); moveHomeSelection(key === 'j' ? 1 : -1); return;
  }
  if (event.key === 'Escape') { setZen(false); sourcePanel.hidden = true; return; }
  if (!selected) return;
  if (event.key.toLowerCase() === 'z') { event.preventDefault(); if (!event.repeat) setZen(!document.body.classList.contains('zen')); return; }
  if (event.key.toLowerCase() === 't') { event.preventDefault(); if (!event.repeat) toggleTime(); return; }
  if ((event.target as HTMLElement).matches('select')) return;
  const direction = ({ h: [-1, 0], j: [0, 1], k: [0, -1], l: [1, 0] } as Record<string, number[]>)[event.key.toLowerCase()];
  if (direction) {
    event.preventDefault(); const step = event.shiftKey ? 120 : 40;
    view.pan(direction[0] * step, direction[1] * step); return;
  }
  if (event.key.toLowerCase() === 'f') { event.preventDefault(); view.fit(true); }
  if (event.key === '+' || event.key === '=') { event.preventDefault(); view.zoom(1.2); }
  if (event.key === '-') { event.preventDefault(); view.zoom(1 / 1.2); }
});
window.addEventListener('popstate', route);
await files(); route();
