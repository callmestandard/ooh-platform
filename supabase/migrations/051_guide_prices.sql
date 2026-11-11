-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — public guide prices
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Requires 035 (board_rates, board_effective_rate_visibility). Safe to re-run.
--
-- Exact rates stay private (035). Buyers now see a rounded range, e.g.
-- "₦1.3M–₦1.7M / month", built from the board's monthly rate:
--   • boards with no owner account (imported by our team) show a range
--     unless an admin hides it;
--   • boards with an owner account show one only when the owner's rate
--     visibility isn't 'hidden' (the owner decides).
-- The exact figure never leaves the database: board_guide_prices() returns
-- only the rounded low/high.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.board_guide_price_hidden (
  board_id  UUID PRIMARY KEY REFERENCES public.boards(id) ON DELETE CASCADE,
  hidden_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  hidden_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.board_guide_price_hidden ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS board_guide_price_hidden_admin ON public.board_guide_price_hidden;
CREATE POLICY board_guide_price_hidden_admin ON public.board_guide_price_hidden FOR ALL
  USING (public.auth_role() = 'admin') WITH CHECK (public.auth_role() = 'admin');

GRANT SELECT, INSERT, DELETE ON public.board_guide_price_hidden TO authenticated;

-- Round a monthly rate into a guide range: about ±10%, snapped outward to a
-- step that suits its size, so the exact rate can't be read back.
CREATE OR REPLACE FUNCTION public.guide_price_step(p_rate NUMERIC)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_rate < 200000   THEN 10000
    WHEN p_rate < 1000000  THEN 50000
    WHEN p_rate < 5000000  THEN 100000
    WHEN p_rate < 20000000 THEN 500000
    ELSE 1000000 END;
$$;

CREATE OR REPLACE FUNCTION public.board_guide_prices(p_board_ids UUID[])
RETURNS TABLE (board_id UUID, low NUMERIC, high NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.board_id,
         GREATEST(public.guide_price_step(r.gross_monthly_rate),
                  FLOOR(r.gross_monthly_rate * 0.9 / public.guide_price_step(r.gross_monthly_rate)) * public.guide_price_step(r.gross_monthly_rate)),
         CEIL(r.gross_monthly_rate * 1.1 / public.guide_price_step(r.gross_monthly_rate)) * public.guide_price_step(r.gross_monthly_rate)
    FROM public.board_rates r
    JOIN public.boards b ON b.id = r.board_id
   WHERE r.board_id = ANY (p_board_ids[1:1000])
     AND r.gross_monthly_rate > 0
     AND b.status <> 'decommissioned'
     AND NOT EXISTS (SELECT 1 FROM public.board_guide_price_hidden h WHERE h.board_id = r.board_id)
     AND (b.owner_id IS NULL OR public.board_effective_rate_visibility(b.id) <> 'hidden');
$$;

REVOKE ALL ON FUNCTION public.board_guide_prices(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.board_guide_prices(UUID[]) TO anon, authenticated;
