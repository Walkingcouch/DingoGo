-- Store uploads in Postgres so the API can run serverless (no persistent disk).
-- Fine at pilot scale; move to Supabase Storage / S3 when volumes grow.
CREATE TABLE uploads (
  name       text PRIMARY KEY,
  mime       text NOT NULL,
  data       bytea NOT NULL,
  owner_id   uuid REFERENCES users(id),
  purpose    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
