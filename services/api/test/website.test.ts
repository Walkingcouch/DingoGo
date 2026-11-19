/**
 * Round 13: the public website's search and sharing logic (apps/web/src/seo.ts) and the website ↔ rider-app links
 * (packages/shared/src/handoff.ts). Pure functions; no database. Loaded by URL so the API's tsc project doesn't pull in web code.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const load = (rel: string) => import(new URL(rel, import.meta.url).href) as Promise<any>;
const seoP = load('../../../apps/web/src/seo.ts');
const faqP = load('../../../apps/web/src/faqs.ts');
const handoffP = load('../../../packages/shared/src/handoff.ts');
const BASE = 'https://dingogo.example';

test('website pages: unique paths and titles, sensible descriptions, every FAQ set exists; private paths never listed', async () => {
  const { PAGES, PRIVATE_PREFIXES, APP_PREFIXES, cleanPath, pageFor, fullTitle } = await seoP;
  const { FAQS } = await faqP;
  assert.equal(new Set(PAGES.map((p: any) => p.path)).size, PAGES.length);
  assert.equal(new Set(PAGES.map((p: any) => p.title)).size, PAGES.length);
  for (const p of PAGES) {
    assert.ok(p.description.length >= 30 && p.description.length <= 200, `${p.path} description length ${p.description.length}`);
    assert.ok(fullTitle(p.title).length <= 70, `${p.path} title too long`);
    if (p.faq) assert.ok(FAQS[p.faq]?.length, `${p.path} faq set`);
    for (const pre of [...PRIVATE_PREFIXES, ...APP_PREFIXES]) assert.ok(!p.path.startsWith(pre), `${p.path} is private`);
    assert.ok(!/100% electric|all-electric/i.test(p.description), 'never claim an all-electric fleet');
  }
  for (const want of ['/', '/fares', '/airport', '/hospital', '/parcels', '/tours', '/business', '/drive', '/rewards', '/help']) assert.ok(pageFor(want), want);
  assert.equal(cleanPath('/rides/?x=1#y'), '/rides');
  assert.equal(pageFor('/airport/')?.path, '/airport');
  assert.equal(pageFor('/track/abc'), undefined);
});

test('website head tags: canonical + absolute 1200x630 Open Graph image + structured data; noindex pages have no canonical or JSON-LD; escaping', async () => {
  const { PAGES, headTags, pageFor } = await seoP;
  const home = headTags({ ...PAGES[0], page: PAGES[0] }, BASE);
  assert.match(home, /<title data-seo>DingoGo — local rides and deliveries in Alice Springs<\/title>/);
  assert.match(home, /<link data-seo rel="canonical" href="https:\/\/dingogo\.example\/" \/>/);
  assert.match(home, /property="og:image" content="https:\/\/dingogo\.example\/og-1200\.jpg"/);
  assert.match(home, /og:image:width" content="1200"/);
  assert.match(home, /twitter:card" content="summary_large_image"/);
  const lds = [...home.matchAll(/<script data-seo type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const types = lds.map((o) => o['@type']);
  for (const t of ['LocalBusiness', 'WebSite', 'TaxiService', 'Service', 'FAQPage']) assert.ok(types.includes(t), t);
  const biz = lds.find((o) => o['@type'] === 'LocalBusiness');
  assert.deepEqual([biz.telephone, biz.address.addressLocality, biz.address.addressRegion, biz.areaServed.alternateName], ['+61432101175', 'Alice Springs', 'NT', 'Mparntwe']);
  const faq = lds.find((o) => o['@type'] === 'FAQPage');
  assert.ok(faq.mainEntity.every((q: any) => !/\{phone\}|\{hours\}/.test(q.acceptedAnswer.text)), 'placeholders filled');

  const air = pageFor('/airport');
  const tags = headTags({ ...air, page: air }, BASE);
  assert.match(tags, /canonical" href="https:\/\/dingogo\.example\/airport"/);
  const crumbs = [...tags.matchAll(/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1])).find((o) => o['@type'] === 'BreadcrumbList');
  assert.deepEqual(crumbs.itemListElement.map((i: any) => i.name), ['Home', 'Airport transfers']);

  const priv = headTags({ title: 'Trip DG-ABC123', description: 'Live <trip> "tracking"', path: '/track/abcdefghijk', noindex: true, page: air }, BASE);
  assert.match(priv, /name="robots" content="noindex, nofollow"/);
  assert.ok(!priv.includes('canonical') && !priv.includes('ld+json') && !priv.includes('og:url') && !priv.includes('abcdefghijk'));
  assert.match(priv, /Live &lt;trip&gt; &quot;tracking&quot;/);
});

test('sitemap and robots: every public page once, absolute URLs; robots keeps apps, API and private links out and names the sitemap', async () => {
  const { PAGES, sitemapXml, robotsTxt, siteUrl } = await seoP;
  const xml = sitemapXml(BASE, '2026-11-19');
  const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
  assert.equal(locs.length, PAGES.length);
  assert.ok(locs.every((l) => l.startsWith(BASE + '/')));
  assert.ok(!xml.includes('/track/') && !xml.includes('/invite/'));
  const robots = robotsTxt(BASE);
  for (const d of ['/rider/', '/driver/', '/admin/', '/partner/', '/roof/', '/api/', '/track/', '/drive/status/', '/invite/']) assert.ok(robots.includes(`Disallow: ${d}\n`), d);
  assert.match(robots, /Sitemap: https:\/\/dingogo\.example\/sitemap\.xml/);
  assert.equal(siteUrl('https://x.example///'), 'https://x.example');
  assert.equal(siteUrl(''), 'https://dingogo-steel.vercel.app');
});

test('analytics paths: share tokens, status links and invite codes removed; only utm tags kept (fare-link places dropped)', async () => {
  const { analyticsPath } = await seoP;
  assert.equal(analyticsPath('/track/hegc8wsurzcy237mdjw5'), '/track/:token');
  assert.equal(analyticsPath('/drive/status/abcdefghijklmnopqrst?x=1'), '/drive/status/:token');
  assert.equal(analyticsPath('/invite/MARYAB12'), '/invite/:code');
  assert.equal(analyticsPath('/fares?from=-23.69,133.83,12%20Smith%20St&to=-23.8,133.9,Airport&service=ride&utm_source=fb&utm_campaign=drivers'), '/fares?utm_source=fb&utm_campaign=drivers');
  assert.equal(analyticsPath('/rides/#pets'), '/rides');
});

test('fare and booking links: round trip, Australian places only, known services and referral codes only', async () => {
  const { tripLinkQuery, parseTripLink, parsePlaceParam } = await handoffP;
  const t = { from: { name: 'Todd Mall', lat: -23.6984, lng: 133.8822 }, to: { name: 'Alice Springs Airport', lat: -23.80671234, lng: 133.9022 }, service: 'courier_m', ref: 'MARYAB12' };
  const q = tripLinkQuery(t);
  const back = parseTripLink(q);
  assert.deepEqual(back.from, t.from);
  assert.deepEqual(back.to, { ...t.to, lat: -23.80671 });
  assert.deepEqual([back.service, back.ref], ['courier_m', 'MARYAB12']);
  assert.equal(parseTripLink('?service=limo&ref=bad code!').service, undefined);
  assert.equal(parseTripLink('?ref=maryab12').ref, 'MARYAB12');
  assert.equal(parsePlaceParam('51.5,-0.12,London'), undefined, 'outside Australia');
  assert.equal(parsePlaceParam('-23.7,133.8')?.name, 'Dropped pin');
  assert.equal(parsePlaceParam('-23.7,133.8,<script>Mall')?.name, 'scriptMall');
  assert.equal(parsePlaceParam('drop table'), undefined);
  assert.equal(tripLinkQuery({}), '');
});

test('FAQ text fills contact details at the start and middle of a sentence', async () => {
  const { fillFaq } = await faqP;
  const c = { phone: '08 8950 0000', hours: '6am to midnight, 7 days' };
  assert.equal(fillFaq('{hours}. Book ahead.', c), '6am to midnight, 7 days. Book ahead.');
  assert.equal(fillFaq('Call {phone}, {hours}.', { ...c, hours: 'Every day' }), 'Call 08 8950 0000, every day.');
});
