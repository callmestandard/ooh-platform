// Opens an owner's deck in the browser and returns each slide's text lines
// and its main photo. PowerPoint (.pptx): the slide's text, table rows as
// "cell<TAB>cell", and the largest picture on the slide. PDF: the page's
// text grouped into lines, and a picture of the whole page.

/** image: the board photo. photos: every large picture on the slide as stored in the deck, biggest first (read for GPS stamps). */
export type DeckSlide = { index: number; lines: string[]; image: Blob | null; photos: Blob[] };

import { pptxSlideLines, pdfPageLines, type PdfItem } from './lines';

const MAX_SLIDES = 150;
const PHOTO_MAX_PX = 1600;

/** Shrinks a picture to at most 1600px and re-saves it as JPEG so uploads stay small. */
async function toJpeg(blob: Blob): Promise<Blob | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, PHOTO_MAX_PX / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    return await new Promise(res => canvas.toBlob(b => res(b), 'image/jpeg', 0.85));
  } catch {
    return null;
  }
}

async function readPptx(file: File, onProgress?: (done: number, total: number) => void): Promise<DeckSlide[]> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(file);
  const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');
  const relsOf = async (path: string) => {
    const f = zip.file(path);
    const map = new Map<string, string>();
    if (!f) return map;
    for (const r of Array.from(parse(await f.async('text')).getElementsByTagName('Relationship'))) {
      map.set(r.getAttribute('Id') ?? '', r.getAttribute('Target') ?? '');
    }
    return map;
  };
  const resolve = (base: string, target: string) => {
    if (target.startsWith('/')) return target.slice(1);
    const parts = base.split('/').slice(0, -1);
    for (const seg of target.split('/')) { if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg); }
    return parts.join('/');
  };

  // Slides in the order the deck shows them.
  const pres = zip.file('ppt/presentation.xml');
  if (!pres) throw new Error('This file is not a PowerPoint deck.');
  const presRels = await relsOf('ppt/_rels/presentation.xml.rels');
  const order = Array.from(parse(await pres.async('text')).getElementsByTagName('p:sldId'))
    .map(s => presRels.get(s.getAttribute('r:id') ?? ''))
    .filter((t): t is string => !!t)
    .map(t => resolve('ppt/presentation.xml', t));
  const paths = (order.length ? order : Object.keys(zip.files).filter(p => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => parseInt(a.match(/(\d+)\.xml$/)![1]) - parseInt(b.match(/(\d+)\.xml$/)![1]))).slice(0, MAX_SLIDES);

  const slides: DeckSlide[] = [];
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    const f = zip.file(path);
    if (!f) continue;
    const doc = parse(await f.async('text'));
    const lines = pptxSlideLines(doc as unknown as Parameters<typeof pptxSlideLines>[0]);

    // The board photo is the biggest picture on the slide (logos are small).
    const rels = await relsOf(path.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels'));
    let best: { size: number; data: Uint8Array; ext: string } | null = null;
    const large: { size: number; blob: Blob }[] = [];
    for (const blip of Array.from(doc.getElementsByTagName('a:blip'))) {
      const target = rels.get(blip.getAttribute('r:embed') ?? '');
      if (!target) continue;
      const mediaPath = resolve(path, target);
      const ext = (mediaPath.split('.').pop() ?? '').toLowerCase();
      if (!['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) continue;
      const media = zip.file(mediaPath);
      if (!media) continue;
      const data = await media.async('uint8array');
      if (!best || data.length > best.size) best = { size: data.length, data, ext };
      if (data.length > 15000 && !large.some(l => l.size === data.length)) {
        large.push({ size: data.length, blob: new Blob([data as BlobPart], { type: ext === 'jpg' ? 'image/jpeg' : `image/${ext}` }) });
      }
    }
    const image = best && best.size > 15000
      ? await toJpeg(new Blob([best.data as BlobPart], { type: best.ext === 'jpg' ? 'image/jpeg' : `image/${best.ext}` }))
      : null;
    slides.push({ index: i + 1, lines, image, photos: large.sort((a, b) => b.size - a.size).map(l => l.blob) });
    onProgress?.(i + 1, paths.length);
  }
  return slides;
}

async function readPdf(file: File, onProgress?: (done: number, total: number) => void): Promise<DeckSlide[]> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const total = Math.min(doc.numPages, MAX_SLIDES);
  const slides: DeckSlide[] = [];
  for (let n = 1; n <= total; n++) {
    const page = await doc.getPage(n);

    const lines = pdfPageLines((await page.getTextContent()).items as PdfItem[]);

    // The page itself is the photo (PDF decks usually put the board picture on each page).
    let image: Blob | null = null;
    try {
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2, PHOTO_MAX_PX / Math.max(base.width, base.height)) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        image = await new Promise(res => canvas.toBlob(b => res(b), 'image/jpeg', 0.82));
      }
    } catch { /* text is still useful without a picture */ }
    slides.push({ index: n, lines, image, photos: image ? [image] : [] });
    page.cleanup();
    onProgress?.(n, total);
  }
  await doc.loadingTask.destroy();
  return slides;
}

/** Reads a .pptx or .pdf deck. */
export async function readDeck(file: File, onProgress?: (done: number, total: number) => void): Promise<DeckSlide[]> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'pptx') return readPptx(file, onProgress);
  if (ext === 'pdf') return readPdf(file, onProgress);
  if (ext === 'ppt') throw new Error('Old .ppt files can\'t be read. Open it in PowerPoint and "Save As" .pptx (or PDF), then upload that.');
  throw new Error('Upload a PowerPoint (.pptx) or PDF deck.');
}
