DO $$
DECLARE
  acct_a uuid := gen_random_uuid();
  acct_b uuid := gen_random_uuid();
  user_a uuid := gen_random_uuid();
  user_b uuid := gen_random_uuid();
  contact_a uuid := gen_random_uuid();
  contact_b uuid := gen_random_uuid();
  prop_a uuid := gen_random_uuid();
  prop_b uuid := gen_random_uuid();
BEGIN
  -- Insert dummy users
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES 
    (user_a, 'a@example.com', '{"full_name": "User A"}'::jsonb), 
    (user_b, 'b@example.com', '{"full_name": "User B"}'::jsonb);

  -- Retrieve their automatically created account_ids (from handle_new_user trigger)
  SELECT account_id INTO acct_a FROM public.profiles WHERE user_id = user_a;
  SELECT account_id INTO acct_b FROM public.profiles WHERE user_id = user_b;

  -- Insert dummy contacts
  INSERT INTO public.contacts (id, account_id, user_id, phone, name) VALUES 
    (contact_a, acct_a, user_a, '+14155551111', 'Contact A'),
    (contact_b, acct_b, user_b, '+14155552222', 'Contact B');

  -- Seed D-M Tables: lead_details, properties, site_visits, assignment_history
  INSERT INTO public.lead_details (contact_id, account_id, intent, budget_min) VALUES 
    (contact_a, acct_a, 'buy', 100), 
    (contact_b, acct_b, 'rent', 200);
  
  INSERT INTO public.properties (id, account_id, title) VALUES 
    (prop_a, acct_a, 'Prop A'),
    (prop_b, acct_b, 'Prop B');

  INSERT INTO public.site_visits (account_id, contact_id, property_id, status) VALUES 
    (acct_a, contact_a, prop_a, 'pending'),
    (acct_b, contact_b, prop_b, 'pending');
  
  INSERT INTO public.assignment_history (account_id, contact_id, reason) VALUES 
    (acct_a, contact_a, 'manual'),
    (acct_b, contact_b, 'manual');

  -- Act as User A (Tenant A)
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', format('{"sub": "%s"}', user_a), true);

  -- Assert visibility (should only see Tenant A rows)
  IF (SELECT count(*) FROM public.lead_details) <> 1 THEN
    RAISE EXCEPTION 'RLS Leakage: User A sees % lead_details, expected 1', (SELECT count(*) FROM public.lead_details);
  END IF;

  IF (SELECT count(*) FROM public.properties) <> 1 THEN
    RAISE EXCEPTION 'RLS Leakage: User A sees % properties, expected 1', (SELECT count(*) FROM public.properties);
  END IF;

  IF (SELECT count(*) FROM public.site_visits) <> 1 THEN
    RAISE EXCEPTION 'RLS Leakage: User A sees % site_visits, expected 1', (SELECT count(*) FROM public.site_visits);
  END IF;

  IF (SELECT count(*) FROM public.assignment_history) <> 1 THEN
    RAISE EXCEPTION 'RLS Leakage: User A sees % assignment_history, expected 1', (SELECT count(*) FROM public.assignment_history);
  END IF;

  -- Revert to postgres superuser
  PERFORM set_config('role', 'postgres', true);

  RAISE NOTICE 'Two-tenant RLS isolation test passed for D-M extensions';
END
$$;
