// Reads GPS stamps off deck photos in the browser. The stamp is small text
// near the bottom of the picture, so only that part is read, enlarged, as is
// and with colours flipped (white text on a busy photo reads better dark on
// light). The text reader (tesseract.js) loads on first use.

import { stampGps } from './stamp-gps';

type Reader = { recognize: (img: HTMLCanvasElement) => Promise<{ data: { text: string } }>; terminate: () => Promise<unknown> };
let reader: Promise<Reader> | null = null;

function getReader(): Promise<Reader> {
  if (!reader) {
    reader = import('tesseract.js').then(t => t.createWorker('eng') as unknown as Promise<Reader>);
    reader.catch(() => { reader = null; });
  }
  return reader;
}

/** The bottom of the photo, and its bottom-right corner, enlarged; each plain and flipped. */
async function stampAreas(photo: Blob): Promise<HTMLCanvasElement[]> {
  const bmp = await createImageBitmap(photo);
  const out: HTMLCanvasElement[] = [];
  for (const [fromLeft, fromTop] of [[0, 0.55], [0.35, 0.6]]) {
    const sx = Math.floor(bmp.width * fromLeft), sy = Math.floor(bmp.height * fromTop);
    const sw = bmp.width - sx, sh = bmp.height - sy;
    if (sw < 50 || sh < 20) continue;
    const scale = Math.min(3, Math.max(1, 2400 / sw));
    for (const filter of ['grayscale(1) contrast(1.3)', 'grayscale(1) invert(1) contrast(2.2)']) {
      const c = document.createElement('canvas');
      c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
      const ctx = c.getContext('2d');
      if (!ctx) continue;
      ctx.filter = filter;
      ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
      out.push(c);
    }
  }
  bmp.close();
  return out;
}

/** GPS printed on any of a slide's photos, or null. */
export async function gpsFromPhotos(photos: Blob[], cancelled: () => boolean = () => false): Promise<{ lat: number; lng: number } | null> {
  const r = await getReader();
  for (const photo of photos) {
    let areas: HTMLCanvasElement[] = [];
    try { areas = await stampAreas(photo); } catch { continue; }
    for (const area of areas) {
      if (cancelled()) return null;
      const { data } = await r.recognize(area);
      const g = stampGps(data.text);
      if (g) return g;
    }
  }
  return null;
}

/** Frees the text reader once a deck is done. */
export async function stopPhotoReader() {
  const r = reader;
  reader = null;
  if (r) await (await r).terminate().catch(() => {});
}
