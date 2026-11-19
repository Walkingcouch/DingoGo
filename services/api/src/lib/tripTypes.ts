/**
 * The money-relevant columns of a `trips` row, so the payment and settlement paths (hold, capture, cancel fee, refund,
 * completion, driver ledger) are type-checked instead of passing `any` rows around. Rows from `SELECT *` carry more columns;
 * these are the ones money code reads.
 */
import type { FareBreakdown } from './fares.js';

export type PaymentMethod = 'card' | 'cash' | 'corporate' | 'wallet';
export type PaymentStatus = 'none' | 'authorised' | 'captured' | 'failed' | 'refunded' | 'invoiced' | 'cash_collected';

export interface TripMoney {
  id: string;
  ref: string;
  kind: 'ride' | 'courier' | string;
  service: string;
  status: string;
  rider_id: string;
  driver_id: string | null;
  corporate_account_id?: string | null;
  quote_cents: number;
  final_cents?: number | null;
  cancel_fee_cents?: number | null;
  tip_cents?: number | null;
  est_distance_m: number;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  payment_ref: string | null;
  points_redeemed: number;
  promo_code: string | null;
  fare_breakdown: FareBreakdown;
  batch_id?: string | null;
}
