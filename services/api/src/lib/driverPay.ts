/**
 * Driver pay rules (admin → Pricing → Driver pay; stored in settings key `driver_pay`).
 * Every rate is editable and the defaults keep today's behaviour: 25% service fee for every car, pickup pay,
 * long-pickup charge, fuel surcharge and the weekly earnings floor all switched off.
 */
import { one, pool, type Q } from '../db.js';
import { isGreen } from './vehicles.js';

export interface DriverPaySettings {
  /** DingoGo service fee by car. The driver's own rate (drivers.commission_pct) is a ceiling: these never raise a fee. */
  service_fee: { own_car_pct: number; green_pct: number };
  /** Pickup pay: the first free_km of the drive to the pickup are unpaid, then driver_cents_per_km up to max_km (no service fee).
   *  Funded by a rider "Long pickup" charge (rider_cents_per_km beyond free_km, same cap) based on the nearest free car. */
  pickup: { enabled: boolean; free_km: number; driver_cents_per_km: number; rider_cents_per_km: number; max_km: number };
  /** Flat amount per ride or parcel (not tours), outside discounts, 100% to the driver. */
  fuel_surcharge: { enabled: boolean; cents: number };
  /** Weekly top-up so counted earnings reach at least this much per engaged hour (accept → end of trip). */
  earnings_floor: { enabled: boolean; cents_per_engaged_hour: number; auto_weekly: boolean };
}

export const DRIVER_PAY_DEFAULTS: DriverPaySettings = {
  service_fee: { own_car_pct: 25, green_pct: 25 },
  pickup: { enabled: false, free_km: 2, driver_cents_per_km: 60, rider_cents_per_km: 60, max_km: 10 },
  fuel_surcharge: { enabled: false, cents: 50 },
  earnings_floor: { enabled: false, cents_per_engaged_hour: 3200, auto_weekly: false },
};

/** Ledger kinds that count as trip earnings for the earnings floor and the "trip pay" total (tips never count). */
export const TRIP_PAY_KINDS = ['fare', 'commission', 'pickup_pay', 'fuel_surcharge', 'cancel_fee'] as const;

export function mergeDriverPay(v: any): DriverPaySettings {
  const d = DRIVER_PAY_DEFAULTS;
  const o = v && typeof v === 'object' ? v : {};
  return {
    service_fee: { ...d.service_fee, ...(o.service_fee ?? {}) },
    pickup: { ...d.pickup, ...(o.pickup ?? {}) },
    fuel_surcharge: { ...d.fuel_surcharge, ...(o.fuel_surcharge ?? {}) },
    earnings_floor: { ...d.earnings_floor, ...(o.earnings_floor ?? {}) },
  };
}

export async function loadDriverPay(c: Q = pool): Promise<DriverPaySettings> {
  const row = await one(`SELECT value FROM settings WHERE key = 'driver_pay'`, [], c);
  return mergeDriverPay(row?.value);
}

export type FeeBasis = 'green' | 'own_car' | 'driver';

/** Service fee for a trip in this car. Electric/hybrid cars use the green rate, driver-owned petrol/diesel cars the own-car
 *  rate, DingoGo fleet/leased petrol cars the driver's own rate. Never above the driver's own rate. */
export function serviceFeeFor(driverPct: number, car: { fuel_type?: string | null; ownership?: string | null } | null, s: DriverPaySettings):
  { pct: number; basis: FeeBasis } {
  const own = Number.isFinite(driverPct) ? driverPct : 25;
  let rate: number | null = null;
  let basis: FeeBasis = 'driver';
  if (car && isGreen(car.fuel_type ?? '')) { rate = s.service_fee.green_pct; basis = 'green'; }
  else if (car?.ownership === 'driver_owned') { rate = s.service_fee.own_car_pct; basis = 'own_car'; }
  return rate != null && rate < own ? { pct: rate, basis } : { pct: own, basis: 'driver' };
}

const round5 = (c: number) => Math.round(c / 5) * 5;

/** Paid / charged pickup km: beyond the free km, capped. */
export function chargeableKm(pickupM: number | null | undefined, s: DriverPaySettings) {
  if (pickupM == null || !s.pickup.enabled) return 0;
  const km = pickupM / 1000 - s.pickup.free_km;
  return Math.max(0, Math.min(km, s.pickup.max_km));
}

export function pickupPayCents(pickupM: number | null | undefined, s: DriverPaySettings) {
  return Math.round(chargeableKm(pickupM, s) * s.pickup.driver_cents_per_km);
}

/** Rider long-pickup charge from the distance of the nearest free car (5c rounding: cash-friendly). */
export function longPickupCents(pickupM: number | null | undefined, s: DriverPaySettings) {
  return round5(chargeableKm(pickupM, s) * s.pickup.rider_cents_per_km);
}

export interface DriverPay {
  fare_cents: number;
  fee_pct: number;
  fee_basis: FeeBasis;
  fee_cents: number;
  pickup_m: number | null;
  pickup_km: number | null;
  pickup_paid_km: number;
  pickup_pay_cents: number;
  fuel_surcharge_cents: number;
  total_cents: number;
}

/** What the driver is paid for a trip (excluding tips). Used for the offer and, with the values fixed at accept, at completion. */
export function driverPay(input: { fareCents: number; feePct: number; feeBasis?: FeeBasis; pickupM: number | null; pickupPayCents: number; fuelSurchargeCents: number }, s?: DriverPaySettings): DriverPay {
  const fee = Math.round((input.fareCents * input.feePct) / 100);
  const pickupKm = input.pickupM != null ? Math.round(input.pickupM / 100) / 10 : null;
  return {
    fare_cents: input.fareCents,
    fee_pct: input.feePct,
    fee_basis: input.feeBasis ?? 'driver',
    fee_cents: fee,
    pickup_m: input.pickupM,
    pickup_km: pickupKm,
    pickup_paid_km: s ? Math.round(chargeableKm(input.pickupM, s) * 10) / 10 : 0,
    pickup_pay_cents: input.pickupPayCents,
    fuel_surcharge_cents: input.fuelSurchargeCents,
    total_cents: input.fareCents - fee + input.pickupPayCents + input.fuelSurchargeCents,
  };
}

/** Monday (YYYY-MM-DD) of the Darwin-time week containing `at`. */
export function weekStartOf(at: Date, tz = 'Australia/Darwin') {
  const local = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at) + 'T00:00:00Z');
  const dow = (local.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(local.getTime() - dow * 864e5).toISOString().slice(0, 10);
}
