import { useState } from 'react';
import { ApiError, patch, post, uploadFile, Ranges } from '@dingogo/shared';
import { useDriver } from '../state';
import { CarStatus, FuelChip, carName, minYearFallback } from '../vehicle';
import { AddCarForm, CarPapers, CarRules, carToSetUp } from './Car';

type State = 'done' | 'review' | 'missing';
const today = () => new Date().toISOString().slice(0, 10);
const future = (d?: string | null) => !!d && d >= today();
const within3m = (d?: string | null) => !!d && (Date.now() - new Date(d).getTime()) / 864e5 <= 92;

interface Step { key: string; title: string; help: string; state: State; form: 'licence' | 'h' | 'doc' | 'abn' | 'gst' | 'bank' | 'car'; docType?: string; needsExpiry?: boolean }

export function Onboarding() {
  const { me, reloadMe, cars } = useDriver();
  const [open, setOpen] = useState<string | null>(null);
  const [ownerNeeded, setOwnerNeeded] = useState<Record<string, boolean>>({});
  if (!me) return null;
  const d = me.driver ?? {};
  const docs: any[] = me.documents ?? [];
  const minYear = cars?.min_year ?? minYearFallback();
  const car = carToSetUp(cars?.vehicles ?? (d.vehicle ? [d.vehicle] : []), cars?.current_vehicle_id ?? d.vehicle_id);
  const carDocs = car ? docs.filter((x) => x.vehicle_id === car.id && x.status !== 'rejected') : [];
  const papersIn = ['vehicle_rego', 'insurance', 'roadworthy', 'vehicle_cvl'].every((t) => carDocs.some((x) => x.type === t));
  const carState: State = !car ? 'missing'
    : (car.status ?? 'approved') === 'approved' && future(car.cvl_expiry) ? 'done'
      : car.status === 'pending' && papersIn ? 'review' : 'missing';
  const carHelp = !car ? 'Bring your own car: any fuel type, under 13 years old, with 4 doors and an NT rideshare licence (CVL).'
    : car.status === 'approved' && !future(car.cvl_expiry) ? 'Your car’s rideshare licence (CVL) has expired. Upload the renewed one.'
      : car.status === 'rejected' ? 'DingoGo couldn’t approve this car yet. See why, then fix it.'
        : car.status === 'pending' && !papersIn ? 'Upload your car’s papers so DingoGo can check it.'
          : car.status === 'pending' ? 'DingoGo is checking your car.' : 'Approved for DingoGo trips.';
  const docState = (type: string, ok: boolean): State => {
    if (ok) return 'done';
    const latest = docs.find((x) => x.type === type);
    if (latest?.status === 'approved') return 'done';
    if (latest?.status === 'pending') return 'review';
    return 'missing';
  };

  const steps: Step[] = [
    { key: 'licence', title: 'Driver licence', help: 'Full NT (or interstate) licence with at least 12 months’ driving history in the last 3 years.', state: d.licence_no && future(d.licence_expiry) ? 'done' : docState('licence', false), form: 'licence', docType: 'licence', needsExpiry: true },
    { key: 'h', title: 'H endorsement & CPV identity card', help: 'Apply through NT Motor Vehicle Registry after passing the hire-and-reward knowledge test. Fee about $117.', state: docState('h_endorsement', future(d.h_endorsement_expiry)), form: 'h', docType: 'h_endorsement', needsExpiry: true },
    { key: 'police', title: 'National police check', help: 'Must be dated within the last 3 months when you apply.', state: docState('police_check', within3m(d.police_check_date)), form: 'doc', docType: 'police_check' },
    { key: 'medical', title: 'Medical certificate', help: 'Commercial driver medical from your GP, dated within the last 3 months.', state: docState('medical', within3m(d.medical_date)), form: 'doc', docType: 'medical' },
    { key: 'abn', title: 'ABN', help: 'You drive as a sole trader. Apply free at abr.gov.au.', state: d.abn ? 'done' : 'missing', form: 'abn' },
    { key: 'gst', title: 'GST registration', help: 'The ATO requires rideshare drivers to register for GST before their first trip, whatever they earn.', state: d.gst_registered ? 'done' : 'missing', form: 'gst' },
    { key: 'bank', title: 'Bank account for payouts', help: 'Earnings are paid weekly to this account.', state: d.bank_bsb ? 'done' : 'missing', form: 'bank' },
    { key: 'da', title: 'Disability awareness training', help: 'Short online module covering assistance animals, wheelchairs and respectful service.', state: docState('disability_awareness', !!d.da_training_date), form: 'doc', docType: 'disability_awareness' },
    { key: 'car', title: 'Your car', help: carHelp, state: carState, form: 'car' },
  ];
  const doneCount = steps.filter((s) => s.state === 'done').length;

  return (
    <div className="screen">
      <h1>Get ready to drive</h1>
      <p className="dg-muted" style={{ marginTop: 0 }}>{doneCount} of {steps.length} done. Status: <strong>{(d.status ?? 'applied').replace(/_/g, ' ')}</strong></p>
      <div className="battery-bar" style={{ marginBottom: 16 }} aria-hidden><i style={{ width: `${(doneCount / steps.length) * 100}%` }} /></div>

      {me.compliance_issues?.length > 0 && (
        <div className="dg-note" style={{ marginBottom: 12 }}>
          <strong>Before you can go online</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{me.compliance_issues.map((i: string) => <li key={i}>{i.replace(/"(\w+)"/g, (_m: string, w: string) => w.replace(/_/g, ' '))}</li>)}</ul>
        </div>
      )}

      <ol className="steps">
        {steps.map((s) => {
          const isCar = s.form === 'car';
          const btnLabel = open === s.key ? 'Close' : !isCar || !car ? 'Add' : car.status === 'rejected' ? 'Fix' : 'Continue';
          return (
            <li key={s.key} className={s.state === "done" ? "done" : ""}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center' }}>
                <div><p>{s.title}</p><small>{s.help}</small>
                  {isCar && car && <div className="car-line"><span>{carName(car)}, {car.rego}</span><FuelChip v={car} />{car.status === 'rejected' && <CarStatus v={car} />}</div>}</div>
                {s.state === 'done' ? <span className="dg-chip dg-chip--green">Done</span>
                  : s.state === 'review' ? (isCar ? <CarStatus v={car} /> : <span className="dg-chip dg-chip--ochre">In review</span>)
                    : <button className="dg-btn dg-btn--sm" onClick={() => setOpen(open === s.key ? null : s.key)} aria-expanded={open === s.key}>{btnLabel}</button>}
              </div>
              {open === s.key && (isCar
                ? <div style={{ marginTop: 12 }}>
                    {car ? <CarPapers car={car} ownerPermissionNeeded={ownerNeeded[car.id]} />
                      : <><CarRules minYear={minYear} /><AddCarForm minYear={minYear} onSaved={async (v, registeredOwner) => { setOwnerNeeded({ ...ownerNeeded, [v.id]: !registeredOwner }); await reloadMe(); }} /></>}
                  </div>
                : <StepForm step={s} onSaved={async () => { setOpen(null); await reloadMe(); }} />)}
            </li>
          );
        })}
      </ol>
      <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)' }}>DingoGo reviews documents within 2 business days. Questions? Call the office.</p>
      <Ranges height={40} fill="var(--line)" style={{ marginTop: 24 }} />
    </div>
  );
}

function StepForm({ step, onSaved }: { step: Step; onSaved: () => void }) {
  const [v, setV] = useState<Record<string, any>>({});
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      if (step.form === 'licence') await patch('/driver/me', { licence_no: v.number, licence_expiry: v.expires_at });
      if (step.form === 'h') await patch('/driver/me', { cpv_authority_no: v.number, h_endorsement_expiry: v.expires_at });
      if (step.form === 'abn') await patch('/driver/me', { abn: String(v.abn ?? '').replace(/\s/g, '') });
      if (step.form === 'gst') await patch('/driver/me', { gst_registered: !!v.gst });
      if (step.form === 'bank') await patch('/driver/me', { bank_bsb: String(v.bsb ?? '').replace(/\D/g, ''), bank_account: String(v.account ?? '').replace(/\D/g, '') });
      if (step.docType && ['licence', 'h', 'doc'].includes(step.form)) {
        const file_url = file ? (await uploadFile(file, 'document')).url : undefined;
        await post('/driver/documents', { type: step.docType, number: v.number || undefined, expires_at: v.expires_at || undefined, file_url });
      }
      onSaved();
    } catch (e2) { setErr(e2 instanceof ApiError ? e2.message : 'Could not save'); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={save} style={{ marginTop: 12 }}>
      {['licence', 'h', 'doc'].includes(step.form) && (
        <>
          <label className="dg-field"><span>Number / reference</span><input className="dg-input" value={v.number ?? ''} onChange={set('number')} required={step.form !== 'doc'} /></label>
          {step.needsExpiry && <label className="dg-field"><span>Expiry date</span><input className="dg-input" type="date" value={v.expires_at ?? ''} onChange={set('expires_at')} required /></label>}
          <label className="dg-field"><span>Photo or PDF</span><input className="dg-input" type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required={step.form === 'doc'} /></label>
        </>
      )}
      {step.form === 'abn' && <label className="dg-field"><span>ABN (11 digits)</span><input className="dg-input" inputMode="numeric" value={v.abn ?? ''} onChange={set('abn')} required /></label>}
      {step.form === 'gst' && <label className="dg-check"><input type="checkbox" checked={!!v.gst} onChange={set('gst')} required /><span>I'm registered for GST with the ATO</span></label>}
      {step.form === 'bank' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
          <label className="dg-field"><span>BSB</span><input className="dg-input" inputMode="numeric" value={v.bsb ?? ''} onChange={set('bsb')} required /></label>
          <label className="dg-field"><span>Account number</span><input className="dg-input" inputMode="numeric" value={v.account ?? ''} onChange={set('account')} required /></label>
        </div>
      )}
      {err && <p className="dg-error" role="alert">{err}</p>}
      <button className="dg-btn dg-btn--block" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
    </form>
  );
}
