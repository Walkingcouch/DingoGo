import { useState } from 'react';
import { usePrefs, type Prefs, type Theme } from '../lib/prefs';
import { NAV_APPS } from '../lib/nav';
import { ApiError, Icon, appVersion, date, del, get, patch, post } from '@dingogo/shared';
import { Acknowledgement, MyReports, NotifySettings, SafetyReportForm, TrustedContacts } from '@dingogo/shared';
import { Link } from 'react-router-dom';
import { useDriver } from '../state';
import { CarStatus, FuelChip, carName } from '../vehicle';
import { DOC_LABEL } from '../rules';
import { AddCarForm, CarExpiries, CarPapers, CarRules } from './Car';
import { Sheet } from '../Sheet';
import { ExpiryList } from './Expiry';
import { TaxDetails } from './Tax';

export function Profile({ onSignOut }: { onSignOut: () => void }) {
  const { me, reloadMe, cars, myState, online, showToast, waiting } = useDriver();
  const [prefs, setPrefs] = usePrefs();
  const [adding, setAdding] = useState(false);
  const [papersFor, setPapersFor] = useState<{ car: any; ownerNeeded?: boolean } | null>(null);
  const [carErr, setCarErr] = useState<string | null>(null);
  const [langs, setLangs] = useState<string>((me?.driver?.languages ?? []).join(', '));
  const [err, setErr] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  if (!me) return null;
  const d = me.driver; const v = d?.vehicle;
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

  return (
    <div className="screen">
      <h1>{d?.name}</h1>
      {(me as any).tax_missing?.length > 0 && <p className="dg-note" role="status"><a href="#tax">Add your tax details</a>: DingoGo must report your earnings to the ATO. Still needed: {(me as any).tax_missing.join(', ')}.</p>}
      <p className="dg-muted" style={{ marginTop: 0 }}>{d?.phone}{d?.state ? `, ${myState.name}` : ''}{d?.rating_avg ? `, rated ${Number(d.rating_avg).toFixed(2)} from ${d.rating_count} trips` : ''}</p>

      <Link to="/help" className="dg-btn dg-btn--ghost dg-btn--block" style={{ marginBottom: 12 }}><Icon name="help" size={18} />Help and messages to DingoGo</Link>
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
        </>) : <p className="dg-muted" style={{ margin: '0 0 12px' }}>No car yet. Add the car you’ll drive. It can be any fuel type, under {myState.vehicle_max_age_years} years old.</p>}

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
        {d && 'long_trips' in d && (<>
          <label className="dg-check"><input type="checkbox" checked={!!d.long_trips} onChange={(e) => pref('long_trips', e.target.checked)} /><span>Long trips to communities (Ntaria, Ltyentye Apurte) and community shuttles</span></label>
          <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)', margin: '0 0 8px' }}>Fixed prices that cover the drive back. Parts of the road have no mobile coverage: you check in on the way. Electric cars only get these trips with the range to get home.</p>
        </>)}
        <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)', margin: '8px 0 4px' }}>
          {d?.female_driver
            ? 'Women-driver matching is on. Riders who ask for a woman driver can be matched with you.'
            : 'Women-driver matching: DingoGo turns this on after checking your ID. Ask support if you’d like it.'}
        </p>
        <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)', margin: '4px 0 12px' }}>Assistance animals are always accepted, whatever these settings.</p>
        <form onSubmit={(e) => { e.preventDefault(); void pref('languages', langs.split(',').map((s) => s.trim()).filter(Boolean)); }}>
          <label className="dg-field"><span>Languages you speak</span><input className="dg-input" value={langs} onChange={(e) => setLangs(e.target.value)} placeholder="English, Arrernte" /></label>
          <button className="dg-btn dg-btn--ghost dg-btn--sm">Save languages</button>
        </form>
        {online && <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)' }}>Changes apply to your next request.</p>}
        {err && <p className="dg-error">{err}</p>}
      </section>

      <ExpiryList />

      <section className="panel" id="tax" aria-label="Tax">
        <h2 style={{ marginTop: 0 }}>Tax</h2>
        <TaxDetails onSaved={() => void reloadMe()} />
      </section>

      <section className="panel" aria-labelledby="safety-h">
        <h2 id="safety-h" style={{ marginTop: 0 }}>Safety</h2>
        <h3>Trusted contacts</h3>
        <TrustedContacts role="driver" />
        <h3>Report a safety problem</h3>
        {reporting ? <SafetyReportForm onDone={() => undefined} />
          : <button className="dg-btn dg-btn--ghost" onClick={() => setReporting(true)}>Report a rider or something that happened</button>}
        <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)' }}>To report a trip, use "Report" on the trip in Trips. In danger now? Call 000.</p>
        <MyReports />
      </section>

      <section className="panel" aria-label="Notifications">
        <h2 style={{ marginTop: 0 }}>Notifications</h2>
        <NotifySettings app="driver" showMarketing={false} />
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

      <InCar prefs={prefs} setPrefs={setPrefs} />

      <PrivacySection online={online} onDeleted={onSignOut} />

      <button className="dg-btn dg-btn--dark dg-btn--block btn-xl" style={{ marginTop: 16 }} onClick={onSignOut} disabled={online || waiting.taps > 0}>Sign out</button>
      {online && <p className="dg-muted" style={{ textAlign: 'center', fontSize: 'var(--fs-sm)' }}>Go offline before signing out.</p>}
      {!online && waiting.taps > 0 && <p className="dg-muted" style={{ textAlign: 'center', fontSize: 'var(--fs-sm)' }}>Trip updates are still waiting for signal. Sign out once they have sent.</p>}

      {adding && (
        <Sheet onClose={() => setAdding(false)} labelledBy="add-car-h">
            <h2 id="add-car-h">Add a car</h2>
            <CarRules j={myState} />
            <AddCarForm onCancel={() => setAdding(false)} onSaved={async (c, registeredOwner) => {
              setAdding(false); await reloadMe(); setPapersFor({ car: c, ownerNeeded: !registeredOwner }); showToast('Car added. Now upload its papers.');
            }} />
        </Sheet>
      )}
      {papersFor && (
        <Sheet onClose={() => setPapersFor(null)} labelledBy="papers-h">
            <h2 id="papers-h">Car papers</h2>
            <CarPapers car={(cars?.vehicles ?? []).find((c) => c.id === papersFor.car.id) ?? papersFor.car} ownerPermissionNeeded={papersFor.ownerNeeded} />
            <button className="dg-btn dg-btn--ghost dg-btn--block" style={{ marginTop: 16 }} onClick={() => setPapersFor(null)}>Done</button>
        </Sheet>
      )}
      <Acknowledgement style={{ margin: '24px 16px 8px' }} />
    </div>
  );
}

/** Settings for driving: kept on this phone. */
const WEB_URL: string = (((import.meta as any).env?.VITE_WEB_URL as string | undefined) || (typeof location !== 'undefined' ? location.origin : '')).replace(/\/$/, '');

/** Round 21: privacy policy, download my data and delete my account in the app (Google Play requires deletion in the app). */
function PrivacySection({ online, onDeleted }: { online: boolean; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function download() {
    setErr(null);
    try {
      const data = await get('/me/export');
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = 'dingogo-my-data.json'; a.click(); URL.revokeObjectURL(url);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not download. Try again.'); }
  }
  async function remove() {
    setBusy(true); setErr(null);
    try { await del('/me'); setConfirm(false); onDeleted(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not delete. Try again.'); setConfirm(false); }
    finally { setBusy(false); }
  }
  return (
    <section className="panel" aria-labelledby="privacy-h">
      <h2 id="privacy-h" style={{ marginTop: 0 }}>Privacy and your data</h2>
      <p className="dg-muted" style={{ marginTop: 0 }}>
        <a href={`${WEB_URL}/legal/privacy`} target="_blank" rel="noopener noreferrer">Read the privacy policy</a>
      </p>
      <button className="dg-btn dg-btn--ghost dg-btn--block" onClick={download}>Download my data</button>
      <button className="dg-btn dg-btn--danger dg-btn--block" style={{ marginTop: 10 }} onClick={() => setConfirm(true)} disabled={online}>Delete my account</button>
      {online && <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)' }}>Go offline before deleting your account.</p>}
      {err && <p className="dg-error" role="alert">{err}</p>}
      <p className="dg-muted" style={{ fontSize: 'var(--fs-xs)', textAlign: 'center', marginBottom: 0 }}>Version {appVersion()}</p>
      {confirm && (
        <Sheet onClose={() => setConfirm(false)} labelledBy="del-h">
          <h2 id="del-h">Delete your account?</h2>
          <p>This removes your name, contacts, bank details and cars from DingoGo, and you can't drive with this account again. The tax office needs us to keep what we paid you, with your ABN, for 5 years. This can't be undone.</p>
          <p className="dg-muted">If you have earnings still to be paid, ask DingoGo for your payout first.</p>
          <div className="btn-row" style={{ marginTop: 14 }}>
            <button className="dg-btn dg-btn--ghost btn-xl" onClick={() => setConfirm(false)} disabled={busy}>Keep my account</button>
            <button className="dg-btn dg-btn--danger btn-xl" onClick={remove} disabled={busy}>{busy ? 'Deleting…' : 'Delete'}</button>
          </div>
        </Sheet>
      )}
    </section>
  );
}

function InCar({ prefs, setPrefs }: { prefs: Prefs; setPrefs: (p: Partial<Prefs>) => void }) {
  const seg = <K extends keyof Prefs>(label: string, key: K, opts: [Prefs[K], string][]) => (
    <fieldset className="choice-set">
      <legend>{label}</legend>
      <div className="seg">
        {opts.map(([k, l]) => <button key={String(k)} type="button" aria-pressed={prefs[key] === k} onClick={() => setPrefs({ [key]: k } as Partial<Prefs>)}>{l}</button>)}
      </div>
    </fieldset>
  );
  const themes: [Theme, string][] = [['auto', 'Phone'], ['sun', 'After dark'], ['light', 'Day'], ['dark', 'Night']];
  return (
    <section className="panel" aria-labelledby="incar-h">
      <h2 id="incar-h" style={{ marginTop: 0 }}>In the car</h2>
      {seg('Navigation app', 'nav', NAV_APPS.map((a) => [a.key, a.label]))}
      {seg('Screen', 'theme', themes)}
      <p className="field-hint" style={{ margin: '-8px 0 12px' }}>“After dark” switches to the night screen from sunset to sunrise, so it doesn’t dazzle you.</p>
      {seg('Accept button on the', 'hand', [['right', 'Right'], ['left', 'Left']])}
      <label className="dg-check"><input type="checkbox" checked={prefs.awake} onChange={(e) => setPrefs({ awake: e.target.checked })} /><span>Keep the screen on while I’m online</span></label>
      <label className="dg-check"><input type="checkbox" checked={prefs.speak} onChange={(e) => setPrefs({ speak: e.target.checked })} /><span>Read new requests out loud (pay, pickup time and distance)</span></label>
    </section>
  );
}
