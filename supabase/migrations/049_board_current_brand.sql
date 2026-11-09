-- 049: which brand is on a board right now, and when their campaign ends.
--
-- Optional, filled in by our team when adding a board. Admins only (like
-- 047 and 048): it's market intelligence for us, not something buyers see.
-- Buyers see the board's available_from date, which the form sets to the
-- day after the current campaign ends.

CREATE TABLE IF NOT EXISTS public.board_current_brand (
  board_id   UUID PRIMARY KEY REFERENCES public.boards(id) ON DELETE CASCADE,
  brand      TEXT CHECK (brand IS NULL OR length(btrim(brand)) BETWEEN 1 AND 120),
  ends_on    DATE,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (brand IS NOT NULL OR ends_on IS NOT NULL)
);

ALTER TABLE public.board_current_brand ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "board_current_brand_admin" ON public.board_current_brand;
CREATE POLICY "board_current_brand_admin" ON public.board_current_brand FOR ALL
  USING (public.auth_role() = 'admin') WITH CHECK (public.auth_role() = 'admin');

REVOKE ALL ON public.board_current_brand FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.board_current_brand TO authenticated;
