-- Add client_invoice_number to invoices
-- This stores the client's own Oracle reference number (e.g. MTN's internal PO/invoice number).
-- Run once in the Supabase SQL Editor.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS client_invoice_number TEXT;

COMMENT ON COLUMN public.invoices.client_invoice_number
  IS 'The invoice/PO reference number as entered in the client Oracle ERP system (e.g. MTN). Set by agency or client after submission to Oracle.';
