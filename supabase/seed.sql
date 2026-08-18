-- ============================================================
-- supabase/seed.sql — Rimula demo/dev seed data
--
-- Populates the net-new Rimula tables added in migrations 040-048
-- (Products, Vehicles, verified compatibility, Campaigns, Content +
-- translations + voice notes, Customer Requests, Trials, Engagement
-- events, Product interactions, WhatsApp sync log) plus a handful of
-- demo `contacts` rows to serve as FK targets, per §19 of
-- docs/RIMULA_BUILD_SPEC.md.
--
-- SCOPE NOTE: this is the Phase 1 (§23) seed pass — schema + seed
-- data for the genuinely net-new Rimula tables only. It deliberately
-- does NOT attempt §19's full Member/BA demographic volumes (202
-- Mechanics / 255 Truck Owners / 387 Drivers, 20 markets, BA
-- `languages`/`region`/`capacity` fields) — those columns don't exist
-- yet. They land on `contacts`/`profiles` in Phase 2 ("Members extend
-- contacts, BAs extend profiles, markets/regions" per §23), and a
-- follow-up seed pass should extend this file once those columns
-- exist rather than duplicate a second seed script.
--
-- LOCAL / DEV ONLY. This file bootstraps a demo login by inserting
-- directly into `auth.users` (bypassing GoTrue's normal signup flow
-- entirely) so the seeded rows have a real `account_id` to attach to
-- — every domain table in this schema requires one non-nullable
-- `account_id`, and `accounts` can only be created via the
-- `handle_new_user()` trigger (migration 017), which only fires on an
-- `auth.users` insert. NEVER point this file at a hosted/production
-- Supabase project. It is intended to run via `supabase db reset`
-- (which replays `supabase/migrations/` then this file) against a
-- local Postgres instance.
--
-- Idempotent / re-runnable: the account is looked up-or-created
-- (`ON CONFLICT (id) DO NOTHING`), then every Rimula-domain row
-- belonging to that account is deleted and reinserted fresh on every
-- run. Row ids are NOT stable across runs (plain `gen_random_uuid()`
-- where nothing downstream needs to reference the row); the *parent*
-- entities that later inserts must reference (categories, products,
-- vehicles, campaigns, contacts, content, translations, a few
-- customer requests) use fixed literal UUIDs instead, purely so this
-- file stays readable — that has no bearing on runtime behaviour.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 0. Demo account bootstrap + cleanup
-- ============================================================
DROP TABLE IF EXISTS _rimula_seed_ctx;
CREATE TEMP TABLE _rimula_seed_ctx (account_id UUID, user_id UUID);

DO $$
DECLARE
  v_user_id UUID := 'a0000000-0000-0000-0000-000000000001';
  v_account_id UUID;
BEGIN
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, confirmation_token, recovery_token,
    email_change_token_new, email_change,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_user_id,
    'authenticated',
    'authenticated',
    'demo@rimula.local',
    crypt('rimula-demo-password', gen_salt('bf')),
    NOW(), '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Rimula Demo Admin"}'::jsonb,
    NOW(), NOW()
  )
  ON CONFLICT (id) DO NOTHING;

  -- handle_new_user() (migration 017) fires on the insert above (a
  -- fresh run) and creates accounts + profiles atomically. On a
  -- re-run the insert is a no-op and both rows already exist.
  SELECT account_id INTO v_account_id FROM profiles WHERE user_id = v_user_id;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION
      'Seed failed: no account found for demo user %. Was migration 017 applied?',
      v_user_id;
  END IF;

  INSERT INTO _rimula_seed_ctx (account_id, user_id) VALUES (v_account_id, v_user_id);

  -- Re-runnable: wipe this demo account's Rimula-domain rows before
  -- reinserting. Children first for readability even though every FK
  -- below is ON DELETE CASCADE/SET NULL. This account is dedicated to
  -- seed data (created solely for demo@rimula.local), so wiping its
  -- contacts on every run is expected, not destructive of real usage.
  DELETE FROM product_interactions WHERE account_id = v_account_id;
  DELETE FROM engagement_events WHERE account_id = v_account_id;
  DELETE FROM whatsapp_sync_log WHERE account_id = v_account_id;
  DELETE FROM voice_notes WHERE account_id = v_account_id;
  DELETE FROM content_translations WHERE account_id = v_account_id;
  DELETE FROM content WHERE account_id = v_account_id;
  DELETE FROM trials WHERE account_id = v_account_id;
  DELETE FROM customer_requests WHERE account_id = v_account_id;
  DELETE FROM campaigns WHERE account_id = v_account_id;
  DELETE FROM product_vehicles WHERE account_id = v_account_id;
  DELETE FROM vehicles WHERE account_id = v_account_id;
  DELETE FROM product_claims WHERE account_id = v_account_id;
  DELETE FROM product_applications WHERE account_id = v_account_id;
  DELETE FROM product_images WHERE account_id = v_account_id;
  DELETE FROM products WHERE account_id = v_account_id;
  DELETE FROM product_categories WHERE account_id = v_account_id;
  DELETE FROM community_groups WHERE account_id = v_account_id;
  DELETE FROM contacts WHERE account_id = v_account_id;
END $$;

-- ============================================================
-- 1. Community group — §8's single MVP destination
-- ============================================================
INSERT INTO community_groups (account_id, name, description, status, created_by)
SELECT account_id, 'Rimula Announcements',
  'Brand-to-audience broadcast destination for community members (Mechanics, Truck Drivers, Truck Owners, BAs, Other).',
  'active', user_id
FROM _rimula_seed_ctx;

-- ============================================================
-- 2. Product categories
-- ============================================================
INSERT INTO product_categories (id, account_id, name, description)
SELECT v.id, ctx.account_id, v.name, v.description
FROM _rimula_seed_ctx ctx
CROSS JOIN (VALUES
  ('10000000-0000-0000-0000-000000000001'::uuid, 'Heavy Duty Diesel Engine Oils', 'Engine oils for trucks, buses, and heavy commercial fleets.'),
  ('10000000-0000-0000-0000-000000000002'::uuid, 'Passenger Car Motor Oils', 'Engine oils for cars and light passenger vehicles.'),
  ('10000000-0000-0000-0000-000000000003'::uuid, 'Transmission & Gear Oils', 'Automatic transmission fluids and manual gear oils.'),
  ('10000000-0000-0000-0000-000000000004'::uuid, 'Greases', 'Multi-purpose and specialty greases.'),
  ('10000000-0000-0000-0000-000000000005'::uuid, 'Coolants', 'Engine coolants and antifreeze concentrates.')
) AS v(id, name, description);

-- ============================================================
-- 3. Products
-- ============================================================
INSERT INTO products (
  id, account_id, category_id, product_code, product_name,
  description, short_description, long_description,
  key_features, benefits, vehicle_types, recommended_vehicles, engine_types,
  packaging, status, created_by
)
SELECT v.id, ctx.account_id, v.category_id, v.product_code, v.product_name,
  v.description, v.short_description, v.long_description,
  v.key_features, v.benefits, v.vehicle_types, v.recommended_vehicles, v.engine_types,
  v.packaging, v.status, ctx.user_id
FROM _rimula_seed_ctx ctx
CROSS JOIN (VALUES
  ('11000000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000001'::uuid,
   'RIM-HDD-15W40', 'Heavy Duty Diesel Engine Oil 15W-40',
   'General-purpose heavy duty diesel engine oil for mixed-fleet operation.',
   'Reliable protection for heavy-duty diesel engines under demanding conditions.',
   'Formulated for extended drain intervals in heavy-duty diesel engines. Confirm current OEM approvals against the manufacturer datasheet before quoting a customer — see product_claims for administrator-approved statements.',
   '["High-temperature oxidation stability","Soot handling for extended oil life","Compatible with common heavy-duty diesel engine families"]'::jsonb,
   '["Helps protect against wear in demanding fleet duty cycles","Supports extended drain intervals where approved"]'::jsonb,
   ARRAY['Heavy Truck','Bus']::text[], ARRAY['Fleet Manufacturer A H1','Fleet Manufacturer B H2']::text[], ARRAY['Diesel I6 Turbo','Diesel V8 Turbo']::text[],
   '20L pail / 209L drum', 'published'),
  ('11000000-0000-0000-0000-000000000002'::uuid, '10000000-0000-0000-0000-000000000001'::uuid,
   'RIM-HDD-10W30', 'Heavy Duty Diesel Engine Oil 10W-30',
   'Lower-viscosity heavy duty diesel oil for fuel-economy-focused fleets.',
   'Fuel-economy oriented protection for modern diesel engines.',
   'A lower-viscosity option for fleets prioritising fuel economy. Confirm current OEM approvals against the manufacturer datasheet before quoting a customer.',
   '["Lower viscosity for fuel-economy benefit potential","Robust wear protection"]'::jsonb,
   '["May support improved fuel economy versus a heavier-grade oil, subject to OEM approval"]'::jsonb,
   ARRAY['Heavy Truck','Light Commercial Vehicle']::text[], ARRAY['Fleet Manufacturer A H1','Fleet Manufacturer C L1']::text[], ARRAY['Diesel I6 Turbo','Diesel I4 Turbo']::text[],
   '20L pail / 209L drum', 'published'),
  ('11000000-0000-0000-0000-000000000003'::uuid, '10000000-0000-0000-0000-000000000001'::uuid,
   'RIM-HDD-5W30-SY', 'Synthetic Heavy Duty Diesel Engine Oil 5W-30',
   'Full-synthetic heavy duty diesel oil for the latest low-emission engines.',
   'Full-synthetic protection for modern low-emission diesel platforms.',
   'A full-synthetic formulation targeted at newer low-emission diesel engine designs. Confirm current OEM approvals against the manufacturer datasheet before quoting a customer.',
   '["Full-synthetic base stock","Designed for low-emission aftertreatment compatibility"]'::jsonb,
   '["Aims to support engine cleanliness and aftertreatment system compatibility"]'::jsonb,
   ARRAY['Heavy Truck']::text[], ARRAY['Fleet Manufacturer B H2']::text[], ARRAY['Diesel V8 Turbo']::text[],
   '20L pail', 'published'),
  ('11000000-0000-0000-0000-000000000004'::uuid, '10000000-0000-0000-0000-000000000002'::uuid,
   'RIM-PCM-5W30', 'Passenger Car Motor Oil 5W-30',
   'General-purpose passenger car engine oil.',
   'Everyday protection for petrol passenger cars.',
   'Suitable for a broad range of petrol passenger car engines. Confirm current OEM approvals against the manufacturer datasheet before quoting a customer.',
   '["Broad OEM compatibility potential","Good cold-start flow characteristics"]'::jsonb,
   '["Supports everyday reliability for daily-driver use"]'::jsonb,
   ARRAY['Passenger Car']::text[], ARRAY['Auto Manufacturer D C1','Auto Manufacturer D C2']::text[], ARRAY['Petrol I4','Petrol I4 Turbo']::text[],
   '1L / 4L bottle', 'published'),
  ('11000000-0000-0000-0000-000000000005'::uuid, '10000000-0000-0000-0000-000000000002'::uuid,
   'RIM-PCM-10W40', 'Passenger Car Motor Oil 10W-40',
   'Higher-viscosity passenger car oil for older engines / hot climates.',
   'A heavier-grade option for older engines or high-ambient-temperature markets.',
   'Aimed at older engine designs or markets with sustained high ambient temperatures. Confirm current OEM approvals against the manufacturer datasheet before quoting a customer.',
   '["Heavier viscosity grade for worn-engine tolerance"]'::jsonb,
   '["May help reduce oil consumption in higher-mileage engines"]'::jsonb,
   ARRAY['Passenger Car']::text[], ARRAY['Auto Manufacturer D C1']::text[], ARRAY['Petrol I4']::text[],
   '1L / 4L bottle', 'pending_review'),
  ('11000000-0000-0000-0000-000000000006'::uuid, '10000000-0000-0000-0000-000000000003'::uuid,
   'RIM-ATF-III', 'Automatic Transmission Fluid III',
   'General-purpose automatic transmission fluid.',
   'Smooth shifting protection for automatic transmissions.',
   'A general-purpose ATF. Confirm current OEM approvals against the manufacturer datasheet before quoting a customer.',
   '["Friction durability for smooth shifting","Oxidation resistance"]'::jsonb,
   '["Supports consistent shift feel over the service interval"]'::jsonb,
   ARRAY['Passenger Car']::text[], ARRAY['Auto Manufacturer D C1','Auto Manufacturer D C2']::text[], ARRAY['Petrol I4','Petrol I4 Turbo']::text[],
   '1L / 4L bottle', 'published'),
  ('11000000-0000-0000-0000-000000000007'::uuid, '10000000-0000-0000-0000-000000000003'::uuid,
   'RIM-GEAR-85W140', 'Heavy Duty Gear Oil 85W-140',
   'Heavy duty manual gear/axle oil.',
   'Robust protection for heavy-duty axles and manual gearboxes.',
   'Formulated for heavy-duty axle and manual gearbox applications. Confirm current OEM approvals against the manufacturer datasheet before quoting a customer.',
   '["Extreme-pressure additive package","Thermal stability under sustained load"]'::jsonb,
   '["Supports gear and bearing protection in heavy-duty axles"]'::jsonb,
   ARRAY['Heavy Truck']::text[], ARRAY['Fleet Manufacturer A H1','Fleet Manufacturer B H2']::text[], ARRAY['Diesel I6 Turbo','Diesel V8 Turbo']::text[],
   '20L pail / 209L drum', 'published'),
  ('11000000-0000-0000-0000-000000000008'::uuid, '10000000-0000-0000-0000-000000000004'::uuid,
   'RIM-GREASE-EP2', 'Multi-Purpose EP2 Grease',
   'General-purpose extreme-pressure grease.',
   'General-purpose lubrication for chassis and wheel-bearing points.',
   'A multi-purpose EP2 grease suitable for common chassis lubrication points. Confirm current OEM approvals against the manufacturer datasheet before quoting a customer.',
   '["Extreme-pressure additive package","Water-resistance"]'::jsonb,
   '["Supports general chassis and bearing lubrication needs"]'::jsonb,
   ARRAY['Heavy Truck','Bus','Passenger Car']::text[], ARRAY[]::text[], ARRAY[]::text[],
   '400g cartridge / 18kg pail', 'draft'),
  ('11000000-0000-0000-0000-000000000009'::uuid, '10000000-0000-0000-0000-000000000005'::uuid,
   'RIM-COOL-OAT', 'Extended Life OAT Coolant Concentrate',
   'Organic Acid Technology coolant concentrate.',
   'Extended-life coolant for mixed engine fleets.',
   'An OAT-technology coolant concentrate intended for dilution per the datasheet. Confirm current OEM approvals against the manufacturer datasheet before quoting a customer.',
   '["Extended service life versus conventional coolant","Broad metal compatibility"]'::jsonb,
   '["Supports longer intervals between coolant service"]'::jsonb,
   ARRAY['Heavy Truck','Bus','Passenger Car']::text[], ARRAY[]::text[], ARRAY[]::text[],
   '5L / 20L container', 'published'),
  ('11000000-0000-0000-0000-000000000010'::uuid, '10000000-0000-0000-0000-000000000001'::uuid,
   'RIM-HDD-20W50', 'Heavy Duty Diesel Engine Oil 20W-50',
   'Higher-viscosity heavy duty diesel oil for older / high-mileage engines.',
   'A heavier-grade option for older heavy-duty diesel engines.',
   'Retained for legacy fleet support; superseded by newer grades for most new equipment. Confirm current OEM approvals against the manufacturer datasheet before quoting a customer.',
   '["Heavier viscosity for worn-engine tolerance"]'::jsonb,
   '["May help reduce oil consumption in higher-mileage diesel engines"]'::jsonb,
   ARRAY['Generator']::text[], ARRAY['Power Equipment Mfr E G1']::text[], ARRAY['Diesel I4']::text[],
   '20L pail / 209L drum', 'archived')
) AS v(
  id, category_id, product_code, product_name, description, short_description,
  long_description, key_features, benefits, vehicle_types, recommended_vehicles,
  engine_types, packaging, status
);

-- ============================================================
-- 4. Product images (illustrative — a subset of products)
-- ============================================================
INSERT INTO product_images (account_id, product_id, storage_path, alt_text, position)
SELECT ctx.account_id, v.product_id,
  'account-' || ctx.account_id || '/products/' || v.filename,
  v.alt_text, v.position
FROM _rimula_seed_ctx ctx
CROSS JOIN (VALUES
  ('11000000-0000-0000-0000-000000000001'::uuid, 'rim-hdd-15w40-front.jpg', 'Rimula Heavy Duty Diesel Engine Oil 15W-40 pail, front label', 0),
  ('11000000-0000-0000-0000-000000000001'::uuid, 'rim-hdd-15w40-back.jpg', 'Rimula Heavy Duty Diesel Engine Oil 15W-40 pail, back label', 1),
  ('11000000-0000-0000-0000-000000000004'::uuid, 'rim-pcm-5w30-front.jpg', 'Rimula Passenger Car Motor Oil 5W-30 bottle, front label', 0),
  ('11000000-0000-0000-0000-000000000009'::uuid, 'rim-coolant-oat-front.jpg', 'Rimula Extended Life OAT Coolant Concentrate container, front label', 0)
) AS v(product_id, filename, alt_text, position);

-- ============================================================
-- 5. Product applications (illustrative — a subset of products)
-- ============================================================
INSERT INTO product_applications (account_id, product_id, application, notes)
SELECT ctx.account_id, v.product_id, v.application, v.notes
FROM _rimula_seed_ctx ctx
CROSS JOIN (VALUES
  ('11000000-0000-0000-0000-000000000001'::uuid, 'Long-haul heavy truck fleets', 'Most-requested application for this grade among heavy-truck BAs.'),
  ('11000000-0000-0000-0000-000000000001'::uuid, 'Intercity bus operators', NULL),
  ('11000000-0000-0000-0000-000000000006'::uuid, 'Passenger car automatic transmissions', 'Confirm fluid type against the vehicle handbook before recommending.'),
  ('11000000-0000-0000-0000-000000000009'::uuid, 'Mixed diesel/petrol fleet coolant standardisation', NULL)
) AS v(product_id, application, notes);

-- ============================================================
-- 6. Product claims (mixed approval states, on purpose)
-- ============================================================
INSERT INTO product_claims (account_id, product_id, claim_text, status, created_by, approved_by, approved_at)
SELECT ctx.account_id, v.product_id, v.claim_text, v.status,
  ctx.user_id,
  CASE WHEN v.status = 'approved' THEN ctx.user_id ELSE NULL END,
  CASE WHEN v.status = 'approved' THEN NOW() - INTERVAL '3 days' ELSE NULL END
FROM _rimula_seed_ctx ctx
CROSS JOIN (VALUES
  ('11000000-0000-0000-0000-000000000001'::uuid, 'Formulated for extended drain intervals in heavy-duty diesel engines (see datasheet for approved interval by OEM).', 'approved'),
  ('11000000-0000-0000-0000-000000000001'::uuid, 'Suitable for all heavy-duty diesel engines regardless of OEM approval.', 'rejected'),
  ('11000000-0000-0000-0000-000000000004'::uuid, 'Meets common OEM specifications for petrol passenger cars (verify against current datasheet per vehicle).', 'approved'),
  ('11000000-0000-0000-0000-000000000009'::uuid, 'Extended-life formulation intended to reduce coolant service frequency versus a conventional coolant.', 'pending_review'),
  ('11000000-0000-0000-0000-000000000005'::uuid, 'Improves fuel economy by 10% in all vehicles.', 'draft')
) AS v(product_id, claim_text, status);

-- ============================================================
-- 7. Vehicles
-- ============================================================
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, engine)
SELECT v.id, ctx.account_id, v.vehicle_type, v.manufacturer, v.model, v.engine
FROM _rimula_seed_ctx ctx
CROSS JOIN (VALUES
  ('13000000-0000-0000-0000-000000000001'::uuid, 'Heavy Truck', 'Fleet Manufacturer A', 'H1', 'Diesel I6 Turbo'),
  ('13000000-0000-0000-0000-000000000002'::uuid, 'Heavy Truck', 'Fleet Manufacturer B', 'H2', 'Diesel V8 Turbo'),
  ('13000000-0000-0000-0000-000000000003'::uuid, 'Bus', 'Fleet Manufacturer A', 'B1', 'Diesel I6'),
  ('13000000-0000-0000-0000-000000000004'::uuid, 'Light Commercial Vehicle', 'Fleet Manufacturer C', 'L1', 'Diesel I4 Turbo'),
  ('13000000-0000-0000-0000-000000000005'::uuid, 'Pickup', 'Fleet Manufacturer C', 'P1', 'Diesel I4'),
  ('13000000-0000-0000-0000-000000000006'::uuid, 'Passenger Car', 'Auto Manufacturer D', 'C1', 'Petrol I4'),
  ('13000000-0000-0000-0000-000000000007'::uuid, 'Passenger Car', 'Auto Manufacturer D', 'C2', 'Petrol I4 Turbo'),
  ('13000000-0000-0000-0000-000000000008'::uuid, 'Generator', 'Power Equipment Mfr E', 'G1', 'Diesel I4')
) AS v(id, vehicle_type, manufacturer, model, engine);

-- ============================================================
-- 8. Verified product/vehicle compatibility
-- ============================================================
INSERT INTO product_vehicles (account_id, product_id, vehicle_id, verified_by, notes)
SELECT ctx.account_id, v.product_id, v.vehicle_id, ctx.user_id, v.notes
FROM _rimula_seed_ctx ctx
CROSS JOIN (VALUES
  ('11000000-0000-0000-0000-000000000001'::uuid, '13000000-0000-0000-0000-000000000001'::uuid, NULL::text),
  ('11000000-0000-0000-0000-000000000001'::uuid, '13000000-0000-0000-0000-000000000002'::uuid, NULL),
  ('11000000-0000-0000-0000-000000000001'::uuid, '13000000-0000-0000-0000-000000000003'::uuid, NULL),
  ('11000000-0000-0000-0000-000000000002'::uuid, '13000000-0000-0000-0000-000000000001'::uuid, NULL),
  ('11000000-0000-0000-0000-000000000002'::uuid, '13000000-0000-0000-0000-000000000004'::uuid, NULL),
  ('11000000-0000-0000-0000-000000000003'::uuid, '13000000-0000-0000-0000-000000000002'::uuid, 'Confirmed against manufacturer B''s latest low-emission diesel spec.'),
  ('11000000-0000-0000-0000-000000000004'::uuid, '13000000-0000-0000-0000-000000000006'::uuid, NULL),
  ('11000000-0000-0000-0000-000000000004'::uuid, '13000000-0000-0000-0000-000000000007'::uuid, NULL),
  ('11000000-0000-0000-0000-000000000005'::uuid, '13000000-0000-0000-0000-000000000006'::uuid, NULL),
  ('11000000-0000-0000-0000-000000000006'::uuid, '13000000-0000-0000-0000-000000000006'::uuid, NULL),
  ('11000000-0000-0000-0000-000000000006'::uuid, '13000000-0000-0000-0000-000000000007'::uuid, NULL),
  ('11000000-0000-0000-0000-000000000007'::uuid, '13000000-0000-0000-0000-000000000001'::uuid, NULL),
  ('11000000-0000-0000-0000-000000000007'::uuid, '13000000-0000-0000-0000-000000000002'::uuid, NULL),
  ('11000000-0000-0000-0000-000000000009'::uuid, '13000000-0000-0000-0000-000000000001'::uuid, NULL),
  ('11000000-0000-0000-0000-000000000009'::uuid, '13000000-0000-0000-0000-000000000002'::uuid, NULL),
  ('11000000-0000-0000-0000-000000000009'::uuid, '13000000-0000-0000-0000-000000000006'::uuid, NULL),
  ('11000000-0000-0000-0000-000000000010'::uuid, '13000000-0000-0000-0000-000000000008'::uuid, NULL)
) AS v(product_id, vehicle_id, notes);

-- ============================================================
-- 9. Campaigns
-- ============================================================
INSERT INTO campaigns (
  id, account_id, campaign_name, product_id, start_date, end_date,
  objective, audience, status, cost, created_by
)
SELECT v.id, ctx.account_id, v.campaign_name, v.product_id, v.start_date, v.end_date,
  v.objective, v.audience, v.status, v.cost, ctx.user_id
FROM _rimula_seed_ctx ctx
CROSS JOIN (VALUES
  ('14000000-0000-0000-0000-000000000001'::uuid, 'Fleet Check-Up Season', '11000000-0000-0000-0000-000000000001'::uuid,
   (CURRENT_DATE - INTERVAL '10 days')::date, (CURRENT_DATE + INTERVAL '20 days')::date,
   'Drive trial requests for Heavy Duty Diesel Engine Oil 15W-40 among heavy-truck drivers and mechanics.',
   '{"roles":["Mechanic","Truck Driver","Truck Owner"],"markets":["all"]}'::jsonb,
   'active', 150000.00),
  ('14000000-0000-0000-0000-000000000002'::uuid, 'Passenger Car Oil Change Push', '11000000-0000-0000-0000-000000000004'::uuid,
   (CURRENT_DATE - INTERVAL '60 days')::date, (CURRENT_DATE - INTERVAL '15 days')::date,
   'Seasonal reminder campaign for passenger car oil changes.',
   '{"roles":["Other"],"markets":["all"]}'::jsonb,
   'completed', 60000.00),
  ('14000000-0000-0000-0000-000000000003'::uuid, 'Winter Coolant Readiness', '11000000-0000-0000-0000-000000000009'::uuid,
   NULL, NULL,
   'Educate the community on coolant service ahead of winter.',
   '{"roles":["Mechanic","Truck Owner"],"markets":["all"]}'::jsonb,
   'draft', NULL)
) AS v(id, campaign_name, product_id, start_date, end_date, objective, audience, status, cost);

-- ============================================================
-- 10. Demo contacts (Members) — existing `contacts` columns only.
-- Role/region/market/vehicle etc. land on this table in Phase 2;
-- these rows are just FK targets for the requests/trials/engagement
-- data below.
-- ============================================================
INSERT INTO contacts (id, account_id, user_id, phone, name, email, company)
SELECT v.id, ctx.account_id, ctx.user_id, v.phone, v.name, v.email, v.company
FROM _rimula_seed_ctx ctx
CROSS JOIN (VALUES
  ('15000000-0000-0000-0000-000000000001'::uuid, '+923000000001', 'Ahmed Raza', 'ahmed.raza@example.com', 'Independent Mechanic'),
  ('15000000-0000-0000-0000-000000000002'::uuid, '+923000000002', 'Bilal Hussain', 'bilal.hussain@example.com', 'City Auto Workshop'),
  ('15000000-0000-0000-0000-000000000003'::uuid, '+923000000003', 'Chaudhry Farooq', 'farooq.c@example.com', 'Farooq Transport Co.'),
  ('15000000-0000-0000-0000-000000000004'::uuid, '+923000000004', 'Danish Iqbal', 'danish.iqbal@example.com', NULL),
  ('15000000-0000-0000-0000-000000000005'::uuid, '+923000000005', 'Ehsan Ali', 'ehsan.ali@example.com', 'Ali Fleet Services'),
  ('15000000-0000-0000-0000-000000000006'::uuid, '+923000000006', 'Faisal Mehmood', 'faisal.m@example.com', NULL),
  ('15000000-0000-0000-0000-000000000007'::uuid, '+923000000007', 'Ghulam Abbas', 'ghulam.abbas@example.com', 'Abbas Logistics'),
  ('15000000-0000-0000-0000-000000000008'::uuid, '+923000000008', 'Hamid Sultan', 'hamid.sultan@example.com', NULL),
  ('15000000-0000-0000-0000-000000000009'::uuid, '+923000000009', 'Imran Sheikh', 'imran.sheikh@example.com', 'Sheikh Bus Service'),
  ('15000000-0000-0000-0000-000000000010'::uuid, '+923000000010', 'Junaid Aslam', 'junaid.aslam@example.com', NULL),
  ('15000000-0000-0000-0000-000000000011'::uuid, '+923000000011', 'Kamran Yousaf', 'kamran.yousaf@example.com', 'Yousaf Auto Care'),
  ('15000000-0000-0000-0000-000000000012'::uuid, '+923000000012', 'Liaquat Baig', 'liaquat.baig@example.com', NULL),
  ('15000000-0000-0000-0000-000000000013'::uuid, '+923000000013', 'Mudassar Khan', 'mudassar.khan@example.com', 'Khan Freight'),
  ('15000000-0000-0000-0000-000000000014'::uuid, '+923000000014', 'Nadeem Chaudhary', 'nadeem.c@example.com', NULL),
  ('15000000-0000-0000-0000-000000000015'::uuid, '+923000000015', 'Omar Farooqi', 'omar.farooqi@example.com', 'Farooqi Motors'),
  ('15000000-0000-0000-0000-000000000016'::uuid, '+923000000016', 'Qasim Latif', 'qasim.latif@example.com', NULL),
  ('15000000-0000-0000-0000-000000000017'::uuid, '+923000000017', 'Rashid Mahmood', 'rashid.mahmood@example.com', 'Mahmood Transport'),
  ('15000000-0000-0000-0000-000000000018'::uuid, '+923000000018', 'Salman Tariq', 'salman.tariq@example.com', NULL),
  ('15000000-0000-0000-0000-000000000019'::uuid, '+923000000019', 'Tariq Jameel', 'tariq.jameel@example.com', 'Jameel Bus Co.'),
  ('15000000-0000-0000-0000-000000000020'::uuid, '+923000000020', 'Usman Ghani', 'usman.ghani@example.com', NULL)
) AS v(id, phone, name, email, company);

-- ============================================================
-- 11. Content + translations + voice notes
-- ============================================================
INSERT INTO content (
  id, account_id, title, content_type, body, product_id, campaign_id,
  status, created_by, approved_by, approved_at
)
SELECT v.id, ctx.account_id, v.title, v.content_type, v.body, v.product_id, v.campaign_id,
  v.status, ctx.user_id,
  CASE WHEN v.status IN ('Approved', 'Scheduled', 'Published') THEN ctx.user_id ELSE NULL END,
  CASE WHEN v.status IN ('Approved', 'Scheduled', 'Published') THEN NOW() - INTERVAL '2 days' ELSE NULL END
FROM _rimula_seed_ctx ctx
CROSS JOIN (VALUES
  ('17000000-0000-0000-0000-000000000001'::uuid, 'Rimula Heavy Duty 15W-40 — Trusted by Fleet Mechanics', 'poster',
   'Reliable protection for heavy-duty diesel engines under demanding conditions. Ask your local BA for a trial.',
   '11000000-0000-0000-0000-000000000001'::uuid, '14000000-0000-0000-0000-000000000001'::uuid, 'Published'),
  ('17000000-0000-0000-0000-000000000002'::uuid, '5 Signs Your Truck Needs an Oil Change', 'text_post',
   'Watch for these signs: dark exhaust smoke, unusual engine noise, reduced fuel economy, oil warning light, and longer-than-usual crank time.',
   NULL, '14000000-0000-0000-0000-000000000001'::uuid, 'Approved'),
  ('17000000-0000-0000-0000-000000000003'::uuid, 'Rimula Coolant Readiness Reminder', 'image',
   'Winter is coming — book a coolant check with your local BA.',
   '11000000-0000-0000-0000-000000000009'::uuid, '14000000-0000-0000-0000-000000000003'::uuid, 'In Review'),
  ('17000000-0000-0000-0000-000000000004'::uuid, 'Passenger Car Oil Change Promo', 'campaign_post',
   'Keep your daily driver protected — ask about Rimula Passenger Car Motor Oil 5W-30.',
   '11000000-0000-0000-0000-000000000004'::uuid, '14000000-0000-0000-0000-000000000002'::uuid, 'Published'),
  ('17000000-0000-0000-0000-000000000005'::uuid, 'Meet Your Local Rimula BA', 'video',
   'Draft script: introduce the local BA and how community members can reach them.',
   NULL, NULL, 'Draft'),
  ('17000000-0000-0000-0000-000000000006'::uuid, 'Voice Note: How to Check Engine Oil', 'voice_note',
   'Script: a short walkthrough of checking engine oil level and condition with the dipstick.',
   NULL, NULL, 'Approved')
) AS v(id, title, content_type, body, product_id, campaign_id, status);

INSERT INTO content_translations (id, account_id, content_id, language, body, translated_by)
SELECT v.id, ctx.account_id, v.content_id, v.language, v.body, ctx.user_id
FROM _rimula_seed_ctx ctx
CROSS JOIN (VALUES
  ('18000000-0000-0000-0000-000000000001'::uuid, '17000000-0000-0000-0000-000000000001'::uuid, 'ur', 'ہیوی ڈیوٹی ڈیزل انجن آئل — فلیٹ مکینکس کا بھروسہ۔ اپنے مقامی بی اے سے ٹرائل کے لیے پوچھیں۔'),
  ('18000000-0000-0000-0000-000000000002'::uuid, '17000000-0000-0000-0000-000000000001'::uuid, 'ps', 'دروند دیوتي ډیزل انجن غوړ — د فلیټ ميخانيکانو باور. د آزمېښت لپاره خپل سیمه‌ییز BA ته اړیکه ونیسئ.'),
  ('18000000-0000-0000-0000-000000000003'::uuid, '17000000-0000-0000-0000-000000000002'::uuid, 'ur', 'ان علامات پر توجہ دیں: گہرا دھواں، غیر معمولی آواز، ایندھن کی کھپت میں اضافہ، آئل وارننگ لائٹ، اور اسٹارٹ ہونے میں تاخیر۔'),
  ('18000000-0000-0000-0000-000000000004'::uuid, '17000000-0000-0000-0000-000000000004'::uuid, 'pa', 'اپنی روزانہ گڈی نوں محفوظ رکھو — Rimula Passenger Car Motor Oil 5W-30 بارے پُچھو۔')
) AS v(id, content_id, language, body);

INSERT INTO voice_notes (account_id, content_id, content_translation_id, language, storage_path, duration_seconds, source, recorded_by)
SELECT ctx.account_id, v.content_id, v.content_translation_id, v.language,
  'account-' || ctx.account_id || '/voice-notes/' || v.filename,
  v.duration_seconds, 'recorded', ctx.user_id
FROM _rimula_seed_ctx ctx
CROSS JOIN (VALUES
  ('17000000-0000-0000-0000-000000000006'::uuid, NULL::uuid, 'ur', 'check-engine-oil-ur.ogg', 48),
  ('17000000-0000-0000-0000-000000000001'::uuid, '18000000-0000-0000-0000-000000000001'::uuid, 'ur', 'rimula-15w40-ur.ogg', 22)
) AS v(content_id, content_translation_id, language, filename, duration_seconds);

-- ============================================================
-- 12. Customer requests
-- ============================================================
INSERT INTO customer_requests (
  id, account_id, contact_id, product_id, campaign_id, type, source, status, assigned_ba_id, notes
)
SELECT v.id, ctx.account_id, v.contact_id, v.product_id, v.campaign_id, v.type, v.source, v.status,
  CASE WHEN v.assign THEN ctx.user_id ELSE NULL END, v.notes
FROM _rimula_seed_ctx ctx
CROSS JOIN (VALUES
  ('16000000-0000-0000-0000-000000000001'::uuid, '15000000-0000-0000-0000-000000000001'::uuid, '11000000-0000-0000-0000-000000000001'::uuid, '14000000-0000-0000-0000-000000000001'::uuid, 'TRIAL_REQUEST', 'demo_whatsapp', 'ASSIGNED', TRUE, 'Wants a trial for his own truck.'),
  ('16000000-0000-0000-0000-000000000002'::uuid, '15000000-0000-0000-0000-000000000002'::uuid, '11000000-0000-0000-0000-000000000004'::uuid, '14000000-0000-0000-0000-000000000002'::uuid, 'PRODUCT_QUESTIO', 'demo_whatsapp', 'RESOLVED', TRUE, 'Asked about correct viscosity grade for his workshop customers.'),
  ('16000000-0000-0000-0000-000000000003'::uuid, '15000000-0000-0000-0000-000000000003'::uuid, '11000000-0000-0000-0000-000000000001'::uuid, '14000000-0000-0000-0000-000000000001'::uuid, 'PRODUCT_SUITABILITY', 'demo_whatsapp', 'NEW', FALSE, 'Fleet of mixed heavy trucks — needs compatibility confirmation.'),
  ('16000000-0000-0000-0000-000000000004'::uuid, '15000000-0000-0000-0000-000000000004'::uuid, NULL, NULL, 'GENERAL_ENQUIRY', 'manual', 'CLOSED', TRUE, 'Walked in to the demo booth at a community event.'),
  ('16000000-0000-0000-0000-000000000005'::uuid, '15000000-0000-0000-0000-000000000005'::uuid, '11000000-0000-0000-0000-000000000009'::uuid, '14000000-0000-0000-0000-000000000003'::uuid, 'PRODUCT_INFORMATIO', 'campaign', 'IN_PROGRESS', TRUE, 'Wants coolant service pricing.'),
  ('16000000-0000-0000-0000-000000000006'::uuid, '15000000-0000-0000-0000-000000000006'::uuid, NULL, NULL, 'BA_CALL_REQUEST', 'demo_whatsapp', 'ASSIGNED', TRUE, NULL),
  ('16000000-0000-0000-0000-000000000007'::uuid, '15000000-0000-0000-0000-000000000007'::uuid, '11000000-0000-0000-0000-000000000001'::uuid, NULL, 'PURCHASE_REQUEST', 'flow', 'NEW', FALSE, 'Captured via Flows collect_input node.'),
  ('16000000-0000-0000-0000-000000000008'::uuid, '15000000-0000-0000-0000-000000000008'::uuid, NULL, NULL, 'FEEDBACK', 'whatsapp', 'RESOLVED', TRUE, 'Positive feedback on BA responsiveness.'),
  ('16000000-0000-0000-0000-000000000009'::uuid, '15000000-0000-0000-0000-000000000009'::uuid, '11000000-0000-0000-0000-000000000006'::uuid, NULL, 'CONVERSION_REQUEST', 'demo_whatsapp', 'IN_PROGRESS', TRUE, 'Ready to place a bulk order pending BA confirmation.'),
  ('16000000-0000-0000-0000-000000000010'::uuid, '15000000-0000-0000-0000-000000000010'::uuid, '11000000-0000-0000-0000-000000000004'::uuid, '14000000-0000-0000-0000-000000000002'::uuid, 'PRODUCT_QUESTIO', 'product_page', 'NEW', FALSE, NULL)
) AS v(id, contact_id, product_id, campaign_id, type, source, status, assign, notes);

-- ============================================================
-- 13. Trials
-- ============================================================
INSERT INTO trials (
  account_id, contact_id, product_id, customer_request_id, name, phone, role, market, vehicle,
  notes, status, assigned_ba_id
)
SELECT ctx.account_id, v.contact_id, v.product_id, v.customer_request_id, v.name, v.phone, v.role, v.market, v.vehicle,
  v.notes, v.status, CASE WHEN v.assign THEN ctx.user_id ELSE NULL END
FROM _rimula_seed_ctx ctx
CROSS JOIN (VALUES
  ('15000000-0000-0000-0000-000000000001'::uuid, '11000000-0000-0000-0000-000000000001'::uuid, '16000000-0000-0000-0000-000000000001'::uuid,
   'Ahmed Raza', '+923000000001', 'Mechanic', 'Lahore', 'Heavy Truck', 'Trial for own fleet.', 'SCHEDULED', TRUE),
  ('15000000-0000-0000-0000-000000000002'::uuid, '11000000-0000-0000-0000-000000000004'::uuid, NULL,
   'Bilal Hussain', '+923000000002', 'Mechanic', 'Karachi', 'Passenger Car', 'Requested for workshop customer demo.', 'REQUESTED', FALSE),
  ('15000000-0000-0000-0000-000000000003'::uuid, '11000000-0000-0000-0000-000000000001'::uuid, NULL,
   'Chaudhry Farooq', '+923000000003', 'Truck Owner', 'Multan', 'Heavy Truck', NULL, 'CONVERTED', TRUE),
  ('15000000-0000-0000-0000-000000000005'::uuid, '11000000-0000-0000-0000-000000000009'::uuid, '16000000-0000-0000-0000-000000000005'::uuid,
   'Ehsan Ali', '+923000000005', 'Truck Owner', 'Faisalabad', 'Heavy Truck', 'Coolant trial pending scheduling.', 'ASSIGNED', TRUE),
  (NULL, '11000000-0000-0000-0000-000000000001'::uuid, NULL,
   'Walk-in Prospect', '+923000000099', 'Truck Driver', 'Lahore', 'Heavy Truck', 'No matching contact record yet — captured at a community event.', 'NEW', FALSE),
  ('15000000-0000-0000-0000-000000000009'::uuid, '11000000-0000-0000-0000-000000000006'::uuid, NULL,
   'Imran Sheikh', '+923000000009', 'Other', 'Islamabad', 'Bus', 'Cancelled — chose a competitor product.', 'CANCELLED', TRUE)
) AS v(contact_id, product_id, customer_request_id, name, phone, role, market, vehicle, notes, status, assign);

-- ============================================================
-- 14. Engagement events — cross join campaigns x event types,
-- attributed to a random seeded contact.
-- ============================================================
INSERT INTO engagement_events (account_id, member_id, campaign_id, event_type, event_value, source, occurred_at)
SELECT
  ctx.account_id,
  member.id,
  camp.id,
  et.event_type,
  CASE WHEN et.event_type = 'CONVERSIO' THEN 45000.00 ELSE NULL END,
  'demo_seed',
  NOW() - (ROW_NUMBER() OVER () || ' hours')::interval
FROM _rimula_seed_ctx ctx
CROSS JOIN (VALUES
  ('14000000-0000-0000-0000-000000000001'::uuid),
  ('14000000-0000-0000-0000-000000000002'::uuid),
  ('14000000-0000-0000-0000-000000000003'::uuid)
) AS camp(id)
CROSS JOIN (VALUES
  ('DELIVERED'), ('READ'), ('REACTIO'), ('REPLY'), ('CLICK'), ('LEAD'), ('TRIAL'), ('CONVERSIO')
) AS et(event_type)
JOIN LATERAL (
  SELECT id FROM contacts WHERE account_id = ctx.account_id ORDER BY random() LIMIT 1
) AS member ON TRUE;

-- ============================================================
-- 15. Product interactions — cross join a subset of products x
-- interaction types, attributed to a random seeded contact/campaign.
-- ============================================================
INSERT INTO product_interactions (account_id, contact_id, product_id, campaign_id, interaction_type, created_at)
SELECT
  ctx.account_id,
  member.id,
  p.id,
  camp.id,
  it.interaction_type,
  NOW() - (ROW_NUMBER() OVER () || ' hours')::interval
FROM _rimula_seed_ctx ctx
CROSS JOIN (VALUES
  ('11000000-0000-0000-0000-000000000001'::uuid),
  ('11000000-0000-0000-0000-000000000004'::uuid),
  ('11000000-0000-0000-0000-000000000009'::uuid)
) AS p(id)
CROSS JOIN (VALUES
  ('viewed'), ('clicked'), ('enquiry'), ('interest'), ('trial_request'), ('lead')
) AS it(interaction_type)
JOIN LATERAL (
  SELECT id FROM contacts WHERE account_id = ctx.account_id ORDER BY random() LIMIT 1
) AS member ON TRUE
LEFT JOIN LATERAL (
  SELECT id FROM campaigns WHERE account_id = ctx.account_id ORDER BY random() LIMIT 1
) AS camp ON TRUE;

-- ============================================================
-- 16. WhatsApp sync log — one row per seeded product.
-- ============================================================
INSERT INTO whatsapp_sync_log (account_id, product_id, sync_status, last_synced_at, sync_error)
SELECT
  ctx.account_id,
  p.id,
  CASE
    WHEN p.id = '11000000-0000-0000-0000-000000000001' THEN 'Synced'
    WHEN p.id = '11000000-0000-0000-0000-000000000010' THEN 'Sync Error'
    WHEN p.status = 'published' THEN 'Pending Review'
    ELSE 'Draft'
  END,
  CASE WHEN p.id = '11000000-0000-0000-0000-000000000001' THEN NOW() - INTERVAL '2 days' ELSE NULL END,
  CASE WHEN p.id = '11000000-0000-0000-0000-000000000010' THEN 'Catalogue rejected: missing required attribute (GTIN).' ELSE NULL END
FROM _rimula_seed_ctx ctx
JOIN products p ON p.account_id = ctx.account_id;

DROP TABLE IF EXISTS _rimula_seed_ctx;
