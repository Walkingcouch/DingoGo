-- Align with DingoGo's March 2026 business plan v2 & draft rider terms:
--  * 25% platform fee (driver keeps 75%)
--  * Cash off for rides by default (draft terms say in-app only; confirm with NT Passenger Transport Division)
--  * Cancellation: rides/courier free within 2 min then $3; tours free until 48 h before (then 50%); hire free until 24 h before (then 50%)
ALTER TABLE drivers ALTER COLUMN commission_pct SET DEFAULT 25.0;
UPDATE drivers SET commission_pct = 25.0 WHERE commission_pct = 20.0;
INSERT INTO settings (key, value) VALUES ('cash_payments', '{"ride": false, "courier": true, "note": "Draft rider terms say rideshare is in-app payment only — confirm with NT Passenger Transport Division before enabling cash for rides."}')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('cancellation_policy', '{"free_window_s": 120, "scheduled_free_hours": {"tour": 48, "hourly": 24}, "scheduled_late_pct": 50}')
  ON CONFLICT (key) DO NOTHING;
UPDATE fare_rules SET cancel_fee_cents = 300 WHERE service IN ('ride','pet','courier_s','courier_m','courier_l') AND cancel_fee_cents IN (500, 600);
