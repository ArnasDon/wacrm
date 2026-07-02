"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ContactJourney, FunnelStage } from "@/types";
import { ensureFunnelStages } from "@/lib/journey/funnel-stages";
import { KanbanBoard } from "@/components/kanban/kanban-board";
import { LeadDetailSheet } from "@/components/kanban/lead-detail-sheet";
import { AddLeadForm } from "@/components/kanban/add-lead-form";
import { GatedButton } from "@/components/ui/gated-button";
import { Filter, Plus } from "lucide-react";
import { toast } from "sonner";
import { useCan } from "@/hooks/use-can";
import { useAuth } from "@/hooks/use-auth";
import { useTranslations } from "next-intl";

export default function KanbanPage() {
  const t = useTranslations("kanban");
  const supabase = createClient();
  const canAddLead = useCan("send-messages");
  const { accountId } = useAuth();

  const [stages, setStages] = useState<FunnelStage[]>([]);
  const [journeys, setJourneys] = useState<ContactJourney[]>([]);
  const [loading, setLoading] = useState(true);

  const [addLeadOpen, setAddLeadOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedJourney, setSelectedJourney] = useState<ContactJourney | null>(null);

  // Guard against double-seeding (React StrictMode double-effect in dev).
  const seedAttempted = useRef(false);

  const loadStages = useCallback(async (): Promise<FunnelStage[]> => {
    if (!accountId) return [];
    const rows = await ensureFunnelStages(supabase, accountId);
    return rows as FunnelStage[];
  }, [supabase, accountId]);

  // Journeys + their contact/stage, plus each contact's conversation
  // preview attached in JS (see ContactJourney.conversation — no DB
  // join because conversations.contact_id has no unique constraint).
  const loadJourneys = useCallback(async (): Promise<ContactJourney[]> => {
    if (!accountId) return [];
    const { data: journeyRows, error } = await supabase
      .from("contact_journey")
      .select("*, contact:contacts(*), stage:funnel_stages(*)")
      .eq("account_id", accountId)
      .order("entered_stage_at", { ascending: false });
    if (error) {
      console.error("Failed to load journeys:", error.message);
      return [];
    }
    const rows = (journeyRows ?? []) as ContactJourney[];
    if (rows.length === 0) return rows;

    const contactIds = rows.map((r) => r.contact_id);
    const { data: conversations } = await supabase
      .from("conversations")
      .select("id, contact_id, last_message_text, last_message_at")
      .in("contact_id", contactIds);

    const convByContact = new Map(
      (conversations ?? []).map((c) => [c.contact_id, c]),
    );
    return rows.map((r) => ({
      ...r,
      conversation: convByContact.get(r.contact_id),
    }));
  }, [supabase, accountId]);

  // Initial load + seed-if-empty
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      let stageList = await loadStages();

      if (stageList.length === 0 && !seedAttempted.current) {
        seedAttempted.current = true;
        stageList = await loadStages();
      }

      const journeyList = await loadJourneys();
      if (cancelled) return;
      setStages(stageList);
      setJourneys(journeyList);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, loadStages, loadJourneys]);

  const refreshJourneys = useCallback(async () => {
    setJourneys(await loadJourneys());
  }, [loadJourneys]);

  const createDealForJourney = useCallback(
    async (journey: ContactJourney) => {
      if (!accountId) return;
      const { data: pipeline } = await supabase
        .from("pipelines")
        .select("id")
        .eq("account_id", accountId)
        .order("created_at")
        .limit(1)
        .maybeSingle();
      if (!pipeline) {
        toast.error(t("page.toast.noPipelineFound"));
        return;
      }
      const { data: firstStage } = await supabase
        .from("pipeline_stages")
        .select("id")
        .eq("pipeline_id", pipeline.id)
        .order("position")
        .limit(1)
        .maybeSingle();
      if (!firstStage) {
        toast.error(t("page.toast.pipelineNoStages"));
        return;
      }
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return;

      const contactLabel =
        journey.contact?.name || journey.contact?.phone || t("page.leadFallbackLabel");
      const { error } = await supabase.from("deals").insert({
        user_id: user.id,
        account_id: accountId,
        pipeline_id: pipeline.id,
        stage_id: firstStage.id,
        contact_id: journey.contact_id,
        title: t("page.dealTitle", { name: contactLabel }),
        value: 0,
      });
      if (error) {
        toast.error(t("page.toast.dealCreateFailed"));
        return;
      }
      toast.success(t("page.toast.dealCreated"));
    },
    [supabase, accountId, t],
  );

  const handleJourneyMoved = useCallback(
    async (journeyId: string, newStageId: string) => {
      const journey = journeys.find((j) => j.id === journeyId);
      if (!journey || journey.stage_id === newStageId) return;

      // Optimistic update — board already animated; just persist.
      setJourneys((prev) =>
        prev.map((j) =>
          j.id === journeyId
            ? { ...j, stage_id: newStageId, entered_stage_at: new Date().toISOString() }
            : j,
        ),
      );
      setSelectedJourney((prev) =>
        prev && prev.id === journeyId ? { ...prev, stage_id: newStageId } : prev,
      );

      const { error } = await supabase
        .from("contact_journey")
        .update({ stage_id: newStageId, entered_stage_at: new Date().toISOString() })
        .eq("id", journeyId);

      if (error) {
        toast.error(t("page.toast.moveFailed"));
        refreshJourneys();
        return;
      }

      await supabase.from("contact_journey_transitions").insert({
        contact_journey_id: journeyId,
        account_id: journey.account_id,
        from_stage_id: journey.stage_id,
        to_stage_id: newStageId,
      });

      // Convenience bridge to the Pipeline board: entering "Negotiating"
      // is usually the point a real opportunity exists. Not required or
      // kept in sync afterwards — just a one-time offer to save a
      // context switch.
      const targetStage = stages.find((s) => s.id === newStageId);
      if (targetStage?.key === "negotiating") {
        toast(t("page.toast.negotiatingTitle"), {
          description: t("page.toast.negotiatingDescription"),
          action: {
            label: t("page.toast.createDealAction"),
            onClick: () => createDealForJourney(journey),
          },
        });
      }
    },
    [supabase, journeys, stages, refreshJourneys, createDealForJourney, t],
  );

  const handleOpenJourney = useCallback((journey: ContactJourney) => {
    setSelectedJourney(journey);
    setDetailOpen(true);
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-8 w-48 animate-pulse rounded bg-muted" />
          <div className="h-9 w-28 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="flex gap-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-96 w-72 animate-pulse rounded-xl bg-muted/50" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-primary" />
          <h1 className="text-lg font-semibold text-foreground">{t("page.title")}</h1>
          <span className="text-sm text-muted-foreground">
            {t("page.subtitle")}
          </span>
        </div>

        <GatedButton
          canAct={canAddLead}
          gateReason="add leads"
          onClick={() => setAddLeadOpen(true)}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="mr-1 h-4 w-4" />
          {t("addLead")}
        </GatedButton>
      </div>

      {/* Board */}
      <KanbanBoard
        stages={stages}
        journeys={journeys}
        onJourneyMoved={handleJourneyMoved}
        onOpenJourney={handleOpenJourney}
      />

      <LeadDetailSheet
        open={detailOpen}
        onOpenChange={setDetailOpen}
        journey={selectedJourney}
        stages={stages}
        onMoved={handleJourneyMoved}
      />

      <AddLeadForm
        open={addLeadOpen}
        onOpenChange={setAddLeadOpen}
        stages={stages}
        existingContactIds={new Set(journeys.map((j) => j.contact_id))}
        onCreated={refreshJourneys}
      />
    </div>
  );
}
