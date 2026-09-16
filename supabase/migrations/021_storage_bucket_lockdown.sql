-- ═══════════════════════════════════════════════════════════════════
-- OOH Platform — close storage bucket enumeration + anon-upload gaps
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Found during a readiness audit, live-tested against production:
--
-- 1. compliance-photos (the bucket holding real POE proof photos) is fully
--    LISTABLE by the anon key: POST /storage/v1/object/list/compliance-photos
--    returns every booking-ID subfolder, and listing into one returns every
--    photo filename inside it. This bypasses the unguessable-poe_token
--    security model entirely — no token or login needed to browse every
--    field photo ever submitted, just the ability to call the list API.
--
-- 2. creatives and board-photos both accept fully anonymous uploads (no
--    login at all) even though every real upload path for them is a
--    logged-in dashboard flow (CreativeUploadPanel, BoardForm, post-board
--    wizard) — nothing in the app needs anonymous writes there.
--
-- Fix uses RESTRICTIVE policies rather than trying to discover and replace
-- whatever permissive policies already exist on storage.objects (unlike
-- public.* tables, we don't have visibility into that live policy set from
-- here) — a RESTRICTIVE policy is AND-ed with every permissive one for the
-- same command, so it narrows access regardless of what's already granted,
-- without touching or risking the existing INSERT policy that makes the
-- anonymous POE upload flow work (compliance-photos is deliberately
-- exempted from the insert restriction below).
--
-- Public image URLs (…/storage/v1/object/public/<bucket>/<path>) are NOT
-- affected — Supabase serves those directly from each bucket's public=true
-- flag, bypassing storage.objects RLS entirely, so marketplace/report/POE
-- photo display keeps working exactly as before. This only closes the
-- list/enumerate path and anonymous-write path.
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "restrict_list_to_service_role" ON storage.objects;
CREATE POLICY "restrict_list_to_service_role" ON storage.objects
  AS RESTRICTIVE
  FOR SELECT
  USING (
    bucket_id NOT IN ('compliance-photos','creatives','board-photos','agency-logos','avatars')
    OR auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS "restrict_insert_to_authenticated" ON storage.objects;
CREATE POLICY "restrict_insert_to_authenticated" ON storage.objects
  AS RESTRICTIVE
  FOR INSERT
  WITH CHECK (
    bucket_id NOT IN ('creatives','board-photos')
    OR auth.role() = 'authenticated'
  );
