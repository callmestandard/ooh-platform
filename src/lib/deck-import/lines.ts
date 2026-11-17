// Turns one slide into text lines, the same way in the browser and in tests.
// PowerPoint: each paragraph is a line, a table row is "cell<TAB>cell".
// PDF: text pieces at the same height form a line; a wide gap is a tab.

type XmlNode = { tagName?: string; parentNode: XmlNode | null; textContent: string | null; getElementsByTagName(tag: string): ArrayLike<XmlNode> };

const all = (el: XmlNode, tag: string) => Array.from(el.getElementsByTagName(tag));
const textOf = (el: XmlNode) => all(el, 'a:t').map(t => t.textContent ?? '').join('');

function inside(el: XmlNode, tag: string): boolean {
  for (let p = el.parentNode; p; p = p.parentNode) if (p.tagName === tag) return true;
  return false;
}

export function pptxSlideLines(doc: XmlNode): string[] {
  const lines: string[] = [];
  for (const p of all(doc, 'a:p')) {
    if (inside(p, 'a:tbl')) continue;
    const t = textOf(p).trim();
    if (t) lines.push(t);
  }
  for (const tr of all(doc, 'a:tr')) {
    const cells = all(tr, 'a:tc').map(tc => all(tc, 'a:p').map(textOf).join(' ').trim()).filter(Boolean);
    if (cells.length) lines.push(cells.join('\t'));
  }
  return lines;
}

export type PdfItem = { str?: string; transform?: number[]; width?: number };

export function pdfPageLines(items: PdfItem[]): string[] {
  type Piece = { s: string; x: number; y: number; w: number };
  const pieces: Piece[] = [];
  for (const it of items) {
    if (!it.str || !it.str.trim() || !it.transform) continue;
    pieces.push({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width ?? 0 });
  }
  pieces.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Piece[][] = [];
  for (const pc of pieces) {
    const row = rows.find(r => Math.abs(r[0].y - pc.y) < 4);
    if (row) row.push(pc); else rows.push([pc]);
  }
  return rows.map(r => {
    r.sort((a, b) => a.x - b.x);
    let out = '';
    r.forEach((pc, i) => {
      if (i > 0) { const gap = pc.x - (r[i - 1].x + r[i - 1].w); out += gap > 24 ? '\t' : gap > 1.5 ? ' ' : ''; }
      out += pc.s;
    });
    return out.trim();
  }).filter(Boolean);
}
