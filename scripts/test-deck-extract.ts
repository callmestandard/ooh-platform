// Checks the deck-reading rules against slides written the way owners do.
//   npx tsx scripts/test-deck-extract.ts
import { extractBoard, deckCity, findContact, findCity } from '../src/lib/deck-import/extract';
import { addressQueries } from '../src/lib/geocode-board';

type Case = { name: string; lines: string[]; expect: Partial<Record<string, string>> | null };
const cases: Case[] = [
  {
    name: 'labelled slide, feet, naira',
    lines: ['ALONG ADENIJI ADELE BY 3RD MAINLAND BRIDGE (LION)', 'SIZE: 40FT X 20FT', 'TYPE: UNIPOLE', 'ILLUMINATION: FRONT-LIT', 'RATE: N7,000,000 per month', 'GPS: 6.4560, 3.3995'],
    expect: { 'Board Name': 'ALONG ADENIJI ADELE BY 3RD MAINLAND BRIDGE (LION)', City: 'Lagos', Area: 'Third Mainland', Format: 'unipole', 'Width (m)': '12.2', 'Height (m)': '6.1', Illuminated: 'Yes', 'Monthly Rate': '7000000', Latitude: '6.456000', Longitude: '3.399500' },
  },
  {
    name: 'LED, millions, metres, two faces',
    lines: ['LED SCREEN – OZUMBA MBADIWE, VICTORIA ISLAND', 'Location - Ozumba Mbadiwe Avenue, opposite Federal Palace', 'Dimension: 12m x 6m', 'Double sided', 'Price: ₦4.5m monthly'],
    expect: { City: 'Lagos', Format: 'led', 'Width (m)': '12', 'Height (m)': '6', Illuminated: 'Yes', 'Monthly Rate': '4500000', Faces: '2', Address: 'Ozumba Mbadiwe Avenue, opposite Federal Palace' },
  },
  {
    name: 'Abuja gantry, DMS GPS, unlit',
    lines: ['Site Name: Wuse Market Gantry', 'Address: Herbert Macaulay Way, Wuse Zone 3', 'Format: Gantry', 'Lighting: Non-illuminated', 'Coordinates: 9°04\'07.0"N 7°27\'57.0"E', 'Rate (NGN): 2,500,000'],
    expect: { 'Board Name': 'Wuse Market Gantry', City: 'Abuja', State: 'FCT', Area: 'Wuse', Format: 'gantry', Illuminated: 'No', 'Monthly Rate': '2500000' },
  },
  {
    name: 'table rows joined with tabs, unitless size',
    lines: ['LEKKI-EPE EXPRESSWAY BY CHEVRON', 'Size\t48 x 12', 'Structure\tBillboard', 'Faces\t1', 'Lat\t6.4401', 'Long\t3.5312'],
    expect: { City: 'Lagos', Format: 'billboard', 'Width (m)': '14.6', 'Height (m)': '3.7', Faces: '1', Latitude: '6.440100', Longitude: '3.531200' },
  },
  { name: 'cover slide', lines: ['XYZ OUTDOOR MEDIA', 'Lagos Inventory 2026', 'Prepared for MaxiMedia'], expect: null },
  { name: 'contact slide', lines: ['CONTACT US', 'Tel: 0803 123 4567', 'Email: sales@xyz.ng', 'www.xyz.ng'], expect: null },
  { name: 'year and phone are not rates', lines: ['IKEJA ALONG OBAFEMI AWOLOWO WAY', 'Size: 12m x 4m', 'Available from 2026', 'Call 08031234567'], expect: { 'Monthly Rate': '', City: 'Lagos', Area: 'Ikeja' } },
];

let fail = 0;
for (const c of cases) {
  const r = extractBoard(c.lines);
  if (c.expect === null) {
    if (r !== null) { fail++; console.log('FAIL', c.name, '— expected no board, got', r); } else console.log('PASS', c.name);
    continue;
  }
  if (!r) { fail++; console.log('FAIL', c.name, '— no board read'); continue; }
  const bad = Object.entries(c.expect).filter(([k, v]) => (r as Record<string, string>)[k] !== v);
  if (bad.length) { fail++; console.log('FAIL', c.name, bad.map(([k, v]) => `${k}: got "${(r as Record<string, string>)[k]}" want "${v}"`).join(' | ')); }
  else console.log('PASS', c.name);
}
const dc = deckCity(['XYZ Outdoor — Lagos inventory', 'Site at Lekki', 'Ikeja board', 'Abuja office']);
if (dc?.city !== 'Lagos') { fail++; console.log('FAIL deck city', dc); } else console.log('PASS deck city');

const contactCases: [string[][], { name: string; phone: string } | null][] = [
  [[['Cover'], ['CONTACT US', 'Tel: 0803 123 4567', 'Email: sales@x.ng']], { name: '', phone: '08031234567' }],
  [[['Contact person: Chidi Okafor', 'WhatsApp: +234 809 876 5432']], { name: 'Chidi Okafor', phone: '08098765432' }],
  [[['Sales: Amaka Bello - 0703-555-1212']], { name: 'Amaka Bello', phone: '07035551212' }],
  [[['Size: 40ft x 20ft', 'Rate: N7,000,000']], null],
];
for (const [input, want] of contactCases) {
  const got = findContact(input);
  if (JSON.stringify(got) !== JSON.stringify(want)) { fail++; console.log('FAIL contact', JSON.stringify(input), '→', JSON.stringify(got), 'want', JSON.stringify(want)); }
  else console.log('PASS contact', want ? want.phone : 'none');
}

// Where the board is: road names that mention two cities don't count.
const cityCases: [string, string | undefined][] = [
  ['Along Lagos Ibadan Expressway By Park Iwo Road Ibadan', 'Ibadan'],
  ['Sango Ota, Ogun State', 'Ota'],
  ['Egbeda Toll Gate', 'Ibadan'],
  ['Mokola Roundabout', 'Ibadan'],
  ['Along Lagos-Abeokuta Expressway, Abule Egba, Lagos', 'Lagos'],
  ['Ikorodu Road by Anthony', 'Lagos'],
];
for (const [text, want] of cityCases) {
  const got = findCity(text)?.city;
  if (got !== want) { fail++; console.log('FAIL city', text, '→', got, 'want', want); } else console.log('PASS city', want);
}
const q = addressQueries('Along Eko Bridge By Apongbon (GIRAFFE ) FTT Costain');
if (q[0] !== 'Apongbon' || q.some(x => /costain|giraffe/i.test(x))) { fail++; console.log('FAIL queries', q); } else console.log('PASS queries', q.join(' | '));
const q2 = addressQueries('Along Lagos Ibadan Expressway By Central Motor Park Iwo Road Ibadan');
if (!q2.some(x => /^Iwo Road$/i.test(x)) || !q2.some(x => /Central Motor Park/i.test(x))) { fail++; console.log('FAIL queries 2', q2); } else console.log('PASS queries 2', q2.join(' | '));
console.log(fail ? `${fail} failed` : 'all passed');
process.exit(fail ? 1 : 0);
