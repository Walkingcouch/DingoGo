/** Trip tax invoice (rides are a taxable supply: every receipt shows ABN and GST). Refunds are listed as adjustments and the
 *  totals are net of them; tips are not part of the supply (no GST), matching the GST report. Used by GET /trips/:id/receipt
 *  and the chargeback evidence pack (Round 22). `t` is a trip from getTrip. */
import { one, q } from '../db.js';

export async function buildReceipt(t: any) {
  const fee = t.status !== 'completed';
  const fare = fee ? t.cancel_fee_cents : t.final_cents;
  const biz = (await one(`SELECT value FROM settings WHERE key = 'business'`))?.value ?? {};
  const refunds = await q(`SELECT created_at AS at, -amount_cents AS cents, -gst_cents AS gst_cents FROM payments
                         WHERE trip_id = $1 AND kind = 'refund' AND status = 'succeeded' ORDER BY created_at`, [t.id]);
  const refunded = refunds.reduce((n: number, r: any) => n + r.cents, 0);
  const refundedGst = refunds.reduce((n: number, r: any) => n + r.gst_cents, 0);
  const gst = Math.round(fare / 11);
  const netGst = gst - refundedGst;
  const total = fare + t.tip_cents;
  const lines = fee ? [{ label: 'Cancellation fee', cents: fare }] : t.fare_breakdown.lines;
  // Fares are the driver's taxable supply (each driver is registered for GST; see the GST report): DingoGo issues the
  // invoice on the driver's behalf, so it carries the driver's ABN as well as DingoGo's.
  const drv = t.driver_id ? await one('SELECT abn, gst_registered FROM drivers WHERE user_id = $1', [t.driver_id]) : null;
  return {
    title: refunded > 0 ? 'Tax Invoice (adjusted)' : 'Tax Invoice', invoice_number: t.ref,
    supplier: biz, supplier_abn: biz.abn ?? null,
    supplied_by: t.driver ? { name: t.driver.name, abn: drv?.abn ?? null, gst_registered: !!drv?.gst_registered } : null,
    issued_on_behalf: !!t.driver, trip_ref: t.ref, date: t.completed_at ?? t.cancelled_at, issued_at: new Date().toISOString(),
    customer: { name: t.rider?.name ?? null, ndis_number: t.ndis_number ?? null },
    service: t.service, from: t.pickup_address, to: t.dropoff_address, cancellation_fee: fee,
    driver: t.driver?.name, vehicle: t.vehicle?.rego, vehicle_fuel_type: t.vehicle?.fuel_type ?? null, vehicle_is_ev: !!t.vehicle?.is_ev,
    lines, fare_cents: fare, tip_cents: t.tip_cents,
    total_cents: total, gst_cents: gst,
    refunds, refunded_cents: refunded, net_total_cents: total - refunded, net_gst_cents: netGst,
    gst_note: `Total includes GST of $${(netGst / 100).toFixed(2)}`,
    tip_note: t.tip_cents > 0 ? 'Tips go 100% to your driver and are not part of the taxable fare (no GST).' : null,
    payment_method: t.payment_method, payment_status: t.payment_status,
    distance_km: Math.round((t.actual_distance_m ?? t.est_distance_m) / 100) / 10,
    // CO₂ saved only for trips actually done in an electric car (vs avg petrol car ~180 g/km); null otherwise.
    co2_saved_kg: !fee && t.vehicle?.is_ev ? Math.round(((t.actual_distance_m ?? t.est_distance_m) / 1000) * 0.18 * 10) / 10 : null,
  };
}
