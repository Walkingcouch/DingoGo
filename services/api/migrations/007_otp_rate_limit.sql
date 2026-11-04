-- OTP request log for rate limiting (SMS pumping / harassment protection)
CREATE TABLE IF NOT EXISTS otp_requests (
  id    bigserial PRIMARY KEY,
  phone text NOT NULL,
  ip    text,
  at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS otp_requests_phone_idx ON otp_requests (phone, at DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log (actor_id, action, at DESC);
