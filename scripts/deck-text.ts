// Reads a deck the way the importer does and prints, per slide, its text
// lines and the board read from them. For tuning the reader on real decks.
//   npx tsx scripts/deck-text.ts <deck.pptx|deck.pdf> [--lines] [--json out.json]
import { readFileSync, writeFileSync } from 'node:fs';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { pptxSlideLines, pdfPageLines, type PdfItem } from '../src/lib/deck-import/lines';
import { extractBoard, deckBoilerplate, withoutBoilerplate, deckCity } from '../src/lib/deck-import/extract';

async function slidesOf(path: string): Promise<string[][]> {
  const data = readFileSync(path);
  if (/\.pdf$/i.test(path)) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: true }).promise;
    const out: string[][] = [];
    for (let n = 1; n <= Math.min(doc.numPages, 150); n++) {
      const page = await doc.getPage(n);
      out.push(pdfPageLines((await page.getTextContent()).items as PdfItem[]));
      page.cleanup();
    }
    await doc.loadingTask.destroy();
    return out;
  }
  const zip = await JSZip.loadAsync(data);
  const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');
  const rels = parse(await zip.file('ppt/_rels/presentation.xml.rels')!.async('text'));
  const target = new Map(Array.from(rels.getElementsByTagName('Relationship')).map(r => [r.getAttribute('Id'), r.getAttribute('Target')]));
  const pres = parse(await zip.file('ppt/presentation.xml')!.async('text'));
  const out: string[][] = [];
  for (const s of Array.from(pres.getElementsByTagName('p:sldId'))) {
    const t = target.get(s.getAttribute('r:id'));
    const f = t && zip.file('ppt/' + t.replace(/^\/?ppt\//, ''));
    if (f) out.push(pptxSlideLines(parse(await f.async('text')) as never));
  }
  return out;
}

const [path, ...flags] = process.argv.slice(2);
(async () => {
  const slides = await slidesOf(path);
  const boiler = deckBoilerplate(slides);
  const fallback = deckCity(slides.map(l => l.join('\n')));
  const rows: unknown[] = [];
  slides.forEach((lines, i) => {
    const b = extractBoard(withoutBoilerplate(lines, boiler));
    if (b && !b.City && fallback) b.City = fallback.city;
    rows.push({ slide: i + 1, lines, board: b });
    if (flags.includes('--lines')) console.log(`\n── ${i + 1} ──\n` + lines.map(l => '  ' + JSON.stringify(l)).join('\n'));
    console.log(`${i + 1}`.padStart(3), b ? `${b['Board Name'].slice(0, 70).padEnd(70)} | ${b.City} | ${b.Format} ${b['Width (m)']}x${b['Height (m)']} | ₦${b['Monthly Rate']}` : '—');
  });
  console.log('boilerplate:', [...boiler].join(' / '));
  const j = flags.indexOf('--json');
  if (j >= 0) writeFileSync(flags[j + 1], JSON.stringify(rows, null, 1));
})();
