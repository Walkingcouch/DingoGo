/**
 * Fare engine. All amounts in cents, GST-inclusive (rideshare in Australia is a taxable supply from $1).
 * Pure function: no DB access, so it is easy to unit-test and to reuse for the website estimator.
 */
export interface FareRule {
  service: string;
  label: string;
  base_cents: number;
  per_km_cents: number;
  per_min_cents: number;
  booking_fee_cents: number;
  min_fare_cents: number;
  night_pct: number;
  holiday_pct: number;
  cancel_fee_cents?: number;
  free_wait_min?: number;
  levy_cents?: number;      // NT passenger services levy — passed through, never discounted
}

export interface FareContext {
  distance_m: number;
  duration_s: number;
  at: Date;
  isHoliday?: boolean;
  zoneMultiplier?: number;          // manual demand multiplier, capped at 1.5
  plan?: { ride_discount_pct: number; waive_booking_fee: boolean; free_delivery: boolean } | null;
  promo?: { code: string; kind: 'percent' | 'fixed'; value: number; max_discount_cents: number | null } | null;
  corporateDiscountPct?: number;
  pointsToRedeem?: number;          // 100 points = $1, capped at 50% of fare
  availablePoints?: number;
  fixedPriceCents?: number;         // tours: package price replaces metered fare
  /** Passenger levy of the pickup zone's state (jurisdictions.levy_cents / levy_label). Applies only to services whose
   *  fare rule carries a levy (passenger services); replaces rule.levy_cents. Omit to use rule.levy_cents ("NT passenger levy"). */
  levy?: { cents: number; label: string } | null;
  /** Rider long-pickup charge (nearest free car is far away): discountable like the booking fee; paid to the driver as pickup pay. */
  longPickup?: { km: number; cents: number } | null;
  /** Fuel surcharge (admin switch): added after discounts, 100% to the driver. Not on fixed-price tours. */
  fuelSurchargeCents?: number;
  /** Approved concession card (admin community pricing): percent off the discountable amount, optional cap. DingoGo-funded. */
  concession?: { pct: number; max_cents: number | null; label: string } | null;
}

export interface FareLine { label: string; cents: number }
export interface FareQuote {
  service: string;
  lines: FareLine[];
  subtotal_cents: number;
  trip_cents: number;        // metered/package fare — the part the driver earns on
  booking_fee_cents: number;
  levy_cents: number;
  long_pickup_cents: number;
  long_pickup_km: number | null;
  fuel_surcharge_cents: number;
  discount_cents: number;
  points_redeemed: number;
  total_cents: number;
  gst_cents: number;
  distance_km: number;
  duration_min: number;
}

export const POINTS_PER_DOLLAR_REDEEM = 100;

export function localHour(at: Date, tz = 'Australia/Darwin'): number {
  return Number(new Intl.DateTimeFormat('en-AU', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(at));
}

export const isNight = (at: Date) => { const h = localHour(at); return h >= 22 || h < 5; };

const round5 = (c: number) => Math.round(c / 5) * 5; // AU has no 1c/2c coins — keep cash-friendly

export function quoteFare(rule: FareRule, ctx: FareContext): FareQuote {
  const km = ctx.distance_m / 1000;
  const min = ctx.duration_s / 60;
  const lines: FareLine[] = [];

  let trip: number;
  if (ctx.fixedPriceCents != null) {
    trip = ctx.fixedPriceCents;
    lines.push({ label: `${rule.label} (package price)`, cents: trip });
  } else {
    lines.push({ label: 'Base fare', cents: rule.base_cents });
    lines.push({ label: `Distance (${km.toFixed(1)} km)`, cents: Math.round(km * rule.per_km_cents) });
    lines.push({ label: `Time (${Math.round(min)} min)`, cents: Math.round(min * rule.per_min_cents) });
    trip = lines.reduce((s, l) => s + l.cents, 0);

    if (trip < rule.min_fare_cents) {
      lines.push({ label: 'Minimum fare adjustment', cents: rule.min_fare_cents - trip });
      trip = rule.min_fare_cents;
    }
    if (isNight(ctx.at) && rule.night_pct) {
      const c = Math.round((trip * rule.night_pct) / 100);
      lines.push({ label: `Late-night (${rule.night_pct}%)`, cents: c });
      trip += c;
    }
    if (ctx.isHoliday && rule.holiday_pct) {
      const c = Math.round((trip * rule.holiday_pct) / 100);
      lines.push({ label: `Public holiday (${rule.holiday_pct}%)`, cents: c });
      trip += c;
    }
    const mult = Math.min(Math.max(ctx.zoneMultiplier ?? 1, 1), 1.5);
    if (mult > 1) {
      const c = Math.round(trip * (mult - 1));
      lines.push({ label: `High demand (×${mult.toFixed(2)})`, cents: c });
      trip += c;
    }
  }

  let booking = rule.booking_fee_cents;
  if (booking) {
    if (ctx.plan?.waive_booking_fee) lines.push({ label: 'Booking fee (waived — DingoGo Pass)', cents: 0 });
    else lines.push({ label: 'Booking fee', cents: booking });
  }
  if (ctx.plan?.waive_booking_fee) booking = 0;

  const longPickup = ctx.fixedPriceCents == null && ctx.longPickup && ctx.longPickup.cents > 0 ? ctx.longPickup : null;
  if (longPickup) lines.push({ label: `Long pickup (nearest car ${longPickup.km.toFixed(1)} km away)`, cents: longPickup.cents });
  const pickupCents = longPickup?.cents ?? 0;

  const ruleLevy = rule.levy_cents ?? 0;
  const levy = ruleLevy > 0 && ctx.levy ? Math.max(0, ctx.levy.cents) : ruleLevy;
  const levyLabel = ruleLevy > 0 && ctx.levy ? ctx.levy.label : 'NT passenger levy';
  const subtotal = trip + booking + pickupCents;  // discountable amount (levy and fuel surcharge added after discounts)
  let discount = 0;

  if (ctx.plan?.free_delivery && rule.service.startsWith('courier')) {
    discount += subtotal;
    lines.push({ label: 'Free delivery (DingoGo Pass)', cents: -subtotal });
  } else if (ctx.plan?.ride_discount_pct) {
    const d = Math.round((trip * ctx.plan.ride_discount_pct) / 100);
    discount += d;
    lines.push({ label: `DingoGo Pass (−${ctx.plan.ride_discount_pct}%)`, cents: -d });
  }
  if (ctx.concession && ctx.concession.pct > 0 && ctx.fixedPriceCents == null) {
    let d = Math.round(((subtotal - discount) * ctx.concession.pct) / 100);
    if (ctx.concession.max_cents) d = Math.min(d, ctx.concession.max_cents);
    d = Math.max(0, Math.min(d, subtotal - discount));
    if (d > 0) { discount += d; lines.push({ label: ctx.concession.label, cents: -d }); }
  }
  if (ctx.corporateDiscountPct) {
    const d = Math.round(((subtotal - discount) * ctx.corporateDiscountPct) / 100);
    discount += d;
    lines.push({ label: `Business account (−${ctx.corporateDiscountPct}%)`, cents: -d });
  }
  if (ctx.promo) {
    let d = ctx.promo.kind === 'percent'
      ? Math.round(((subtotal - discount) * ctx.promo.value) / 100)
      : ctx.promo.value;
    if (ctx.promo.max_discount_cents != null) d = Math.min(d, ctx.promo.max_discount_cents);
    d = Math.min(d, subtotal - discount);
    discount += d;
    lines.push({ label: `Promo ${ctx.promo.code}`, cents: -d });
  }

  let pointsRedeemed = 0;
  if (ctx.pointsToRedeem && ctx.availablePoints) {
    const maxByFare = Math.floor(((subtotal - discount) * 0.5) / 100) * POINTS_PER_DOLLAR_REDEEM;
    pointsRedeemed = Math.max(0, Math.min(ctx.pointsToRedeem, ctx.availablePoints, maxByFare));
    pointsRedeemed -= pointsRedeemed % POINTS_PER_DOLLAR_REDEEM;
    if (pointsRedeemed > 0) {
      const d = (pointsRedeemed / POINTS_PER_DOLLAR_REDEEM) * 100;
      discount += d;
      lines.push({ label: `Dingo Points (${pointsRedeemed} pts)`, cents: -d });
    }
  }

  const fuel = ctx.fixedPriceCents == null ? Math.max(0, round5(ctx.fuelSurchargeCents ?? 0)) : 0;
  if (fuel) lines.push({ label: 'Fuel surcharge (all to your driver)', cents: fuel });
  if (levy) lines.push({ label: levyLabel, cents: levy });
  const total = Math.max(0, round5(subtotal - discount)) + fuel + levy;
  return {
    service: rule.service,
    lines,
    subtotal_cents: subtotal + fuel + levy,
    trip_cents: trip,
    booking_fee_cents: booking,
    levy_cents: levy,
    long_pickup_cents: pickupCents,
    long_pickup_km: longPickup ? Math.round(longPickup.km * 10) / 10 : null,
    fuel_surcharge_cents: fuel,
    discount_cents: discount,
    points_redeemed: pointsRedeemed,
    total_cents: total,
    gst_cents: Math.round(total / 11),
    distance_km: Math.round(km * 10) / 10,
    duration_min: Math.round(min),
  };
}

/** Fare breakdown as stored on trips.fare_breakdown: the quote at booking plus what happened on the road
 *  (route change line, return-to-sender line and fee). */
export type FareBreakdown = Partial<FareQuote> & { lines: FareLine[]; return_fee_cents?: number };

export const ROUTE_CHANGE_LABEL = 'Route change adjustment';
export const RETURN_FEE_LABEL = 'Return to sender';

/** Upfront pricing after the trip: the rider pays the quote unless the driven distance is more than 25% over the estimate;
 *  then the extra kilometres are charged at the per-km rate, capped at +20% of the quote. Tours (package price) never change.
 *  Pure; returns the extra cents (0 when the quote stands). */
export function routeChangeExtra(o: { quoteCents: number; estDistanceM: number; actualDistanceM: number | null | undefined; perKmCents: number; service: string }): number {
  const actual = o.actualDistanceM ?? 0;
  if (!actual || o.service === 'tour' || !(o.estDistanceM > 0) || actual <= o.estDistanceM * 1.25) return 0;
  const extra = Math.round((actual - o.estDistanceM) * (o.perKmCents / 1000));
  return Math.max(0, Math.min(extra, Math.round(o.quoteCents * 1.2) - o.quoteCents));
}

/** Return-to-sender fee for a failed delivery: a percent of the trip fare (before discounts), at least the minimum,
 *  5c-rounded; 0 when the percent is 0. */
export function returnFeeCents(tripCents: number, policy: { return_fee_pct: number; return_fee_min_cents: number }): number {
  if (!(policy.return_fee_pct > 0)) return 0;
  return Math.max(policy.return_fee_min_cents, round5((tripCents * policy.return_fee_pct) / 100));
}

/** Late-cancellation fee actually charged: never more than the trip's price (a free Pass delivery or a heavily discounted
 *  fare can't cost more to cancel than to take), and nothing on cash trips (DingoGo can't collect it). */
export function cancelFeeCharged(feeCents: number, t: { quote_cents: number; payment_method: string }): { cents: number; waived?: 'cash' | 'capped' } {
  if (feeCents <= 0) return { cents: 0 };
  if (t.payment_method === 'cash') return { cents: 0, waived: 'cash' };
  if (feeCents > t.quote_cents) return { cents: Math.max(0, t.quote_cents), waived: 'capped' };
  return { cents: feeCents };
}

/** Points earned on what the rider paid (whole points, nothing on $0). */
export const pointsEarned = (paidCents: number, pointsPerDollar: number) => Math.max(0, Math.floor((paidCents / 100) * pointsPerDollar));

/** GST in a GST-inclusive amount (1/11th, to the cent). */
export const gstOf = (cents: number) => Math.round(cents / 11);
