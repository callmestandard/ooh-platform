-- Add AI verification columns to compliance_checks
-- Run once in the Supabase SQL Editor.

ALTER TABLE public.compliance_checks
  ADD COLUMN IF NOT EXISTS ai_verdict      TEXT CHECK (ai_verdict IN ('verified','review','flagged')),
  ADD COLUMN IF NOT EXISTS ai_confidence   NUMERIC(3,2),
  ADD COLUMN IF NOT EXISTS ai_notes        TEXT,
  ADD COLUMN IF NOT EXISTS ai_verified_at  TIMESTAMPTZ;

COMMENT ON COLUMN public.compliance_checks.ai_verdict     IS 'Claude vision verdict: verified / review / flagged';
COMMENT ON COLUMN public.compliance_checks.ai_confidence  IS 'Model confidence 0.00–1.00';
COMMENT ON COLUMN public.compliance_checks.ai_notes       IS 'One-sentence AI summary shown to the agency';
COMMENT ON COLUMN public.compliance_checks.ai_verified_at IS 'When the AI check was last run';
