-- Profile photo (avatar) support.
-- Run once in the Supabase SQL Editor.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

COMMENT ON COLUMN public.profiles.avatar_url IS
  'Public URL of the user profile photo stored in Supabase Storage "avatars" bucket.';

-- After running this SQL, create the storage bucket manually:
--   Supabase dashboard → Storage → New bucket
--   Name: avatars
--   Public: true  (avatars are shown in the UI without auth headers)
--   File size limit: 5 MB
--   Allowed MIME types: image/jpeg, image/png, image/webp
