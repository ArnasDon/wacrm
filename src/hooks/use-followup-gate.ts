"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  createActionItem,
  editActionItem,
  findActivePendingActionItem,
} from "@/lib/action-items/queries";
import { FOLLOWUP_STAGE_NAME } from "@/lib/action-items/constants";
import type { Deal, PipelineStage } from "@/types";

interface PendingMove {
  deal: Deal;
  performMove: () => Promise<void> | void;
}

interface GuardMoveArgs {
  /** The deal being moved — must carry its current stage_id/contact_id. */
  deal: Deal;
  /** All stages of the deal's pipeline, to resolve the target stage's name. */
  stages: PipelineStage[];
  targetStageId: string;
  /** The actual `deals.stage_id` write (and anything else the caller
   *  needs to do alongside it, e.g. DealForm saving every other field
   *  too) — only ever invoked once the Follow-up requirements (when
   *  applicable) are satisfied and saved. */
  performMove: () => Promise<void> | void;
}

/**
 * Global gate for "this deal is about to enter the Follow-up stage" —
 * AGENTS task: motivo + prazo (data e hora) are mandatory no matter
 * which UI surface initiates the move (Pipeline drag, Inbox "Mover
 * para", contact sidebar, deal edit form's Etapa select). One shared
 * hook + dialog, mounted locally wherever a stage move can happen
 * (same pattern already used for e.g. ArchiveDealDialog) — not
 * reimplemented per screen.
 *
 * `guardMove` is a drop-in wrapper around any existing stage-move
 * action: if the target stage isn't "Follow-up", or the deal is
 * already there, it just runs `performMove()` immediately — zero
 * behavior change for every other move. Only a genuine transition
 * INTO Follow-up opens the dialog; `performMove` (the real
 * `deals.stage_id` write) only ever runs after the follow-up's
 * motivo/prazo have been saved to `action_items` (reusing the exact
 * same create/edit functions the Central de Ações "Adicionar" flow
 * already uses), so cancelling leaves the deal exactly where it was.
 */
export function useFollowupGate() {
  const { accountId, user } = useAuth();
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [saving, setSaving] = useState(false);

  const guardMove = useCallback((args: GuardMoveArgs) => {
    if (args.deal.stage_id === args.targetStageId) {
      void args.performMove();
      return;
    }
    const targetStage = args.stages.find((s) => s.id === args.targetStageId);
    const isFollowup =
      !!targetStage &&
      targetStage.name.trim().toLowerCase() === FOLLOWUP_STAGE_NAME.toLowerCase();
    if (!isFollowup) {
      void args.performMove();
      return;
    }
    if (!args.deal.contact_id) {
      toast.error("Este negócio não tem um lead vinculado para registrar o follow-up.");
      return;
    }
    setPending({ deal: args.deal, performMove: args.performMove });
  }, []);

  const cancel = useCallback(() => {
    if (saving) return;
    setPending(null);
  }, [saving]);

  const confirm = useCallback(
    async (title: string, dueDate: string, dueTime: string) => {
      if (!pending || !accountId) return;
      const contactId = pending.deal.contact_id;
      if (!contactId) return;

      setSaving(true);
      try {
        const db = createClient();
        const existing = await findActivePendingActionItem(db, contactId, "followup");
        if (existing) {
          await editActionItem(
            db,
            existing,
            { title, description: existing.description, due_date: dueDate, due_time: dueTime },
            user?.id ?? null,
          );
        } else {
          await createActionItem(db, {
            account_id: accountId,
            contact_id: contactId,
            deal_id: pending.deal.id,
            conversation_id: pending.deal.conversation_id ?? null,
            type: "followup",
            title,
            due_date: dueDate,
            due_time: dueTime,
            created_by: user?.id ?? null,
          });
        }
        await pending.performMove();
        setPending(null);
      } catch (err) {
        console.error("[followup-gate] failed to save follow-up:", err);
        toast.error("Não foi possível salvar o follow-up. O lead não foi movido.");
      } finally {
        setSaving(false);
      }
    },
    [pending, accountId, user?.id],
  );

  const contact = pending?.deal.contact;
  const contactName = contact?.name || contact?.phone || pending?.deal.title || "";

  // Memoized: without this, every consumer (Pipeline page, Inbox
  // message thread, deal form, contact sidebar) gets a brand-new
  // object reference from this hook on every render of the component
  // that calls it — even when nothing here actually changed. That
  // breaks referential-stability of anything derived from this return
  // value (e.g. a `useCallback([...followupGate])` elsewhere), which
  // in turn defeats React.memo on components further down relying on
  // that callback staying stable (see PipelineBoard).
  return useMemo(
    () => ({
      open: !!pending,
      saving,
      contactName,
      guardMove,
      cancel,
      confirm,
    }),
    [pending, saving, contactName, guardMove, cancel, confirm],
  );
}

export type FollowupGate = ReturnType<typeof useFollowupGate>;
