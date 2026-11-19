import { useEffect, useState } from 'react';
import { get, money } from '@dingogo/shared';

export interface AccountSetup {
  role: string;
  rules: { require_cost_centre: boolean; require_purpose: boolean; require_po: boolean; default_po: string | null; approval_over_cents: number; require_ndis_number: boolean };
  cost_centres: { id: string; code: string; name: string; active: boolean; approver_id: string | null }[];
  purposes: { code: string; label: string; active: boolean }[];
}
export interface AccountValues { cost_centre_id: string; purpose_code: string; po_number: string }
export const EMPTY_ACCOUNT_VALUES: AccountValues = { cost_centre_id: '', purpose_code: '', po_number: '' };

/** The business account's set-up (cost centres, purposes, rules), or null when it has none or the server can't say yet. */
export function useAccountSetup(accountId: string | null | undefined) {
  const [setup, setSetup] = useState<AccountSetup | null>(null);
  useEffect(() => {
    let live = true;
    setSetup(null);
    if (accountId) get<AccountSetup>(`/business/accounts/${accountId}/setup`).then((s) => { if (live) setSetup(s); }).catch(() => {});
    return () => { live = false; };
  }, [accountId]);
  return setup;
}

/** What the booking body carries for these values (blank ones left out). */
export const accountBody = (v: AccountValues) => ({
  ...(v.cost_centre_id ? { cost_centre_id: v.cost_centre_id } : {}), ...(v.purpose_code ? { purpose_code: v.purpose_code } : {}),
  ...(v.po_number.trim() ? { po_number: v.po_number.trim() } : {}),
});
/** Why the booking can't go yet, in plain words, or null. */
export function accountMissing(setup: AccountSetup | null, v: AccountValues) {
  if (!setup) return null;
  if (setup.rules.require_cost_centre && setup.cost_centres.some((c) => c.active) && !v.cost_centre_id) return 'choose a cost centre';
  if (setup.rules.require_purpose && setup.purposes.some((p) => p.active) && !v.purpose_code) return 'choose the trip purpose';
  if (setup.rules.require_po && !setup.rules.default_po && !v.po_number.trim()) return 'add the PO number';
  return null;
}

/** Cost centre, purpose and PO fields for a trip billed to a business account. Shows only what the account uses. */
export function AccountFields({ setup, value, onChange, totalCents, later }: {
  setup: AccountSetup | null; value: AccountValues; onChange: (v: AccountValues) => void; totalCents?: number | null; later?: boolean;
}) {
  if (!setup) return null;
  const cc = setup.cost_centres.filter((c) => c.active);
  const purposes = setup.purposes.filter((p) => p.active);
  const r = setup.rules;
  const approver = setup.role === 'manager' || setup.role === 'approver' || cc.some((c) => c.id === value.cost_centre_id && c.approver_id);
  const overApproval = r.approval_over_cents > 0 && (totalCents ?? 0) > r.approval_over_cents && !approver;
  if (!cc.length && !purposes.length && !r.require_po && !r.default_po && !overApproval) return null;
  return (
    <div className="acct-fields">
      {cc.length > 0 && (
        <label className="dg-field"><span>Cost centre{!r.require_cost_centre && <span className="dg-muted"> (optional)</span>}</span>
          <select className="dg-select" value={value.cost_centre_id} onChange={(e) => onChange({ ...value, cost_centre_id: e.target.value })}>
            <option value="">{r.require_cost_centre ? 'Choose…' : 'None'}</option>
            {cc.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}
          </select></label>
      )}
      {purposes.length > 0 && (
        <label className="dg-field"><span>Purpose of the trip{!r.require_purpose && <span className="dg-muted"> (optional)</span>}</span>
          <select className="dg-select" value={value.purpose_code} onChange={(e) => onChange({ ...value, purpose_code: e.target.value })}>
            <option value="">{r.require_purpose ? 'Choose…' : 'None'}</option>
            {purposes.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
          </select></label>
      )}
      {(r.require_po || r.default_po) && (
        <label className="dg-field"><span>Purchase order (PO) number{(!r.require_po || r.default_po) && <span className="dg-muted"> (optional)</span>}</span>
          <input className="dg-input" value={value.po_number} maxLength={40} placeholder={r.default_po ? `Standing PO ${r.default_po}` : ''}
            onChange={(e) => onChange({ ...value, po_number: e.target.value })} /></label>
      )}
      {overApproval && (
        <p className="dg-note" role="status">Trips over {money(r.approval_over_cents)} need an approver's OK. {later ? 'We will ask them now; the trip goes ahead once they say yes.' : 'Book it for later so an approver can say yes, or ask an approver to book it.'}</p>
      )}
    </div>
  );
}
