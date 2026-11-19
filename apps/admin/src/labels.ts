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
export const PAYMENT_KIND: Map = { fare: 'Fare', tip: 'Tip', refund: 'Refund', cancellation_fee: 'Cancellation fee', adjustment: 'Adjustment', topup: 'Top-up', voucher: 'Voucher',
  authorise: 'Card hold', capture: 'Charged', cash: 'Cash', invoice: 'Account invoice', subscription: 'DingoGo Pass', dispute: 'Dispute (chargeback)' };
export const PAYMENT_PROVIDER: Map = { stripe: 'Stripe', mock: 'Test payment', cash: 'Cash', wallet: 'DingoGo credit', corporate: 'Business account', voucher: 'Voucher', card: 'Card' };
export const PAYMENT_ROW_STATUS: Map = { succeeded: 'Done', failed: 'Failed', pending: 'Pending', warning_needs_response: 'Early warning: reply needed', warning_under_review: 'Early warning: under review',
  warning_closed: 'Early warning closed', needs_response: 'Reply needed', under_review: 'Under review', won: 'Won', lost: 'Lost' };

export const DOC_TYPE: Map = {
  licence: 'Driver licence', h_endorsement: 'H endorsement', cpvid: 'CPV identity card', police_check: 'Police check', medical: 'Medical certificate',
  abn: 'ABN', gst: 'GST registration', insurance: 'Insurance', vehicle_cvl: 'Vehicle CVL', roadworthy: 'Roadworthy', first_aid: 'First aid',
  disability_awareness: 'Disability awareness training', wwcc: 'Working with children check',
  vehicle_rego: 'Registration papers', owner_permission: 'Owner’s written permission', compliance_plate: 'Compliance plate photo',
  sa_driver_accreditation: 'SA driver accreditation', sa_operator_accreditation: 'SA operator accreditation', sa_inspection: 'SA annual inspection',
  ctp_spv: 'CTP (small passenger vehicle)', public_liability: 'Public liability insurance',
};
export const STATE_NAME: Map = { NT: 'Northern Territory', SA: 'South Australia' };
/** Where staff confirmed the year the car was built. */
export const VERIFIED_SOURCE: Map = { vin: 'VIN', compliance_plate: 'Compliance plate', rego_papers: 'Rego papers', plate_lookup: 'Paid plate lookup', other: 'Other' };
export const DOC_STATUS: Map = { pending: 'Waiting for review', approved: 'Approved', rejected: 'Rejected', expired: 'Expired' };
export const docTone = (s: string) => (s === 'approved' ? 'green' : s === 'pending' ? 'ochre' : 'red');

export const FLAG_KIND: Map = { assistance_animal_refusal: 'Assistance animal refusal', doc_expired: 'Document expired', route_deviation: 'Route deviation', levy: 'Passenger levy', repeat_cancellation: 'Repeated cancellations after accepting', delivery_far_from_address: 'Parcel left far from the address' };
export const PARCEL_OUTCOME: Map = { delivered: 'Delivered', returning: 'Coming back to the sender', returned: 'Returned to the sender', accepted: 'Accepted', arrived: 'At pickup', in_progress: 'On its way', requested: 'Searching', scheduled: 'Booked', completed: 'Completed' };
export const FAIL_REASON: Map = { no_one_home: 'Nobody home', no_safe_place: 'No safe place', refused: 'Refused', wrong_address: 'Wrong address', no_access: 'No access', unsafe: 'Unsafe', other: 'Other' };
export const FLAG_STATUS: Map = { open: 'Open', reviewing: 'Reviewing', reviewed: 'Reviewed', actioned: 'Action taken', resolved: 'Resolved', dismissed: 'Dismissed' };
export const SOS_STATUS: Map = { open: 'Open', acknowledged: 'Acknowledged', resolved: 'Resolved' };
export const TICKET_STATUS: Map = { open: 'Open', pending: 'Waiting on customer', resolved: 'Resolved', closed: 'Closed', new: 'New', contacted: 'Contacted', quoted: 'Quoted', booked: 'Booked', confirmed: 'Confirmed', replied: 'Replied', declined: 'Declined' };
export const APPLICATION_STATUS: Map = { new: 'New', contacted: 'Contacted', onboarding: 'Onboarding', declined: 'Declined' };
export const CAMPAIGN_STATUS: Map = { pending: 'Waiting for approval', approved: 'Approved', paused: 'Paused', ended: 'Ended', rejected: 'Rejected' };
export const REDEMPTION_STATUS: Map = { issued: 'Issued', redeemed: 'Redeemed', expired: 'Expired', cancelled: 'Cancelled' };
export const CORPORATE_KIND: Map = { business: 'Business', ndis_plan_manager: 'NDIS plan manager', community_org: 'Community organisation', aboriginal_corporation: 'Aboriginal corporation', health_service: 'Health service', government: 'Government' };
export const OFFER_STATUS: Map = { offered: 'Offered', accepted: 'Accepted', declined: 'Declined', expired: 'Timed out', cancelled: 'Driver cancelled after accepting', released: 'Given to another driver' };
export const LEDGER_KIND: Map = {
  fare: 'Fare', commission: 'DingoGo fee', fee: 'DingoGo fee', pickup_pay: 'Pickup pay', fuel_surcharge: 'Fuel surcharge', cancel_fee: 'Cancellation fee share',
  tip: 'Tip', earnings_floor: 'Earnings floor top-up', bonus: 'Bonus', cash_collected: 'Cash held by driver', lease: 'Lease deduction',
  charging_credit: 'Charging reimbursement', charging: 'Charging reimbursement', payout: 'Payout', adjustment: 'Adjustment',
};
export const PARCEL_SIZE: Map = { s: 'Small', m: 'Medium', l: 'Large', small: 'Small', medium: 'Medium', large: 'Large' };

export const OWNERSHIP: Map = { fleet: 'DingoGo fleet', leased_to_driver: 'Leased to driver', dingogo: 'DingoGo owned', dingogo_owned: 'DingoGo owned', driver_owned: 'Driver owned', leased: 'Leased to driver', lease: 'Leased to driver', partner: 'Partner owned' };
export const FUEL: Map = { electric: 'Electric', plug_in_hybrid: 'Plug-in hybrid', hybrid: 'Hybrid', petrol: 'Petrol', diesel: 'Diesel' };
/** Electric and hybrids are "green": they get trips first. */
export const isGreenFuel = (f?: string | null) => f === 'electric' || f === 'plug_in_hybrid' || f === 'hybrid';
export const VEHICLE_STATUS: Map = { pending: 'Waiting for check', approved: 'Approved', rejected: 'Not approved' };
export const VEHICLE_STATUS_TONE: Map = { pending: 'ochre', approved: 'green', rejected: 'red' };
export const EVENT_TYPE: Map = { relay_call: 'Call through DingoGo number', requested: 'Requested', offered: 'Offered to driver', accepted: 'Driver accepted', arrived: 'Driver arrived', started: 'Trip started', in_progress: 'Trip started', completed: 'Completed', cancelled: 'Cancelled', no_drivers: 'No driver available', picked_up: 'Parcel collected', delivered: 'Parcel delivered', refund: 'Refund issued', rated: 'Rated', pin_verified: 'PIN checked', scheduled: 'Scheduled', released: 'Released to drivers', redispatched: 'Searching again', pod_pin_failed: 'Wrong delivery PIN',
  payment_failed: 'Payment failed', payment_retried: 'Payment taken (retry)', payment_retry_failed: 'Retry payment failed', hold_lapsed: 'Card hold lapsed',
  dispute_opened: 'Dispute opened', dispute_updated: 'Dispute updated', dispute_closed: 'Dispute closed',
  driver_released: 'Back to the search (driver pulled out)', driver_silent: 'No signal from driver', offer_withdrawn: 'Offer withdrawn (driver went offline)',
  cancelled_rider: 'Cancelled by rider', cancelled_driver: 'Cancelled by driver', cancelled_admin: 'Cancelled by DingoGo', declined: 'Driver declined' };
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

/** Round 9: texts, calls and push logged for a trip (comms_log). */
export const COMMS_TEMPLATE: Map = {
  otp: 'Sign-in code', sos_contact: 'SOS text to emergency contact', parcel_recipient: 'Parcel PIN to recipient', parcel_delivered_sender: 'Delivered text to sender', parcel_recipient_booked: 'Parcel booked text to recipient', parcel_on_way: 'Parcel ETA to recipient', parcel_failed_recipient: 'Not delivered text to recipient', parcel_failed_sender: 'Not delivered text to sender', parcel_returned_sender: 'Returned text to sender',
  driver_on_way: 'Driver on the way', driver_here: 'Driver is here', no_drivers: 'No drivers', booking_card_declined: 'Booking cancelled: card',
  finding_another_driver: 'Finding another driver', driver_cancelled: 'Driver cancelled', chat_relay_sms: 'Message passed on by text', relay_call: 'Call through DingoGo number',
  promo: 'Offer',
};
export const COMMS_STATUS: Map = {
  sent: 'Sent', failed: 'Failed', skipped_opt_out: 'Not sent: replied STOP', unsubscribed: 'Not sent: unsubscribed', bad_number: 'Not sent: bad number',
  dev_log: 'Not sent: texts off', no_reply_number: 'Not sent: no reply number', bridged: 'Connected', no_trip: 'No live trip',
};
