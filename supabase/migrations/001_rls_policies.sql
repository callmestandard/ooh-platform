-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — Row Level Security (RLS) Policies
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ═══════════════════════════════════════════════════════════════════

-- ─── Enable RLS on every table ──────────────────────────────────────

ALTER TABLE campaigns          ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE boards             ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices           ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_checks  ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages           ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles           ENABLE ROW LEVEL SECURITY;

-- ─── Helper: get calling user's role ────────────────────────────────

CREATE OR REPLACE FUNCTION auth_role()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT role FROM profiles WHERE id = auth.uid()),
    auth.jwt() ->> 'role',
    'anon'
  );
$$;

-- ─── profiles ───────────────────────────────────────────────────────
-- Users can read/update only their own profile

DROP POLICY IF EXISTS "profiles_select_own"  ON profiles;
DROP POLICY IF EXISTS "profiles_update_own"  ON profiles;
DROP POLICY IF EXISTS "profiles_insert_own"  ON profiles;

CREATE POLICY "profiles_select_own"  ON profiles FOR SELECT USING (id = auth.uid() OR auth_role() = 'admin');
CREATE POLICY "profiles_update_own"  ON profiles FOR UPDATE USING (id = auth.uid());
CREATE POLICY "profiles_insert_own"  ON profiles FOR INSERT WITH CHECK (id = auth.uid());

-- ─── boards ─────────────────────────────────────────────────────────
-- Public read (marketplace), owners manage their own, admins all

DROP POLICY IF EXISTS "boards_select_public"    ON boards;
DROP POLICY IF EXISTS "boards_insert_own"       ON boards;
DROP POLICY IF EXISTS "boards_update_own"       ON boards;
DROP POLICY IF EXISTS "boards_delete_own"       ON boards;

CREATE POLICY "boards_select_public" ON boards FOR SELECT USING (true);
CREATE POLICY "boards_insert_own"    ON boards FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY "boards_update_own"    ON boards FOR UPDATE USING (owner_id = auth.uid() OR auth_role() = 'admin');
CREATE POLICY "boards_delete_own"    ON boards FOR DELETE USING (owner_id = auth.uid() OR auth_role() = 'admin');

-- ─── campaigns ──────────────────────────────────────────────────────
-- Agencies see their own; clients see campaigns where they are the client

DROP POLICY IF EXISTS "campaigns_select" ON campaigns;
DROP POLICY IF EXISTS "campaigns_insert" ON campaigns;
DROP POLICY IF EXISTS "campaigns_update" ON campaigns;
DROP POLICY IF EXISTS "campaigns_delete" ON campaigns;

CREATE POLICY "campaigns_select" ON campaigns FOR SELECT USING (
  agency_id = auth.uid()
  OR client_id = auth.uid()
  OR auth_role() = 'admin'
);
CREATE POLICY "campaigns_insert" ON campaigns FOR INSERT WITH CHECK (
  agency_id = auth.uid() OR client_id = auth.uid()
);
CREATE POLICY "campaigns_update" ON campaigns FOR UPDATE USING (
  agency_id = auth.uid() OR auth_role() = 'admin'
);
CREATE POLICY "campaigns_delete" ON campaigns FOR DELETE USING (
  agency_id = auth.uid() OR auth_role() = 'admin'
);

-- ─── bookings ───────────────────────────────────────────────────────
-- Agencies (via campaign ownership), board owners (via board ownership), clients (via campaign)

DROP POLICY IF EXISTS "bookings_select" ON bookings;
DROP POLICY IF EXISTS "bookings_insert" ON bookings;
DROP POLICY IF EXISTS "bookings_update" ON bookings;

CREATE POLICY "bookings_select" ON bookings FOR SELECT USING (
  EXISTS (SELECT 1 FROM campaigns WHERE campaigns.id = bookings.campaign_id AND campaigns.agency_id = auth.uid())
  OR EXISTS (SELECT 1 FROM boards WHERE boards.id = bookings.board_id AND boards.owner_id = auth.uid())
  OR EXISTS (SELECT 1 FROM campaigns WHERE campaigns.id = bookings.campaign_id AND campaigns.client_id = auth.uid())
  OR auth_role() = 'admin'
);
CREATE POLICY "bookings_insert" ON bookings FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM campaigns WHERE campaigns.id = campaign_id AND campaigns.agency_id = auth.uid())
);
CREATE POLICY "bookings_update" ON bookings FOR UPDATE USING (
  EXISTS (SELECT 1 FROM campaigns WHERE campaigns.id = bookings.campaign_id AND campaigns.agency_id = auth.uid())
  OR EXISTS (SELECT 1 FROM boards WHERE boards.id = bookings.board_id AND boards.owner_id = auth.uid())
  OR EXISTS (SELECT 1 FROM campaigns WHERE campaigns.id = bookings.campaign_id AND campaigns.client_id = auth.uid())
  OR auth_role() = 'admin'
);

-- ─── messages ───────────────────────────────────────────────────────
-- Only parties to the booking can see messages

DROP POLICY IF EXISTS "messages_select" ON messages;
DROP POLICY IF EXISTS "messages_insert" ON messages;

CREATE POLICY "messages_select" ON messages FOR SELECT USING (
  sender_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM bookings b
    JOIN campaigns c ON c.id = b.campaign_id
    WHERE b.id = messages.booking_id AND c.agency_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM bookings b
    JOIN boards bo ON bo.id = b.board_id
    WHERE b.id = messages.booking_id AND bo.owner_id = auth.uid()
  )
  OR auth_role() = 'admin'
);
CREATE POLICY "messages_insert" ON messages FOR INSERT WITH CHECK (
  sender_id = auth.uid()
);

-- ─── invoices ───────────────────────────────────────────────────────
-- Agencies see their own (invoice_type=client); owners see their own (invoice_type=media_partner)

DROP POLICY IF EXISTS "invoices_select" ON invoices;
DROP POLICY IF EXISTS "invoices_insert" ON invoices;
DROP POLICY IF EXISTS "invoices_update" ON invoices;

CREATE POLICY "invoices_select" ON invoices FOR SELECT USING (
  agency_id = auth.uid()
  OR owner_id = auth.uid()
  OR EXISTS (SELECT 1 FROM campaigns WHERE campaigns.id = invoices.campaign_id AND campaigns.client_id = auth.uid())
  OR auth_role() = 'admin'
);
CREATE POLICY "invoices_insert" ON invoices FOR INSERT WITH CHECK (
  agency_id = auth.uid() OR owner_id = auth.uid()
);
CREATE POLICY "invoices_update" ON invoices FOR UPDATE USING (
  agency_id = auth.uid() OR owner_id = auth.uid() OR auth_role() = 'admin'
);

-- ─── invoice_items ──────────────────────────────────────────────────

DROP POLICY IF EXISTS "invoice_items_select" ON invoice_items;
DROP POLICY IF EXISTS "invoice_items_insert" ON invoice_items;

CREATE POLICY "invoice_items_select" ON invoice_items FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM invoices
    WHERE invoices.id = invoice_items.invoice_id
    AND (invoices.agency_id = auth.uid() OR invoices.owner_id = auth.uid() OR auth_role() = 'admin')
  )
);
CREATE POLICY "invoice_items_insert" ON invoice_items FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM invoices
    WHERE invoices.id = invoice_id
    AND (invoices.agency_id = auth.uid() OR invoices.owner_id = auth.uid())
  )
);

-- ─── compliance_checks ──────────────────────────────────────────────
-- Note: submitted_by is a text label (e.g. "Agency Field Team"), not a UUID.
-- Field agent POE uploads go through service-role API (/poe/[token]) and bypass RLS.
-- Agency/client/admin access via booking → campaign chain.

DROP POLICY IF EXISTS "compliance_select" ON compliance_checks;
DROP POLICY IF EXISTS "compliance_insert" ON compliance_checks;
DROP POLICY IF EXISTS "compliance_update" ON compliance_checks;

CREATE POLICY "compliance_select" ON compliance_checks FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM bookings b
    JOIN campaigns c ON c.id = b.campaign_id
    WHERE b.id = compliance_checks.booking_id AND c.agency_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM bookings b
    JOIN campaigns c ON c.id = b.campaign_id
    WHERE b.id = compliance_checks.booking_id AND c.client_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM bookings b
    JOIN boards bo ON bo.id = b.board_id
    WHERE b.id = compliance_checks.booking_id AND bo.owner_id = auth.uid()
  )
  OR auth_role() = 'admin'
);
CREATE POLICY "compliance_insert" ON compliance_checks FOR INSERT WITH CHECK (true);
CREATE POLICY "compliance_update" ON compliance_checks FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM bookings b
    JOIN campaigns c ON c.id = b.campaign_id
    WHERE b.id = compliance_checks.booking_id AND c.agency_id = auth.uid()
  )
  OR auth_role() = 'admin'
);

-- ─── activity_events ────────────────────────────────────────────────

DROP POLICY IF EXISTS "activity_select" ON activity_events;
DROP POLICY IF EXISTS "activity_insert" ON activity_events;

CREATE POLICY "activity_select" ON activity_events FOR SELECT USING (
  actor_id = auth.uid()
  OR EXISTS (SELECT 1 FROM campaigns WHERE campaigns.id = activity_events.campaign_id AND campaigns.agency_id = auth.uid())
  OR EXISTS (SELECT 1 FROM campaigns WHERE campaigns.id = activity_events.campaign_id AND campaigns.client_id = auth.uid())
  OR auth_role() = 'admin'
);
CREATE POLICY "activity_insert" ON activity_events FOR INSERT WITH CHECK (true);

-- ─── notifications ───────────────────────────────────────────────────

DROP POLICY IF EXISTS "notifications_select" ON notifications;
DROP POLICY IF EXISTS "notifications_update" ON notifications;
DROP POLICY IF EXISTS "notifications_insert" ON notifications;

CREATE POLICY "notifications_select" ON notifications FOR SELECT USING (
  recipient_role = auth_role() OR auth_role() = 'admin'
);
CREATE POLICY "notifications_update" ON notifications FOR UPDATE USING (
  recipient_role = auth_role()
);
CREATE POLICY "notifications_insert" ON notifications FOR INSERT WITH CHECK (true);

-- ─── Indexes for query performance ──────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_campaigns_agency_id    ON campaigns(agency_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_client_id    ON campaigns(client_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status       ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_created_at   ON campaigns(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bookings_campaign_id   ON bookings(campaign_id);
CREATE INDEX IF NOT EXISTS idx_bookings_board_id      ON bookings(board_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status        ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_created_at    ON bookings(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_boards_owner_id        ON boards(owner_id);
CREATE INDEX IF NOT EXISTS idx_boards_status          ON boards(status);
CREATE INDEX IF NOT EXISTS idx_boards_city            ON boards(city);
CREATE INDEX IF NOT EXISTS idx_boards_format          ON boards(format);
CREATE INDEX IF NOT EXISTS idx_boards_created_at      ON boards(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoices_agency_id     ON invoices(agency_id);
CREATE INDEX IF NOT EXISTS idx_invoices_owner_id      ON invoices(owner_id);
CREATE INDEX IF NOT EXISTS idx_invoices_campaign_id   ON invoices(campaign_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status        ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_type          ON invoices(invoice_type);
CREATE INDEX IF NOT EXISTS idx_invoices_created_at    ON invoices(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice  ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_booking  ON invoice_items(booking_id);

CREATE INDEX IF NOT EXISTS idx_compliance_booking_id  ON compliance_checks(booking_id);
CREATE INDEX IF NOT EXISTS idx_compliance_status      ON compliance_checks(status);

CREATE INDEX IF NOT EXISTS idx_messages_booking_id    ON messages(booking_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender        ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at    ON messages(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_role);
CREATE INDEX IF NOT EXISTS idx_activity_campaign_id   ON activity_events(campaign_id);
CREATE INDEX IF NOT EXISTS idx_activity_entity        ON activity_events(entity_type, entity_id);

-- ─── Backfill: ensure invoices.agency_id is populated ────────────────
-- Run ONCE after applying RLS to avoid losing access to existing rows.
-- Sets agency_id on client invoices by joining to campaigns.

UPDATE invoices i
SET agency_id = c.agency_id
FROM campaigns c
WHERE i.campaign_id = c.id
  AND i.invoice_type = 'client'
  AND i.agency_id IS NULL
  AND c.agency_id IS NOT NULL;
