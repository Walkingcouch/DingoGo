-- Round 13: website growth. Driver applications get a reference, a private status link, a note the applicant can see, the
-- channel they came from and when their stage last changed. Additive; the API keeps the old form working until this exists.
ALTER TABLE driver_applications
  ADD COLUMN IF NOT EXISTS ref          text,
  ADD COLUMN IF NOT EXISTS status_token text,
  ADD COLUMN IF NOT EXISTS public_note  text,
  ADD COLUMN IF NOT EXISTS source       text,
  ADD COLUMN IF NOT EXISTS drive_state  text,
  ADD COLUMN IF NOT EXISTS updated_at   timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS driver_applications_token_idx ON driver_applications (status_token) WHERE status_token IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS driver_applications_ref_idx ON driver_applications (ref) WHERE ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS driver_applications_status_idx ON driver_applications (status, created_at DESC);
