import { useState } from 'react';
import { ApiError, date, patch } from '@dingogo/shared';
import { Link } from 'react-router-dom';
import { useDriver } from '../state';

const DOC_LABEL: Record<string, string> = {
  licence: 'Driver licence', h_endorsement: 'H endorsement', cpvid: 'CPV identity card', police_check: 'Police check', medical: 'Medical',
  abn: 'ABN', gst: 'GST', insurance: 'Insurance', vehicle_cvl: 'Vehicle CVL', roadworthy: 'Roadworthy', first_aid: 'First aid',
  disability_awareness: 'Disability awareness', wwcc: 'Working with children (Ochre Card)',
};

export function Profile({ onSignOut }: { onSignOut: () => void }) {
  const { me, reloadMe, online, showToast } = useDriver();
  const [langs, setLangs] = useState<string>((me?.driver?.languages ?? []).join(', '));
  const [err, setErr] = useState<string | null>(null);
  const [theme, setTheme] = useState<string>(() => document.documentElement.dataset.theme ?? 'auto');
  if (!me) return null;
  const d = me.driver; const v = d?.vehicle;

  async function pref(key: string, value: unknown) {
    setErr(null);
    try { await patch('/driver/me', { [key]: value }); await reloadMe(); showToast('Saved'); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not save'); }
  }
  function applyTheme(t: string) {
    setTheme(t);
    if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
    try { localStorage.setItem('dingogo.driver.theme', t); } catch { /* ignore */ }
  }

  return (
    <div className="screen">
      <h1>{d?.name}</h1>
      <p className="dg-muted" style={{ marginTop: 0 }}>{d?.phone}{d?.rating_avg ? `, ${Number(d.rating_avg).toFixed(2)}★ from ${d.rating_count} trips` : ''}</p>

      {v && (
        <section className="panel">
          <h2 style={{ marginTop: 0 }}>Vehicle</h2>
          <div className="info-row"><span className="dg-muted">Car</span><strong>{v.year} {v.make} {v.model}, {v.colour}</strong></div>
          <div className="info-row"><span className="dg-muted">Rego</span><strong>{v.rego}</strong></div>
          <div className="info-row"><span className="dg-muted">Rideshare licence (CVL)</span><strong>{v.cvl_expiry ? `to ${date(v.cvl_expiry)}` : 'Missing'}</strong></div>
          {v.lease_weekly_cents > 0 && <div className="info-row"><span className="dg-muted">Lease</span><strong>${(v.lease_weekly_cents / 100).toFixed(2)} a week</strong></div>}
        </section>
      )}

      <section className="panel">
        <h2 style={{ marginTop: 0 }}>Trip preferences</h2>
        <label className="dg-check"><input type="checkbox" checked={!!d?.accepts_courier} onChange={(e) => pref('accepts_courier', e.target.checked)} /><span>Accept parcel deliveries</span></label>
        <label className="dg-check"><input type="checkbox" checked={!!d?.accepts_pets} onChange={(e) => pref('accepts_pets', e.target.checked)} /><span>Accept pet-friendly rides (needs a pet-ready car)</span></label>
        <label className="dg-check"><input type="checkbox" checked={!!d?.female_driver} onChange={(e) => pref('female_driver', e.target.checked)} /><span>I'm a woman driver — match me with riders who ask for one</span></label>
        <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)', margin: '4px 0 12px' }}>Assistance animals are always accepted, whatever these settings.</p>
        <form onSubmit={(e) => { e.preventDefault(); void pref('languages', langs.split(',').map((s) => s.trim()).filter(Boolean)); }}>
          <label className="dg-field"><span>Languages you speak</span><input className="dg-input" value={langs} onChange={(e) => setLangs(e.target.value)} placeholder="English, Arrernte" /></label>
          <button className="dg-btn dg-btn--ghost dg-btn--sm">Save languages</button>
        </form>
        {online && <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)' }}>Changes apply to your next request.</p>}
        {err && <p className="dg-error">{err}</p>}
      </section>

      <section className="panel">
        <h2 style={{ marginTop: 0 }}>Documents</h2>
        <ul className="list">
          {(me.documents ?? []).map((x: any) => (
            <li key={x.id}>
              <div><div>{DOC_LABEL[x.type] ?? x.type}</div>{x.expires_at && <div className="sub">Expires {date(x.expires_at)}</div>}</div>
              <span className={`dg-chip ${x.status === 'approved' ? 'dg-chip--green' : x.status === 'rejected' || x.status === 'expired' ? 'dg-chip--red' : 'dg-chip--ochre'}`}>{x.status}</span>
            </li>
          ))}
        </ul>
        <Link className="dg-btn dg-btn--ghost dg-btn--block" to="/setup">Update documents</Link>
      </section>

      <section className="panel">
        <h2 style={{ marginTop: 0 }}>Display</h2>
        <div className="seg" role="group" aria-label="Theme">
          {[['auto', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => <button key={k} aria-pressed={theme === k} onClick={() => applyTheme(k)}>{l}</button>)}
        </div>
      </section>

      <button className="dg-btn dg-btn--dark dg-btn--block btn-xl" style={{ marginTop: 16 }} onClick={onSignOut} disabled={online}>Sign out</button>
      {online && <p className="dg-muted" style={{ textAlign: 'center', fontSize: 'var(--fs-sm)' }}>Go offline before signing out.</p>}
    </div>
  );
}
