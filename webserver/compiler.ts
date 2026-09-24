/** The compiler is deliberately pure: source text in, a graph and diagnostics out. */
export type Border = 'rounded' | 'rectangle' | 'none';
export interface Note {
  id: string; kind: 'note' | 'class'; text: string; attributes: string[];
  border: Border; color?: string; line: number;
}
export interface Edge { id: string; source: string; target: string; kind: 'to' | 'from' | 'use' | 'inherit'; line: number }
export interface Diagnostic { line: number; message: string }
export interface Graph { nodes: Note[]; edges: Edge[] }
export interface Compilation { graph: Graph; diagnostics: Diagnostic[] }
export interface DocumentSnapshot extends Compilation { name: string; path?: string; displayName?: string; source: string; width: number; revision: string }

const identifier = '[\\p{L}\\p{N}_][\\p{L}\\p{N}_.-]*';
const heading = new RegExp(`^@(class::)?(${identifier})$`, 'u');
const reference = new RegExp(`^#(to|from|use|inherit)\\s+@?(?:class::)?(${identifier})$`, 'u');

export function compile(source: string): Compilation {
  const nodes: Note[] = [], edges: Edge[] = [], diagnostics: Diagnostic[] = [];
  const seen = new Set<string>(), edgeIds = new Set<string>();
  let current: Note | undefined;
  let body: string[] = [];
  const error = (line: number, message: string) => diagnostics.push({ line, message });
  const finish = () => { if (current) current.text = body.join('\n').trim(); body = []; };
  source.replace(/^\uFEFF/, '').split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1, text = raw.trim();
    if (text.startsWith('//')) return;
    if (text.startsWith('@')) {
      finish();
      const match = heading.exec(text);
      if (!match) { error(line, 'Use @name or @class::name to start a note.'); current = undefined; return; }
      const id = match[2];
      if (seen.has(id)) error(line, `“${id}” is already defined. Each note needs a unique name.`);
      seen.add(id);
      current = { id, kind: match[1] ? 'class' : 'note', text: '', attributes: [],
        border: match[1] ? 'rectangle' : 'none', line };
      nodes.push(current);
      return;
    }
    if (!current) { if (text) error(line, 'Start a note with @name before adding text or directives.'); return; }
    if (text.startsWith('#')) {
      const match = reference.exec(text);
      if (match) {
        const kind = match[1] as Edge['kind'];
        // Inheritance is drawn parent → child, with the hollow diamond at the child.
        const reversed = kind === 'inherit' || kind === 'from';
        const from = reversed ? match[2] : current.id;
        const to = reversed ? current.id : match[2];
        const id = `${kind}:${from}:${to}`;
        if (!edgeIds.has(id)) { edges.push({ id, source: from, target: to, kind, line }); edgeIds.add(id); }
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
      else error(line, 'Unknown directive. Use #to @target, #from @source, #use @target, #inherit @parent, #border, or #color RRGGBB.');
      return;
    }
    if (/^--(?:\s|$)/.test(text)) {
      if (current.kind !== 'class') error(line, 'Attributes (--) belong inside an @class::name note.');
      else if (!text.slice(2).trim()) error(line, 'Add an attribute after --.');
      else current.attributes.push(text.slice(2).trim());
      return;
    }
    // Escape a reserved character at the beginning of a line to keep it as text.
    body.push(raw.replace(/^(\s*)\\([@#\\/]|--)/, '$1$2'));
  });
  finish();
  if (nodes.length > 500) error(0, 'This graph exceeds 500 notes. Split it into smaller files to keep the canvas responsive.');
  for (const edge of edges) {
    const target = (edge.kind === 'inherit' || edge.kind === 'from') ? edge.source : edge.target;
    if (!seen.has(target)) error(edge.line, `“${target}” is not defined. Add @${target} or fix this reference.`);
  }
  return { graph: { nodes, edges }, diagnostics: diagnostics.sort((a, b) => a.line - b.line) };
}
