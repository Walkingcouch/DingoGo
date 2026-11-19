import { Link } from 'react-router-dom';
import { contact, useConfig } from '../config';
import { FAQS, fillFaq, type FaqSet } from '../faqs';

/** A page's questions from faqs.ts — the same text the page's FAQPage structured data carries. */
export function FaqList({ set, className = 'faq' }: { set: FaqSet; className?: string }) {
  const c = contact(useConfig());
  return (
    <div className={className}>
      {FAQS[set].map((f) => (
        <details key={f.q}>
          <summary>{fillFaq(f.q, c)}</summary>
          <p>{fillFaq(f.a, c)}{'link' in f && f.link && <> <Link className="faq-more" to={f.link.to}>{f.link.label}</Link></>}</p>
        </details>
      ))}
    </div>
  );
}

export function FaqSection({ set, title = 'Common questions' }: { set: FaqSet; title?: string }) {
  return (
    <section className="section" style={{ paddingTop: 0 }}>
      <div className="wrap split">
        <div><h2>{title}</h2></div>
        <FaqList set={set} />
      </div>
    </section>
  );
}
