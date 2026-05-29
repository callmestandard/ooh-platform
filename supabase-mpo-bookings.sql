-- Track MPO issuance on bookings
-- When an agency raises an MPO for a booking, these fields are stamped so the
-- board owner can see the MPO in their dashboard and create their invoice from it.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS mpo_number      TEXT,
  ADD COLUMN IF NOT EXISTS mpo_issued_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mpo_agency_name TEXT;

CREATE INDEX IF NOT EXISTS idx_bookings_mpo_issued ON bookings(mpo_issued_at) WHERE mpo_issued_at IS NOT NULL;
