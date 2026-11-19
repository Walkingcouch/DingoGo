-- Round 18: partial indexes for the requests every app polls and the dispatcher runs every few seconds.
-- Each covers only rows in a live state (a handful), so they stay tiny however many finished trips there are.
-- Additive and re-runnable. The API works without them (the planner falls back to the status index, slower as trips grow).

-- "Is this driver on a trip?" (location pings, dispatch candidates, nearest free car, stale drivers, the live map).
CREATE INDEX IF NOT EXISTS trips_driver_live_idx ON trips (driver_id) WHERE status IN ('accepted', 'arrived', 'in_progress');
-- Trips still searching, oldest first (dispatch tick).
CREATE INDEX IF NOT EXISTS trips_searching_idx ON trips (requested_at) WHERE status = 'requested';
-- Bookings waiting for release, by booked time (dispatch tick).
CREATE INDEX IF NOT EXISTS trips_booked_idx ON trips (scheduled_for) WHERE status = 'scheduled';
-- Offers on screen, by expiry (expired every tick; the driver index can't answer "status = offered AND expires_at <= now()").
CREATE INDEX IF NOT EXISTS trip_offers_open_idx ON trip_offers (expires_at) WHERE status = 'offered';
