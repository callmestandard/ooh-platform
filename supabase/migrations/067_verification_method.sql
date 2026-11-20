-- 067: verification that can't go stale silently (audit checks 85 and 86).
-- 1. Records how a board was verified (site visit, owner confirmed, photo check, other),
--    an optional note, and who verified it.
-- 2. If an admin-verified board's pin moves more than 50 m (or is removed), the board
--    goes back to "pending" with a note saying why. Owner-verified boards keep their
--    status: an approved owner moving their own pin is the owner's own word.
-- Runs after the 042/050 guard (triggers fire in name order), which still decides
-- who may verify at all.

ALTER TABLE public.boards ADD COLUMN IF NOT EXISTS verification_method TEXT;
ALTER TABLE public.boards ADD COLUMN IF NOT EXISTS verification_note   TEXT;
ALTER TABLE public.boards ADD COLUMN IF NOT EXISTS verified_by         UUID;
ALTER TABLE public.boards DROP CONSTRAINT IF EXISTS boards_verification_method_check;
ALTER TABLE public.boards ADD CONSTRAINT boards_verification_method_check
  CHECK (verification_method IS NULL OR verification_method IN ('site_visit', 'owner_confirmed', 'photo_check', 'other'));
ALTER TABLE public.boards DROP CONSTRAINT IF EXISTS boards_verification_note_len;
ALTER TABLE public.boards ADD CONSTRAINT boards_verification_note_len
  CHECK (verification_note IS NULL OR length(verification_note) <= 300);

-- Readable like the other verification columns (060 grants board columns one by one).
GRANT SELECT (verification_method, verification_note, verified_by) ON public.boards TO anon, authenticated;
GRANT UPDATE (verification_method, verification_note) ON public.boards TO authenticated;

CREATE OR REPLACE FUNCTION public.boards_verification_trail()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_trusted BOOLEAN := auth.uid() IS NULL OR public.auth_role() = 'admin';
  v_moved   DOUBLE PRECISION;
BEGIN
  IF TG_OP = 'UPDATE' AND NOT v_trusted THEN
    NEW.verification_method := OLD.verification_method;
    NEW.verification_note   := OLD.verification_note;
    NEW.verified_by         := OLD.verified_by;
  END IF;

  IF NEW.verification_status = 'verified'
     AND (TG_OP = 'INSERT' OR OLD.verification_status IS DISTINCT FROM 'verified') THEN
    NEW.verified_by := COALESCE(auth.uid(), NEW.verified_by);
    IF TG_OP = 'UPDATE' AND NEW.verification_note IS NOT DISTINCT FROM OLD.verification_note THEN
      NEW.verification_note := NULL;  -- drop an old "pin moved" note when re-verified
    END IF;
  ELSIF NEW.verification_status IS DISTINCT FROM 'verified' AND TG_OP = 'UPDATE'
        AND OLD.verification_status = 'verified' THEN
    NEW.verification_method := NULL;
    NEW.verified_by         := NULL;
  END IF;

  -- Pin moved on an admin-verified board, in an update that didn't itself verify it.
  IF TG_OP = 'UPDATE' AND OLD.verification_status = 'verified' AND NEW.verification_status = 'verified'
     AND OLD.latitude IS NOT NULL
     AND (NEW.latitude IS DISTINCT FROM OLD.latitude OR NEW.longitude IS DISTINCT FROM OLD.longitude) THEN
    IF NEW.latitude IS NULL OR NEW.longitude IS NULL THEN
      v_moved := NULL;
    ELSE
      v_moved := 6371000 * 2 * asin(sqrt(
        power(sin(radians(NEW.latitude - OLD.latitude) / 2), 2) +
        cos(radians(OLD.latitude)) * cos(radians(NEW.latitude)) * power(sin(radians(NEW.longitude - OLD.longitude) / 2), 2)));
    END IF;
    IF v_moved IS NULL OR v_moved > 50 THEN
      NEW.verification_status := 'pending';
      NEW.verification_method := NULL;
      NEW.verified_by         := NULL;
      NEW.verification_note   := CASE WHEN v_moved IS NULL THEN 'Pin removed' ELSE 'Pin moved ' || round(v_moved::numeric) || ' m' END
                                 || ' on ' || to_char(NOW() AT TIME ZONE 'Africa/Lagos', 'DD Mon YYYY') || '. Verify again.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS boards_verification_trail ON public.boards;
CREATE TRIGGER boards_verification_trail BEFORE INSERT OR UPDATE ON public.boards
  FOR EACH ROW EXECUTE FUNCTION public.boards_verification_trail();

-- The 23 boards verified before this migration: how is unknown, so it stays empty
-- and the inventory shows "method not recorded" until an admin fills it in.
