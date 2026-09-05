-- Performance hardening pass (Supabase performance advisor, 2026-09-05):
--
-- 1) `auth_rls_initplan` — several RLS policies called `auth.uid()`
--    directly, which Postgres re-evaluates once per row instead of
--    once per query. Wrapping it as `(select auth.uid())` lets the
--    planner treat it as a stable subplan evaluated a single time.
--    Pure performance change — the boolean result is identical, so
--    access control behaviour is unchanged. Docs:
--    https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
--
-- 2) `unindexed_foreign_keys` — 63 foreign-key columns had no covering
--    index, which forces a sequential scan on the referencing table
--    for every parent-row UPDATE/DELETE (FK existence check) and for
--    any JOIN through that key. Purely additive.
--
-- Deliberately NOT touched here (higher risk, lower reward, left for
-- a dedicated follow-up): `multiple_permissive_policies` (66 hits,
-- but only ~11 distinct table/action pairs — the advisor multiplies
-- by every Postgres role — and merging them means re-deriving each
-- table's access rules by hand) and `unused_index` (22 hits — an
-- index can look "unused" simply because its query pattern runs
-- monthly, e.g. reporting; dropping on a live multi-tenant DB without
-- a full usage history is not worth the risk).

-- ---------------------------------------------------------------
-- 1) auth.uid() -> (select auth.uid()) in RLS policies
-- ---------------------------------------------------------------

alter policy "profiles_insert" on public.profiles
  with check ((select auth.uid()) = user_id);

alter policy "profiles_select" on public.profiles
  using (((select auth.uid()) = user_id) or is_account_member(account_id));

alter policy "profiles_update" on public.profiles
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy "push_subscriptions_delete" on public.push_subscriptions
  using ((select auth.uid()) = user_id);

alter policy "push_subscriptions_insert" on public.push_subscriptions
  with check ((select auth.uid()) = user_id);

alter policy "push_subscriptions_select" on public.push_subscriptions
  using ((select auth.uid()) = user_id);

alter policy "push_subscriptions_update" on public.push_subscriptions
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy "notifications_select" on public.notifications
  using ((select auth.uid()) = user_id);

alter policy "notifications_update" on public.notifications
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy "saved_views_delete" on public.saved_views
  using (is_account_member(account_id) and (user_id = (select auth.uid())));

alter policy "saved_views_insert" on public.saved_views
  with check (is_account_member(account_id) and (user_id = (select auth.uid())));

alter policy "saved_views_select" on public.saved_views
  using (is_account_member(account_id) and ((user_id = (select auth.uid())) or is_shared));

alter policy "saved_views_update" on public.saved_views
  using (is_account_member(account_id) and (user_id = (select auth.uid())))
  with check (is_account_member(account_id) and (user_id = (select auth.uid())));

alter policy "tasks_insert" on public.tasks
  with check (is_account_member(account_id, 'agent'::account_role_enum) and (created_by = (select auth.uid())));

alter policy "support_tickets_insert_own" on public.support_tickets
  with check (reported_by_user_id = (select auth.uid()));

alter policy "support_tickets_select" on public.support_tickets
  using (
    (reported_by_user_id = (select auth.uid()))
    or ((account_id is not null) and is_account_member(account_id))
    or is_platform_admin()
  );

alter policy "ai_action_log_insert" on public.ai_action_log
  with check (is_account_member(account_id) and (actor_user_id = (select auth.uid())));

-- ---------------------------------------------------------------
-- 1b) Composite index for the inbox's paginated message fetch
-- ---------------------------------------------------------------
--
-- The inbox used to load a conversation's ENTIRE history on every
-- open (verified live: one production conversation already has 1,431
-- messages). It now pages the latest 50 via
-- `.eq('conversation_id', x).order('created_at', {ascending:false}).limit(50)`
-- (see src/components/inbox/message-thread.tsx). The existing
-- `idx_messages_conversation` index (conversation_id only) still
-- means Postgres reads every row for that conversation before sorting
-- and truncating to 50. This composite index lets it walk the btree
-- in `created_at` order and stop after 50 rows instead.
create index if not exists idx_messages_conversation_created_at
  on public.messages (conversation_id, created_at);

-- ---------------------------------------------------------------
-- 2) Covering indexes for previously-unindexed foreign keys
-- ---------------------------------------------------------------

create index if not exists account_invitations_accepted_by_user_id_idx on public.account_invitations (accepted_by_user_id);
create index if not exists account_invitations_created_by_user_id_idx on public.account_invitations (created_by_user_id);
create index if not exists ai_action_log_actor_user_id_idx on public.ai_action_log (actor_user_id);
create index if not exists ai_configs_created_by_idx on public.ai_configs (created_by);
create index if not exists ai_configs_handoff_agent_id_idx on public.ai_configs (handoff_agent_id);
create index if not exists ai_followup_log_account_id_idx on public.ai_followup_log (account_id);
create index if not exists ai_followup_log_contact_id_idx on public.ai_followup_log (contact_id);
create index if not exists ai_followup_log_message_id_idx on public.ai_followup_log (message_id);
create index if not exists ai_knowledge_documents_created_by_idx on public.ai_knowledge_documents (created_by);
create index if not exists ai_usage_log_conversation_id_idx on public.ai_usage_log (conversation_id);
create index if not exists api_keys_created_by_idx on public.api_keys (created_by);
create index if not exists automation_logs_contact_id_idx on public.automation_logs (contact_id);
create index if not exists automation_pending_executions_automation_id_idx on public.automation_pending_executions (automation_id);
create index if not exists automation_pending_executions_contact_id_idx on public.automation_pending_executions (contact_id);
create index if not exists automation_pending_executions_log_id_idx on public.automation_pending_executions (log_id);
create index if not exists automation_pending_executions_parent_step_id_idx on public.automation_pending_executions (parent_step_id);
create index if not exists automation_pending_executions_user_id_idx on public.automation_pending_executions (user_id);
create index if not exists broadcast_recipients_contact_id_idx on public.broadcast_recipients (contact_id);
create index if not exists broadcasts_user_id_idx on public.broadcasts (user_id);
create index if not exists broadcasts_whatsapp_config_id_idx on public.broadcasts (whatsapp_config_id);
create index if not exists contact_custom_values_custom_field_id_idx on public.contact_custom_values (custom_field_id);
create index if not exists contact_notes_contact_id_idx on public.contact_notes (contact_id);
create index if not exists contact_notes_user_id_idx on public.contact_notes (user_id);
create index if not exists custom_fields_user_id_idx on public.custom_fields (user_id);
create index if not exists deals_contact_id_idx on public.deals (contact_id);
create index if not exists deals_conversation_id_idx on public.deals (conversation_id);
create index if not exists deals_user_id_idx on public.deals (user_id);
create index if not exists facebook_config_user_id_idx on public.facebook_config (user_id);
create index if not exists flow_runs_contact_id_idx on public.flow_runs (contact_id);
create index if not exists flow_runs_conversation_id_idx on public.flow_runs (conversation_id);
create index if not exists flow_runs_last_prompt_message_id_idx on public.flow_runs (last_prompt_message_id);
create index if not exists flow_runs_user_id_idx on public.flow_runs (user_id);
create index if not exists google_calendar_config_user_id_idx on public.google_calendar_config (user_id);
create index if not exists google_sheets_config_user_id_idx on public.google_sheets_config (user_id);
create index if not exists instagram_config_user_id_idx on public.instagram_config (user_id);
create index if not exists kpi_period_spend_created_by_idx on public.kpi_period_spend (created_by);
create index if not exists message_templates_user_id_idx on public.message_templates (user_id);
create index if not exists notifications_account_id_idx on public.notifications (account_id);
create index if not exists notifications_actor_user_id_idx on public.notifications (actor_user_id);
create index if not exists notifications_contact_id_idx on public.notifications (contact_id);
create index if not exists notifications_conversation_id_idx on public.notifications (conversation_id);
create index if not exists pipelines_user_id_idx on public.pipelines (user_id);
create index if not exists platform_company_invitations_account_id_idx on public.platform_company_invitations (account_id);
create index if not exists platform_company_invitations_invited_by_idx on public.platform_company_invitations (invited_by);
create index if not exists products_user_id_idx on public.products (user_id);
create index if not exists push_subscriptions_account_id_idx on public.push_subscriptions (account_id);
create index if not exists quick_replies_user_id_idx on public.quick_replies (user_id);
create index if not exists quote_items_account_id_idx on public.quote_items (account_id);
create index if not exists quote_items_product_id_idx on public.quote_items (product_id);
create index if not exists quote_items_product_price_option_id_idx on public.quote_items (product_price_option_id);
create index if not exists quotes_deal_id_idx on public.quotes (deal_id);
create index if not exists quotes_user_id_idx on public.quotes (user_id);
create index if not exists saved_views_user_id_idx on public.saved_views (user_id);
create index if not exists support_tickets_account_id_idx on public.support_tickets (account_id);
create index if not exists support_tickets_reported_by_user_id_idx on public.support_tickets (reported_by_user_id);
create index if not exists support_tickets_resolved_by_idx on public.support_tickets (resolved_by);
create index if not exists system_alerts_account_id_idx on public.system_alerts (account_id);
create index if not exists tags_user_id_idx on public.tags (user_id);
create index if not exists tasks_created_by_idx on public.tasks (created_by);
create index if not exists tasks_deal_id_idx on public.tasks (deal_id);
create index if not exists webhook_deliveries_account_id_idx on public.webhook_deliveries (account_id);
create index if not exists webhook_endpoints_created_by_idx on public.webhook_endpoints (created_by);
create index if not exists whatsapp_config_user_id_idx on public.whatsapp_config (user_id);
