// Reads GPS coordinates typed or pasted by people, in the formats decks,
// phones and Google Maps produce.

export type Coords = { lat: number; lng: number };

function inRange({ lat, lng }: Coords): Coords | null {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

/**
 * Reads GPS coordinates typed or pasted in the usual formats:
 *   6.4541, 3.4206 · 6.4541 3.4206 · 6.4541° N, 3.4206° E
 *   6°27'14.8"N 3°25'14.2"E · a Google Maps link (…/@6.4541,3.4206,17z or ?q=6.4541,3.4206)
 */
export function parseCoordinates(input: string): Coords | null {
  const s = input.trim().replace(/[′’]/g, "'").replace(/[″”]/g, '"');
  if (!s) return null;

  const link = s.match(/(?:@|[?&](?:q|query|ll)=)(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/);
  if (link) return inRange({ lat: +link[1], lng: +link[2] });

  const dms = [...s.matchAll(/(\d{1,3})\s*°\s*(\d{1,2})\s*'\s*(\d{1,2}(?:\.\d+)?)\s*(?:"|'')?\s*([NSEW])/gi)];
  if (dms.length === 2) {
    const val = (m: RegExpMatchArray) => (+m[1] + +m[2] / 60 + +m[3] / 3600) * (/[SW]/i.test(m[4]) ? -1 : 1);
    const latM = dms.find(m => /[NS]/i.test(m[4])), lngM = dms.find(m => /[EW]/i.test(m[4]));
    if (latM && lngM) return inRange({ lat: val(latM), lng: val(lngM) });
  }

  const dec = s.match(/^(-?\d{1,2}(?:\.\d+)?)\s*°?\s*([NS])?\s*(?:,\s*|\s+)(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])?$/i);
  if (dec && (dec[1].includes('.') || dec[3].includes('.'))) {
    const lat = +dec[1] * (dec[2]?.toUpperCase() === 'S' ? -1 : 1);
    const lng = +dec[3] * (dec[4]?.toUpperCase() === 'W' ? -1 : 1);
    return inRange({ lat, lng });
  }
  return null;
}
