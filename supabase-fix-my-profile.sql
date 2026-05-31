-- Insert profile row for mayowaoyekale48@gmail.com as agency
INSERT INTO public.profiles (id, role, full_name, company_name)
SELECT id, 'agency', 'Mayowa', 'OOH Platform'
FROM auth.users
WHERE email = 'mayowaoyekale48@gmail.com'
ON CONFLICT (id) DO UPDATE SET role = 'agency';
