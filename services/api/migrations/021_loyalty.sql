-- Round 17: rider growth and loyalty. Promo rules and budgets, targeted codes, birthday/streak opt-ins, loyalty notices (expiry warnings,
-- bonuses, win-back sent once), café settlement fixed at the rate when served and paid statements, gift vouchers bought online and cards that
-- must be sold before use. Additive and re-runnable; the API keeps the old behaviour until this exists (lib/loyalty.ts `loyaltyReady()`).

ALTER TABLE promo_codes
  ADD COLUMN IF NOT EXISTS budget_cents  integer CHECK (budget_cents IS NULL OR budget_cents >= 0),
  ADD COLUMN IF NOT EXISTS spent_cents   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS services      text[],
  ADD COLUMN IF NOT EXISTS hour_from     smallint CHECK (hour_from IS NULL OR hour_from BETWEEN 0 AND 23),
  ADD COLUMN IF NOT EXISTS hour_to       smallint CHECK (hour_to IS NULL OR hour_to BETWEEN 1 AND 24),
  ADD COLUMN IF NOT EXISTS days          smallint[],
  ADD COLUMN IF NOT EXISTS geo_lat       double precision,
  ADD COLUMN IF NOT EXISTS geo_lng       double precision,
  ADD COLUMN IF NOT EXISTS geo_radius_m  integer,
  ADD COLUMN IF NOT EXISTS targeted      boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS promo_grants (
  code       text NOT NULL REFERENCES promo_codes(code) ON UPDATE CASCADE ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id),
  reason     text,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (code, user_id)
);
CREATE INDEX IF NOT EXISTS promo_grants_user_idx ON promo_grants (user_id);

CREATE TABLE IF NOT EXISTS loyalty_profiles (
  user_id         uuid PRIMARY KEY REFERENCES users(id),
  birthday_md     text CHECK (birthday_md IS NULL OR birthday_md ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  birthday_opt_in boolean NOT NULL DEFAULT false,
  streak_opt_in   boolean NOT NULL DEFAULT false,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- One row per thing sent or given once: expiry warning per activity date, birthday per year, streak per week, win-back per date.
CREATE TABLE IF NOT EXISTS loyalty_notices (
  user_id    uuid NOT NULL REFERENCES users(id),
  kind       text NOT NULL,
  period     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, period)
);
CREATE INDEX IF NOT EXISTS loyalty_notices_kind_idx ON loyalty_notices (kind, created_at DESC);

ALTER TABLE reward_redemptions ADD COLUMN IF NOT EXISTS settlement_cents integer;
CREATE INDEX IF NOT EXISTS reward_redemptions_redeemed_idx ON reward_redemptions (redeemed_at) WHERE status = 'redeemed';

CREATE TABLE IF NOT EXISTS partner_settlements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id   uuid NOT NULL REFERENCES partners(id),
  month        text NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  redeemed     integer NOT NULL,
  amount_cents integer NOT NULL,
  paid_at      timestamptz NOT NULL DEFAULT now(),
  paid_ref     text,
  paid_by      uuid REFERENCES users(id),
  UNIQUE (partner_id, month)
);

ALTER TABLE gift_vouchers
  ADD COLUMN IF NOT EXISTS needs_activation boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS purchased_by     uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS from_name        text,
  ADD COLUMN IF NOT EXISTS recipient_name   text,
  ADD COLUMN IF NOT EXISTS message          text,
  ADD COLUMN IF NOT EXISTS payment_ref      text;
CREATE INDEX IF NOT EXISTS gift_vouchers_buyer_idx ON gift_vouchers (purchased_by, created_at DESC) WHERE purchased_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS loyalty_ledger_reason_idx ON loyalty_ledger (user_id, reason);
