// Dry run (or, with --apply, fix) of board pins using the import geocoder.
// npx tsx scripts/geocode-dry-run.ts [--apply]
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { geocodeBoard } from '../src/lib/geocode-board';
import { findCity } from '../src/lib/deck-import/extract';

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]));
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const apply = process.argv.includes('--apply');

(async () => {
  const { data } = await svc.from('boards').select('id, name, address, area, city, state, latitude, longitude').order('created_at');
  for (const b of data ?? []) {
    const where = findCity(`${b.address ?? ''}\n${b.name}`) ?? { city: b.city, state: b.state };
    const hit = await geocodeBoard({ address: b.address ?? b.name, name: b.name, area: b.area ?? '', city: where.city, state: where.state }, env.NEXT_PUBLIC_MAPBOX_TOKEN);
    console.log(`${b.name.slice(0, 48).padEnd(48)} | ${String(b.city).padEnd(7)}→ ${where.city.padEnd(7)} | ${hit ? `${hit.lat.toFixed(5)},${hit.lng.toFixed(5)} ${hit.confidence.padEnd(4)} ${hit.label.slice(0, 60)}` : 'none'}`);
    if (apply && hit) {
      await svc.from('boards').update({ city: where.city, state: where.state, latitude: hit.lat, longitude: hit.lng }).eq('id', b.id);
    }
    await new Promise(r => setTimeout(r, 300));
  }
})();
