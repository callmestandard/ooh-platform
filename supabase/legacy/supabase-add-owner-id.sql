-- Add owner tracking to boards so each owner only sees their own boards
ALTER TABLE boards ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_boards_owner_id ON boards(owner_id);

-- If boards already exist without owner_id, clear them (demo data)
DELETE FROM bookings WHERE board_id IN (SELECT id FROM boards WHERE owner_id IS NULL);
DELETE FROM boards WHERE owner_id IS NULL;
