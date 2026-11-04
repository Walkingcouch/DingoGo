import { useState } from 'react';
import { ApiError, Icon, date, patch, post } from '@dingogo/shared';
import { Link } from 'react-router-dom';
import { useDriver } from '../state';
import { CarStatus, FuelChip, carName, minYearFallback } from '../vehicle';
import { AddCarForm, CarExpiries, CarPapers, CarRules } from './Car';

const DOC_LABEL: Record<string, string> = {
  licence: 'Driver licence', h_endorsement: 'H endorsement', cpvid: 'CPV identity card', police_check: 'Police check', medical: 'Medical',
  abn: 'ABN', gst: 'GST', insurance: 'Car insurance', vehicle_cvl: 'Car rideshare licence (CVL)', roadworthy: 'Roadworthy report', first_aid: 'First aid',
  vehicle_rego: 'Car registration', owner_permission: 'Owner’s permission',
  disability_awareness: 'Disability awareness', wwcc: 'Working with children (Ochre Card)',
};

export function Profile({ onSignOut }: { onSignOut: () => void }) {
  const { me, reloadMe, cars, online, showToast } = useDriver();
  const [adding, setAdding] = useState(false);
  const [papersFor, setPapersFor] = useState<{ car: any; ownerNeeded?: boolean } | null>(null);
  const [carErr, setCarErr] = useState<string | null>(null);
  const [langs, setLangs] = useState<string>((me?.driver?.languages ?? []).join(', '));
  const [err, setErr] = useState<string | null>(null);
  const [theme, setTheme] = useState<string>(() => document.documentElement.dataset.theme ?? 'auto');
  if (!me) return null;
  const d = me.driver; const v = d?.vehicle;
  const minYear = cars?.min_year ?? minYearFallback();
  const others = (cars?.vehicles ?? []).filter((c) => c.id !== v?.id);
  const regoOf = (c: any) => (me.documents ?? []).filter((x: any) => x.vehicle_id === c.id);

  async function switchCar(c: any) {
    setCarErr(null);
    try { await post(`/driver/vehicles/${c.id}/use`); await reloadMe(); showToast(`You’re now driving ${c.rego}`); }
    catch (e) { setCarErr(e instanceof ApiError ? e.message : 'Could not switch cars'); }
  }

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
      <p className="dg-muted" style={{ marginTop: 0 }}>{d?.phone}{d?.rating_avg ? `, rated ${Number(d.rating_avg).toFixed(2)} from ${d.rating_count} trips` : ''}</p>

      <section className="panel">
        <h2 style={{ marginTop: 0 }}>Your car</h2>
        {v ? (<>
          <div className="car-head">
            <div style={{ minWidth: 0 }}><p className="car-name">{carName(v)}</p><p className="sub">{v.colour}, <strong>{v.rego}</strong></p></div>
            <div className="car-chips"><FuelChip v={v} /><CarStatus v={v} /></div>
          </div>
          {v.status === 'rejected' && v.review_note && <p className="dg-error" style={{ margin: '0 0 8px', fontWeight: 400 }}><strong>Why: </strong>{v.review_note}</p>}
          <CarExpiries v={v} />
          {Number(v.lease_weekly_cents) > 0 && <div className="info-row"><span className="dg-muted">Lease</span><strong>${(v.lease_weekly_cents / 100).toFixed(2)} a week</strong></div>}
          {v.ownership === 'driver_owned' && <button className="dg-btn dg-btn--ghost dg-btn--block" style={{ marginTop: 8 }} onClick={() => setPapersFor({ car: v })}><Icon name="document" size={18} />Car papers</button>}
        </>) : <p className="dg-muted" style={{ margin: '0 0 12px' }}>No car yet. Add the car you’ll drive. It can be any fuel type, under 13 years old.</p>}

        {others.length > 0 && (<>
          <p className="panel-label" style={{ marginTop: 16 }}>Your other cars</p>
          <ul className="list">
            {others.map((c) => (
              <li key={c.id} className="car-item">
                <div style={{ minWidth: 0 }}>
                  <div>{carName(c)}, <strong>{c.rego}</strong></div>
                  <div className="car-chips" style={{ marginTop: 4 }}><FuelChip v={c} /><CarStatus v={c} /></div>
                  {c.status === 'rejected' && c.review_note && <div className="sub">{c.review_note}</div>}
                </div>
                {c.status === 'approved'
                  ? <button className="dg-btn dg-btn--sm" disabled={online} onClick={() => switchCar(c)}>Use this car</button>
                  : <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => setPapersFor({ car: c })}>{regoOf(c).length ? 'Papers' : 'Add papers'}</button>}
              </li>
            ))}
          </ul>
          {online && <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)', margin: '4px 0 0' }}>Go offline to switch cars.</p>}
        </>)}
        {carErr && <p className="dg-error" role="alert">{carErr}</p>}
        <button className="dg-btn dg-btn--ghost dg-btn--block" style={{ marginTop: 12 }} onClick={() => setAdding(true)}><Icon name="plus" size={18} />{v || others.length ? 'Add another car' : 'Add your car'}</button>
        <p className="fine-print"><Icon name="info" size={16} />Changing a car’s details means DingoGo checks it again before you can drive it.</p>
      </section>

      <section className="panel">
        <h2 style={{ marginTop: 0 }}>Trip preferences</h2>
        <label className="dg-check"><input type="checkbox" checked={!!d?.accepts_courier} onChange={(e) => pref('accepts_courier', e.target.checked)} /><span>Accept parcel deliveries</span></label>
        <label className="dg-check"><input type="checkbox" checked={!!d?.accepts_pets} onChange={(e) => pref('accepts_pets', e.target.checked)} /><span>Accept pet-friendly rides (needs a pet-ready car)</span></label>
        <label className="dg-check"><input type="checkbox" checked={!!d?.female_driver} onChange={(e) => pref('female_driver', e.target.checked)} /><span>I'm a woman driver. Match me with riders who ask for one</span></label>
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
          {(me.documents ?? []).filter((x: any) => !x.vehicle_id).map((x: any) => (
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

      {adding && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setAdding(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="add-car-h">
            <h2 id="add-car-h">Add a car</h2>
            <CarRules minYear={minYear} />
            <AddCarForm minYear={minYear} onCancel={() => setAdding(false)} onSaved={async (c, registeredOwner) => {
              setAdding(false); await reloadMe(); setPapersFor({ car: c, ownerNeeded: !registeredOwner }); showToast('Car added. Now upload its papers.');
            }} />
          </div>
        </div>
      )}
      {papersFor && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setPapersFor(null)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="papers-h">
            <h2 id="papers-h">Car papers</h2>
            <CarPapers car={(cars?.vehicles ?? []).find((c) => c.id === papersFor.car.id) ?? papersFor.car} ownerPermissionNeeded={papersFor.ownerNeeded} />
            <button className="dg-btn dg-btn--ghost dg-btn--block" style={{ marginTop: 16 }} onClick={() => setPapersFor(null)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
