-- STEP 1: Delete the broken account so you can re-register cleanly
DELETE FROM auth.users WHERE email = 'oluwamayowa.oyekale@maximediayello.com';

-- STEP 2: Auto-create profile for every future sign-up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, role, full_name, company_name)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'role', 'agency'),
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'company_name'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
