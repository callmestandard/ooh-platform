// Reads the GPS a camera app prints on a photo ("GPS Map Camera" and similar),
// from text found on the picture. Owners' decks often carry these stamps, and
// they are the board's exact spot.
//
// Forms seen in decks:
//   Lat 7.396822° Long 3.920231°
//   6.6970834N 3.2324984E
//   4°57'11.724"N 7°0'41.814"E

/** Coordinates inside Nigeria, or null. */
function inNigeria(lat: number, lng: number): { lat: number; lng: number } | null {
  return lat > 3.5 && lat < 14.5 && lng > 2 && lng < 15.5 ? { lat: +lat.toFixed(6), lng: +lng.toFixed(6) } : null;
}

export function stampGps(text: string): { lat: number; lng: number } | null {
  // Text read off a photo mixes up O/0 and uses , for . now and then.
  const s = text
    .replace(/(?<=\d)[oO]|[oO](?=\d)/g, '0')
    .replace(/(?<=\d),(?=\d{3,})/g, '.')
    .replace(/[“”″]/g, '"')
    .replace(/[‘’′`]/g, "'");

  const dms = s.match(/(\d{1,2})\s*°\s*(\d{1,2})\s*'\s*(\d{1,2}(?:\.\d+)?)\s*"?\s*N[\s,]+(\d{1,3})\s*°\s*(\d{1,2})\s*'\s*(\d{1,2}(?:\.\d+)?)\s*"?\s*E/i);
  if (dms) {
    const d = dms.slice(1).map(Number);
    const g = inNigeria(d[0] + d[1] / 60 + d[2] / 3600, d[3] + d[4] / 60 + d[5] / 3600);
    if (g) return g;
  }
  const m = s.match(/lat\w*\s*[:.]?\s*(\d{1,2}\.\d{3,})\s*°?[^\d]{0,25}?lon\w*\s*[:.]?\s*(\d{1,2}\.\d{3,})/i)
    ?? s.match(/\b(\d{1,2}\.\d{4,})\s*°?\s*N\b[\s,]*(\d{1,2}\.\d{4,})\s*°?\s*E?/i)
    ?? s.match(/\b(\d{1,2}\.\d{5,})\s*°?\s*[,/ ]\s*(\d{1,2}\.\d{5,})\b/);
  return m ? inNigeria(parseFloat(m[1]), parseFloat(m[2])) : null;
}
