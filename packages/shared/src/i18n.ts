/**
 * App words in more than one language. English is the default and the source; Arrernte and Kriol entries are community
 * drafts (see the note at the top of i18n/strings.json) and anything missing falls back to English.
 */
import data from './i18n/strings.json';

export type Lang = 'en' | 'aer' | 'rop';
export const LANGS = Object.keys(data.languages) as Lang[];
type Entry = { en: string } & Partial<Record<Exclude<Lang, 'en'>, { text: string; status: string; note?: string; reviewed_by?: string }>>;
const STRINGS = data.strings as Record<string, Entry>;
export type StringKey = keyof typeof data.strings;

/** Old profiles saved Arrernte as "arr" (that code is another language); anything unknown is English. */
export function normaliseLang(l?: string | null): Lang {
  if (l === 'arr') return 'aer';
  return (LANGS as string[]).includes(l ?? '') ? (l as Lang) : 'en';
}

export const langInfo = (l: Lang) => (data.languages as Record<Lang, { name: string; english_name: string; status: string }>)[l];

/** The word in `lang` if there is one (draft or reviewed), else English. */
export function t(key: StringKey, lang: string | null | undefined = 'en'): string {
  const e = STRINGS[key];
  if (!e) return String(key);
  const l = normaliseLang(lang);
  if (l === 'en') return e.en;
  return e[l]?.text || e.en;
}

/** True when what t() gives for this key is an unreviewed community draft (show the "needs review" flag). */
export function isDraft(key: StringKey, lang: string | null | undefined): boolean {
  const l = normaliseLang(lang);
  if (l === 'en') return false;
  const v = STRINGS[key]?.[l];
  return !!v?.text && v.status !== 'reviewed';
}

/** A language is "draft" until every entry it has is reviewed. */
export function langIsDraft(lang: string | null | undefined): boolean {
  const l = normaliseLang(lang);
  if (l === 'en') return false;
  return Object.values(STRINGS).some((e) => e[l]?.text && e[l]!.status !== 'reviewed') || langInfo(l).status !== 'reviewed';
}
