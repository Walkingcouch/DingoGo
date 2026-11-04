import { useState } from 'react';
import { ApiError, Icon, patch, post, uploadFile, Ranges } from '@dingogo/shared';
import { useDriver } from '../state';
import { CarStatus, FuelChip, carName } from '../vehicle';
import { driverDocInfo, findJ, minYearFor, type Jurisdiction } from '../rules';
import { AddCarForm, CarPapers, CarRules, carDocsFor, carState as carStateOf, carToSetUp } from './Car';

type State = 'done' | 'review' | 'missing';
const today = () => new Date().toISOString().slice(0, 10);
const future = (d?: string | null) => !!d && d >= today();
const within3m = (d?: string | null) => !!d && (Date.now() - new Date(d).getTime()) / 864e5 <= 92;

interface Step { key: string; title: string; help: string; state: State; form: 'licence' | 'h' | 'doc' | 'abn' | 'gst' | 'bank' | 'car'; docType?: string; needsExpiry?: boolean; numberLabel?: string; numberRequired?: boolean }

const SA_TOWNS = 'Port Augusta, Coober Pedy, Whyalla, Port Pirie and Mount Gambier';

export function Onboarding() {
  const { me, reloadMe, cars, states, myState } = useDriver();
  const [open, setOpen] = useState<string | null>(null);
  const [ownerNeeded, setOwnerNeeded] = useState<Record<string, boolean>>({});
  if (!me) return null;
  const d = me.driver ?? {};
  const docs: any[] = me.documents ?? [];
  const j = myState;
  const car = carToSetUp(cars?.vehicles ?? (d.vehicle ? [d.vehicle] : []), cars?.current_vehicle_id ?? d.vehicle_id);
  const carJ = car ? findJ(states, carStateOf(car, j.code)) : j;
  const carDocs = car ? docs.filter((x) => x.vehicle_id === car.id && x.status !== 'rejected') : [];
  const papersIn = carDocsFor(carJ).filter((x) => !x.optional).every((t) => carDocs.some((x) => x.type === t.type));
  // NT cars need a current CVL; SA cars a current annual inspection. Older APIs may not send the date yet.
  const carLicenceOk = j.code === 'SA' ? car?.inspection_expiry === undefined || future(car?.inspection_expiry) : future(car?.cvl_expiry);
  const carState: State = !car ? 'missing'
    : (car.status ?? 'approved') === 'approved' && carLicenceOk ? 'done'
      : car.status === 'pending' && papersIn ? 'review' : 'missing';
  const carHelp = !car ? (j.code === 'SA'
      ? `Bring your own car: any fuel type, under ${j.vehicle_max_age_years} years old, SA-registered with 4 doors, inspected every year.`
      : `Bring your own car: any fuel type, under ${j.vehicle_max_age_years} years old, with 4 doors and an NT rideshare licence (CVL).`)
    : car.status === 'approved' && !carLicenceOk ? (j.code === 'SA' ? 'Your car’s annual inspection is due. Upload the new report.' : 'Your car’s rideshare licence (CVL) has expired. Upload the renewed one.')
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

  // The state's required papers, in its order, then DingoGo's own steps.
  const stateSteps: Step[] = j.driver_docs.flatMap((type): Step[] => {
    const info = driverDocInfo(type, j.code);
    if (!info) return []; // e.g. cpvid, covered by the H endorsement step
    const base = { key: type, title: info.title, help: info.help };
    switch (type) {
      case 'licence': return [{ ...base, state: d.licence_no && future(d.licence_expiry) ? 'done' : docState('licence', false), form: 'licence', docType: 'licence', needsExpiry: true }];
      case 'h_endorsement': return [{ ...base, key: 'h', state: docState('h_endorsement', future(d.h_endorsement_expiry)), form: 'h', docType: 'h_endorsement', needsExpiry: true }];
      case 'police_check': return [{ ...base, key: 'police', state: docState('police_check', within3m(d.police_check_date)), form: 'doc', docType: 'police_check' }];
      case 'medical': return [{ ...base, state: docState('medical', within3m(d.medical_date)), form: 'doc', docType: 'medical' }];
      case 'abn': return [{ ...base, state: d.abn ? 'done' : 'missing', form: 'abn' }];
      case 'gst': return [{ ...base, state: d.gst_registered ? 'done' : 'missing', form: 'gst' }];
      default: return [{ ...base, state: docState(type, false), form: 'doc', docType: type, needsExpiry: !!info.expiry, numberLabel: info.number, numberRequired: info.numberRequired }];
    }
  });
  const steps: Step[] = [
    ...stateSteps,
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

      <StatePicker j={j} />

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
                      : <><CarRules j={j} /><AddCarForm onSaved={async (v, registeredOwner) => { setOwnerNeeded({ ...ownerNeeded, [v.id]: !registeredOwner }); await reloadMe(); }} /></>}
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
          <label className="dg-field"><span>{step.numberLabel ?? 'Number / reference'}</span><input className="dg-input" value={v.number ?? ''} onChange={set('number')} required={step.form !== 'doc' || !!step.numberRequired} /></label>
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

/** "Where will you drive?" Drivers can change it until they're approved. SA is built but not open yet. */
function StatePicker({ j }: { j: Jurisdiction }) {
  const { me, states, reloadMe, setStatePick, showToast } = useDriver();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const status = me?.driver?.status ?? 'applied';
  const canChange = status === 'applied' || status === 'pending_documents';
  async function pick(code: string) {
    if (code === j.code || busy) return;
    setBusy(true); setErr(null);
    try { await patch('/driver/me', { state: code }); setStatePick(code); await reloadMe(); showToast(`Showing what you need for ${findJ(states, code).name}`); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not change your state'); }
    finally { setBusy(false); }
  }
  return (
    <section className="state-pick" aria-labelledby="state-h">
      <p id="state-h" className="panel-label">Where will you drive?</p>
      {canChange ? (
        <div className="choice-grid" role="group" aria-labelledby="state-h">
          {states.map((x) => (
            <button type="button" key={x.code} aria-pressed={x.code === j.code} disabled={busy} onClick={() => pick(x.code)}>
              <span className="state-pick__name">{x.name}{!x.active && <small>Coming soon</small>}</span>
            </button>
          ))}
        </div>
      ) : <p className="state-pick__fixed"><Icon name="pin" size={18} />{j.name}</p>}
      {!j.active && <p className="dg-note" style={{ margin: '8px 0 0' }}><strong>Coming soon.</strong> Sign up now and we’ll be in touch. In {j.code} we’re starting in {j.code === 'SA' ? SA_TOWNS : 'regional towns'}, once DingoGo is accredited there.</p>}
      {err && <p className="dg-error" role="alert">{err}</p>}
      <p className="fine-print" style={{ marginTop: 8 }}><Icon name="info" size={16} />Your car must be under {j.vehicle_max_age_years} years old (made in {minYearFor(j)} or later).</p>
    </section>
  );
}
