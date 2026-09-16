-- Add agency ownership to campaigns
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_campaigns_agency_id ON campaigns(agency_id);

-- Clear all demo/seed data so every agency starts fresh
DELETE FROM bookings;
DELETE FROM campaigns;
