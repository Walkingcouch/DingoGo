/** Human labels for every code the API returns. Never show a raw enum to staff. */
type Map = Record<string, string>;

/** Look up a code; fall back to a readable version ("pending_documents" → "Pending documents"). */
export function label(map: Map, code: unknown): string {
  if (code == null || code === '') return '—';
  const s = String(code);
  if (map[s]) return map[s];
  const t = s.replace(/[_.-]+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
export const humanize = (code: unknown) => label({}, code);

export const DRIVER_STATUS: Map = { applied: 'Applied', pending_documents: 'Documents pending', approved: 'Approved', suspended: 'Suspended', rejected: 'Rejected' };
export const DRIVER_STATUS_TONE: Map = { approved: 'green', suspended: 'red', rejected: 'red', applied: 'ochre', pending_documents: 'ochre' };

export const ROLE: Map = { rider: 'Rider', driver: 'Driver', admin: 'Administrator', dispatcher: 'Dispatcher', partner: 'Partner business', corporate_admin: 'Business account admin' };
export const CHANNEL: Map = { app: 'App', phone: 'Phone', web: 'Website', sms: 'Text message' };
export const PAYMENT_METHOD: Map = { card: 'Card', cash: 'Cash', corporate: 'Business account', wallet: 'DingoGo credit' };
export const PAYMENT_STATUS: Map = { none: 'Not charged', authorised: 'Authorised', captured: 'Paid', failed: 'Failed', refunded: 'Refunded', invoiced: 'Invoiced', cash_collected: 'Cash collected' };
export const PAYMENT_KIND: Map = { fare: 'Fare', tip: 'Tip', refund: 'Refund', cancellation_fee: 'Cancellation fee', adjustment: 'Adjustment', topup: 'Top-up', voucher: 'Voucher' };

export const DOC_TYPE: Map = {
  licence: 'Driver licence', h_endorsement: 'H endorsement', cpvid: 'CPV identity card', police_check: 'Police check', medical: 'Medical certificate',
  abn: 'ABN', gst: 'GST registration', insurance: 'Insurance', vehicle_cvl: 'Vehicle CVL', roadworthy: 'Roadworthy', first_aid: 'First aid',
  disability_awareness: 'Disability awareness training', wwcc: 'Working with children (Ochre card)',
  vehicle_rego: 'Registration papers', owner_permission: 'Owner’s written permission',
};
export const DOC_STATUS: Map = { pending: 'Waiting for review', approved: 'Approved', rejected: 'Rejected', expired: 'Expired' };
export const docTone = (s: string) => (s === 'approved' ? 'green' : s === 'pending' ? 'ochre' : 'red');

export const FLAG_KIND: Map = { assistance_animal_refusal: 'Assistance animal refusal', doc_expired: 'Document expired', route_deviation: 'Route deviation', levy: 'NT levy' };
export const FLAG_STATUS: Map = { open: 'Open', reviewing: 'Reviewing', reviewed: 'Reviewed', actioned: 'Action taken', resolved: 'Resolved', dismissed: 'Dismissed' };
export const SOS_STATUS: Map = { open: 'Open', acknowledged: 'Acknowledged', resolved: 'Resolved' };
export const TICKET_STATUS: Map = { open: 'Open', pending: 'Waiting on customer', resolved: 'Resolved', closed: 'Closed', new: 'New', contacted: 'Contacted', quoted: 'Quoted', booked: 'Booked', confirmed: 'Confirmed', replied: 'Replied', declined: 'Declined' };
export const APPLICATION_STATUS: Map = { new: 'New', contacted: 'Contacted', onboarding: 'Onboarding', declined: 'Declined' };
export const CAMPAIGN_STATUS: Map = { pending: 'Waiting for approval', approved: 'Approved', paused: 'Paused', ended: 'Ended', rejected: 'Rejected' };
export const REDEMPTION_STATUS: Map = { issued: 'Issued', redeemed: 'Redeemed', expired: 'Expired', cancelled: 'Cancelled' };
export const CORPORATE_KIND: Map = { business: 'Business', ndis_plan_manager: 'NDIS plan manager', community_org: 'Community organisation', government: 'Government' };
export const OFFER_STATUS: Map = { offered: 'Offered', accepted: 'Accepted', declined: 'Declined', expired: 'Timed out', cancelled: 'Withdrawn' };
export const LEDGER_KIND: Map = { fare: 'Fare share', tip: 'Tip', fee: 'DingoGo fee', lease: 'Lease deduction', charging: 'Charging reimbursement', payout: 'Payout', adjustment: 'Adjustment', bonus: 'Bonus' };
export const PARCEL_SIZE: Map = { s: 'Small', m: 'Medium', l: 'Large', small: 'Small', medium: 'Medium', large: 'Large' };

export const OWNERSHIP: Map = { fleet: 'DingoGo fleet', leased_to_driver: 'Leased to driver', dingogo: 'DingoGo owned', dingogo_owned: 'DingoGo owned', driver_owned: 'Driver owned', leased: 'Leased to driver', lease: 'Leased to driver', partner: 'Partner owned' };
export const FUEL: Map = { electric: 'Electric', plug_in_hybrid: 'Plug-in hybrid', hybrid: 'Hybrid', petrol: 'Petrol', diesel: 'Diesel' };
/** Electric and hybrids are "green": they get trips first. */
export const isGreenFuel = (f?: string | null) => f === 'electric' || f === 'plug_in_hybrid' || f === 'hybrid';
export const VEHICLE_STATUS: Map = { pending: 'Waiting for check', approved: 'Approved', rejected: 'Not approved' };
export const VEHICLE_STATUS_TONE: Map = { pending: 'ochre', approved: 'green', rejected: 'red' };
export const EVENT_TYPE: Map = { requested: 'Requested', offered: 'Offered to driver', accepted: 'Driver accepted', arrived: 'Driver arrived', started: 'Trip started', in_progress: 'Trip started', completed: 'Completed', cancelled: 'Cancelled', no_drivers: 'No driver available', picked_up: 'Parcel collected', delivered: 'Parcel delivered', refund: 'Refund issued', rated: 'Rated', pin_verified: 'PIN checked', scheduled: 'Scheduled', released: 'Released to drivers' };
export const PARTNER_KIND: Map = { cafe: 'Café', shop: 'Shop', community: 'Community organisation', other: 'Other' };
export const SERVICE_NAME: Map = { ride: 'Ride', pet: 'Pet-friendly ride', courier_s: 'Courier, small', courier_m: 'Courier, medium', courier_l: 'Courier, large', tour: 'Tour', hourly: 'Hourly hire' };

/** The API phrases driver compliance problems for the driver ("your application"). Rephrase for staff and strip raw codes. */
export function complianceText(issue: string): string {
  const m = issue.match(/^Account status is "([a-z_]+)"/);
  if (m) {
    const st = m[1];
    if (st === 'suspended') return 'Account suspended';
    if (st === 'rejected') return 'Application rejected';
    if (st === 'pending_documents') return 'Documents still needed';
    return 'Application not yet approved';
  }
  const wait = issue.match(/^Your car (\S+) is waiting for DingoGo to check it/);
  if (wait) return `Car ${wait[1]} waiting for check`;
  const no = issue.match(/^Your car (\S+) was not approved:?\s*(.*)$/);
  if (no) return `Car ${no[1]} not approved${no[2] ? `: ${no[2]}` : ''}`;
  return issue.replace(/\s*\(ATO:[^)]*\)/, '').replace(/^Your car\b/, 'Car');
}
