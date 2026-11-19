/** Common Alice Springs (Mparntwe) places for quick address search. Coordinates approximate.
 *  Dual names: `arrernte` is the Arrernte name in public use (NT Place Names register / Parks and Wildlife signs) and is shown
 *  first with the English name after it. Spellings to be confirmed with Arrernte Traditional Owners before printed material.
 *  `sacred`: a sacred site — results carry a short respect note. */
export interface Place { name: string; arrernte?: string; address: string; lat: number; lng: number; tags: string[]; sacred?: boolean }
export const RESPECT_NOTE = 'Sacred site. Please respect signs: no climbing or photos where asked.';

export const PLACES: Place[] = [
  { name: 'Alice Springs Airport', address: 'Santa Teresa Rd, Alice Springs NT 0870', lat: -23.8067, lng: 133.9022, tags: ['airport'] },
  { name: 'Todd Mall', address: 'Todd Mall, Alice Springs NT 0870', lat: -23.6984, lng: 133.8822, tags: ['shopping', 'cbd', 'town centre', 'mparntwe'] },
  { name: 'Alice Springs Hospital', address: '6 Gap Rd, The Gap NT 0870', lat: -23.7076, lng: 133.8770, tags: ['hospital'] },
  { name: 'Yeperenye Shopping Centre', address: '36 Hartley St, Alice Springs NT 0870', lat: -23.7008, lng: 133.8818, tags: ['shopping'] },
  { name: 'Alice Plaza', address: '36 Todd Mall, Alice Springs NT 0870', lat: -23.6974, lng: 133.8826, tags: ['shopping'] },
  { name: 'Alice Springs Desert Park', address: '871 Larapinta Dr, Alice Springs NT 0870', lat: -23.7076, lng: 133.8205, tags: ['tourism'] },
  { name: 'Alice Springs Telegraph Station', address: 'Herbert Heritage Dr, Alice Springs NT 0870', lat: -23.6676, lng: 133.8853, tags: ['tourism', 'heritage'] },
  { name: 'Anzac Hill', arrernte: 'Untyeyetweleye', address: 'Anzac Hill Rd, Alice Springs NT 0870', lat: -23.6920, lng: 133.8790, tags: ['lookout'] },
  { name: 'Araluen Arts Centre', address: '61 Larapinta Dr, Araluen NT 0870', lat: -23.7036, lng: 133.8622, tags: ['arts'] },
  { name: 'Olive Pink Botanic Garden', address: 'Tuncks Rd, Alice Springs NT 0870', lat: -23.7066, lng: 133.8875, tags: ['nature'] },
  { name: 'Alice Springs Railway Station (The Ghan)', address: 'George Cres, Alice Springs NT 0870', lat: -23.7069, lng: 133.8701, tags: ['transport'] },
  { name: 'Charles Darwin University — Alice Springs', address: 'Grevillea Dr, Sadadeen NT 0870', lat: -23.7034, lng: 133.8939, tags: ['education'] },
  { name: 'Lasseters Hotel Casino', address: '93 Barrett Dr, Alice Springs NT 0870', lat: -23.7178, lng: 133.8869, tags: ['hotel'] },
  { name: 'Alice Springs Reptile Centre', address: '9 Stuart Terrace, Alice Springs NT 0870', lat: -23.7019, lng: 133.8786, tags: ['tourism'] },
  { name: 'School of the Air', address: '80 Head St, Braitling NT 0870', lat: -23.6830, lng: 133.8700, tags: ['tourism'] },
  { name: 'Royal Flying Doctor Service Tourist Facility', address: '8-10 Stuart Terrace, Alice Springs NT 0870', lat: -23.7024, lng: 133.8797, tags: ['tourism'] },
  { name: 'Simpsons Gap', arrernte: 'Rungutjirba', address: 'Larapinta Dr, Tjoritja / West MacDonnell NP', lat: -23.6794, lng: 133.7194, tags: ['nature', 'tour'], sacred: true },
  { name: 'Emily Gap', arrernte: 'Anthwerrke', address: 'Ross Hwy, Alice Springs NT 0870', lat: -23.7417, lng: 133.9414, tags: ['nature', 'sacred'], sacred: true },
  { name: 'Jessie Gap', arrernte: 'Atherrke', address: 'Ross Hwy, Alice Springs NT 0870', lat: -23.7435, lng: 133.9640, tags: ['nature', 'sacred'], sacred: true },
  { name: 'Heavitree Gap', arrernte: 'Ntaripe', address: 'Stuart Hwy, The Gap NT 0870', lat: -23.7215, lng: 133.8823, tags: ['nature', 'sacred'], sacred: true },
  { name: 'Mount Gillen', arrernte: 'Alhekulyele', address: 'Larapinta Dr, Gillen NT 0870', lat: -23.7115, lng: 133.8238, tags: ['nature', 'sacred'], sacred: true },
  { name: 'Todd River', arrernte: 'Lhere Mparntwe', address: 'Todd River, Alice Springs NT 0870', lat: -23.6995, lng: 133.8850, tags: ['nature', 'river'] },
  { name: 'Standley Chasm', arrernte: 'Angkerle Atwatye', address: 'Standley Chasm Rd, Tjoritja / West MacDonnell NP', lat: -23.7184, lng: 133.4722, tags: ['nature', 'tour', 'sacred'], sacred: true },
  { name: 'Ellery Creek Big Hole', arrernte: 'Udepata', address: 'Namatjira Dr, Tjoritja / West MacDonnell NP', lat: -23.7802, lng: 133.0717, tags: ['nature', 'tour'] },
  { name: 'Ormiston Gorge', arrernte: 'Kwartatuma', address: 'Namatjira Dr, Tjoritja / West MacDonnell NP', lat: -23.6317, lng: 132.7270, tags: ['nature', 'tour'] },
  { name: 'Gillen', address: 'Gillen NT 0870', lat: -23.7090, lng: 133.8600, tags: ['suburb'] },
  { name: 'Larapinta', address: 'Larapinta NT 0875', lat: -23.6950, lng: 133.8350, tags: ['suburb'] },
  { name: 'Braitling', address: 'Braitling NT 0870', lat: -23.6830, lng: 133.8680, tags: ['suburb'] },
  { name: 'Eastside', address: 'East Side NT 0870', lat: -23.6950, lng: 133.8960, tags: ['suburb'] },
  { name: 'Sadadeen', address: 'Sadadeen NT 0870', lat: -23.7040, lng: 133.9010, tags: ['suburb'] },
  { name: 'Araluen', address: 'Araluen NT 0870', lat: -23.6960, lng: 133.8560, tags: ['suburb'] },
];

export function searchPlaces(qs: string) {
  const fold = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const s = fold(qs.trim());
  const hits = !s ? PLACES.slice(0, 8)
    : PLACES.filter((p) => fold([p.name, p.arrernte ?? '', p.address, p.tags.join(' ')].join(' ')).includes(s)).slice(0, 10);
  return hits.map(placeOut);
}

/** "Rungutjirba (Simpsons Gap)": the Arrernte name first, then the English one. */
export const placeLabel = (p: Place) => (p.arrernte ? `${p.arrernte} (${p.name})` : p.name);
const placeOut = (p: Place) => ({
  name: placeLabel(p), english_name: p.name, arrernte_name: p.arrernte ?? null, address: p.address, lat: p.lat, lng: p.lng, tags: p.tags,
  ...(p.sacred ? { sacred: true, note: RESPECT_NOTE } : {}),
});
