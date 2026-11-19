/**
 * Search and sharing for the public website (Round 13): one list of pages with their title, description and structured data.
 * The build (vite.config.ts) writes each page as its own HTML file with these tags in the <head>, plus sitemap.xml and robots.txt,
 * so crawlers and link previews (which don't run JavaScript) see the right page. In the browser, `useMeta` (meta.ts) renders the
 * same tags. Pure TypeScript: no DOM, no Vite, so the build and the tests can import it.
 */
import { FAQS, fillFaq, type FaqSet } from './faqs';

export const SITE = {
  name: 'DingoGo',
  legalName: 'DingoGo Rideshare & Courier',
  /** Published contact from the business plan; the live site uses /public/config when it loads. */
  phone: '0432 101 175',
  email: 'contact@aperrke.com.au',
  hours: '6am to midnight, 7 days',
  defaultUrl: 'https://dingogo-steel.vercel.app',
  ogImage: '/og-1200.jpg',
  ogImageAlt: 'DingoGo: local rides and deliveries in Alice Springs, Aboriginal-owned',
  themeColor: '#14213D',
};
export const HOME_TITLE = 'DingoGo — local rides and deliveries in Alice Springs';

export type Page = {
  path: string; title: string; description: string;
  /** FAQ set shown on the page (and marked up as FAQPage). */
  faq?: FaqSet;
  /** Extra structured data kinds for the page. */
  ld?: ('business' | 'website' | 'rides' | 'parcels' | 'tours' | 'airport' | 'hospital' | 'business-accounts')[];
  priority?: number; changefreq?: 'weekly' | 'monthly' | 'yearly';
  /** Breadcrumb label (defaults to the title). */
  crumb?: string;
};

export const PAGES: Page[] = [
  { path: '/', title: 'DingoGo', description: 'Aboriginal-owned, local rideshare and same-day courier in Alice Springs (Mparntwe), going electric. See your fixed price before you book.',
    faq: 'home', ld: ['business', 'website', 'rides', 'parcels'], priority: 1, changefreq: 'weekly' },
  { path: '/fares', title: 'Check a fare', description: 'Work out the fixed price of a DingoGo ride or parcel in Alice Springs, GST and the NT levy included, and share the link.', ld: ['rides'], priority: 0.9, changefreq: 'weekly' },
  { path: '/rides', title: 'Rides', description: 'Fixed-price local rides around Alice Springs: airport, town, hospital and home. Pet-friendly cars and assistance animals always welcome.', ld: ['rides'], priority: 0.9 },
  { path: '/airport', title: 'Alice Springs Airport transfers', crumb: 'Airport transfers', description: 'Fixed-price rides between Alice Springs Airport and town with a local driver. Book ahead for early flights, see your price before you book.', faq: 'airport', ld: ['airport'], priority: 0.9 },
  { path: '/hospital', title: 'Rides to hospital and clinics', crumb: 'Hospital and clinic trips', description: 'Rides to Alice Springs Hospital, clinics and appointments, with help for walkers and wheelchairs, carers welcome, and NDIS and health service accounts.', faq: 'hospital', ld: ['hospital'], priority: 0.9 },
  { path: '/parcels', title: 'Send a parcel', description: 'Same-day parcel delivery around Alice Springs by local drivers, with a delivery PIN or signature on every handover.', faq: 'parcels', ld: ['parcels'], priority: 0.8 },
  { path: '/tours', title: 'Private tours', description: 'Private tours with a local driver from Alice Springs: Telegraph Station, the West MacDonnell gaps, Desert Park and Emily and Jessie Gaps.', faq: 'tours', ld: ['tours'], priority: 0.8 },
  { path: '/business', title: 'Business & events', description: 'Business accounts, NDIS plan-manager invoicing, community organisation billing and event transport in Alice Springs.', faq: 'business', ld: ['business-accounts'], priority: 0.8 },
  { path: '/drive', title: 'Drive with us', description: 'Drive your own car for DingoGo in Alice Springs, and soon in regional South Australia. What the NT requires of you and your car, how we help you get accredited, and how earnings work.', priority: 0.8 },
  { path: '/rewards', title: 'Rewards & partners', description: 'Earn Dingo Points on every DingoGo trip, bring a friend for 500 points each, and swap points for coffee at partner cafés or money off your next ride.', priority: 0.6 },
  { path: '/advertise', title: 'Advertise', description: 'Advertise your Alice Springs business on DingoGo, on roof screens (subject to NT approval) and inside the app.', priority: 0.4, changefreq: 'monthly' },
  { path: '/safety', title: 'Safety', description: 'How DingoGo keeps riders, recipients and drivers safe: vetted drivers, trip PINs, live trip sharing, an emergency button and route checks.', priority: 0.6, changefreq: 'monthly' },
  { path: '/about', title: 'About', description: 'DingoGo is an Aboriginal-owned, local rideshare and courier business in Alice Springs, going electric. Owned by Johnathan Ah Chee and Micah Bartlett.', priority: 0.6, changefreq: 'monthly' },
  { path: '/help', title: 'Help & FAQ', description: 'Answers to common questions about DingoGo rides, parcels, payments, points and accounts.', faq: 'general', priority: 0.7, changefreq: 'monthly' },
  { path: '/delete-account', title: 'Delete your account', description: 'Delete your DingoGo rider or driver account and personal information, with or without the app, and what we have to keep.', priority: 0.3, changefreq: 'yearly' },
  { path: '/legal/privacy', title: 'Privacy policy', description: 'How DingoGo collects, uses and protects personal information.', priority: 0.3, changefreq: 'yearly' },
  { path: '/legal/terms', title: 'Terms of use', description: 'The terms for using DingoGo rides, deliveries and the app.', priority: 0.3, changefreq: 'yearly' },
  { path: '/legal/cancellations', title: 'Cancellations and refunds', description: 'When cancellation fees apply and how to ask for a refund.', priority: 0.3, changefreq: 'yearly' },
  { path: '/legal/prohibited-items', title: 'Prohibited items', description: 'Items DingoGo couriers will not carry.', priority: 0.3, changefreq: 'yearly' },
];

/** Paths that are private or per-person: never indexed, never in the sitemap. */
export const PRIVATE_PREFIXES = ['/track/', '/drive/status/', '/invite/', '/hire/'];
/** Other apps and the API on the same domain: kept out of search. */
export const APP_PREFIXES = ['/rider/', '/driver/', '/admin/', '/partner/', '/roof/', '/api/'];

export const cleanPath = (path: string) => {
  const p = ('/' + path.split(/[?#]/)[0]).replace(/\/{2,}/g, '/');
  return p.length > 1 ? p.replace(/\/$/, '') : '/';
};
export const pageFor = (path: string) => PAGES.find((p) => p.path === cleanPath(path));
export const fullTitle = (title: string) => (title === 'DingoGo' ? HOME_TITLE : `${title} | DingoGo`);
export const siteUrl = (raw?: string | null) => (raw || SITE.defaultUrl).replace(/\/+$/, '');

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** JSON inside <script>: never let a value close the tag. */
const ldJson = (o: unknown) => JSON.stringify(o).replace(/</g, '\\u003c');

type Contact = { phone: string; email: string; hours: string };
const intlPhone = (p: string) => { const d = p.replace(/\D/g, ''); return d.startsWith('0') ? `+61${d.slice(1)}` : `+${d}`; };

const AREA = { '@type': 'City', name: 'Alice Springs', alternateName: 'Mparntwe', containedInPlace: { '@type': 'State', name: 'Northern Territory' } };

export function structuredData(page: Page, base: string, contact: Contact = SITE): object[] {
  const url = base + (page.path === '/' ? '/' : page.path);
  const biz = `${base}/#business`;
  const out: object[] = [];
  const service = (name: string, serviceType: string, description: string, extra: object = {}) => ({
    '@context': 'https://schema.org', '@type': serviceType === 'Taxi' ? 'TaxiService' : 'Service', name, serviceType, description,
    provider: { '@id': biz }, areaServed: AREA, url, ...extra,
  });
  for (const kind of page.ld ?? []) {
    if (kind === 'business') {
      out.push({
        '@context': 'https://schema.org', '@type': 'LocalBusiness', '@id': biz, name: SITE.name, legalName: SITE.legalName, url: `${base}/`,
        logo: `${base}/icon-192.png`, image: base + SITE.ogImage, description: PAGES[0].description,
        telephone: intlPhone(contact.phone), email: contact.email, priceRange: '$$', currenciesAccepted: 'AUD', paymentAccepted: 'Card, DingoGo credit, account',
        address: { '@type': 'PostalAddress', addressLocality: 'Alice Springs', addressRegion: 'NT', postalCode: '0870', addressCountry: 'AU' },
        geo: { '@type': 'GeoCoordinates', latitude: -23.6984, longitude: 133.8822 }, areaServed: AREA,
        openingHoursSpecification: [{ '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], opens: '06:00', closes: '23:59' }],
        founder: [{ '@type': 'Person', name: 'Johnathan Ah Chee' }, { '@type': 'Person', name: 'Micah Bartlett' }],
      });
    }
    if (kind === 'website') out.push({ '@context': 'https://schema.org', '@type': 'WebSite', name: SITE.name, url: `${base}/`, inLanguage: 'en-AU', publisher: { '@id': biz } });
    if (kind === 'rides') out.push(service('DingoGo rides', 'Taxi', 'Fixed-price local rides around Alice Springs with local drivers, booked in the app or by phone.'));
    if (kind === 'airport') out.push(service('Alice Springs Airport transfers', 'Taxi', page.description));
    if (kind === 'hospital') out.push(service('Rides to hospital and clinics', 'Taxi', page.description));
    if (kind === 'parcels') out.push(service('Same-day parcel delivery', 'Courier', 'Same-day parcel delivery across Alice Springs, handed over with a PIN, signature or photo.'));
    if (kind === 'tours') out.push(service('Private tours from Alice Springs', 'Private tour', page.description));
    if (kind === 'business-accounts') out.push(service('Business, NDIS and community accounts', 'Business transport', page.description));
  }
  if (page.faq) {
    out.push({
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: FAQS[page.faq].map((f) => ({ '@type': 'Question', name: fillFaq(f.q, contact), acceptedAnswer: { '@type': 'Answer', text: fillFaq(f.a, contact) } })),
    });
  }
  if (page.path !== '/') {
    const parts = [{ name: page.crumb ?? page.title, url }];
    out.push({
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [{ name: 'Home', url: `${base}/` }, ...parts].map((p, i) => ({ '@type': 'ListItem', position: i + 1, name: p.name, item: p.url })),
    });
  }
  return out;
}

export type HeadInput = { title: string; description: string; path: string; noindex?: boolean; page?: Page };

/** The <head> tags for one page, each marked data-seo so the browser can swap them on navigation. */
export function headTags(h: HeadInput, base: string, contact: Contact = SITE) {
  const title = fullTitle(h.title);
  const url = base + (cleanPath(h.path) === '/' ? '/' : cleanPath(h.path));
  const img = base + SITE.ogImage;
  const tags = [
    `<title data-seo>${esc(title)}</title>`,
    `<meta data-seo name="description" content="${esc(h.description)}" />`,
    h.noindex ? `<meta data-seo name="robots" content="noindex, nofollow" />` : `<link data-seo rel="canonical" href="${esc(url)}" />`,
    `<meta data-seo property="og:type" content="website" />`,
    `<meta data-seo property="og:site_name" content="${SITE.name}" />`,
    `<meta data-seo property="og:locale" content="en_AU" />`,
    `<meta data-seo property="og:title" content="${esc(title)}" />`,
    `<meta data-seo property="og:description" content="${esc(h.description)}" />`,
    ...(h.noindex ? [] : [`<meta data-seo property="og:url" content="${esc(url)}" />`]),
    `<meta data-seo property="og:image" content="${esc(img)}" />`,
    `<meta data-seo property="og:image:width" content="1200" />`,
    `<meta data-seo property="og:image:height" content="630" />`,
    `<meta data-seo property="og:image:alt" content="${esc(SITE.ogImageAlt)}" />`,
    `<meta data-seo name="twitter:card" content="summary_large_image" />`,
    `<meta data-seo name="twitter:title" content="${esc(title)}" />`,
    `<meta data-seo name="twitter:description" content="${esc(h.description)}" />`,
    `<meta data-seo name="twitter:image" content="${esc(img)}" />`,
  ];
  if (h.page && !h.noindex) for (const o of structuredData(h.page, base, contact)) tags.push(`<script data-seo type="application/ld+json">${ldJson(o)}</script>`);
  return tags.join('\n    ');
}

export function sitemapXml(base: string, lastmod: string) {
  const urls = PAGES.map((p) => `  <url><loc>${esc(base + (p.path === '/' ? '/' : p.path))}</loc><lastmod>${lastmod}</lastmod>` +
    `<changefreq>${p.changefreq ?? 'monthly'}</changefreq><priority>${(p.priority ?? 0.5).toFixed(1)}</priority></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

export function robotsTxt(base: string) {
  return ['User-agent: *', 'Allow: /', ...[...APP_PREFIXES, ...PRIVATE_PREFIXES].map((p) => `Disallow: ${p}`), '', `Sitemap: ${base}/sitemap.xml`, ''].join('\n');
}

/**
 * Analytics: the path sent for a page view. Share-trip tokens, application status links and invite codes are replaced, and only
 * utm_* tags are kept from the query (a fare link's places can be someone's home).
 */
export function analyticsPath(pathWithQuery: string) {
  const [pathPart, query = ''] = pathWithQuery.split('#')[0].split('?');
  let p = cleanPath(pathPart);
  p = p.replace(/^\/track\/[^/]+/, '/track/:token').replace(/^\/drive\/status\/[^/]+/, '/drive/status/:token').replace(/^\/invite\/[^/]+/, '/invite/:code');
  const keep = new URLSearchParams();
  for (const [k, v] of new URLSearchParams(query)) if (/^utm_(source|medium|campaign|content|term)$/.test(k)) keep.set(k, v.slice(0, 80));
  const q = keep.toString();
  return q ? `${p}?${q}` : p;
}
