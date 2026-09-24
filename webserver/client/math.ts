import katex from 'katex';

function mathEnd(text: string, start: number): number {
  return text.startsWith('\\(', start) ? text.indexOf('\\)', start + 2) : -1;
}

function closingMarker(text: string, start: number, marker: string): number {
  for (let i = start; i < text.length; i++) {
    const end = mathEnd(text, i);
    if (end !== -1) { i = end + 1; continue; }
    if (text[i] === '\\') { i++; continue; }
    if (text.startsWith(marker, i) && !/\s/.test(text[i - 1]) && i > start) {
      // A pair belongs to bold, not to a surrounding italic expression.
      if (marker === '*' && text.startsWith('**', i)) { i++; continue; }
      return i;
    }
  }
  return -1;
}

/** Render explicit inline formatting using DOM nodes; ordinary HTML stays literal. */
export function renderInlineMath(element: HTMLElement, text: string, depth = 0) {
  let plain = '';
  const flush = () => { if (plain) { element.append(document.createTextNode(plain)); plain = ''; } };
  for (let i = 0; i < text.length;) {
    if (text[i] === '\\' && (text[i + 1] === '*' || text[i + 1] === '\\')) {
      plain += text[i + 1]; i += 2; continue;
    }
    const end = mathEnd(text, i);
    if (end !== -1) {
      flush();
      const math = document.createElement('span'); math.className = 'inline-math';
      try {
        katex.render(text.slice(i + 2, end), math, { displayMode: false, throwOnError: true,
          trust: false, strict: 'error', maxExpand: 200, maxSize: 10, output: 'htmlAndMathml' });
      } catch {
        math.replaceChildren(document.createTextNode(text.slice(i, end + 2)));
        math.classList.add('math-invalid'); math.title = 'Invalid or unsupported math expression';
      }
      element.append(math); i = end + 2; continue;
    }
    if (text[i] === '*' && depth < 20) {
      const marker = text.startsWith('**', i) ? '**' : '*';
      const start = i + marker.length;
      const close = !/\s/.test(text[start] || ' ') ? closingMarker(text, start, marker) : -1;
      if (close !== -1) {
        flush();
        const formatted = document.createElement(marker === '**' ? 'strong' : 'em');
        renderInlineMath(formatted, text.slice(start, close), depth + 1);
        element.append(formatted); i = close + marker.length; continue;
      }
      plain += marker; i += marker.length; continue;
    }
    plain += text[i++];
  }
  flush();
}
