-- Test accounts: created by an admin, can sign in with code 000000 while demo mode is on (OTP_DEMO_PREFIXES set).
ALTER TABLE users ADD COLUMN IF NOT EXISTS test_account boolean NOT NULL DEFAULT false;
