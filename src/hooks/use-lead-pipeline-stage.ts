"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Deal, PipelineStage } from "@/types";

/**
 * Shared by the inbox header's "⋮ → Mover para" submenu
 * (message-thread.tsx) and the contact sidebar's "Etapa da Pipeline" card
 * (contact-sidebar.tsx) — both call the same fetch + `deals.stage_id`
 * update (the same one the Kanban board at pipelines/page.tsx already
 * uses), and broadcast a window event on change so a move made from
 * either entry point updates the other without a page refresh.
 */
const DEAL_STAGE_EVENT = "wacrm:deal-stage-changed";

export function useLeadPipelineStage(contactId: string | null | undefined) {
  const [deal, setDeal] = useState<Deal | null>(null);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchStage = useCallback(async () => {
    if (!contactId) {
      setDeal(null);
      setStages([]);
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { data: deals } = await supabase
      .from("deals")
      .select("*, stage:pipeline_stages(*)")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(1);

    const current = ((deals as Deal[] | null)?.[0] as Deal | undefined) ?? null;
    setDeal(current);

    if (current?.pipeline_id) {
      const { data: pipelineStages } = await supabase
        .from("pipeline_stages")
        .select("*")
        .eq("pipeline_id", current.pipeline_id)
        .order("position");
      setStages((pipelineStages as PipelineStage[] | null) ?? []);
    } else {
      setStages([]);
    }
    setLoading(false);
  }, [contactId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchStage();
  }, [fetchStage]);

  // Cross-component sync: the other entry point (header menu vs. sidebar
  // card) may have moved the deal to a different stage; refetch so this
  // instance's displayed stage stays correct.
  useEffect(() => {
    function handleExternalChange(e: Event) {
      const detail = (e as CustomEvent<{ contactId: string }>).detail;
      if (detail?.contactId && detail.contactId === contactId) {
        fetchStage();
      }
    }
    window.addEventListener(DEAL_STAGE_EVENT, handleExternalChange);
    return () => window.removeEventListener(DEAL_STAGE_EVENT, handleExternalChange);
  }, [contactId, fetchStage]);

  const moveToStage = useCallback(
    async (stageId: string) => {
      if (!deal) return { error: new Error("No deal to move") };

      const supabase = createClient();
      const { error } = await supabase
        .from("deals")
        .update({ stage_id: stageId })
        .eq("id", deal.id);

      if (!error) {
        setDeal((prev) =>
          prev
            ? {
                ...prev,
                stage_id: stageId,
                stage: stages.find((s) => s.id === stageId) ?? prev.stage,
              }
            : prev,
        );
        if (contactId) {
          window.dispatchEvent(
            new CustomEvent(DEAL_STAGE_EVENT, { detail: { contactId } }),
          );
        }
      }

      return { error };
    },
    [deal, stages, contactId],
  );

  return { deal, stages, loading, moveToStage };
}
