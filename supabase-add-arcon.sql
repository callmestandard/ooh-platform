-- ARCON Compliance fields on campaigns
-- ARCON (Advertising Regulatory Council of Nigeria) requires all ads to be
-- submitted and approved before going live. This tracks that workflow.
-- Run once in the Supabase SQL Editor.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS arcon_status      TEXT DEFAULT 'not_submitted'
    CHECK (arcon_status IN ('not_submitted','pending','approved','rejected','expired')),
  ADD COLUMN IF NOT EXISTS arcon_ref         TEXT,        -- ARCON submission/approval reference number
  ADD COLUMN IF NOT EXISTS arcon_submitted_at TIMESTAMPTZ, -- date agency submitted to ARCON
  ADD COLUMN IF NOT EXISTS arcon_approved_at  TIMESTAMPTZ, -- date ARCON approved
  ADD COLUMN IF NOT EXISTS arcon_expiry_date  DATE,        -- approval validity end date
  ADD COLUMN IF NOT EXISTS arcon_notes        TEXT;        -- rejection reason or general notes

COMMENT ON COLUMN public.campaigns.arcon_status       IS 'not_submitted | pending | approved | rejected | expired';
COMMENT ON COLUMN public.campaigns.arcon_ref          IS 'ARCON permit/approval reference number';
COMMENT ON COLUMN public.campaigns.arcon_submitted_at IS 'When the creative was submitted to ARCON for pre-vetting';
COMMENT ON COLUMN public.campaigns.arcon_approved_at  IS 'When ARCON issued approval';
COMMENT ON COLUMN public.campaigns.arcon_expiry_date  IS 'Approval validity expiry — must renew before this date';
COMMENT ON COLUMN public.campaigns.arcon_notes        IS 'Rejection reason or general ARCON notes';
