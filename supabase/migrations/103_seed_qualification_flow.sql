-- ============================================================
-- 103_seed_qualification_flow.sql — Seed Qualification Flow
--
-- Updates handle_new_user to seed the default Real Estate
-- qualification Flow (I2 / F5) automatically at signup.
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_account_id UUID;
  v_pipeline_id UUID;
  v_auto_24h UUID;
  v_auto_2h UUID;
  v_auto_noshow UUID;
  v_flow_id UUID;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id)
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  -- Create default real-estate pipeline
  INSERT INTO public.pipelines (account_id, user_id, name)
  VALUES (v_account_id, NEW.id, 'Real Estate')
  RETURNING id INTO v_pipeline_id;

  INSERT INTO public.pipeline_stages (pipeline_id, name, position, color)
  VALUES 
    (v_pipeline_id, 'New', 0, '#3b82f6'),
    (v_pipeline_id, 'Contacted', 1, '#8b5cf6'),
    (v_pipeline_id, 'Site Visit', 2, '#ec4899'),
    (v_pipeline_id, 'Negotiation', 3, '#f59e0b'),
    (v_pipeline_id, 'Closed', 4, '#10b981');

  -- Seed Site Visit Automations
  
  -- 1. T-24h Confirmation
  INSERT INTO public.automations (account_id, user_id, name, description, trigger_type, is_active)
  VALUES (v_account_id, NEW.id, 'T-24h Visit Confirmation', 'Sent 24 hours before a scheduled site visit.', 'visit_reminder_24h', TRUE)
  RETURNING id INTO v_auto_24h;

  INSERT INTO public.automation_steps (automation_id, step_type, step_config, position)
  VALUES (v_auto_24h, 'send_message', '{"body": "Hi, just confirming your site visit tomorrow at {{scheduled_at}} for {{property_title}}. Looking forward to seeing you!"}'::jsonb, 0);

  -- 2. T-2h Reminder
  INSERT INTO public.automations (account_id, user_id, name, description, trigger_type, is_active)
  VALUES (v_account_id, NEW.id, 'T-2h Visit Reminder', 'Sent 2 hours before a confirmed site visit.', 'visit_reminder_2h', TRUE)
  RETURNING id INTO v_auto_2h;

  INSERT INTO public.automation_steps (automation_id, step_type, step_config, position)
  VALUES (v_auto_2h, 'send_message', '{"body": "Hi, a quick reminder about your site visit in 2 hours for {{property_title}}. See you soon!"}'::jsonb, 0);

  -- 3. No-show Recovery
  INSERT INTO public.automations (account_id, user_id, name, description, trigger_type, is_active)
  VALUES (v_account_id, NEW.id, 'No-show Recovery', 'Sent when a pending visit passes its scheduled time.', 'visit_no_show', TRUE)
  RETURNING id INTO v_auto_noshow;

  INSERT INTO public.automation_steps (automation_id, step_type, step_config, position)
  VALUES (v_auto_noshow, 'send_message', '{"body": "Hi, it looks like we missed you for the site visit at {{property_title}}. Let us know if you would like to reschedule."}'::jsonb, 0);

  -- 4. Default Qualification Flow
  INSERT INTO public.flows (account_id, user_id, name, description, trigger_type, status, entry_node_id)
  VALUES (v_account_id, NEW.id, 'Real Estate Lead Qualification', 'Automatically qualify new leads with a standard set of questions.', 'first_inbound_message', 'active', 'start')
  RETURNING id INTO v_flow_id;

  INSERT INTO public.flow_nodes (flow_id, node_key, node_type, config)
  VALUES 
    (v_flow_id, 'start', 'start', '{"next_node_key": "q1_timeframe"}'::jsonb),
    (v_flow_id, 'q1_timeframe', 'send_buttons', '{"text": "Hi! Thanks for your interest. To help us find the perfect property, when are you looking to move?", "buttons": [{"id": "asap", "text": "ASAP", "next_node_key": "q2_budget"}, {"id": "1_3_months", "text": "1-3 months", "next_node_key": "q2_budget"}, {"id": "just_looking", "text": "Just looking", "next_node_key": "handoff"}]}'::jsonb),
    (v_flow_id, 'q2_budget', 'send_buttons', '{"text": "Got it. What is your estimated budget?", "buttons": [{"id": "under_500k", "text": "Under 500k", "next_node_key": "handoff"}, {"id": "500_1m", "text": "500k - 1M", "next_node_key": "handoff"}, {"id": "over_1m", "text": "1M+", "next_node_key": "handoff"}]}'::jsonb),
    (v_flow_id, 'handoff', 'handoff', '{"message": "Great! A team member will be with you shortly to assist further."}'::jsonb);

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;
