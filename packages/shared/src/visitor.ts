/**
 * Round 19: visitor languages for the tour and hire screens. Machine translations, shown with a "being checked" note until a
 * fluent reviewer marks them reviewed (see the note in i18n/visitor.json). English is the source and falls in for anything
 * missing. Separate from the community languages (Arrernte, Kriol) in i18n.ts, which are never machine-translated.
 */
import data from './i18n/visitor.json';

export type VisitorLang = 'en' | 'de' | 'fr' | 'it' | 'ja' | 'ko' | 'zh';
export const VISITOR_LANGS = ['en', ...Object.keys(data.languages)] as VisitorLang[];
type Entry = { en: string } & Partial<Record<Exclude<VisitorLang, 'en'>, { text: string; status: string }>>;
const STRINGS = data.strings as Record<string, Entry>;
export type VisitorKey = keyof typeof data.strings;

export const visitorLangName = (l: VisitorLang) => (l === 'en' ? 'English' : (data.languages as Record<string, { name: string }>)[l]?.name ?? l);
export const normaliseVisitorLang = (l?: string | null): VisitorLang => ((VISITOR_LANGS as string[]).includes(l ?? '') ? (l as VisitorLang) : 'en');

/** The words in `lang` (English if there are none), with {name} placeholders filled. */
export function tv(key: VisitorKey, lang: string | null | undefined = 'en', vars: Record<string, string | number> = {}): string {
  const e = STRINGS[key];
  const l = normaliseVisitorLang(lang);
  let s = !e ? String(key) : l === 'en' ? e.en : e[l]?.text || e.en;
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** True when the page in `lang` shows machine-translated words that nobody has checked yet. */
export const visitorIsMachine = (lang: string | null | undefined) => {
  const l = normaliseVisitorLang(lang);
  return l !== 'en' && Object.values(STRINGS).some((e) => e[l] && e[l]!.status !== 'reviewed');
};

/** Visitor language remembered on this device (no account needed). */
export function savedVisitorLang(): VisitorLang {
  try { return normaliseVisitorLang(localStorage.getItem('dg_visitor_lang')); } catch { return 'en'; }
}
export function saveVisitorLang(l: VisitorLang) { try { localStorage.setItem('dg_visitor_lang', l); } catch { /* private mode */ } }
