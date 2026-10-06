/** The compiler is deliberately pure: source text in, a graph and diagnostics out. */
export type Border = 'rounded' | 'rectangle' | 'none';
export interface Note {
  id: string; kind: 'note' | 'class' | 'image'; imagePath?: string; imageUrl?: string; text: string; attributes: string[];
  border: Border; color?: string; line: number;
}
export interface Edge { id: string; source: string; target: string; kind: 'to' | 'from' | 'use' | 'inherit' | 'with'; sourceAttribute?: number; targetAttribute?: number; line: number }
export interface Diagnostic { line: number; message: string }
export interface NoteGroup { id: string; members: string[]; subtitle: string; footer: string; line: number; endLine?: number }
export interface Graph { nodes: Note[]; edges: Edge[]; groups?: NoteGroup[] }
export interface Compilation { graph: Graph; diagnostics: Diagnostic[] }
export interface DocumentSnapshot extends Compilation { name: string; path?: string; displayName?: string; source: string; width: number; revision: string }

const identifier = '[\\p{L}\\p{N}_][\\p{L}\\p{N}_.-]*';
// Space-separated syntax is canonical; old files remain readable. Edge IDs
// below stay stable so changing spelling does not disturb saved graph layouts.
const heading = new RegExp(`^@(class(?:\\s+|::))?(${identifier})$`, 'u');
const reference = new RegExp(`^#(to|from|use|inherit|with)\\s+@?(?:class::)?(${identifier})(?:(?:\\s+|::)([0-9]+))?$`, 'u');
const attributeTo = new RegExp(`^#from\\s+([0-9]+)\\s+#to\\s+@?(${identifier})\\s+([0-9]+)$`, 'u');
const attributeTargetFirst = new RegExp(`^#to\\s+@?(${identifier})\\s+([0-9]+)\\s+#from\\s+([0-9]+)$`, 'u');
const attributeFrom = new RegExp(`^#from\\s+@?(${identifier})\\s+([0-9]+)\\s+#to\\s+([0-9]+)$`, 'u');

export function compile(source: string): Compilation {
  const nodes: Note[] = [], edges: Edge[] = [], diagnostics: Diagnostic[] = [];
  const seen = new Set<string>(), edgeIds = new Set<string>();
  const groups: NoteGroup[] = [], activeGroups = new Map<string, NoteGroup>();
  let groupText: { group: NoteGroup; field: 'subtitle' | 'footer' } | undefined;
  let current: Note | undefined;
  let body: string[] = [];
  const error = (line: number, message: string) => diagnostics.push({ line, message });
  const finish = () => { if (current) current.text = body.join('\n').trim(); else if (groupText) groupText.group[groupText.field] = body.join('\n').trim(); body = []; };
  source.replace(/^\uFEFF/, '').split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1, text = raw.trim();
    if (text.startsWith('//')) return;
    if (text.startsWith('@')) {
      finish(); current = undefined; groupText = undefined;
      if (/^@box(?:open|close)(?:\s|$)/.test(text)) {
        const box = /^@box(open|close)\s+(.+)$/.exec(text);
        if (!box) { error(line, 'Use @boxopen name or @boxclose name.'); return; }
        const name = box[2].trim();
        if (box[1] === 'open') {
          if (groups.some(g => g.id === name)) { error(line, `Box “${name}” is already defined. Use a unique box name.`); return; }
          const group: NoteGroup = { id:name, members:[], subtitle:'', footer:'', line };
          groups.push(group); activeGroups.set(name,group); groupText = {group,field:'subtitle'};
        } else {
          const group = activeGroups.get(name);
          if (!group) { error(line, `Box “${name}” is not open.`); return; }
          group.endLine = line; activeGroups.delete(name); groupText = {group,field:'footer'};
        }
        return;
      }
      if (/^@image\s/.test(text)) {
        let path = text.slice(7).trim();
        if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1,-1);
        if (!path || /^(?:[\\/]|[a-zA-Z][a-zA-Z0-9+.-]*:)/.test(path) || !/\.png$/i.test(path) || /[\x00-\x1f]/.test(path)) {
          error(line, 'Use @image relative/path.png (relative to this text file).'); current = undefined; return;
        }
        const occurrence = nodes.filter(n => n.imagePath === path).length + 1;
        const id = `image:${path}:${occurrence}`; seen.add(id);
        current = { id, kind:'image', imagePath:path, text:'', attributes:[], border:'none', line };
        nodes.push(current); for (const group of activeGroups.values()) group.members.push(id); return;
      }
      const match = heading.exec(text);
      if (!match) { error(line, 'Use @name or @class name to start a note.'); current = undefined; return; }
      const id = match[2];
      if (seen.has(id)) error(line, `“${id}” is already defined. Each note needs a unique name.`);
      seen.add(id);
      current = { id, kind: match[1] ? 'class' : 'note', text: '', attributes: [],
        border: match[1] ? 'rectangle' : 'none', line };
      nodes.push(current); for (const group of activeGroups.values()) group.members.push(id);
      return;
    }
    if (groupText) { body.push(raw.replace(/^(\s*)\\([@#\\/]|--)/, '$1$2')); return; }
    if (!current) { if (text) error(line, 'Start a note with @name before adding text or directives.'); return; }
    if (text.startsWith('#')) {
      const outgoing = attributeTo.exec(text), targetFirst = attributeTargetFirst.exec(text), incoming = attributeFrom.exec(text);
      if (outgoing || targetFirst || incoming) {
        const localSource = !!(outgoing || targetFirst);
        const source = localSource ? current.id : incoming![1];
        const target = targetFirst?.[1] ?? outgoing?.[2] ?? current.id;
        const sourceAttribute = Number(targetFirst?.[3] ?? outgoing?.[1] ?? incoming![2]);
        const targetAttribute = Number(targetFirst?.[2] ?? outgoing?.[3] ?? incoming![3]);
        // Either declaration describes the same row-to-row dependency.
        const id = `attributes:${source}:${sourceAttribute}:${target}:${targetAttribute}`;
        if (!edgeIds.has(id)) {
          edges.push({id, source, target, sourceAttribute, targetAttribute, kind:localSource?'to':'from', line});
          edgeIds.add(id);
        }
        return;
      }
      if (/^#(?:from|to)\b.*#(?:to|from)\b/.test(text)) {
        error(line, 'Use #from 1 #to @target 2 or #to @target 2 #from 1, with a positive attribute index at each end.');
        return;
      }
      const match = reference.exec(text);
      if (match) {
        const kind = match[1] as Edge['kind'];
        const attribute = match[3] === undefined ? undefined : Number(match[3]);
        if (attribute !== undefined && kind !== 'to' && kind !== 'from') { error(line, 'Attribute indices are supported only with #to and #from.'); return; }
        // Inheritance is drawn parent → child, with the hollow diamond at the child.
        const reversed = kind === 'inherit' || kind === 'from';
        const from = reversed ? match[2] : current.id;
        const to = reversed ? current.id : match[2];
        const pair = kind === 'with' ? [from,to].sort().join(':') : `${from}:${to}`;
        const id = `${kind}:${pair}${attribute === undefined ? '' : `::${attribute}`}`;
        if (!edgeIds.has(id)) { edges.push({ id, source: from, target: to, kind, line, ...(attribute === undefined ? {} : reversed ? {sourceAttribute: attribute} : {targetAttribute: attribute}) }); edgeIds.add(id); }
      } else if (/^#border(?:\s+(rounded|rectangle|none))?$/.test(text)) {
        current.border = (text.split(/\s+/)[1] as Border) || (current.kind === 'class' ? 'rectangle' : 'rounded');
      } else if (/^#color(?:\s|$)/.test(text)) {
        const color = /^#color\s+([0-9a-fA-F]{6})$/.exec(text);
        if (!color) error(line, 'Use #color RRGGBB with exactly six hexadecimal digits, for example #color 222c3a.');
        else {
          current.color = color[1].toLowerCase();
          if (current.border === 'none') current.border = current.kind === 'class' ? 'rectangle' : 'rounded';
        }
      } else if (text === '#noborder') current.border = 'none';
      else error(line, 'Unknown directive. Use #to @target, #from @source (optionally followed by a class attribute index, e.g. #to @target 2), #use @target, #with @neighbor, #inherit @parent, #border, or #color RRGGBB.');
      return;
    }
    if (/^--(?:\s|$)/.test(text)) {
      if (current.kind !== 'class') error(line, 'Attributes (--) belong inside an @class name note.');
      else if (!text.slice(2).trim()) error(line, 'Add an attribute after --.');
      else current.attributes.push(text.slice(2).trim());
      return;
    }
    // Escape a reserved character at the beginning of a line to keep it as text.
    body.push(raw.replace(/^(\s*)\\([@#\\/]|--)/, '$1$2'));
  });
  finish();
  for (const group of activeGroups.values()) error(group.line, `Box “${group.id}” needs @boxclose ${group.id}.`);
  for (const group of groups) if (!group.members.length) error(group.line, `Box “${group.id}” contains no notes.`);
  if (nodes.length > 500) error(0, 'This graph exceeds 500 notes. Split it into smaller files to keep the canvas responsive.');
  const byId = new Map(nodes.map(note=>[note.id,note]));
  for (const edge of edges) {
    for (const id of new Set([edge.source,edge.target]))
      if (!seen.has(id)) error(edge.line, `“${id}” is not defined. Add @${id} or fix this reference.`);
    for (const [id,attribute] of [[edge.source,edge.sourceAttribute],[edge.target,edge.targetAttribute]] as const) {
      const note = byId.get(id);
      if (note && attribute !== undefined) {
        if (note.kind !== 'class') error(edge.line, `“${id}” must be a class to reference an attribute.`);
        else if (!Number.isSafeInteger(attribute) || attribute < 1 || attribute > note.attributes.length)
          error(edge.line, `Attribute ${attribute} does not exist in “${id}”. Attributes are numbered from 1; this class has ${note.attributes.length}.`);
      }
    }
  }
  return { graph: { nodes, edges, ...(groups.length ? {groups} : {}) }, diagnostics: diagnostics.sort((a, b) => a.line - b.line) };
}
