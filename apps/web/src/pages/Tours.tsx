import { useEffect, useState } from 'react';
import { get, money } from '@dingogo/shared';
import { PageHead } from '../Layout';
import { Area, Field, formData, Sent, useSubmit } from '../forms';
import { useMeta } from '../meta';

type Tour = { id: string; slug: string; name: string; summary: string; description: string; duration_min: number; price_cents: number; max_passengers: number; stops: string[]; cultural_note: string | null; requires_permit: boolean };
const hours = (m: number) => (m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} hours`);

export default function Tours() {
  useMeta('Private tours', 'Private tours with a local driver from Alice Springs: Telegraph Station, the West MacDonnell gaps, Desert Park and Emily and Jessie Gaps.');
  const [tours, setTours] = useState<Tour[] | null>(null);
  const [err, setErr] = useState(false);
  const f = useSubmit('/public/hire-requests');
  const [pick, setPick] = useState('');
  useEffect(() => { get<{ tours: Tour[] }>('/public/tours').then((r) => setTours(r.tours)).catch(() => setErr(true)); }, []);

  return (
    <>
      <PageHead tone="gap" title="Private tours from town">Your own car and driver for the morning, the afternoon or sunset. One price per car, for up to four people.</PageHead>
      <section className="section">
        <div className="wrap">
          {err && <p className="dg-error">Tours couldn't load. Call us to book.</p>}
          {!tours && !err && <p className="dg-muted">Loading tours…</p>}
          <div>
            {tours?.map((t) => (
              <article className="tour" key={t.id} id={t.slug}>
                <div>
                  <h3>{t.name}</h3>
                  <p className="meta">{hours(t.duration_min)}, up to {t.max_passengers} guests</p>
                  <p style={{ margin: 0, maxWidth: '68ch' }}>{t.description}</p>
                  <div className="stops">{t.stops.map((s) => <span className="dg-chip" key={s}>{s}</span>)}</div>
                  {t.cultural_note && <p className="culture"><b>Respecting Country.</b> {t.cultural_note}</p>}
                </div>
                <aside>
                  <b>{money(t.price_cents)}</b>
                  <span className="dg-muted">per car, incl. GST</span><br />
                  <a className="dg-btn dg-btn--sm" style={{ marginTop: 12 }} href="#enquire" onClick={() => setPick(t.name)}>Ask about this tour</a>
                </aside>
              </article>
            ))}
          </div>
          <p className="dg-muted prose" style={{ marginTop: 20 }}>Park entry fees aren't included. Some places on these routes are sacred sites or on Aboriginal land; your driver will explain where you can walk, swim and take photos. Trips onto Aboriginal land beyond these routes need a permit from the Central Land Council, which we'll help arrange. For longer guided cultural tours we partner with licensed Aboriginal tour operators.</p>
        </div>
      </section>
      <section className="section band" id="enquire">
        <div className="wrap split">
          <div><h2>Book a tour</h2><p className="section-intro">Tell us the date and how many of you there are. We'll confirm a pickup time and driver within a day.</p></div>
          <div className="panel" style={{ color: 'var(--text)' }}>
            {f.done ? <Sent title="Thanks, we've got your request." onAgain={f.reset}>We'll email or call you within one business day to confirm.</Sent> : (
              <form className="form-grid" onSubmit={(e) => { const d = formData(e); f.submit({ kind: 'tour', ...d, details: `Tour: ${d.tour ?? 'not sure'}\n${d.details ?? ''}`, tour: undefined }); }}>
                <label className="dg-field full"><span>Tour</span>
                  <select className="dg-select" name="tour" value={pick} onChange={(e) => setPick(e.target.value)}>
                    <option value="">Not sure yet</option>{tours?.map((t) => <option key={t.id}>{t.name}</option>)}
                  </select>
                </label>
                <Field label="Your name" name="contact_name" required autoComplete="name" />
                <Field label="Email" name="contact_email" type="email" required autoComplete="email" />
                <Field label="Mobile" name="contact_phone" type="tel" autoComplete="tel" />
                <Field label="Date" name="event_date" type="date" />
                <Field label="Number of guests" name="passengers" type="number" min={1} max={4} />
                <Area label="Anything we should know" name="details" placeholder="Hotel for pickup, mobility needs, kids' car seats…" />
                {f.error && <p className="dg-error full">{f.error}</p>}
                <div className="full"><button className="dg-btn" disabled={f.busy}>{f.busy ? 'Sending…' : 'Send tour request'}</button></div>
              </form>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
