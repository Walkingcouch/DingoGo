/** Common Alice Springs (Mparntwe) places for quick address search. Coordinates approximate. */
export const PLACES = [
  { name: 'Alice Springs Airport', address: 'Santa Teresa Rd, Alice Springs NT 0870', lat: -23.8067, lng: 133.9022, tags: ['airport'] },
  { name: 'Todd Mall', address: 'Todd Mall, Alice Springs NT 0870', lat: -23.6984, lng: 133.8822, tags: ['shopping', 'cbd'] },
  { name: 'Alice Springs Hospital', address: '6 Gap Rd, The Gap NT 0870', lat: -23.7076, lng: 133.8770, tags: ['hospital'] },
  { name: 'Yeperenye Shopping Centre', address: '36 Hartley St, Alice Springs NT 0870', lat: -23.7008, lng: 133.8818, tags: ['shopping'] },
  { name: 'Alice Plaza', address: '36 Todd Mall, Alice Springs NT 0870', lat: -23.6974, lng: 133.8826, tags: ['shopping'] },
  { name: 'Alice Springs Desert Park', address: '871 Larapinta Dr, Alice Springs NT 0870', lat: -23.7076, lng: 133.8205, tags: ['tourism'] },
  { name: 'Alice Springs Telegraph Station', address: 'Herbert Heritage Dr, Alice Springs NT 0870', lat: -23.6676, lng: 133.8853, tags: ['tourism', 'heritage'] },
  { name: 'Anzac Hill', address: 'Anzac Hill Rd, Alice Springs NT 0870', lat: -23.6920, lng: 133.8790, tags: ['lookout'] },
  { name: 'Araluen Arts Centre', address: '61 Larapinta Dr, Araluen NT 0870', lat: -23.7036, lng: 133.8622, tags: ['arts'] },
  { name: 'Olive Pink Botanic Garden', address: 'Tuncks Rd, Alice Springs NT 0870', lat: -23.7066, lng: 133.8875, tags: ['nature'] },
  { name: 'Alice Springs Railway Station (The Ghan)', address: 'George Cres, Alice Springs NT 0870', lat: -23.7069, lng: 133.8701, tags: ['transport'] },
  { name: 'Charles Darwin University — Alice Springs', address: 'Grevillea Dr, Sadadeen NT 0870', lat: -23.7034, lng: 133.8939, tags: ['education'] },
  { name: 'Lasseters Hotel Casino', address: '93 Barrett Dr, Alice Springs NT 0870', lat: -23.7178, lng: 133.8869, tags: ['hotel'] },
  { name: 'Alice Springs Reptile Centre', address: '9 Stuart Terrace, Alice Springs NT 0870', lat: -23.7019, lng: 133.8786, tags: ['tourism'] },
  { name: 'School of the Air', address: '80 Head St, Braitling NT 0870', lat: -23.6830, lng: 133.8700, tags: ['tourism'] },
  { name: 'Royal Flying Doctor Service Tourist Facility', address: '8-10 Stuart Terrace, Alice Springs NT 0870', lat: -23.7024, lng: 133.8797, tags: ['tourism'] },
  { name: 'Simpsons Gap (Rungutjirba)', address: 'Larapinta Dr, Tjoritja / West MacDonnell NP', lat: -23.6794, lng: 133.7194, tags: ['nature', 'tour'] },
  { name: 'Emily Gap (Anthwerrke)', address: 'Ross Hwy, Alice Springs NT 0870', lat: -23.7417, lng: 133.9414, tags: ['nature', 'sacred'] },
  { name: 'Gillen', address: 'Gillen NT 0870', lat: -23.7090, lng: 133.8600, tags: ['suburb'] },
  { name: 'Larapinta', address: 'Larapinta NT 0875', lat: -23.6950, lng: 133.8350, tags: ['suburb'] },
  { name: 'Braitling', address: 'Braitling NT 0870', lat: -23.6830, lng: 133.8680, tags: ['suburb'] },
  { name: 'Eastside', address: 'East Side NT 0870', lat: -23.6950, lng: 133.8960, tags: ['suburb'] },
  { name: 'Sadadeen', address: 'Sadadeen NT 0870', lat: -23.7040, lng: 133.9010, tags: ['suburb'] },
  { name: 'Araluen', address: 'Araluen NT 0870', lat: -23.6960, lng: 133.8560, tags: ['suburb'] },
];

export function searchPlaces(qs: string) {
  const s = qs.trim().toLowerCase();
  if (!s) return PLACES.slice(0, 8);
  return PLACES.filter((p) => (p.name + ' ' + p.address + ' ' + p.tags.join(' ')).toLowerCase().includes(s)).slice(0, 10);
}
