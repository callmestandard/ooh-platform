-- Media Partner Invoice support
-- Extends the invoices table to support the owner→agency→client billing chain.
--
-- invoice_type:
--   'media_partner' = owner raises invoice addressed to agency for their boards
--   'client'        = agency raises compiled invoice addressed to client (default)
--
-- owner_id:   profile of the board owner who raised a media_partner invoice
-- agency_id:  profile of the agency (recipient for media_partner; sender for client)
-- compiled_invoice_id: on a media_partner invoice, set once compiled into a client invoice

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS invoice_type TEXT NOT NULL DEFAULT 'client'
    CHECK (invoice_type IN ('media_partner', 'client')),
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS compiled_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL;

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_invoices_type       ON invoices(invoice_type);
CREATE INDEX IF NOT EXISTS idx_invoices_owner_id   ON invoices(owner_id);
CREATE INDEX IF NOT EXISTS idx_invoices_agency_id  ON invoices(agency_id);
CREATE INDEX IF NOT EXISTS idx_invoices_compiled   ON invoices(compiled_invoice_id);

-- RLS: owners can see their own media partner invoices
-- (Run these only if RLS is enabled on invoices)
-- CREATE POLICY "owners can see own mpi" ON invoices FOR SELECT
--   USING (invoice_type = 'media_partner' AND owner_id = auth.uid());

-- Allow the 'acknowledged' status for media partner invoices
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft', 'sent', 'acknowledged', 'paid', 'overdue', 'cancelled'));
