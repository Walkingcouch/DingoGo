import { money } from '@dingogo/shared';

export function QuoteBox({ quote, loading, error }: { quote: any | null; loading: boolean; error: string | null }) {
  if (error) return <p className="dg-error" role="alert">{error}</p>;
  if (!quote) return null;
  return (
    <details className="quote" aria-busy={loading}>
      <summary>
        <span className="quote__head">
          <strong className="quote__total dg-money">{money(quote.total_cents)}</strong>
          <span className="dg-muted">{quote.distance_km} km, about {quote.duration_min} min</span>
        </span>
        <span className="quote__more">Fare details</span>
      </summary>
      <table className="quote__lines">
        <tbody>
          {quote.lines.map((l: any, i: number) => (
            <tr key={i} className={l.cents < 0 ? 'is-discount' : ''}><td>{l.label}</td><td className="dg-money">{money(l.cents)}</td></tr>
          ))}
          <tr className="quote__sum"><td>Total (incl. GST {money(quote.gst_cents)})</td><td className="dg-money">{money(quote.total_cents)}</td></tr>
        </tbody>
      </table>
      <p className="dg-muted" style={{ fontSize: 'var(--fs-xs)', margin: '.4rem 0 0' }}>
        Upfront price: you pay this unless the route changes a lot. Prices are rounded to 5c so cash works.
      </p>
    </details>
  );
}
