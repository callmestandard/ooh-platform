-- ============================================================
-- OOH PLATFORM — DEMO SEED DATA
-- ============================================================
-- Run this in the Supabase SQL Editor AFTER you have signed up
-- and confirmed your account. It seeds realistic demo data so
-- dashboards look populated during a presentation.
--
-- What it does:
--   1. Finds your agency profile (the first agency in the DB)
--   2. Creates a demo board-owner profile if none exists
--   3. Seeds 6 boards, 3 campaigns, 8 bookings at various stages,
--      negotiation messages, invoices, and compliance checks
--   4. Safe to re-run — deletes and re-inserts the demo rows
-- ============================================================

DO $$
DECLARE
  v_agency_id   UUID;
  v_owner_id    UUID;

  -- Fixed demo UUIDs (stable so re-runs clean up correctly)
  v_demo_owner  UUID := 'a1000000-0000-0000-0000-000000000001'::UUID; -- unused but kept for cleanup

  v_board1  UUID := 'b1000000-0000-0000-0000-000000000001'::UUID;
  v_board2  UUID := 'b1000000-0000-0000-0000-000000000002'::UUID;
  v_board3  UUID := 'b1000000-0000-0000-0000-000000000003'::UUID;
  v_board4  UUID := 'b1000000-0000-0000-0000-000000000004'::UUID;
  v_board5  UUID := 'b1000000-0000-0000-0000-000000000005'::UUID;
  v_board6  UUID := 'b1000000-0000-0000-0000-000000000006'::UUID;

  v_camp1   UUID := 'c1000000-0000-0000-0000-000000000001'::UUID;
  v_camp2   UUID := 'c1000000-0000-0000-0000-000000000002'::UUID;
  v_camp3   UUID := 'c1000000-0000-0000-0000-000000000003'::UUID;

  v_book1   UUID := 'd1000000-0000-0000-0000-000000000001'::UUID;
  v_book2   UUID := 'd1000000-0000-0000-0000-000000000002'::UUID;
  v_book3   UUID := 'd1000000-0000-0000-0000-000000000003'::UUID;
  v_book4   UUID := 'd1000000-0000-0000-0000-000000000004'::UUID;
  v_book5   UUID := 'd1000000-0000-0000-0000-000000000005'::UUID;
  v_book6   UUID := 'd1000000-0000-0000-0000-000000000006'::UUID;
  v_book7   UUID := 'd1000000-0000-0000-0000-000000000007'::UUID;
  v_book8   UUID := 'd1000000-0000-0000-0000-000000000008'::UUID;

  v_inv1    UUID := 'e1000000-0000-0000-0000-000000000001'::UUID;
  v_inv2    UUID := 'e1000000-0000-0000-0000-000000000002'::UUID;
  v_inv3    UUID := 'e1000000-0000-0000-0000-000000000003'::UUID;

BEGIN

  -- ── 1. Find the agency user ────────────────────────────────────────────────
  SELECT id INTO v_agency_id FROM profiles WHERE role = 'agency' LIMIT 1;
  IF v_agency_id IS NULL THEN
    RAISE EXCEPTION 'No agency profile found. Sign up as an agency first, then run this script.';
  END IF;

  -- ── 2. Owner = same user as agency (avoids FK issues; both dashboards populated)
  v_owner_id := v_agency_id;

  -- ── 3. Clean up previous demo data ────────────────────────────────────────
  DELETE FROM notifications  WHERE link LIKE '%d1000000%' OR link LIKE '%c1000000%';
  DELETE FROM compliance_checks WHERE booking_id IN (v_book1,v_book2,v_book3,v_book4,v_book5,v_book6,v_book7,v_book8);
  DELETE FROM messages       WHERE booking_id IN (v_book1,v_book2,v_book3,v_book4,v_book5,v_book6,v_book7,v_book8);
  DELETE FROM invoices       WHERE id IN (v_inv1,v_inv2,v_inv3);
  DELETE FROM bookings       WHERE id IN (v_book1,v_book2,v_book3,v_book4,v_book5,v_book6,v_book7,v_book8);
  DELETE FROM campaigns      WHERE id IN (v_camp1,v_camp2,v_camp3);
  DELETE FROM boards         WHERE id IN (v_board1,v_board2,v_board3,v_board4,v_board5,v_board6);

  -- ── 4. Boards ──────────────────────────────────────────────────────────────
  INSERT INTO boards (id, name, format, address, city, state, width, height, face_count, illuminated, asking_rate, latitude, longitude, status, owner_id, notes) VALUES
  (v_board1, 'Lekki-Epe Expressway Unipole',     'unipole',      'Opposite Lekki Phase 1 Gate',       'Lekki',           'Lagos',       14, 8,  1, true,  850000,  6.4344,  3.4734,  'available', NULL, 'High-traffic corridor serving Lekki–VI commuters'),
  (v_board2, 'Ikorodu Road Bridge Panel',         'bridge_panel', 'Ketu Bridge, Ikorodu Road',         'Lagos',           'Lagos',       6,  4,  2, true,  420000,  6.5958,  3.3874,  'booked',    NULL, 'Visible to both inbound and outbound traffic'),
  (v_board3, 'Victoria Island Gantry',            'gantry',       'Ozumba Mbadiwe, opposite MRS',      'Victoria Island', 'Lagos',       18, 5,  1, true,  1200000, 6.4281,  3.4219,  'booked',    NULL, 'Premium VI location, 3 lanes coverage'),
  (v_board4, 'Oshodi Interchange Billboard',      'billboard',    'Agege Motor Road, Oshodi',          'Oshodi',          'Lagos',       12, 8,  2, false, 650000,  6.5581,  3.3494,  'available', NULL, 'Major interchange with 200k+ daily impressions'),
  (v_board5, 'Gbagada Expressway Unipole',        'unipole',      'Gbagada Phase 2, by flyover',       'Gbagada',         'Lagos',       14, 8,  1, true,  580000,  6.5501,  3.3791,  'available', NULL, 'Clean sight lines on the expressway'),
  (v_board6, 'Abuja Airport Road Unipole',        'unipole',      'Airport Road, by Nnamdi Azikiwe',   'Abuja',           'FCT - Abuja', 14, 8,  1, true,  950000,  9.0082,  7.4634,  'available', NULL, 'First impression for all arriving travellers');

  -- ── 5. Campaigns ──────────────────────────────────────────────────────────
  INSERT INTO campaigns (id, name, client_name, status, start_date, end_date, total_budget, plan_notes, agency_id) VALUES
  (v_camp1, 'MTN Fastlink — Q3 Push',       'MTN Nigeria',   'active',    '2026-06-01', '2026-08-31', 15000000, 'Focus on high-traffic Lagos corridors. Prioritise illuminated formats for night visibility.', v_agency_id),
  (v_camp2, 'Guinness Black Campaign',      'Diageo Nigeria','active',    '2026-06-15', '2026-07-31', 8500000,  'Premium placement only. VI and Lekki exclusively. Match brand dark aesthetic.',              v_agency_id),
  (v_camp3, 'Access Bank — Digital Push',   'Access Bank',   'draft',     '2026-07-01', '2026-09-30', 6000000,  'Target business districts. Abuja and Lagos. Decision pending client sign-off.',               v_agency_id);

  -- ── 6. Bookings ───────────────────────────────────────────────────────────
  -- Camp 1 (MTN): 4 boards — live, agreed, negotiating, pending
  INSERT INTO bookings (id, campaign_id, board_id, offered_rate, agreed_rate, status, start_date, end_date, duration_months, creative_type, print_required, mpo_number, mpo_issued_at, mpo_agency_name) VALUES
  (v_book1, v_camp1, v_board1, 800000,  765000,  'live',        '2026-06-01', '2026-08-31', 3, 'static', false, 'MPO-2026-0041', NOW() - INTERVAL '15 days', 'Maximedia Yello'),
  (v_book2, v_camp1, v_board3, 1100000, 1050000, 'agreed',      '2026-06-01', '2026-07-31', 2, 'led',    false, 'MPO-2026-0042', NOW() - INTERVAL '10 days', 'Maximedia Yello'),
  (v_book3, v_camp1, v_board4, 600000,  NULL,    'negotiating', '2026-07-01', '2026-08-31', 2, 'static', true,  NULL,            NULL,                       NULL),
  (v_book4, v_camp1, v_board5, 550000,  NULL,    'pending',     '2026-07-01', '2026-07-31', 1, 'static', false, NULL,            NULL,                       NULL);

  -- Camp 2 (Guinness): 2 boards — agreed, negotiating
  INSERT INTO bookings (id, campaign_id, board_id, offered_rate, agreed_rate, status, start_date, end_date, duration_months, creative_type, print_required) VALUES
  (v_book5, v_camp2, v_board2, 390000,  380000,  'agreed',      '2026-06-15', '2026-07-31', 2, 'led',    false),
  (v_book6, v_camp2, v_board6, 900000,  NULL,    'negotiating', '2026-06-15', '2026-07-31', 2, 'static', false);

  -- Camp 3 (Access Bank): 1 board — pending
  INSERT INTO bookings (id, campaign_id, board_id, offered_rate, agreed_rate, status, start_date, end_date, duration_months, creative_type, print_required) VALUES
  (v_book7, v_camp3, v_board6, 880000, NULL, 'pending', '2026-07-01', '2026-09-30', 3, 'static', false);

  -- Extra declined booking (so Reports shows realistic data)
  INSERT INTO bookings (id, campaign_id, board_id, offered_rate, agreed_rate, status, start_date, end_date, duration_months, creative_type, print_required) VALUES
  (v_book8, v_camp3, v_board4, 500000, NULL, 'declined', '2026-07-01', '2026-08-31', 2, 'static', false);

  -- ── 7. Negotiation messages ────────────────────────────────────────────────
  -- book3 (Oshodi Billboard — negotiating)
  INSERT INTO messages (booking_id, sender_role, message, offer_amount, created_at) VALUES
  (v_book3, 'agency', 'Hi, we''d like to book the Oshodi Interchange for 2 months. Our offer is ₦600k/month.', 600000, NOW() - INTERVAL '5 days'),
  (v_book3, 'owner',  'Thanks for your interest. That location does very strong numbers at Oshodi. We''d need ₦640k to make it work.', 640000, NOW() - INTERVAL '4 days'),
  (v_book3, 'agency', 'We can stretch to ₦620k — client budget is tight on this one.', 620000, NOW() - INTERVAL '3 days'),
  (v_book3, 'owner',  'Let''s do ₦625k and I''ll include the production installation. Final offer.', 625000, NOW() - INTERVAL '2 days');

  -- book6 (Abuja Airport Road — negotiating for Guinness)
  INSERT INTO messages (booking_id, sender_role, message, offer_amount, created_at) VALUES
  (v_book6, 'agency', 'Guinness requires the Abuja Airport Road for their national launch. Offering ₦900k/month for 2 months.', 900000, NOW() - INTERVAL '2 days'),
  (v_book6, 'owner',  'Airport Road is our premium location. Minimum is ₦950k. This site had 4 competing bids last quarter.', 950000, NOW() - INTERVAL '1 day');

  -- book4 (Gbagada — pending, no messages yet)

  -- ── 8. Compliance checks ──────────────────────────────────────────────────
  -- book1 (live — verified)
  INSERT INTO compliance_checks (booking_id, status, gps_lat, gps_lng, submitted_at, notes) VALUES
  (v_book1, 'verified', 6.4344, 3.4734, NOW() - INTERVAL '12 days', 'Creative mounted correctly. Illumination confirmed working at night.'),
  (v_book1, 'verified', 6.4344, 3.4734, NOW() - INTERVAL '5 days',  'Week 2 check — no issues. Creative in good condition.');

  -- book2 (agreed — pending first check)
  INSERT INTO compliance_checks (booking_id, status, gps_lat, gps_lng, submitted_at, notes) VALUES
  (v_book2, 'pending', 6.4281, 3.4219, NOW() - INTERVAL '2 days', 'Mounting complete. Awaiting agency sign-off.');

  -- book5 (agreed Guinness — flagged)
  INSERT INTO compliance_checks (booking_id, status, gps_lat, gps_lng, submitted_at, notes) VALUES
  (v_book5, 'flagged', 6.5958, 3.3874, NOW() - INTERVAL '3 days', 'Creative appears faded on right panel. Requesting reprint.');

  -- ── 9. Invoices ───────────────────────────────────────────────────────────
  -- Media partner invoice: owner → agency for book1 + book2
  INSERT INTO invoices (id, invoice_number, campaign_id, invoice_type, owner_id, agency_id, status, total_amount, due_date, client_name, client_email, line_items) VALUES
  (v_inv1, 'MPI-2026-0031', v_camp1, 'media_partner', NULL, v_agency_id, 'acknowledged', 4395000, NOW() + INTERVAL '14 days',
   'Maximedia Yello', 'finance@maximediayello.com',
   '[{"description":"Lekki-Epe Expressway Unipole — 3 months","quantity":3,"unit_price":765000,"total":2295000},{"description":"Victoria Island Gantry — 2 months","quantity":2,"unit_price":1050000,"total":2100000}]'::jsonb);

  -- Client invoice: agency → MTN (compiled, sent)
  INSERT INTO invoices (id, invoice_number, campaign_id, invoice_type, agency_id, status, total_amount, due_date, client_name, client_email, line_items) VALUES
  (v_inv2, 'INV-2026-0058', v_camp1, 'client', v_agency_id, 'sent', 4834500, NOW() + INTERVAL '21 days',
   'MTN Nigeria', 'procurement@mtn.ng',
   '[{"description":"Lekki-Epe Expressway Unipole — 3 months","quantity":3,"unit_price":765000,"total":2295000},{"description":"Victoria Island Gantry — 2 months","quantity":2,"unit_price":1050000,"total":2100000},{"description":"Agency fee (10%)","quantity":1,"unit_price":439500,"total":439500}]'::jsonb);

  -- Client invoice: agency → Diageo (paid)
  INSERT INTO invoices (id, invoice_number, campaign_id, invoice_type, agency_id, status, total_amount, due_date, client_name, client_email, line_items) VALUES
  (v_inv3, 'INV-2026-0052', v_camp2, 'client', v_agency_id, 'paid', 836000, NOW() - INTERVAL '5 days',
   'Diageo Nigeria', 'finance@diageo.ng',
   '[{"description":"Ikorodu Road Bridge Panel — 2 months","quantity":2,"unit_price":380000,"total":760000},{"description":"Agency fee (10%)","quantity":1,"unit_price":76000,"total":76000}]'::jsonb);

  -- ── 10. Notifications ─────────────────────────────────────────────────────
  INSERT INTO notifications (recipient_role, type, message, read, created_at, link) VALUES
  ('agency', 'booking_agreed',    'Deal agreed: Lekki-Epe Expressway Unipole for MTN Fastlink',            true,  NOW() - INTERVAL '10 days', '/dashboard/agency/negotiations/' || v_book1),
  ('agency', 'booking_agreed',    'Deal agreed: Victoria Island Gantry for MTN Fastlink',                  true,  NOW() - INTERVAL '9 days',  '/dashboard/agency/negotiations/' || v_book2),
  ('agency', 'counter_offer',     'Counter offer received on Oshodi Interchange — ₦625k',                  false, NOW() - INTERVAL '2 days',  '/dashboard/agency/negotiations/' || v_book3),
  ('agency', 'counter_offer',     'Counter offer on Abuja Airport Road — owner wants ₦950k',               false, NOW() - INTERVAL '1 day',   '/dashboard/agency/negotiations/' || v_book6),
  ('agency', 'compliance_flagged','Compliance flag: Ikorodu Road Bridge Panel — creative faded',           false, NOW() - INTERVAL '3 days',  '/dashboard/agency/compliance'),
  ('agency', 'invoice_paid',      'Invoice INV-2026-0052 paid by Diageo Nigeria — ₦836,000',               true,  NOW() - INTERVAL '5 days',  '/dashboard/agency/invoices/' || v_inv3),
  ('owner',  'new_booking',       'New booking request: Gbagada Expressway for MTN Fastlink',              false, NOW() - INTERVAL '3 days',  '/dashboard/owner/negotiations/' || v_book4),
  ('owner',  'new_booking',       'New booking request: Abuja Airport Road for Guinness Black Campaign',   false, NOW() - INTERVAL '2 days',  '/dashboard/owner/negotiations/' || v_book6),
  ('owner',  'invoice_received',  'Invoice MPI-2026-0031 acknowledged by Maximedia Yello — ₦4,395,000',   true,  NOW() - INTERVAL '8 days',  '/dashboard/owner');

  RAISE NOTICE 'Demo seed complete. Agency ID: %. Owner ID: %.', v_agency_id, v_owner_id;
END;
$$;
