-- Round 22: customer support and dispute resolution. Ticket references, priority, owner and SLA due times on support_tickets;
-- a message thread per ticket (customer, staff, system, internal notes); satisfaction score after resolution; canned replies;
-- lost property cases (with the courier job that returns the item). Additive and re-runnable. Until it is applied the API keeps
-- the old single-message tickets working (POST/GET /support, admin list and reply) and the new parts answer 503 migration_pending.

ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS ref                   text,
  ADD COLUMN IF NOT EXISTS role                  text,                               -- rider | driver (who opened it)
  ADD COLUMN IF NOT EXISTS priority              text NOT NULL DEFAULT 'normal',     -- urgent | high | normal | low
  ADD COLUMN IF NOT EXISTS assigned_to           uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS first_response_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolve_due_at        timestamptz,
  ADD COLUMN IF NOT EXISTS first_response_at     timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_at           timestamptz,
  ADD COLUMN IF NOT EXISTS last_customer_at      timestamptz,
  ADD COLUMN IF NOT EXISTS csat_score            smallint CHECK (csat_score BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS csat_comment          text,
  ADD COLUMN IF NOT EXISTS csat_at               timestamptz,
  ADD COLUMN IF NOT EXISTS review                jsonb;                              -- fare review working (automatic check)

CREATE UNIQUE INDEX IF NOT EXISTS support_tickets_ref_idx ON support_tickets (ref) WHERE ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS support_tickets_queue_idx ON support_tickets (status, resolve_due_at);
CREATE INDEX IF NOT EXISTS support_tickets_assigned_idx ON support_tickets (assigned_to, status);
CREATE INDEX IF NOT EXISTS support_tickets_trip_idx ON support_tickets (trip_id);

CREATE TABLE IF NOT EXISTS support_messages (
  id          bigserial PRIMARY KEY,
  ticket_id   uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  author_role text NOT NULL CHECK (author_role IN ('customer', 'staff', 'system')),
  body        text NOT NULL,
  internal    boolean NOT NULL DEFAULT false,                -- staff notes, never shown to the customer
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_messages_ticket_idx ON support_messages (ticket_id, id);

CREATE TABLE IF NOT EXISTS support_canned_replies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  body        text NOT NULL,
  category    text,                                          -- shown first for tickets of this category (null = any)
  active      boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lost_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id        uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  ticket_id      uuid REFERENCES support_tickets(id) ON DELETE SET NULL,
  rider_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  driver_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  reported_by    text NOT NULL CHECK (reported_by IN ('rider', 'driver', 'staff')),
  description    text NOT NULL,
  -- reported (rider asked) | found (driver has it) | not_found | collect (rider collects) | return_booked (courier job) | returned | closed
  status         text NOT NULL DEFAULT 'reported',
  driver_note    text,
  handover_address text,
  handover_lat   double precision,
  handover_lng   double precision,
  return_trip_id uuid REFERENCES trips(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  closed_at      timestamptz
);
-- One open case per trip.
CREATE UNIQUE INDEX IF NOT EXISTS lost_items_open_idx ON lost_items (trip_id) WHERE status NOT IN ('returned', 'closed', 'not_found');
CREATE INDEX IF NOT EXISTS lost_items_driver_idx ON lost_items (driver_id, status);

-- Starter canned replies (plain language; edit in admin → Support → Canned replies).
INSERT INTO support_canned_replies (title, body, category)
SELECT v.title, v.body, v.category FROM (VALUES
  ('Lost item: driver has it', 'Hi {first_name}, good news: your driver has your item from trip {trip_ref}. You can book a courier to bring it to you from the trip screen (Get help with this trip), or message your driver to arrange a pickup.', 'lost_item'),
  ('Lost item: not found', 'Hi {first_name}, your driver checked the car after trip {trip_ref} and could not find it. If you think it was another trip, reply here with the time and we will check again.', 'lost_item'),
  ('Fare: refund issued', 'Hi {first_name}, we checked trip {trip_ref} and refunded the difference. It goes back to the card or DingoGo credit you paid with, usually within 3 to 5 business days for cards.', 'fare'),
  ('Fare: price was as quoted', 'Hi {first_name}, we checked trip {trip_ref}. You paid the price shown when you booked, and the route the car took matches it. If something else went wrong, reply here and tell us.', 'fare'),
  ('Driver feedback received', 'Hi {first_name}, thank you for telling us about trip {trip_ref}. We have passed your feedback to our driver team and will follow it up with the driver.', 'driver'),
  ('Need more details', 'Hi {first_name}, thanks for getting in touch. Could you tell us a bit more (the time, the place and what happened) so we can help? Reply here in the app.', NULL),
  ('Closing: no reply', 'Hi {first_name}, we have not heard back, so we are closing this for now ({ticket_ref}). Reply here any time and it opens again.', NULL)
) AS v(title, body, category)
WHERE NOT EXISTS (SELECT 1 FROM support_canned_replies);
