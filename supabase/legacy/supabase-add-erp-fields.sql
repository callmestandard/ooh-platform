-- ERP / finance integration fields for client invoice export.
-- Run once in the Supabase SQL Editor.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS erp_system TEXT,
  ADD COLUMN IF NOT EXISTS client_cost_centre TEXT,
  ADD COLUMN IF NOT EXISTS payment_terms TEXT DEFAULT 'Net 30';

COMMENT ON COLUMN public.campaigns.erp_system IS 'Client ERP: oracle | sap | business_central | other';
COMMENT ON COLUMN public.campaigns.client_cost_centre IS 'Client cost centre / GL segment for this campaign';
COMMENT ON COLUMN public.campaigns.payment_terms IS 'e.g. Net 30, Net 45';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS erp_vendor_code TEXT;

COMMENT ON COLUMN public.profiles.erp_vendor_code IS 'Agency vendor/supplier code in the client ERP (e.g. MTN Oracle vendor ID)';

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS wht_rate NUMERIC DEFAULT 5,
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'NGN';

COMMENT ON COLUMN public.invoices.wht_rate IS 'Withholding tax % applied on subtotal for ERP export (default 5)';
COMMENT ON COLUMN public.invoices.currency IS 'ISO currency code; default NGN';
