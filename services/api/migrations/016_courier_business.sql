-- Round 11: courier and delivery business.
-- Multi-drop runs (several parcels from one pickup, one driver), pickup windows, safe-place drops, recipient ETA,
-- failed deliveries returned to the sender, prohibited-items checklist and the sender's own order reference.
-- Additive and backward compatible: the API checks for these columns and keeps the old behaviour until they exist.

-- A run of deliveries booked together: one pickup, up to 10 drops, offered to one driver as one job.
CREATE TABLE IF NOT EXISTS courier_batches (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref                  text UNIQUE NOT NULL,
  rider_id             uuid NOT NULL REFERENCES users(id),
  corporate_account_id uuid REFERENCES corporate_accounts(id),
  source               text NOT NULL DEFAULT 'app',     -- app | csv
  pickup_address       text NOT NULL,
  stops                integer NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS courier_batches_rider_idx ON courier_batches (rider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS courier_batches_account_idx ON courier_batches (corporate_account_id, created_at DESC);

ALTER TABLE trips ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES courier_batches(id);
ALTER TABLE trips ADD COLUMN IF NOT EXISTS batch_seq integer;                -- delivery order within the run (1 = first drop)
ALTER TABLE trips ADD COLUMN IF NOT EXISTS pickup_window_end timestamptz;    -- "collect between scheduled_for and this"
CREATE INDEX IF NOT EXISTS trips_batch_idx ON trips (batch_id, batch_seq) WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS trips_corporate_kind_idx ON trips (corporate_account_id, kind, requested_at DESC) WHERE corporate_account_id IS NOT NULL;

ALTER TABLE parcels ADD COLUMN IF NOT EXISTS customer_ref        text;        -- sender's own order / script number
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS safe_place          text;        -- where to leave it when nobody is home
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS recipient_notes     text;        -- added by the recipient from the tracking link
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS prohibited_checklist jsonb;      -- { version, items: [...] } ticked by the sender
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS eta_at              timestamptz; -- delivery estimate set at pickup (texted to the recipient)
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS outcome             text;        -- null (on its way) | delivered | returning | returned
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS failed_at           timestamptz;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS failed_reason       text;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS failed_note         text;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS failed_photo_url    text;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS returned_at         timestamptz;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS pod_distance_m      integer;     -- how far from the drop-off the driver was at handover
