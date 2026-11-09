-- 047: who owns a board that was added before its owner had an account.
--
-- When our team adds or imports boards for a media owner who is not on the
-- platform yet, the admin types the owner's name. It is kept here, readable
-- by admins only, so buyers can't see it and go around the platform. When
-- the owner signs up and claims the board, boards.owner_id takes over.

CREATE TABLE IF NOT EXISTS public.board_owner_names (
  board_id   UUID PRIMARY KEY REFERENCES public.boards(id) ON DELETE CASCADE,
  owner_name TEXT NOT NULL CHECK (length(btrim(owner_name)) BETWEEN 1 AND 200),
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.board_owner_names ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "board_owner_names_admin" ON public.board_owner_names;
CREATE POLICY "board_owner_names_admin" ON public.board_owner_names FOR ALL
  USING (public.auth_role() = 'admin') WITH CHECK (public.auth_role() = 'admin');

REVOKE ALL ON public.board_owner_names FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.board_owner_names TO authenticated;

CREATE INDEX IF NOT EXISTS board_owner_names_name_idx ON public.board_owner_names (lower(owner_name));
