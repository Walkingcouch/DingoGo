import { useState } from 'react';
import { ApiError, Icon, date, patch, post, uploadFile } from '@dingogo/shared';
import { useDriver } from '../state';
import { CarStatus, FUELS, FuelChip, carName, isGreen } from '../vehicle';
import { carDocInfo, cleanVin, decodeVin, findJ, minYearFor, type DocInfo, type Jurisdiction, type StateCode } from '../rules';

type DocState = 'done' | 'review' | 'missing' | 'rejected';
interface CarDoc extends DocInfo { type: string; optional?: boolean }

/** The papers a car needs in its state, plus the owner's permission when someone else owns it. */
export function carDocsFor(j: Jurisdiction): CarDoc[] {
  return [...j.vehicle_docs, 'owner_permission'].map((t) => ({ type: t, ...carDocInfo(t, j.code), optional: t === 'owner_permission' }));
}
/** The state a car is registered in. Cars from before state support are NT. */
export const carState = (car: any, fallback: StateCode = 'NT'): StateCode => (car?.rego_state ?? fallback) as StateCode;

/** The car the driver is setting up: their current car, otherwise the newest car they added. */
export function carToSetUp(cars: any[], currentId?: string | null) {
  return cars.find((c) => c.id === currentId) ?? cars.find((c) => c.ownership === 'driver_owned') ?? cars[0] ?? null;
}

/** What the state asks of a rideshare car, in plain English. */
export function CarRules({ j }: { j: Jurisdiction }) {
  const minYear = minYearFor(j);
  const age = `Made in ${minYear} or later (under ${j.vehicle_max_age_years} years old)`;
  return (
    <div className="car-rules">
      <p className="panel-label">What your car needs in {j.code}</p>
      {j.code === 'SA' ? (
        <ul>
          <li>{age}</li>
          <li>4 or more doors, and seats for at least 4 passengers</li>
          <li>SA registration, with CTP upgraded to “small passenger vehicle”</li>
          <li>An inspection every {j.inspection_months ?? 12} months at an approved station (RAA or Rightway)</li>
          <li>At least third-party property insurance, plus $5 million public liability</li>
        </ul>
      ) : (
        <ul>
          <li>{age}</li>
          <li>4 or more doors, and 4 to 7 passenger seats</li>
          <li>A roadworthy inspection less than 6 weeks old when you apply for the CVL</li>
          <li>A rideshare Commercial Vehicle Licence (CVL) from the Motor Vehicle Registry</li>
          <li>Rego with CTP, plus at least third-party property insurance naming you</li>
        </ul>
      )}
      <p className="fine-print"><Icon name="leaf" size={16} />Any fuel type is fine. Electric and hybrid cars get offered trips first.</p>
    </div>
  );
}

export function AddCarForm({ onSaved, onCancel }: { onSaved: (v: any, registeredOwner: boolean) => void; onCancel?: () => void }) {
  const { states, myState } = useDriver();
  const [v, setV] = useState<Record<string, any>>({ fuel_type: '', make: '', model: '', year: '', colour: '', rego: '', rego_state: myState.code, seats: '4', doors: '4', vin: '', range_km: '', registered_owner: true, pet_friendly: false, wheelchair_accessible: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setV({ ...v, [k]: e.target instanceof HTMLInputElement && e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const j = findJ(states, v.rego_state);
  const minYear = minYearFor(j);
  const year = Number(v.year);
  const hasYear = /^\d{4}$/.test(v.year);
  const tooOld = hasYear && year < minYear;
  const vin = decodeVin(v.vin);
  const vinOff = vin.year != null && hasYear && Math.abs(vin.year - year) > 1;
  const vinOld = vin.year != null && vin.year < minYear;
  const vinHint = !v.vin ? { bad: false, text: '17 characters. It’s on your rego papers and the compliance plate.' }
    : !vin.valid ? { bad: /I, O or Q/.test(vin.note), text: vin.note }
      : vin.year == null ? { bad: false, text: vin.note }
        : vinOff ? { bad: true, text: `VIN suggests a ${vin.year} model, but you entered ${year}. Check both. DingoGo checks the build date.` }
          : vinOld ? { bad: true, text: `VIN suggests a ${vin.year} model. ${j.code} cars must be ${minYear} or newer.` }
            : { bad: false, ok: true, text: `VIN suggests a ${vin.year} model.` };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!v.fuel_type) { setErr('Choose the fuel type'); return; }
    if (!vin.valid) { setErr('Check the VIN. It has 17 letters and numbers.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await post('/driver/vehicles', {
        fuel_type: v.fuel_type, make: v.make.trim(), model: v.model.trim(), year, colour: v.colour.trim(),
        rego: v.rego.replace(/\s/g, '').toUpperCase(), rego_state: v.rego_state, seats: Number(v.seats), doors: Number(v.doors), vin: cleanVin(v.vin),
        range_km: v.fuel_type === 'electric' && v.range_km ? Number(v.range_km) : undefined,
        pet_friendly: v.pet_friendly, wheelchair_accessible: v.wheelchair_accessible, registered_owner: v.registered_owner,
      });
      onSaved(r.vehicle, v.registered_owner);
    } catch (e2) { setErr(e2 instanceof ApiError ? e2.message : 'Could not save your car'); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={save} className="car-form">
      <fieldset className="choice-set">
        <legend>Fuel type</legend>
        <div className="choice-grid">
          {FUELS.map(([k, l]) => (
            <button type="button" key={k} aria-pressed={v.fuel_type === k} onClick={() => setV({ ...v, fuel_type: k })}>
              {isGreen({ fuel_type: k }) && <Icon name={k === 'electric' ? 'bolt' : 'leaf'} size={18} />}{l}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="field-pair">
        <label className="dg-field"><span>Make</span><input className="dg-input" value={v.make} onChange={set('make')} placeholder="Toyota" required /></label>
        <label className="dg-field"><span>Model</span><input className="dg-input" value={v.model} onChange={set('model')} placeholder="Camry" required /></label>
      </div>
      <div className="field-pair">
        <label className="dg-field"><span>Year</span>
          <input className="dg-input" inputMode="numeric" maxLength={4} value={v.year} onChange={set('year')} required aria-describedby="year-hint" />
          <small id="year-hint" className={tooOld ? 'field-hint bad' : 'field-hint'}>{tooOld ? `Too old. ${j.code} cars must be ${minYear} or newer.` : `${minYear} or newer`}</small>
        </label>
        <label className="dg-field"><span>Colour</span><input className="dg-input" value={v.colour} onChange={set('colour')} placeholder="White" required /></label>
      </div>
      <div className="field-pair">
        <label className="dg-field"><span>Number plate (rego)</span><input className="dg-input" value={v.rego} onChange={set('rego')} autoCapitalize="characters" placeholder={v.rego_state === 'SA' ? 'S123ABC' : 'CA12BC'} required /></label>
        <label className="dg-field"><span>Registered in</span>
          <select className="dg-select" value={v.rego_state} onChange={set('rego_state')}>{states.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></label>
      </div>
      {v.rego_state !== myState.code && <p className="dg-note" style={{ margin: '-4px 0 12px' }}>You’ll drive in {myState.name}, so the car needs {myState.code} registration before DingoGo can approve it.</p>}
      <label className="dg-field"><span>VIN</span>
        <input className="dg-input mono" value={v.vin} onChange={(e) => setV({ ...v, vin: cleanVin(e.target.value).slice(0, 17) })} autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={17} required aria-describedby="vin-hint" />
        <small id="vin-hint" className={'field-hint' + (vinHint.bad ? ' bad' : vinHint.ok ? ' good' : '')} aria-live="polite">{vinHint.ok && <Icon name="check" size={14} />}{vinHint.text}</small>
      </label>
      <div className="field-pair">
        <label className="dg-field"><span>Passenger seats</span>
          <select className="dg-select" value={v.seats} onChange={set('seats')}>{[4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        <label className="dg-field"><span>Doors</span>
          <select className="dg-select" value={v.doors} onChange={set('doors')}>{[4, 5].map((n) => <option key={n} value={n}>{n === 5 ? '5 (hatch or wagon)' : n}</option>)}</select></label>
      </div>
      {v.fuel_type === 'electric' && (
        <label className="dg-field"><span>Rated range (km, optional)</span><input className="dg-input" inputMode="numeric" value={v.range_km} onChange={set('range_km')} placeholder="400" />
          <small className="field-hint">From the brochure. We allow for heat and air-con.</small></label>
      )}
      <label className="dg-check"><input type="checkbox" checked={v.pet_friendly} onChange={set('pet_friendly')} /><span>Pet-ready (seat cover and harness point)</span></label>
      <label className="dg-check"><input type="checkbox" checked={v.wheelchair_accessible} onChange={set('wheelchair_accessible')} /><span>Wheelchair accessible</span></label>
      <label className="dg-check"><input type="checkbox" checked={v.registered_owner} onChange={set('registered_owner')} /><span>I’m the registered owner</span></label>
      {!v.registered_owner && <p className="dg-note" style={{ margin: '4px 0 12px' }}>That’s fine. You’ll upload the owner’s written permission with the car’s papers.</p>}
      {err && <p className="dg-error" role="alert">{err}</p>}
      <div className={onCancel ? 'btn-row' : ''}>
        {onCancel && <button type="button" className="dg-btn dg-btn--ghost" onClick={onCancel}>Cancel</button>}
        <button className="dg-btn dg-btn--block" disabled={busy || tooOld}>{busy ? 'Saving…' : 'Save car'}</button>
      </div>
    </form>
  );
}

/** One car: status, then each paper with its upload form. */
export function CarPapers({ car, ownerPermissionNeeded }: { car: any; ownerPermissionNeeded?: boolean }) {
  const { me, reloadMe, showToast, states, myState } = useDriver();
  const j = findJ(states, carState(car, myState.code));
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rejected = car.status === 'rejected';
  // Any change to a car puts it back in DingoGo's queue, so re-sending the same details asks for a fresh check.
  async function recheck() {
    setBusy(true); setErr(null);
    try { await patch(`/driver/vehicles/${car.id}`, { colour: car.colour }); await reloadMe(); showToast('Sent to DingoGo to check again'); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not send'); }
    finally { setBusy(false); }
  }
  const docs: any[] = (me?.documents ?? []).filter((d: any) => d.vehicle_id === car.id);
  const stateOf = (type: string): { s: DocState; note?: string; fresh?: boolean } => {
    const latest = docs.find((d) => d.type === type);
    if (!latest) return { s: 'missing' };
    // Uploaded since DingoGo last looked at the car
    if (rejected && latest.status === 'pending' && car.reviewed_at && latest.created_at > car.reviewed_at) return { s: 'review', fresh: true };
    // Approving the car covers the papers DingoGo looked at.
    if (latest.status === 'approved' || (latest.status === 'pending' && car.status === 'approved')) return { s: 'done' };
    if (latest.status === 'pending') return { s: 'review' };
    return { s: 'rejected', note: latest.note };
  };
  const needOwner = ownerPermissionNeeded || car.registered_owner === false || docs.some((d) => d.type === 'owner_permission');
  const list = carDocsFor(j).map((d) => (d.type === 'owner_permission' && needOwner ? { ...d, optional: false } : d));

  return (
    <div className="car-papers">
      <div className="car-head">
        <div style={{ minWidth: 0 }}>
          <p className="car-name">{carName(car)}</p>
          <p className="sub">{car.colour}, <strong>{car.rego}</strong> ({j.code})</p>
        </div>
        <div className="car-chips"><FuelChip v={car} /><CarStatus v={car} /></div>
      </div>
      {j.code !== myState.code && <p className="dg-note" style={{ margin: '0 0 8px' }}>This car is registered in {j.code}. To drive in {myState.code} it needs {myState.code} registration.</p>}
      {car.status === 'rejected' && car.review_note && <p className="dg-error" style={{ margin: '0 0 8px', fontWeight: 400 }}><strong>Why: </strong>{car.review_note}</p>}
      {car.status === 'pending' && <p className="dg-muted car-msg">DingoGo checks your car once its papers are in, usually within 2 business days.</p>}
      <ul className="doc-list">
        {list.map((d) => {
          const st = stateOf(d.type);
          return (
            <li key={d.type}>
              <div className="doc-row">
                <div><p>{d.title}{d.optional && <span className="dg-muted"> (if needed)</span>}</p><small>{d.help}</small>
                  {st.s === 'rejected' && <small className="doc-bad">Not accepted{st.note ? `: ${st.note}` : ''}. Upload it again.</small>}</div>
                {rejected && !st.fresh && st.s !== 'missing' && st.s !== 'rejected' ? <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => setOpen(open === d.type ? null : d.type)} aria-expanded={open === d.type}>{open === d.type ? 'Close' : 'Replace'}</button>
                  : st.s === 'done' ? <span className="dg-chip dg-chip--green">Done</span>
                  : st.s === 'review' ? <span className="dg-chip dg-chip--ochre">{st.fresh ? 'New' : 'In review'}</span>
                    : <button className={'dg-btn dg-btn--sm' + (d.optional ? ' dg-btn--ghost' : '')} onClick={() => setOpen(open === d.type ? null : d.type)} aria-expanded={open === d.type}>{open === d.type ? 'Close' : 'Add'}</button>}
              </div>
              {open === d.type && <DocForm doc={d} vehicleId={car.id} onSaved={async () => { setOpen(null); await reloadMe(); }} />}
            </li>
          );
        })}
      </ul>
      {rejected && (<>
        <p className="fine-print"><Icon name="info" size={16} />Fixed the problem? Replace the paper above, then send your car back to DingoGo.</p>
        {err && <p className="dg-error" role="alert">{err}</p>}
        <button className="dg-btn dg-btn--block" style={{ marginTop: 12 }} disabled={busy} onClick={recheck}>{busy ? 'Sending…' : 'Check my car again'}</button>
      </>)}
    </div>
  );
}

function DocForm({ doc, vehicleId, onSaved }: { doc: CarDoc; vehicleId: string; onSaved: () => void }) {
  const [number, setNumber] = useState('');
  const [expires, setExpires] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const file_url = file ? (await uploadFile(file, 'document')).url : undefined;
      await post('/driver/documents', { type: doc.type, vehicle_id: vehicleId, number: number || undefined, expires_at: expires || undefined, file_url });
      onSaved();
    } catch (e2) { setErr(e2 instanceof ApiError ? e2.message : 'Could not save'); }
    finally { setBusy(false); }
  }
  return (
    <form onSubmit={save} style={{ marginTop: 12 }}>
      {doc.number && <label className="dg-field"><span>{doc.number}</span><input className="dg-input" value={number} onChange={(e) => setNumber(e.target.value)} required={!!doc.numberRequired} /></label>}
      {doc.expiry && <label className="dg-field"><span>{doc.expiry}</span><input className="dg-input" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} required /></label>}
      <label className="dg-field"><span>Photo or PDF</span><input className="dg-input" type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required /></label>
      {err && <p className="dg-error" role="alert">{err}</p>}
      <button className="dg-btn dg-btn--block" disabled={busy}>{busy ? 'Uploading…' : 'Upload'}</button>
    </form>
  );
}

/** Expiry dates DingoGo recorded when it checked the car. */
export function CarExpiries({ v }: { v: any }) {
  const row = (label: string, d?: string | null) => <div className="info-row"><span className="dg-muted">{label}</span><strong>{d ? `to ${date(d)}` : 'Not yet checked'}</strong></div>;
  if (carState(v) === 'SA') return (<>
    {row('Annual inspection', v.inspection_expiry)}
    {row('Registration', v.rego_expiry)}
    {row('Insurance', v.insurance_expiry)}
  </>);
  return (<>
    {row('Rideshare licence (CVL)', v.cvl_expiry)}
    {row('Registration', v.rego_expiry)}
    {row('Insurance', v.insurance_expiry)}
  </>);
}
