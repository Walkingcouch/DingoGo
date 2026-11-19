/**
 * Round 22: chargeback evidence pack for a trip. Everything a card issuer asks for when a rider disputes a charge: what was
 * booked and agreed (price shown, terms), proof the service happened (timeline, PIN check or proof of delivery, GPS track),
 * communication (trip chat), the tax invoice and payments, refunds already given, and the rider's history with DingoGo.
 * Phone numbers are cut to the last 3 digits; nothing about other trips' people. JSON for Stripe's form, PDF to upload.
 */
import { one, q } from '../db.js';
import { Pdf } from '../lib/pdf.js';
import { trackDistanceM } from '../lib/support.js';
import { buildReceipt } from './receipts.js';
import * as trips from './trips.js';
import { config } from '../config.js';

const tail = (p?: string | null) => (p ? `…${p.replace(/\D/g, '').slice(-3)}` : null);
const missing = (e: any) => e?.code === '42P01' || e?.code === '42703';
const opt = <T>(p: Promise<T>, empty: T) => p.catch((e) => { if (missing(e)) return empty; throw e; });
const money = (c: number | null | undefined) => (c == null ? '-' : `$${(c / 100).toFixed(2)}`);
const local = (d: Date | string | null | undefined) => (d ? new Intl.DateTimeFormat('en-AU', { timeZone: config.timezone, dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(d)) : '-');

const EVENT_LABEL: Record<string, string> = {
  requested: 'Booked', created: 'Booked', offered: 'Offered to a driver', accepted: 'Driver accepted', arrived: 'Driver arrived at pickup', started: 'Trip started',
  completed: 'Trip completed', cancelled: 'Cancelled', refund: 'Refund', tip: 'Tip added', rated: 'Rated', payment_failed: 'Payment failed', captured: 'Payment taken',
  relay_call: 'Masked call', fare_review: 'Fare check', lost_item_reported: 'Lost property reported', dispute_opened: 'Dispute opened',
  dispute_updated: 'Dispute updated', dispute_closed: 'Dispute closed', pod_pin_failed: 'Wrong delivery PIN',
};

/** Round 26: the pack goes to a card issuer, a third party. Safety matters between rider and driver (reports, shared trips,
 *  check-ins, SOS) aren't theirs to see, and the driver is named by first name and initial only. */
const PRIVATE_EVENTS = /^(incident_|shared_with_contacts|safety_|check_in|sos|identity_)/;
export const driverLabel = (name?: string | null) => {
  const [first, ...rest] = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!first) return null;
  const last = rest.at(-1);
  return last ? `${first} ${last[0].toUpperCase()}.` : first;
};

export async function evidencePack(tripId: string) {
  const t = await trips.getTrip(tripId);
  const [events, track, payments, messages, tickets, riderStats] = await Promise.all([
    q(`SELECT e.at, e.type, e.data, u.role AS actor_role FROM trip_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.trip_id = $1 ORDER BY e.at, e.id`, [t.id])
      .then((rows) => rows.filter((e: any) => !PRIVATE_EVENTS.test(e.type))),
    q(`SELECT lat, lng, at FROM trip_track WHERE trip_id = $1 ORDER BY at`, [t.id]),
    q(`SELECT created_at, kind, provider, provider_ref, amount_cents, gst_cents, status FROM payments WHERE trip_id = $1 ORDER BY created_at`, [t.id]),
    opt(q(`SELECT m.created_at, m.sender_role, m.body, m.via FROM trip_messages m WHERE m.trip_id = $1 ORDER BY m.id`, [t.id]), [] as any[]),
    q(`SELECT ref, category, subject, status, created_at FROM support_tickets WHERE trip_id = $1 ORDER BY created_at`, [t.id])
      .catch((e) => { if (missing(e)) return q(`SELECT category, subject, status, created_at FROM support_tickets WHERE trip_id = $1 ORDER BY created_at`, [t.id]); throw e; }),
    one(`SELECT u.created_at AS member_since,
           (SELECT count(*)::int FROM trips x WHERE x.rider_id = u.id AND x.status = 'completed') AS completed_trips,
           (SELECT count(*)::int FROM payments p WHERE p.user_id = u.id AND p.kind = 'dispute') AS disputes,
           (SELECT count(*)::int FROM trips x WHERE x.rider_id = u.id AND x.status = 'completed' AND x.payment_method = t.payment_method) AS same_payment_trips
         FROM users u JOIN trips t ON t.id = $2 WHERE u.id = $1`, [t.rider_id, t.id]),
  ]);
  const inTrip = track.filter((p: any) => (!t.started_at || new Date(p.at) >= new Date(t.started_at)) && (!t.completed_at || new Date(p.at) <= new Date(t.completed_at)));
  const receipt = t.status === 'completed' || t.cancel_fee_cents ? await buildReceipt(t) : null;
  const ride = t.kind === 'ride';
  const started = events.find((e: any) => e.type === 'started');
  const proof = ride
    ? { kind: 'pin', text: started ? `The trip could only start after the driver entered the rider's 4-digit trip PIN (shown only in the rider's app). Started ${local(started.at)}.` : 'The trip did not start.' }
    : { kind: 'delivery', received_by: t.parcel?.pod_received_by ?? null, signature: !!t.parcel?.pod_signature, photo: !!t.parcel?.pod_photo_url,
        delivered_at: t.parcel?.delivered_at ?? null, distance_m: t.parcel?.pod_distance_m ?? null,
        text: t.parcel?.delivered_at ? `Delivered ${local(t.parcel.delivered_at)}${t.parcel.pod_received_by ? ` to ${t.parcel.pod_received_by}` : ''}${t.parcel.pod_signature ? ', signed' : ''}${t.parcel.pod_photo_url ? ', photo taken' : ''}.` : 'Not delivered.' };
  const refunded = payments.filter((p: any) => p.kind === 'refund' && p.status === 'succeeded').reduce((n: number, p: any) => n - p.amount_cents, 0);
  const trackedM = inTrip.length >= 2 ? trackDistanceM(inTrip) : null;
  const summary = [
    `${ride ? 'Ride' : 'Delivery'} ${t.ref} for ${t.rider?.name ?? 'the customer'}, ${t.pickup_address} to ${t.dropoff_address}.`,
    `Booked in the DingoGo app ${local(t.requested_at)} with an upfront price of ${money(t.quote_cents)}${t.final_cents != null && t.final_cents !== t.quote_cents ? `; final charge ${money(t.final_cents)} (route change)` : ''}.`,
    t.completed_at ? `Completed ${local(t.completed_at)} by driver ${driverLabel(t.driver?.name) ?? '-'} in ${t.vehicle ? `${t.vehicle.colour ?? ''} ${t.vehicle.make ?? ''} ${t.vehicle.model ?? ''}, rego ${t.vehicle.rego}`.replace(/\s+/g, ' ').trim() : 'a registered car'}.` : `Status: ${t.status}.`,
    proof.text,
    trackedM != null ? `GPS track: ${inTrip.length} points, ${(trackedM / 1000).toFixed(1)} km driven during the trip (estimate ${(t.est_distance_m / 1000).toFixed(1)} km).` : 'GPS track: not enough points recorded.',
    `${messages.length} chat message${messages.length === 1 ? '' : 's'} between rider and driver.`,
    refunded > 0 ? `Already refunded: ${money(refunded)}.` : 'No refunds given.',
    riderStats ? `Customer since ${local(riderStats.member_since)}, ${riderStats.completed_trips} completed trips${riderStats.same_payment_trips > 1 ? `, ${riderStats.same_payment_trips} paid the same way` : ''}.` : '',
    t.rider_rating ? `The rider rated the trip ${t.rider_rating} of 5${t.rider_feedback ? `: "${t.rider_feedback}"` : ''}.` : '',
  ].filter(Boolean);
  return {
    generated_at: new Date().toISOString(),
    summary,
    trip: {
      ref: t.ref, kind: t.kind, service: t.service, status: t.status, channel: t.channel, pickup: t.pickup_address, dropoff: t.dropoff_address,
      requested_at: t.requested_at, accepted_at: t.accepted_at, arrived_at: t.arrived_at, started_at: t.started_at, completed_at: t.completed_at, cancelled_at: t.cancelled_at,
      est_distance_m: t.est_distance_m, actual_distance_m: t.actual_distance_m, quote_cents: t.quote_cents, final_cents: t.final_cents, tip_cents: t.tip_cents,
      cancel_fee_cents: t.cancel_fee_cents, payment_method: t.payment_method, payment_status: t.payment_status, payment_ref: t.payment_ref, fare_lines: t.fare_breakdown?.lines ?? [],
    },
    customer: { name: t.rider?.name ?? null, phone: tail(t.rider?.phone), ...(riderStats ?? {}) },
    driver: t.driver ? { name: driverLabel(t.driver.name), phone: tail(t.driver.phone) } : null,
    vehicle: t.vehicle ? { rego: t.vehicle.rego, make: t.vehicle.make, model: t.vehicle.model, colour: t.vehicle.colour } : null,
    proof,
    timeline: events.map((e: any) => ({ at: e.at, type: e.type, label: EVENT_LABEL[e.type] ?? e.type.replace(/_/g, ' '), by: e.actor_role ?? 'system' })),
    track: { points: inTrip.length, all_points: track.length, distance_m: trackedM, first_at: inTrip[0]?.at ?? null, last_at: inTrip.at(-1)?.at ?? null,
      path: inTrip.map((p: any) => ({ lat: Number(p.lat.toFixed(5)), lng: Number(p.lng.toFixed(5)), at: p.at })) },
    chat: messages.map((m: any) => ({ at: m.created_at, from: m.sender_role, via: m.via, body: m.body })),
    receipt,
    payments: payments.map((p: any) => ({ at: p.created_at, kind: p.kind, provider: p.provider, ref: p.provider_ref, cents: p.amount_cents, status: p.status })),
    refunded_cents: refunded,
    ratings: { rider_rating: t.rider_rating, rider_feedback: t.rider_feedback, driver_rating: t.driver_rating },
    support: tickets.filter((s: any) => s.category !== 'safety').map((s: any) => ({ ref: s.ref ?? null, category: s.category, subject: s.subject, status: s.status, at: s.created_at })),
  };
}

export function evidencePdf(p: Awaited<ReturnType<typeof evidencePack>>): Buffer {
  const pdf = new Pdf(`DingoGo evidence ${p.trip.ref}`, `DingoGo evidence pack ${p.trip.ref}, made ${local(p.generated_at)}`);
  pdf.heading(`Evidence pack: trip ${p.trip.ref}`);
  pdf.para(`Prepared by DingoGo for a payment dispute. Times are Australia/Darwin (ACST). Phone numbers show the last 3 digits only.`, 9);
  pdf.heading('Summary', 12);
  for (const s of p.summary) pdf.para(`- ${s}`, 9.5);
  pdf.heading('Trip', 12);
  pdf.rows([
    ['Reference', p.trip.ref], ['Service', `${p.trip.kind}, ${p.trip.service}`], ['Booked through', p.trip.channel ?? 'app'],
    ['From', p.trip.pickup], ['To', p.trip.dropoff], ['Booked', local(p.trip.requested_at)], ['Driver accepted', local(p.trip.accepted_at)],
    ['Started', local(p.trip.started_at)], ['Completed', local(p.trip.completed_at)], ['Price shown at booking', money(p.trip.quote_cents)],
    ['Charged', money(p.trip.final_cents ?? p.trip.cancel_fee_cents)], ['Tip', money(p.trip.tip_cents)], ['Payment', `${p.trip.payment_method}, ${p.trip.payment_status}${p.trip.payment_ref ? ` (${p.trip.payment_ref})` : ''}`],
    ['Customer', `${p.customer.name ?? '-'} ${p.customer.phone ?? ''}`], ['Driver', p.driver ? `${p.driver.name} ${p.driver.phone ?? ''}` : '-'],
    ['Car', p.vehicle ? `${p.vehicle.colour ?? ''} ${p.vehicle.make ?? ''} ${p.vehicle.model ?? ''}, ${p.vehicle.rego}` : '-'],
  ], { size: 9, labelW: 150 });
  pdf.heading('Proof the service was provided', 12);
  pdf.para(p.proof.text, 9.5);
  pdf.heading('Timeline', 12);
  pdf.table([{ label: 'Time', width: 0.32 }, { label: 'What happened', width: 0.5 }, { label: 'By', width: 0.18 }],
    p.timeline.map((e) => [local(e.at), e.label, e.by]));
  pdf.heading('GPS track', 12);
  pdf.para(p.track.distance_m != null ? `${p.track.points} points between ${local(p.track.first_at)} and ${local(p.track.last_at)}, ${(p.track.distance_m / 1000).toFixed(1)} km.` : 'Not enough GPS points recorded during the trip.', 9.5);
  if (p.track.path.length) {
    const step = Math.max(1, Math.ceil(p.track.path.length / 60));
    const rows = p.track.path.filter((_, i) => i % step === 0 || i === p.track.path.length - 1).map((x) => [local(x.at), x.lat.toFixed(5), x.lng.toFixed(5)]);
    pdf.table([{ label: 'Time', width: 0.4 }, { label: 'Latitude', width: 0.3, align: 'right' }, { label: 'Longitude', width: 0.3, align: 'right' }], rows, { size: 7.5 });
    if (step > 1) pdf.para(`Every ${step}th point shown. The JSON pack has all ${p.track.path.length}.`, 8);
  }
  pdf.heading('Messages between rider and driver', 12);
  if (p.chat.length) pdf.table([{ label: 'Time', width: 0.28 }, { label: 'From', width: 0.12 }, { label: 'Message', width: 0.6 }], p.chat.map((m) => [local(m.at), m.from, m.body]));
  else pdf.para('No messages.', 9.5);
  pdf.heading('Tax invoice and payments', 12);
  if (p.receipt) {
    pdf.rows([...((p.receipt.lines ?? []) as { label: string; cents: number }[]).map((l): [string, string] => [l.label, money(l.cents)]),
      ['Total incl. GST', money(p.receipt.total_cents)], ['Refunded', money(p.receipt.refunded_cents)], ['Net', money(p.receipt.net_total_cents)]], { size: 9, boldLast: true });
  }
  pdf.table([{ label: 'Time', width: 0.3 }, { label: 'Kind', width: 0.14 }, { label: 'Provider / ref', width: 0.34 }, { label: 'Amount', width: 0.12, align: 'right' }, { label: 'Status', width: 0.1 }],
    p.payments.map((x) => [local(x.at), x.kind, `${x.provider}${x.ref ? ` ${x.ref}` : ''}`, money(x.cents), x.status]), { size: 7.5 });
  if (p.support.length) {
    pdf.heading('Support contact about this trip', 12);
    pdf.table([{ label: 'Time', width: 0.3 }, { label: 'Ref', width: 0.14 }, { label: 'Subject', width: 0.42 }, { label: 'Status', width: 0.14 }],
      p.support.map((s) => [local(s.at), s.ref ?? '-', s.subject, s.status]));
  }
  return pdf.toBuffer();
}
