import { useState } from 'react';
import { ApiError, Icon, dateTime, get, money, post, useLoad } from '@dingogo/shared';
import { rangeKm, useDriver } from '../state';

const nowLocal = (offsetMin = 0) => { const d = new Date(Date.now() + offsetMin * 60000); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

export function Charging() {
  const { me, battery, setBattery, showToast } = useDriver();
  const { data, reload } = useLoad(() => get('/driver/charging'));
  const [form, setForm] = useState(false);
  const [checkIn, setCheckIn] = useState(false);
  const m = data?.month;
  const centsPerKm = m && m.trip_km ? Math.round(m.cost_cents / m.trip_km) : null;

  return (
    <div className="screen">
      <h1>Charging</h1>
      <section className="panel">
        <div className="battery" aria-label={`Battery ${battery} percent`}>
          <Icon name="battery" size={24} style={{ color: battery < 20 ? 'var(--earth)' : 'var(--saltbush)' }} />
          <div className="battery-bar" aria-hidden><i className={battery < 20 ? 'low' : ''} style={{ width: `${battery}%` }} /></div>
          <strong className="dg-money">{battery}%</strong>
        </div>
        <p className="dg-muted" style={{ margin: '10px 0 14px' }}>About {rangeKm(me?.driver?.vehicle?.range_km, battery)} km left with air-con in this heat.</p>
        <div className="btn-row">
          <button className="dg-btn dg-btn--ghost" onClick={() => setCheckIn(true)}><Icon name="battery" size={18} />Check in</button>
          <button className="dg-btn" onClick={() => setForm(true)}><Icon name="plus" size={18} />Log a charge</button>
        </div>
      </section>

      {m && (
        <>
          <h2>This month</h2>
          <div className="stats">
            <div className="stat"><b>{Number(m.kwh).toFixed(0)}</b><span>kWh</span></div>
            <div className="stat"><b>{money(m.cost_cents)}</b><span>Electricity</span></div>
            <div className="stat"><b>{centsPerKm != null ? `${centsPerKm}c` : 'None'}</b><span>Per km</span></div>
          </div>
          <p className="fine-print"><Icon name="info" size={16} />{m.trip_km ? `Based on ${m.trip_km} trip km. ` : ''}Home charging is reimbursed at the household tariff with your next payout.</p>
        </>
      )}

      <h2>Sessions</h2>
      <ul className="list">
        {(data?.sessions ?? []).map((s: any) => (
          <li key={s.id} className="session">
            <span className="session-ic" aria-hidden><Icon name={s.location === 'home' ? 'home' : 'bolt'} size={20} /></span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="session-title">{s.location === 'home' ? 'Home' : s.location === 'depot' ? 'Depot' : s.site_name || 'Public charger'}</div>
              <div className="sub">{dateTime(s.started_at)}</div>
              <div className="sub">{Number(s.kwh).toFixed(1)} kWh{s.start_pct != null && s.end_pct != null ? `, ${s.start_pct}% to ${s.end_pct}%` : ''}</div>
            </div>
            <div className="session-end">
              <div className="dg-money">{money(s.cost_cents)}</div>
              {s.reimbursed_at ? <span className="dg-chip dg-chip--green">Reimbursed</span> : s.reimbursable ? <span className="dg-chip">Pending</span> : null}
            </div>
          </li>
        ))}
        {data && !data.sessions?.length && <li className="dg-muted">No charging logged yet.</li>}
      </ul>

      {form && <LogCharge onClose={() => setForm(false)} onSaved={(endPct) => { setForm(false); if (endPct != null) setBattery(endPct); void reload(); showToast('Charge logged'); }} />}
      {checkIn && <CheckIn onClose={() => setCheckIn(false)} onSaved={(p) => { setBattery(p); setCheckIn(false); showToast('Battery updated'); }} />}
    </div>
  );
}

function LogCharge({ onClose, onSaved }: { onClose: () => void; onSaved: (endPct?: number) => void }) {
  const [v, setV] = useState<any>({ location: 'home', started_at: nowLocal(-300), ended_at: nowLocal(), kwh: '', start_pct: '', end_pct: '', tariff: '', cost: '', site_name: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  const num = (x: string) => (x === '' ? undefined : Number(x));

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await post('/driver/charging', {
        location: v.location, site_name: v.site_name || undefined,
        started_at: new Date(v.started_at).toISOString(), ended_at: v.ended_at ? new Date(v.ended_at).toISOString() : undefined,
        kwh: Number(v.kwh), start_pct: num(v.start_pct), end_pct: num(v.end_pct),
        tariff_cents_per_kwh: num(v.tariff), cost_cents: v.cost ? Math.round(Number(v.cost) * 100) : undefined,
      });
      onSaved(num(v.end_pct));
    } catch (e2) { setErr(e2 instanceof ApiError ? e2.message : 'Could not save'); } finally { setBusy(false); }
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet" onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="lc-h">
        <h2 id="lc-h">Log a charge</h2>
        <div className="seg" role="group" aria-label="Where">
          {['home', 'depot', 'public'].map((l) => <button type="button" key={l} aria-pressed={v.location === l} onClick={() => setV({ ...v, location: l })}>{l[0].toUpperCase() + l.slice(1)}</button>)}
        </div>
        {v.location === 'public' && <label className="dg-field"><span>Charger name</span><input className="dg-input" value={v.site_name} onChange={set('site_name')} placeholder="e.g. NRMA fast charger" /></label>}
        <div style={{ display: 'grid', gap: 0 }}>
          <label className="dg-field"><span>Started</span><input className="dg-input" type="datetime-local" value={v.started_at} onChange={set('started_at')} required /></label>
          <label className="dg-field"><span>Finished</span><input className="dg-input" type="datetime-local" value={v.ended_at} onChange={set('ended_at')} /></label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          <label className="dg-field"><span>kWh</span><input className="dg-input" inputMode="decimal" value={v.kwh} onChange={set('kwh')} required /></label>
          <label className="dg-field"><span>Start %</span><input className="dg-input" inputMode="numeric" value={v.start_pct} onChange={set('start_pct')} /></label>
          <label className="dg-field"><span>End %</span><input className="dg-input" inputMode="numeric" value={v.end_pct} onChange={set('end_pct')} /></label>
        </div>
        <div className="btn-row">
          <label className="dg-field"><span>Cost ($, if known)</span><input className="dg-input" inputMode="decimal" value={v.cost} onChange={set('cost')} /></label>
          <label className="dg-field"><span>Or tariff (c/kWh)</span><input className="dg-input" inputMode="numeric" value={v.tariff} onChange={set('tariff')} placeholder="30" /></label>
        </div>
        {err && <p className="dg-error" role="alert">{err}</p>}
        <div className="btn-row">
          <button type="button" className="dg-btn dg-btn--ghost" onClick={onClose}>Cancel</button>
          <button className="dg-btn" disabled={busy || !v.kwh}>{busy ? 'Saving…' : 'Save charge'}</button>
        </div>
      </form>
    </div>
  );
}

function CheckIn({ onClose, onSaved }: { onClose: () => void; onSaved: (p: number) => void }) {
  const { battery } = useDriver();
  const [pct, setPct] = useState(battery);
  const [odo, setOdo] = useState('');
  const [temp, setTemp] = useState('');
  const [err, setErr] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try { await post('/driver/battery', { pct, odometer_km: odo ? Number(odo) : undefined, ambient_c: temp ? Number(temp) : undefined }); onSaved(pct); }
    catch (e2) { setErr(e2 instanceof ApiError ? e2.message : 'Could not save'); }
  }
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="sheet" onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="ci-h">
        <h2 id="ci-h">Battery check-in</h2>
        <div className="dial-num">{pct}%</div>
        <input type="range" min={0} max={100} value={pct} onChange={(e) => setPct(Number(e.target.value))} aria-label="Battery percent" className="range-input" />
        <div className="btn-row">
          <label className="dg-field"><span>Odometer (km)</span><input className="dg-input" inputMode="numeric" value={odo} onChange={(e) => setOdo(e.target.value)} /></label>
          <label className="dg-field"><span>Outside temp (°C)</span><input className="dg-input" inputMode="decimal" value={temp} onChange={(e) => setTemp(e.target.value)} /></label>
        </div>
        {err && <p className="dg-error">{err}</p>}
        <button className="dg-btn dg-btn--block btn-xl">Save</button>
      </form>
    </div>
  );
}
