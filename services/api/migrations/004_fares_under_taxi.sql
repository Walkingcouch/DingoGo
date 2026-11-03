-- Bring ride fares clearly under the Alice Springs taxi day tariff ($5.30 + $2.45/km):
-- 5 km / 10 min ≈ $15.50 (taxi ≈ $17.55); airport ≈ $36 (taxi ≈ $41–44).
UPDATE fare_rules SET base_cents = 300, per_km_cents = 160, per_min_cents = 25 WHERE service = 'ride' AND base_cents = 350;
UPDATE fare_rules SET base_cents = 500, per_km_cents = 160, per_min_cents = 25 WHERE service = 'pet' AND base_cents = 550;
