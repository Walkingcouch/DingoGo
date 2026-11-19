import { t, isDraft, langIsDraft, langInfo, normaliseLang, type StringKey } from './i18n';

/** Acknowledgement of Country, shown in every app (sign-in screens, account pages, console footers). */
export function Acknowledgement({ short = false, className, style }: { short?: boolean; className?: string; style?: React.CSSProperties }) {
  return (
    <p className={`dg-ack ${className ?? ''}`} style={style}>
      {t(short ? 'acknowledgement_short' : 'acknowledgement')}
    </p>
  );
}

/** A word that may be a community draft in the chosen language: marked so nobody takes it as checked. */
export function Words({ k, lang }: { k: StringKey; lang?: string | null }) {
  const draft = isDraft(k, lang);
  return <>{t(k, lang)}{draft && <span className="dg-draft" title="Draft: needs community review"> (draft)</span>}</>;
}

/** "Words in this language are a draft…" when the chosen language isn't English. */
export function DraftNotice({ lang }: { lang?: string | null }) {
  const l = normaliseLang(lang);
  if (!langIsDraft(l)) return null;
  return <p className="dg-note" role="note"><strong>{langInfo(l).english_name}: draft.</strong> {t('draft_notice')}</p>;
}
