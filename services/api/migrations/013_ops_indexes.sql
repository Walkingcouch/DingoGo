-- Round 7: indexes for ops tooling (audit log filters and the SOS incident timeline, daily summary, CSV exports).
-- Additive only. The API works without them (just slower on big tables).
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log (entity, entity_id, at);
CREATE INDEX IF NOT EXISTS audit_log_action_idx ON audit_log (action, id DESC);
CREATE INDEX IF NOT EXISTS trips_requested_at_idx ON trips (requested_at);
CREATE INDEX IF NOT EXISTS trips_completed_at_idx ON trips (completed_at) WHERE completed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS driver_ledger_kind_idx ON driver_ledger (kind, created_at);
CREATE INDEX IF NOT EXISTS driver_documents_reviewed_idx ON driver_documents (reviewed_at) WHERE reviewed_at IS NOT NULL;
