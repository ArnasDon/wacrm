import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionItem, ActionItemEventType, ActionItemType } from "@/types";
import { getCurrentWeekEndKey } from "./date-utils";
import { FOLLOWUP_STAGE_NAME } from "./constants";

export const ACTION_ITEM_SELECT =
  "*, contact:contacts(*), deal:deals(*, stage:pipeline_stages(*))";

async function logEvent(
  db: SupabaseClient,
  args: {
    actionItemId: string;
    accountId: string;
    type: ActionItemEventType;
    payload?: Record<string, unknown>;
    createdBy?: string | null;
  },
) {
  await db.from("action_item_events").insert({
    action_item_id: args.actionItemId,
    account_id: args.accountId,
    type: args.type,
    payload: args.payload ?? {},
    created_by: args.createdBy ?? null,
  });
}

/** Interesses — a plain manual queue, independent of the lead's
 *  current pipeline stage. Oldest pending first (FIFO), so nothing
 *  waits forever (AGENTS.md §14 — no priority field exists to sort by). */
export async function listInterestActionItems(
  db: SupabaseClient,
  accountId: string,
): Promise<ActionItem[]> {
  const { data, error } = await db
    .from("action_items")
    .select(ACTION_ITEM_SELECT)
    .eq("account_id", accountId)
    .eq("type", "interest")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as ActionItem[];
}

/** The account's "Follow-up" pipeline stage id, if one exists. */
export async function resolveFollowupStageId(
  db: SupabaseClient,
  accountId: string,
): Promise<string | null> {
  const { data: pipelines } = await db
    .from("pipelines")
    .select("id")
    .eq("account_id", accountId);
  const pipelineIds = (pipelines ?? []).map((p) => p.id as string);
  if (pipelineIds.length === 0) return null;

  const { data: stage } = await db
    .from("pipeline_stages")
    .select("id, name")
    .in("pipeline_id", pipelineIds)
    .ilike("name", FOLLOWUP_STAGE_NAME)
    .limit(1)
    .maybeSingle();
  return (stage?.id as string) ?? null;
}

/** Follow-ups da Semana — pending items due today, overdue (any age),
 *  or later this week, AND whose lead is still sitting in the
 *  account's "Follow-up" pipeline stage right now (AGENTS.md §29: a
 *  lead dragged out of that stage on the Kanban board must stop
 *  appearing here with no extra wiring on the Pipeline side). Filtered
 *  client-side against the live stage id rather than a PostgREST
 *  nested-embed filter, so this stays correct regardless of
 *  embedding-filter edge cases. */
export async function listWeekFollowupActionItems(
  db: SupabaseClient,
  accountId: string,
): Promise<ActionItem[]> {
  const stageId = await resolveFollowupStageId(db, accountId);
  if (!stageId) return [];

  const weekEndKey = getCurrentWeekEndKey();
  const { data, error } = await db
    .from("action_items")
    .select(ACTION_ITEM_SELECT)
    .eq("account_id", accountId)
    .eq("type", "followup")
    .eq("status", "pending")
    .lte("due_date", weekEndKey)
    .order("due_date", { ascending: true });
  if (error) throw error;

  return ((data ?? []) as unknown as ActionItem[]).filter(
    (item) => item.deal?.stage_id === stageId,
  );
}

/** The most recent active (pending) action item of a given type for a
 *  contact — used for the duplicate-prevention flow (§10). */
export async function findActivePendingActionItem(
  db: SupabaseClient,
  contactId: string,
  type: ActionItemType,
): Promise<ActionItem | null> {
  const { data, error } = await db
    .from("action_items")
    .select(ACTION_ITEM_SELECT)
    .eq("contact_id", contactId)
    .eq("type", type)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as ActionItem) ?? null;
}

export interface CreateActionItemInput {
  account_id: string;
  contact_id: string;
  deal_id?: string | null;
  conversation_id?: string | null;
  type: ActionItemType;
  title: string;
  description?: string | null;
  due_date?: string | null;
  due_time?: string | null;
  source_suggestion_id?: string | null;
  created_by?: string | null;
}

export async function createActionItem(
  db: SupabaseClient,
  input: CreateActionItemInput,
): Promise<ActionItem> {
  const { data, error } = await db
    .from("action_items")
    .insert({
      account_id: input.account_id,
      contact_id: input.contact_id,
      deal_id: input.deal_id ?? null,
      conversation_id: input.conversation_id ?? null,
      type: input.type,
      title: input.title,
      description: input.description || null,
      due_date: input.due_date ?? null,
      due_time: input.due_time ?? null,
      source_suggestion_id: input.source_suggestion_id ?? null,
      created_by: input.created_by ?? null,
    })
    .select(ACTION_ITEM_SELECT)
    .single();
  if (error) throw error;

  await logEvent(db, {
    actionItemId: data.id,
    accountId: input.account_id,
    type: "created",
    createdBy: input.created_by,
  });

  return data as unknown as ActionItem;
}

export interface EditActionItemInput {
  title: string;
  description?: string | null;
  due_date?: string | null;
  due_time?: string | null;
}

export async function editActionItem(
  db: SupabaseClient,
  item: ActionItem,
  patch: EditActionItemInput,
  editedBy?: string | null,
): Promise<void> {
  const { error } = await db
    .from("action_items")
    .update({
      title: patch.title,
      description: patch.description || null,
      due_date: patch.due_date ?? item.due_date ?? null,
      due_time: patch.due_time ?? item.due_time ?? null,
    })
    .eq("id", item.id);
  if (error) throw error;

  await logEvent(db, {
    actionItemId: item.id,
    accountId: item.account_id,
    type: "context_changed",
    createdBy: editedBy,
    payload: { title: patch.title, description: patch.description ?? null },
  });
}

/** Interesse "Marcar como feito" — never touches the Pipeline stage
 *  (AGENTS.md §21: "NÃO deve alterar automaticamente o estágio da
 *  Pipeline"). */
export async function completeInterest(
  db: SupabaseClient,
  item: ActionItem,
  resolvedBy: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db
    .from("action_items")
    .update({ status: "completed", resolved_by: resolvedBy, resolved_at: now })
    .eq("id", item.id);
  if (error) throw error;

  await logEvent(db, {
    actionItemId: item.id,
    accountId: item.account_id,
    type: "completed",
    createdBy: resolvedBy,
  });
}

/** Follow-up "Continuar acompanhamento" / reagendar — keeps status
 *  pending, only ever the next contact date changes (§22). */
export async function rescheduleFollowup(
  db: SupabaseClient,
  item: ActionItem,
  newDueDate: string,
  newDueTime: string,
  note: string | null,
  actedBy: string | null,
): Promise<void> {
  const { error } = await db
    .from("action_items")
    .update({ due_date: newDueDate, due_time: newDueTime })
    .eq("id", item.id);
  if (error) throw error;

  await logEvent(db, {
    actionItemId: item.id,
    accountId: item.account_id,
    type: "rescheduled",
    createdBy: actedBy,
    payload: {
      from_due_date: item.due_date,
      from_due_time: item.due_time,
      to_due_date: newDueDate,
      to_due_time: newDueTime,
      note,
    },
  });
}

export type FollowupOutcome =
  | "advanced"
  | "no_response"
  | "not_interested"
  | "ended"
  | "other";

/** Follow-up "Marcar como feito" → terminal outcome — closes the item
 *  (§21/§23). "Continuar acompanhamento" does NOT go through here; it
 *  calls {@link rescheduleFollowup} instead and stays pending. */
export async function recordFollowupOutcome(
  db: SupabaseClient,
  item: ActionItem,
  outcome: FollowupOutcome,
  note: string | null,
  resolvedBy: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db
    .from("action_items")
    .update({ status: "completed", resolved_by: resolvedBy, resolved_at: now })
    .eq("id", item.id);
  if (error) throw error;

  await logEvent(db, {
    actionItemId: item.id,
    accountId: item.account_id,
    type: "outcome_recorded",
    createdBy: resolvedBy,
    payload: { outcome, note },
  });
}

export async function listActionItemEvents(db: SupabaseClient, actionItemId: string) {
  const { data, error } = await db
    .from("action_item_events")
    .select("*")
    .eq("action_item_id", actionItemId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
