"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Pipeline, PipelineStage, Deal } from "@/types";
import { DEAL_SELECT, normalizeDeals } from "@/lib/pipelines/deals";
import { colorForConversation, fetchAssignedAgentMap } from "@/lib/responder-color";
import {
  PipelineBoard,
  type DealPositionUpdate,
} from "@/components/pipelines/pipeline-board";
import { PipelineSettings } from "@/components/pipelines/pipeline-settings";
import { DealDetailDrawer } from "@/components/pipelines/deal-detail-drawer";
import { DeleteLeadDialog } from "@/components/contacts/delete-lead-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GitBranch, Plus, ChevronDown, Settings } from "lucide-react";
import { toast } from "sonner";
import { useCan } from "@/hooks/use-can";
import { useAuth } from "@/hooks/use-auth";
import { GatedButton } from "@/components/ui/gated-button";
import { useTranslations } from "next-intl";

// Pipeline creation is admin-class (settings-tier write under
// the new RLS); deal creation is operational and only requires
// agent+. The two CTAs gate on different `useCan` capabilities,
// not on different copy.

// Spec-defined seed — name and color per the product spec.
const SPEC_DEFAULT_STAGES = [
  { name: "New Lead", color: "#3b82f6", position: 0 }, // blue
  { name: "Qualified", color: "#eab308", position: 1 }, // yellow
  { name: "Proposal Sent", color: "#f97316", position: 2 }, // orange
  { name: "Negotiation", color: "#8b5cf6", position: 3 }, // purple
  { name: "Won", color: "#22c55e", position: 4 }, // green
];

export default function PipelinesPage() {
  const t = useTranslations("Pipelines.page");
  const supabase = createClient();
  const canEditSettings = useCan("edit-settings");
  const { accountId } = useAuth();

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);

  // `<main>` (dashboard-shell.tsx) is `overflow-y-auto` by default, needed
  // for pages taller than the viewport. This page instead wants each
  // column to own its own vertical scroll (so a long column doesn't just
  // grow the whole page — see the board wrapper below), so `<main>` has
  // nothing left to legitimately scroll while Pipeline is open. Same
  // opt-out technique already used by inbox/page.tsx: find `<main>` via
  // the root ref, hide its scroll for as long as this page is mounted,
  // restore on unmount — every other route is unaffected.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const main = rootRef.current?.closest("main");
    if (!main) return;
    const previousOverflow = main.style.overflowY;
    main.style.overflowY = "hidden";
    return () => {
      main.style.overflowY = previousOverflow;
    };
  }, []);

  // Dialog / sheet state
  const [newPipelineOpen, setNewPipelineOpen] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState("");
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Deal detail drawer — opened by clicking a card. Deals themselves are
  // no longer manually created (see "Entrada automática" in the product
  // spec: every new WhatsApp lead gets a card automatically), so there's
  // no separate "new deal" form state here anymore — DealForm is only
  // reachable as the drawer's "Editar" action.
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  // The clicked card's own bounding box — lets the detail panel open with
  // a FLIP animation that grows out of the card instead of a plain
  // centered fade/zoom. Null just falls back to that plain fade/zoom.
  const [dealOriginRect, setDealOriginRect] = useState<DOMRect | null>(null);

  // Delete-lead confirmation — a "lead" is the contact row, not the deal
  // (see AGENTS task); deleting it cascades to the conversation/messages/
  // tags/notes and clears (not deletes) this and any other deal linked to
  // the same contact. Shared with the Inbox's own entry point via
  // DeleteLeadDialog.
  const [deleteLeadTarget, setDeleteLeadTarget] = useState<{
    contactId: string;
    name: string;
  } | null>(null);

  // Guard against double-seeding (React StrictMode double-effect in dev).
  const seedAttempted = useRef(false);

  const loadPipelines = useCallback(async () => {
    const { data, error } = await supabase
      .from("pipelines")
      .select("*")
      .order("created_at");
    if (error) {
      console.error("Failed to load pipelines:", error.message);
      return [];
    }
    return data ?? [];
  }, [supabase]);

  const loadStages = useCallback(
    async (pipelineId: string) => {
      const { data } = await supabase
        .from("pipeline_stages")
        .select("*")
        .eq("pipeline_id", pipelineId)
        .order("position");
      return data ?? [];
    },
    [supabase],
  );

  const loadDeals = useCallback(
    async (pipelineId: string) => {
      // The "last internal responder" indicator bar needs, for every
      // deal, its conversation's persistently assigned agent — fetched
      // here as one extra aggregate query (not per-card) and merged in,
      // using the exact same `colorForConversation` the Inbox uses so a
      // lead's card shows the same color in both places (see AGENTS task).
      const [{ data }, { data: profiles }, assignedAgentMap] =
        await Promise.all([
          supabase
            .from("deals")
            .select(DEAL_SELECT)
            .eq("pipeline_id", pipelineId)
            .order("position", { ascending: true }),
          supabase.from("profiles").select("*"),
          fetchAssignedAgentMap(supabase).catch((error) => {
            console.error("Failed to load assigned agents:", error);
            return new Map<string, string>();
          }),
        ]);
      return normalizeDeals(data ?? []).map((deal) => ({
        ...deal,
        responder_color: colorForConversation(
          deal.conversation_id,
          assignedAgentMap,
          profiles ?? [],
        ),
      }));
    },
    [supabase],
  );

  const seedDefaultPipeline = useCallback(async (): Promise<Pipeline | null> => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return null;
    // pipelines.account_id is NOT NULL post-017 with no DB default.
    if (!accountId) return null;

    const { data: pipeline, error } = await supabase
      .from("pipelines")
      .insert({ user_id: user.id, account_id: accountId, name: "Sales Pipeline" })
      .select()
      .single();

    if (error || !pipeline) {
      console.error("Failed to seed pipeline:", error?.message);
      return null;
    }

    const stagesPayload = SPEC_DEFAULT_STAGES.map((s) => ({
      pipeline_id: pipeline.id,
      name: s.name,
      color: s.color,
      position: s.position,
    }));
    await supabase.from("pipeline_stages").insert(stagesPayload);

    return pipeline as Pipeline;
  }, [supabase, accountId]);

  // Initial load + seed-if-empty
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      let list = await loadPipelines();

      if (list.length === 0 && !seedAttempted.current) {
        seedAttempted.current = true;
        const seeded = await seedDefaultPipeline();
        if (seeded) list = await loadPipelines();
      }

      if (cancelled) return;
      setPipelines(list);
      if (list.length > 0) {
        setSelectedPipelineId((prev) =>
          prev && list.some((p) => p.id === prev) ? prev : list[0].id,
        );
      } else {
        setSelectedPipelineId("");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPipelines, seedDefaultPipeline]);

  // Load stages + deals whenever selected pipeline changes.
  // Clearing on no-selection is a legitimate sync with URL/prop
  // state; the load completion uses async setters inside promise
  // callbacks (not synchronous in the effect body).
  useEffect(() => {
    if (!selectedPipelineId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStages([]);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDeals([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const [s, d] = await Promise.all([
        loadStages(selectedPipelineId),
        loadDeals(selectedPipelineId),
      ]);
      if (cancelled) return;
      setStages(s);
      setDeals(d);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPipelineId, loadStages, loadDeals]);

  const refreshPipelines = useCallback(async () => {
    const list = await loadPipelines();
    setPipelines(list);
    if (list.length === 0) setSelectedPipelineId("");
    else if (!list.some((p) => p.id === selectedPipelineId))
      setSelectedPipelineId(list[0].id);
  }, [loadPipelines, selectedPipelineId]);

  const refreshStages = useCallback(async () => {
    if (!selectedPipelineId) return;
    setStages(await loadStages(selectedPipelineId));
  }, [loadStages, selectedPipelineId]);

  const refreshDeals = useCallback(async () => {
    if (!selectedPipelineId) return;
    setDeals(await loadDeals(selectedPipelineId));
  }, [loadDeals, selectedPipelineId]);

  const handleDealsReordered = useCallback(
    async (rows: DealPositionUpdate[]) => {
      // Optimistic update — the board already animated the drag live;
      // this just persists the final `stage_id`/`position` for whichever
      // deals actually moved (source + destination column).
      const patchById = new Map(rows.map((r) => [r.id, r]));
      setDeals((prev) =>
        prev.map((d) => {
          const patch = patchById.get(d.id);
          return patch ? { ...d, stage_id: patch.stage_id, position: patch.position } : d;
        }),
      );
      // Per-row UPDATE, not a batched upsert: `deals` has several other
      // NOT NULL columns (user_id/pipeline_id/title) plus an RLS INSERT
      // policy requiring `account_id` in the payload, and Postgres's
      // `ON CONFLICT DO UPDATE` validates that INSERT branch even though
      // every row here already exists and only ever updates. A plain
      // UPDATE has no insert branch to satisfy.
      const results = await Promise.all(
        rows.map((r) =>
          supabase
            .from("deals")
            .update({ stage_id: r.stage_id, position: r.position })
            .eq("id", r.id),
        ),
      );
      const error = results.find((r) => r.error)?.error;
      if (error) {
        toast.error(t("toastFailedMoveDeal"));
        refreshDeals();
      }
    },
    [supabase, refreshDeals, t],
  );

  const handleOpenDeal = useCallback((deal: Deal, originRect?: DOMRect) => {
    setSelectedDeal(deal);
    setDealOriginRect(originRect ?? null);
  }, []);

  const handleRequestDeleteDeal = useCallback(
    (deal: Deal) => {
      // A deal can outlive its contact (migration 004/057 SET NULL the
      // link on delete) — nothing left to delete as a "lead" then.
      if (!deal.contact_id) {
        toast.error(t("toastNoLeadToDelete"));
        return;
      }
      setDeleteLeadTarget({
        contactId: deal.contact_id,
        name: deal.contact?.name || deal.contact?.phone || deal.title,
      });
    },
    [t],
  );

  const handleLeadDeleted = useCallback(() => {
    setDeleteLeadTarget(null);
    // The deleted contact's deal(s) are gone too (contact_tags/contact_notes/
    // conversations CASCADE; the deal itself isn't a contacts-cascade target,
    // but with contact_id now null it no longer belongs on this board as a
    // "lead" card) — simplest correct state is a full refetch.
    refreshDeals();
    if (selectedDeal?.contact_id === deleteLeadTarget?.contactId) {
      setSelectedDeal(null);
    }
  }, [refreshDeals, selectedDeal, deleteLeadTarget]);

  async function handleCreatePipeline() {
    const name = newPipelineName.trim();
    if (!name) return;
    setCreating(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      setCreating(false);
      return;
    }
    // pipelines.account_id is NOT NULL post-017 with no DB default.
    if (!accountId) {
      toast.error(t("toastNotLinkedToAccount"));
      setCreating(false);
      return;
    }

    const { data: pipeline, error } = await supabase
      .from("pipelines")
      .insert({ user_id: user.id, account_id: accountId, name })
      .select()
      .single();

    if (error || !pipeline) {
      toast.error(t("toastFailedCreatePipeline"));
      setCreating(false);
      return;
    }

    const stagesPayload = SPEC_DEFAULT_STAGES.map((s) => ({
      pipeline_id: pipeline.id,
      name: s.name,
      color: s.color,
      position: s.position,
    }));
    await supabase.from("pipeline_stages").insert(stagesPayload);

    setNewPipelineName("");
    setNewPipelineOpen(false);
    setSelectedPipelineId(pipeline.id);
    await refreshPipelines();
    setCreating(false);
    toast.success(t("toastPipelineCreated"));
  }

  const selectedPipeline = pipelines.find((p) => p.id === selectedPipelineId);

  if (loading) {
    return (
      <div ref={rootRef} className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-8 w-48 animate-pulse rounded bg-muted" />
          <div className="h-9 w-28 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="flex gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-96 w-72 animate-pulse rounded-xl bg-muted/50" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Pipeline selector dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors data-[popup-open]:bg-muted"
            >
              <GitBranch className="h-4 w-4 text-primary" />
              <span className="font-semibold">
                {selectedPipeline?.name ?? t("selectPipeline")}
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-64 border-border bg-popover text-popover-foreground"
            >
              {pipelines.length === 0 && (
                <DropdownMenuItem disabled className="text-muted-foreground">
                  {t("noPipelinesYet")}
                </DropdownMenuItem>
              )}
              {pipelines.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  onClick={() => setSelectedPipelineId(p.id)}
                  className={
                    p.id === selectedPipelineId
                      ? "text-primary"
                      : "text-popover-foreground"
                  }
                >
                  <GitBranch className="mr-2 h-3.5 w-3.5" />
                  {p.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator className="bg-border" />
              {selectedPipeline && (
                <DropdownMenuItem
                  onClick={() => setSettingsOpen(true)}
                  className="text-popover-foreground"
                >
                  <Settings className="mr-2 h-3.5 w-3.5" />
                  {t("managePipelines")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-2">
          <GatedButton
            variant="outline"
            canAct={canEditSettings}
            gateReason="criar pipelines"
            onClick={() => setNewPipelineOpen(true)}
            className="border-border bg-card text-foreground hover:bg-muted"
          >
            <Plus className="mr-1 h-4 w-4" />
            {t("addPipeline")}
          </GatedButton>
        </div>
      </div>

      {/* Board — bounded to the remaining page height so each column can
          own its own vertical scroll instead of the whole page growing
          (see the `<main>` opt-out above). */}
      <div className="min-h-0 flex-1 overflow-hidden">
      {pipelines.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20">
          <GitBranch className="h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-medium text-foreground">
            {t("noPipelinesYet")}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("createToStartTracking")}
          </p>
          <GatedButton
            canAct={canEditSettings}
            gateReason="criar pipelines"
            onClick={() => setNewPipelineOpen(true)}
            className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" />
            {t("createPipeline")}
          </GatedButton>
        </div>
      ) : (
        <PipelineBoard
          stages={stages}
          deals={deals}
          onDealsReordered={handleDealsReordered}
          onEditDeal={handleOpenDeal}
          onRequestDeleteDeal={handleRequestDeleteDeal}
        />
      )}
      </div>

      <DeleteLeadDialog
        open={!!deleteLeadTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteLeadTarget(null);
        }}
        contactId={deleteLeadTarget?.contactId ?? null}
        contactName={deleteLeadTarget?.name ?? ""}
        onDeleted={handleLeadDeleted}
      />

      {/* New Pipeline Dialog */}
      <Dialog open={newPipelineOpen} onOpenChange={setNewPipelineOpen}>
        <DialogContent className="sm:max-w-sm bg-popover border-border">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t("newPipeline")}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label className="text-muted-foreground">{t("pipelineName")}</Label>
            <Input
              value={newPipelineName}
              onChange={(e) => setNewPipelineName(e.target.value)}
              placeholder={t("pipelineNamePlaceholder")}
              className="mt-2 bg-muted border-border text-foreground"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreatePipeline();
              }}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              {t("defaultStagesDesc")}
            </p>
          </div>
          <DialogFooter className="bg-popover/50 border-border">
            <Button
              variant="outline"
              onClick={() => setNewPipelineOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t("cancel")}
            </Button>
            <Button
              onClick={handleCreatePipeline}
              disabled={creating || !newPipelineName.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {creating ? t("creating") : t("createPipelineBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pipeline Settings */}
      {selectedPipeline && (
        <PipelineSettings
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          pipeline={selectedPipeline}
          stages={stages}
          onPipelinesChanged={refreshPipelines}
          onStagesChanged={refreshStages}
          onCreateNewPipeline={() => {
            setSettingsOpen(false);
            setNewPipelineOpen(true);
          }}
        />
      )}

      {/* Deal detail drawer — opened by clicking a card. Owns the
          hand-off to DealForm (edit) internally. */}
      <DealDetailDrawer
        deal={selectedDeal}
        stage={stages.find((s) => s.id === selectedDeal?.stage_id) ?? null}
        pipelineId={selectedPipelineId}
        stages={stages}
        originRect={dealOriginRect}
        onClose={() => setSelectedDeal(null)}
        onChanged={refreshDeals}
      />
    </div>
  );
}
