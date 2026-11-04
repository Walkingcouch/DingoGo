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
}

export interface FareLine { label: string; cents: number }
export interface FareQuote {
  service: string;
  lines: FareLine[];
  subtotal_cents: number;
  trip_cents: number;        // metered/package fare — the part the driver earns on
  booking_fee_cents: number;
  levy_cents: number;
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

  const ruleLevy = rule.levy_cents ?? 0;
  const levy = ruleLevy > 0 && ctx.levy ? Math.max(0, ctx.levy.cents) : ruleLevy;
  const levyLabel = ruleLevy > 0 && ctx.levy ? ctx.levy.label : 'NT passenger levy';
  const subtotal = trip + booking;  // discountable amount (levy added after discounts)
  let discount = 0;

  if (ctx.plan?.free_delivery && rule.service.startsWith('courier')) {
    discount += subtotal;
    lines.push({ label: 'Free delivery (DingoGo Pass)', cents: -subtotal });
  } else if (ctx.plan?.ride_discount_pct) {
    const d = Math.round((trip * ctx.plan.ride_discount_pct) / 100);
    discount += d;
    lines.push({ label: `DingoGo Pass (−${ctx.plan.ride_discount_pct}%)`, cents: -d });
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

  if (levy) lines.push({ label: levyLabel, cents: levy });
  const total = Math.max(0, round5(subtotal - discount)) + levy;
  return {
    service: rule.service,
    lines,
    subtotal_cents: subtotal + levy,
    trip_cents: trip,
    booking_fee_cents: booking,
    levy_cents: levy,
    discount_cents: discount,
    points_redeemed: pointsRedeemed,
    total_cents: total,
    gst_cents: Math.round(total / 11),
    distance_km: Math.round(km * 10) / 10,
    duration_min: Math.round(min),
  };
}

/** Final fare after the trip: re-meter on actual distance/time but never exceed quote by more than 20% without review. */
export function finalFare(quoteCents: number, rule: FareRule, ctx: FareContext): { cents: number; capped: boolean } {
  const metered = quoteFare(rule, ctx).total_cents;
  const cap = Math.round(quoteCents * 1.2);
  return metered > cap ? { cents: cap, capped: true } : { cents: Math.max(metered, 0), capped: false };
}
