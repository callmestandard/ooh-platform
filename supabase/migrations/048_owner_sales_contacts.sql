-- 048: saved sales contacts per board owner, so our team doesn't retype them.
--
-- Every time an admin adds or imports a board with a sales contact, the
-- contact is remembered against that board's owner: their account id, or
-- 'name:' + the lower-cased owner name typed for owners with no account
-- (see 047). Admins pick from these next time, and can delete them.
-- Admins only, like board_owner_names.

CREATE TABLE IF NOT EXISTS public.owner_sales_contacts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_key     TEXT NOT NULL CHECK (length(owner_key) BETWEEN 1 AND 220),
  contact_name  TEXT NOT NULL DEFAULT '' CHECK (length(contact_name) <= 120),
  contact_phone TEXT NOT NULL DEFAULT '' CHECK (length(contact_phone) <= 40),
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (contact_name <> '' OR contact_phone <> ''),
  UNIQUE (owner_key, contact_name, contact_phone)
);

ALTER TABLE public.owner_sales_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_sales_contacts_admin" ON public.owner_sales_contacts;
CREATE POLICY "owner_sales_contacts_admin" ON public.owner_sales_contacts FOR ALL
  USING (public.auth_role() = 'admin') WITH CHECK (public.auth_role() = 'admin');

REVOKE ALL ON public.owner_sales_contacts FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_sales_contacts TO authenticated;

CREATE INDEX IF NOT EXISTS owner_sales_contacts_key_idx ON public.owner_sales_contacts (owner_key, last_used_at DESC);
