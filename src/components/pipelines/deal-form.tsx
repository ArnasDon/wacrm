"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type {
  Contact,
  Conversation,
  Deal,
  DealStatus,
  Pipeline,
  PipelineStage,
  Profile,
} from "@/types";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Check,
  X,
  Trash2,
  MessageSquare,
  Loader2,
  FileText,
  History,
  Sparkles,
  CheckCircle2,
  XCircle,
  PlusCircle,
  Clock,
  Send,
  MessageCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { validateDealStageRequirements } from "@/lib/pipelines/validation";
import { CURRENCIES } from "@/lib/currency";

interface DealFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal?: Deal | null;
  pipelineId: string;
  pipelines?: Pipeline[];
  stages: PipelineStage[];
  defaultStageId?: string;
  /** Pre-select a contact when opening the form to create a deal from inbox. */
  initialContactId?: string;
  /** Pre-fill the deal title with the contact's name. */
  initialContactName?: string;
  /** Pre-link a conversation when opening the form from inbox. */
  initialConversationId?: string;
  onSaved: () => void;
}

interface DealMeta {
  temperature?: string;
  leadType?: string;
  lastPurchaseDate?: string;
  source?: string;
  product?: string;
  userNotes?: string;
}

interface TimelineEvent {
  id: string;
  type:
    | "deal_created"
    | "status_won"
    | "status_lost"
    | "message_inbound"
    | "message_outbound"
    | "note";
  title: string;
  description?: string;
  timestamp: string;
}

export function DealForm({
  open,
  onOpenChange,
  deal,
  pipelineId,
  pipelines = [],
  stages: initialStages,
  defaultStageId,
  initialContactId,
  initialContactName,
  initialConversationId,
  onSaved,
}: DealFormProps) {
  const t = useTranslations("Pipelines.form");
  const supabase = createClient();
  const { accountId, defaultCurrency } = useAuth();

  // Top navigation tabs inside drawer
  const [activeTab, setActiveTab] = useState<"details" | "history">("details");

  // Basic deal fields
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [contactId, setContactId] = useState("");
  const [currentPipelineId, setCurrentPipelineId] = useState(pipelineId);
  const [stageId, setStageId] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");

  // Print-specific enhanced metadata fields
  const [temperature, setTemperature] = useState("Frio");
  const [leadType, setLeadType] = useState("Lead");
  const [lastPurchaseDate, setLastPurchaseDate] = useState("");
  const [source, setSource] = useState("—");
  const [product, setProduct] = useState("");
  const [userNotes, setUserNotes] = useState("");

  // Timeline / History state
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [loadingTimeline, setLoadingTimeline] = useState(false);
  const [customNote, setCustomNote] = useState("");

  // Auxiliary state
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [allPipelines, setAllPipelines] = useState<Pipeline[]>(pipelines);
  const [availableStages, setAvailableStages] = useState<PipelineStage[]>(initialStages);
  const [linkedConversation, setLinkedConversation] = useState<Conversation | null>(null);

  const [saving, setSaving] = useState(false);
  const [statusAction, setStatusAction] = useState<DealStatus | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Sync state when sheet opens or deal changes
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    setActiveTab("details");
    setCurrentPipelineId(deal?.pipeline_id || pipelineId);

    if (deal) {
      setTitle(deal.title);
      setValue(String(deal.value ?? ""));
      setCurrency(deal.currency || defaultCurrency);
      setContactId(deal.contact_id ?? "");
      setStageId(deal.stage_id);
      setAssignedTo(deal.assigned_to ?? "");
      setExpectedCloseDate(deal.expected_close_date ?? "");

      // Parse metadata from notes if available
      let parsedMeta: DealMeta = {
        temperature: "Frio",
        leadType: "Lead",
        lastPurchaseDate: "",
        source: "—",
        product: "",
        userNotes: deal.notes ?? "",
      };

      if (deal.notes && deal.notes.trim().startsWith("{")) {
        try {
          const json = JSON.parse(deal.notes);
          if (json && typeof json === "object" && !Array.isArray(json)) {
            parsedMeta = {
              temperature: json.temperature || "Frio",
              leadType: json.leadType || "Lead",
              lastPurchaseDate: json.lastPurchaseDate || "",
              source: json.source || "—",
              product: json.product || "",
              userNotes: json.userNotes !== undefined ? json.userNotes : "",
            };
          }
        } catch {
          /* use fallback text notes */
        }
      }

      setTemperature(parsedMeta.temperature || "Frio");
      setLeadType(parsedMeta.leadType || "Lead");
      setLastPurchaseDate(parsedMeta.lastPurchaseDate || "");
      setSource(parsedMeta.source || "—");
      setProduct(parsedMeta.product || "");
      setUserNotes(parsedMeta.userNotes || (deal.notes?.startsWith("{") ? "" : deal.notes) || "");
    } else {
      // Pre-fill title with the contact's name when opening from the inbox
      setTitle(initialContactName ?? "");
      setValue("");
      setCurrency(defaultCurrency);
      setContactId(initialContactId ?? "");
      setStageId(defaultStageId || initialStages[0]?.id || "");
      setAssignedTo("");
      setExpectedCloseDate("");

      setTemperature("Frio");
      setLeadType("Lead");
      setLastPurchaseDate("");
      setSource("—");
      setProduct("");
      setUserNotes("");
    }
  }, [open, deal, pipelineId, defaultStageId, initialStages, defaultCurrency, initialContactId, initialContactName]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Load contacts and profiles
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const [cRes, pRes, pipeRes] = await Promise.all([
        supabase.from("contacts").select("*").order("name"),
        supabase.from("profiles").select("*").order("full_name"),
        supabase.from("pipelines").select("*").order("created_at"),
      ]);
      if (cancelled) return;
      setContacts((cRes.data ?? []) as Contact[]);
      setProfiles((pRes.data ?? []) as Profile[]);
      if (pipeRes.data && pipeRes.data.length > 0) {
        setAllPipelines(pipeRes.data as Pipeline[]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, supabase]);

  // Load stages when selected pipeline changes
  useEffect(() => {
    if (!open || !currentPipelineId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("pipeline_stages")
        .select("*")
        .eq("pipeline_id", currentPipelineId)
        .order("position");
      if (cancelled) return;
      const loaded = (data ?? []) as PipelineStage[];
      setAvailableStages(loaded);
      // Ensure selected stageId belongs to loaded stages
      if (loaded.length > 0 && !loaded.some((s) => s.id === stageId)) {
        setStageId(loaded[0].id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, currentPipelineId, supabase, stageId]);

  // Load linked conversation for contact + subscribe to realtime updates
  useEffect(() => {
    if (!open || !contactId) {
      /* eslint-disable-next-line react-hooks/set-state-in-effect */
      setLinkedConversation(null);
      return;
    }
    let cancelled = false;
    const fetchConv = async () => {
      const { data } = await supabase
        .from("conversations")
        .select("*")
        .eq("contact_id", contactId)
        .order("last_message_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) {
        setLinkedConversation((data as Conversation | null) ?? null);
      }
    };

    fetchConv();

    // Realtime listener on conversations table for this contact so last_message_at updates instantly
    const channel = supabase
      .channel(`conv_contact_${contactId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversations",
          filter: `contact_id=eq.${contactId}`,
        },
        () => {
          fetchConv();
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [open, contactId, supabase]);

  // Load timeline events for history tab
  useEffect(() => {
    if (!open || activeTab !== "history") return;
    let cancelled = false;
    (async () => {
      setLoadingTimeline(true);
      const events: TimelineEvent[] = [];

      // 1. Deal creation event
      if (deal?.created_at) {
        events.push({
          id: `deal_created_${deal.id}`,
          type: "deal_created",
          title: "Negócio Criado",
          description: `Negócio "${deal.title}" criado no funil.`,
          timestamp: deal.created_at,
        });
      }

      // 2. Status event if won or lost
      if (deal?.status === "won") {
        events.push({
          id: `status_won_${deal.id}`,
          type: "status_won",
          title: "Negócio Ganho 🎉",
          description: `Negócio marcado como ganho com sucesso.`,
          timestamp: deal.updated_at || deal.created_at,
        });
      } else if (deal?.status === "lost") {
        events.push({
          id: `status_lost_${deal.id}`,
          type: "status_lost",
          title: "Negócio Perdido ❌",
          description: "Status alterado para Perdido.",
          timestamp: deal.updated_at || deal.created_at,
        });
      }

      // 3. Conversation messages (inbound & outbound)
      if (linkedConversation?.id) {
        const { data: msgs } = await supabase
          .from("messages")
          .select("*")
          .eq("conversation_id", linkedConversation.id)
          .order("created_at", { ascending: false })
          .limit(25);

        if (msgs && msgs.length > 0) {
          for (const m of msgs) {
            events.push({
              id: `msg_${m.id}`,
              type: m.sender_type === "customer" ? "message_inbound" : "message_outbound",
              title: m.sender_type === "customer" ? "Mensagem do Cliente (WhatsApp)" : "Mensagem Enviada (WhatsApp)",
              description: m.content_text || (m.media_url ? "[Mídia enviada]" : `[${m.content_type}]`),
              timestamp: m.created_at,
            });
          }
        }
      }

      // Sort all events chronologically (newest first)
      events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      if (!cancelled) {
        setTimelineEvents(events);
        setLoadingTimeline(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, activeTab, deal, linkedConversation, supabase]);

  const selectedContact = contacts.find((c) => c.id === contactId);

  const handleAddCustomNote = () => {
    if (!customNote.trim()) return;
    const newEvt: TimelineEvent = {
      id: `custom_note_${Date.now()}`,
      type: "note",
      title: "Anotação de Atendimento",
      description: customNote.trim(),
      timestamp: new Date().toISOString(),
    };
    setTimelineEvents((prev) => [newEvt, ...prev]);
    setCustomNote("");
    toast.success("Anotação adicionada ao histórico!");
  };

  async function handleSave() {
    if (!title.trim() || !contactId || !stageId) {
      toast.error(t("toastRequired"));
      return;
    }
    const metaPayload: DealMeta = {
      temperature,
      leadType,
      lastPurchaseDate,
      source,
      product,
      userNotes: userNotes.trim(),
    };

    const targetStage = availableStages.find((s) => s.id === stageId);
    const selectedContact = contacts.find((c) => c.id === contactId);

    if (targetStage) {
      const dealForValidation = {
        title: title.trim(),
        value: parseFloat(value) || 0,
        currency,
        contact_id: contactId,
        pipeline_id: currentPipelineId,
        stage_id: stageId,
        assigned_to: assignedTo || null,
        notes: JSON.stringify(metaPayload),
        expected_close_date: expectedCloseDate || null,
        contact: selectedContact,
      };

      const { valid, missingFields } = validateDealStageRequirements(
        dealForValidation,
        targetStage
      );
      if (!valid) {
        toast.error(
          `Para salvar nesta etapa ("${targetStage.name}"), preencha: ${missingFields.join(", ")}`
        );
        return;
      }
    }

    setSaving(true);

    const payload = {
      title: title.trim(),
      value: parseFloat(value) || 0,
      currency,
      contact_id: contactId,
      pipeline_id: currentPipelineId,
      stage_id: stageId,
      assigned_to: assignedTo || null,
      notes: JSON.stringify(metaPayload),
      expected_close_date: expectedCloseDate || null,
    };

    if (deal) {
      const { error } = await supabase
        .from("deals")
        .update(payload)
        .eq("id", deal.id);
      if (error) {
        toast.error(t("toastFailedSave"));
        setSaving(false);
        return;
      }
    } else {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user || !accountId) {
        toast.error(t("toastNotSignedIn"));
        setSaving(false);
        return;
      }
      const { error } = await supabase
        .from("deals")
        .insert({ ...payload, user_id: user.id, account_id: accountId, status: "open", conversation_id: initialConversationId || null });
      if (error) {
        toast.error(t("toastFailedCreate"));
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    toast.success(deal ? t("toastUpdated") : t("toastCreated"));
    onOpenChange(false);
    onSaved();
  }

  async function handleStatusChange(status: DealStatus) {
    if (!deal) return;
    setStatusAction(status);

    let targetStageId = stageId;

    if (status === "won") {
      // Find a stage named Won / Ganho, or fallback to the highest position stage
      const wonStage = availableStages.find(
        (s) =>
          s.name.toLowerCase().includes("won") ||
          s.name.toLowerCase().includes("ganho") ||
          s.name.toLowerCase().includes("fechado")
      ) || availableStages[availableStages.length - 1];
      if (wonStage) targetStageId = wonStage.id;
    } else if (status === "lost") {
      // Find a stage named Lost / Perdido / Cancelado
      const lostStage = availableStages.find(
        (s) =>
          s.name.toLowerCase().includes("lost") ||
          s.name.toLowerCase().includes("perdido") ||
          s.name.toLowerCase().includes("cancelado")
      );
      if (lostStage) {
        targetStageId = lostStage.id;
      } else {
        // If current stage is a "Won" stage, move it out of the Won stage to the initial stage
        const currentStage = availableStages.find((s) => s.id === stageId);
        if (
          currentStage &&
          (currentStage.name.toLowerCase().includes("won") ||
            currentStage.name.toLowerCase().includes("ganho") ||
            currentStage.name.toLowerCase().includes("fechado"))
        ) {
          targetStageId = availableStages[0]?.id || stageId;
        }
      }
    } else if (status === "open") {
      // If reopening and in a won/lost stage, move to first stage
      const currentStage = availableStages.find((s) => s.id === stageId);
      if (
        currentStage &&
        (currentStage.name.toLowerCase().includes("won") ||
          currentStage.name.toLowerCase().includes("ganho") ||
          currentStage.name.toLowerCase().includes("lost") ||
          currentStage.name.toLowerCase().includes("perdido"))
      ) {
        targetStageId = availableStages[0]?.id || stageId;
      }
    }

    const { error } = await supabase
      .from("deals")
      .update({ status, stage_id: targetStageId })
      .eq("id", deal.id);

    setStatusAction(null);
    if (error) {
      toast.error(t("toastFailedStatus"));
      return;
    }

    setStageId(targetStageId);
    toast.success(
      status === "won" ? t("toastMarkedWon") : status === "lost" ? t("toastMarkedLost") : t("toastReopened"),
    );
    onOpenChange(false);
    onSaved();
  }

  async function handleDelete() {
    if (!deal) return;
    setDeleting(true);
    const { error } = await supabase.from("deals").delete().eq("id", deal.id);
    setDeleting(false);
    if (error) {
      toast.error(t("toastFailedDelete"));
      return;
    }
    toast.success(t("toastDeleted"));
    setConfirmDelete(false);
    onOpenChange(false);
    onSaved();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="bg-popover text-popover-foreground border-l border-border sm:max-w-2xl w-full p-0 flex flex-col h-full shadow-2xl transition-colors duration-200"
      >
        {/* Top Header matching theme */}
        <div className="flex items-start justify-between border-b border-border/50 px-6 pt-5 pb-3 bg-muted/40">
          <div className="flex-1 space-y-1.5 pr-4">
            <div className="flex items-center gap-2">
              <span className="rounded bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary">
                {leadType || "LEAD"}
              </span>
              {temperature && (
                <span
                  className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${
                    temperature === "Quente"
                      ? "bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30"
                      : temperature === "Morno"
                      ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30"
                      : "bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30"
                  }`}
                >
                  {temperature}
                </span>
              )}
            </div>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Luciano Sant Anna"
              className="h-8 border-none bg-transparent p-0 text-xl font-bold text-foreground focus-visible:ring-0 placeholder:text-muted-foreground/40"
            />
          </div>

          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Navigation Tabs Bar */}
        <div className="flex items-center gap-1 border-b border-border/50 bg-muted/20 px-6">
          <button
            type="button"
            onClick={() => setActiveTab("details")}
            className={`flex items-center gap-2 border-b-2 px-3 py-2.5 text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "details"
                ? "border-primary text-primary font-bold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <FileText className="h-3.5 w-3.5" />
            Dados do Negócio
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("history")}
            className={`flex items-center gap-2 border-b-2 px-3 py-2.5 text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "history"
                ? "border-primary text-primary font-bold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <History className="h-3.5 w-3.5" />
            Histórico do Lead
            {timelineEvents.length > 0 && (
              <span className="rounded-full bg-primary/20 px-1.5 py-0.2 text-[10px] font-bold text-primary">
                {timelineEvents.length}
              </span>
            )}
          </button>
        </div>

        {/* Tab 1: DADOS DO NEGÓCIO */}
        {activeTab === "details" && (
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {/* Row 1: TEMPERATURA & TIPO */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  TEMPERATURA
                </label>
                <select
                  value={temperature}
                  onChange={(e) => setTemperature(e.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-muted/50 px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                >
                  <option value="Frio" className="bg-popover text-popover-foreground">
                    Frio
                  </option>
                  <option value="Morno" className="bg-popover text-popover-foreground">
                    Morno
                  </option>
                  <option value="Quente" className="bg-popover text-popover-foreground">
                    Quente
                  </option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  TIPO
                </label>
                <select
                  value={leadType}
                  onChange={(e) => setLeadType(e.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-muted/50 px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                >
                  <option value="Lead" className="bg-popover text-popover-foreground">
                    Lead
                  </option>
                  <option value="Cliente" className="bg-popover text-popover-foreground">
                    Cliente
                  </option>
                  <option value="Parceiro" className="bg-popover text-popover-foreground">
                    Parceiro
                  </option>
                  <option value="Outro" className="bg-popover text-popover-foreground">
                    Outro
                  </option>
                </select>
              </div>
            </div>

            {/* STATUS DO NEGÓCIO Section */}
            <div className="space-y-2 pt-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                STATUS DO NEGÓCIO
              </label>
              <div className="grid grid-cols-2 gap-3 w-full">
                <button
                  type="button"
                  onClick={() => handleStatusChange("won")}
                  disabled={!!statusAction || deal?.status === "won"}
                  className={`h-12 w-full rounded-lg text-xs font-semibold tracking-wide transition-all flex items-center justify-center px-2 text-center cursor-pointer ${
                    deal?.status === "won"
                      ? "bg-emerald-600 text-white border border-emerald-400 shadow-md font-bold"
                      : "bg-emerald-500/10 dark:bg-[#062419]/80 text-emerald-600 dark:text-[#22c55e] border border-emerald-500/30 dark:border-[#14532d]/70 hover:bg-emerald-500/20 active:scale-[0.98]"
                  } disabled:opacity-50 disabled:pointer-events-none`}
                >
                  {statusAction === "won" ? (
                    <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />
                  ) : (
                    "Marcar como ganho"
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => handleStatusChange("lost")}
                  disabled={!!statusAction || deal?.status === "lost"}
                  className={`h-12 w-full rounded-lg text-xs font-semibold tracking-wide transition-all flex items-center justify-center px-2 text-center cursor-pointer ${
                    deal?.status === "lost"
                      ? "bg-rose-600 text-white border border-rose-400 shadow-md font-bold"
                      : "bg-rose-500/10 dark:bg-[#270c12]/80 text-rose-600 dark:text-[#f87171] border border-rose-500/30 dark:border-[#7f1d1d]/70 hover:bg-rose-500/20 active:scale-[0.98]"
                  } disabled:opacity-50 disabled:pointer-events-none`}
                >
                  {statusAction === "lost" ? (
                    <Loader2 className="h-4 w-4 animate-spin text-rose-500" />
                  ) : (
                    "Marcar como perdido"
                  )}
                </button>
              </div>

              {deal?.status && deal.status !== "open" && (
                <button
                  type="button"
                  onClick={() => handleStatusChange("open")}
                  disabled={!!statusAction}
                  className="w-full text-xs text-muted-foreground hover:text-foreground py-1.5 transition-colors text-center cursor-pointer"
                >
                  Reabrir negócio
                </button>
              )}
            </div>

            {/* CONTATO Section */}
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  CONTATO
                </label>
                {deal?.contact_id && (
                  <span className="text-[10px] text-muted-foreground font-medium flex items-center gap-1">
                    🔒 Contato fixado
                  </span>
                )}
              </div>

              {!deal?.contact_id ? (
                <select
                  value={contactId}
                  onChange={(e) => setContactId(e.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-muted/50 px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary cursor-pointer"
                >
                  <option value="">Selecione um contato...</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || c.phone} {c.phone ? `(${c.phone})` : ""}
                    </option>
                  ))}
                </select>
              ) : null}

              {selectedContact && (
                <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/40 p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/20 text-sm font-bold text-primary">
                      {(selectedContact.name || selectedContact.phone || "?").charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {selectedContact.name || "Sem nome"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {selectedContact.phone || selectedContact.email || "Sem contato"}
                      </p>
                    </div>
                  </div>
                  {linkedConversation && (
                    <Link
                      href={`/inbox?conversationId=${linkedConversation.id}`}
                      className="inline-flex items-center gap-1.5 rounded-md bg-primary/15 px-2.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary/25 transition-colors"
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      Ver no Inbox
                    </Link>
                  )}
                </div>
              )}
            </div>

            {/* FUNIL & ETAPA Row */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  FUNIL
                </label>
                <select
                  value={currentPipelineId}
                  onChange={(e) => setCurrentPipelineId(e.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-muted/50 px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                >
                  {allPipelines.map((p) => (
                    <option key={p.id} value={p.id} className="bg-popover text-popover-foreground">
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  ETAPA
                </label>
                <select
                  value={stageId}
                  onChange={(e) => setStageId(e.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-muted/50 px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                >
                  {availableStages.map((s) => (
                    <option key={s.id} value={s.id} className="bg-popover text-popover-foreground">
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* VALOR DO NEGÓCIO & DATA DE FECHAMENTO Row */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  VALOR DO NEGÓCIO
                </label>
                <div className="relative flex items-center">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="0.00"
                    className="h-10 w-full border-border bg-muted/50 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary pl-3 pr-24 font-semibold"
                  />
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="absolute right-1.5 h-7 rounded border-0 bg-background/80 px-2 text-xs font-bold text-foreground outline-none cursor-pointer hover:bg-muted"
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code} ({c.symbol})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  DATA DE FECHAMENTO
                </label>
                <Input
                  type="date"
                  value={expectedCloseDate}
                  onChange={(e) => setExpectedCloseDate(e.target.value)}
                  className="h-10 w-full border-border bg-muted/50 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            {/* RESPONSÁVEL & ORIGEM Row */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  RESPONSÁVEL
                </label>
                <select
                  value={assignedTo}
                  onChange={(e) => setAssignedTo(e.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-muted/50 px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                >
                  <option value="" className="bg-popover text-popover-foreground">
                    Não atribuído
                  </option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id} className="bg-popover text-popover-foreground">
                      {p.full_name || p.email}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  ORIGEM
                </label>
                <select
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-muted/50 px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                >
                  <option value="—" className="bg-popover text-popover-foreground">
                    —
                  </option>
                  <option value="WhatsApp" className="bg-popover text-popover-foreground">
                    WhatsApp
                  </option>
                  <option value="Instagram" className="bg-popover text-popover-foreground">
                    Instagram
                  </option>
                  <option value="Site" className="bg-popover text-popover-foreground">
                    Site
                  </option>
                  <option value="Indicação" className="bg-popover text-popover-foreground">
                    Indicação
                  </option>
                  <option value="Anúncio" className="bg-popover text-popover-foreground">
                    Anúncio
                  </option>
                  <option value="Outro" className="bg-popover text-popover-foreground">
                    Outro
                  </option>
                </select>
              </div>
            </div>

            {/* Timestamps Row */}
            <div className="grid grid-cols-2 gap-4 rounded-lg border border-border/50 bg-muted/30 p-3">
              <div>
                <p className="font-bold uppercase tracking-wider text-muted-foreground text-[10px]">
                  CRIADO EM
                </p>
                <p className="mt-0.5 text-xs font-semibold text-foreground">
                  {deal?.created_at
                    ? new Date(deal.created_at).toLocaleString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "—"}
                </p>
              </div>
              <div>
                <p className="font-bold uppercase tracking-wider text-muted-foreground text-[10px]">
                  ÚLTIMA INTERAÇÃO
                </p>
                <p className="mt-0.5 text-xs font-semibold text-foreground">
                  {(() => {
                    const timestamps = [
                      linkedConversation?.last_message_at ? new Date(linkedConversation.last_message_at).getTime() : 0,
                      deal?.updated_at ? new Date(deal.updated_at).getTime() : 0,
                      deal?.created_at ? new Date(deal.created_at).getTime() : 0,
                    ].filter((t) => !isNaN(t) && t > 0);
                    if (timestamps.length === 0) return "—";
                    return new Date(Math.max(...timestamps)).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    });
                  })()}
                </p>
              </div>
            </div>

            {/* OBSERVAÇÕES */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                OBSERVAÇÕES
              </label>
              <Textarea
                value={userNotes}
                onChange={(e) => setUserNotes(e.target.value)}
                placeholder="Adicione observações ou anotações detalhadas sobre este negócio..."
                className="min-h-[85px] border-border bg-muted/50 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
        )}

        {/* Tab 2: HISTÓRICO DO LEAD */}
        {activeTab === "history" && (
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {/* Quick Activity Note Add Box */}
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                REGISTRAR ATIVIDADE / ANOTAÇÃO
              </label>
              <div className="flex gap-2">
                <Input
                  value={customNote}
                  onChange={(e) => setCustomNote(e.target.value)}
                  placeholder="Ex: Ligação realizada, agendado retorno..."
                  className="h-9 border-border bg-popover text-xs text-foreground focus:border-primary"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddCustomNote();
                    }
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={handleAddCustomNote}
                  disabled={!customNote.trim()}
                  className="h-9 px-3 bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90"
                >
                  <PlusCircle className="mr-1 h-3.5 w-3.5" />
                  Salvar
                </Button>
              </div>
            </div>

            {/* Timeline Feed */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  LINHA DO TEMPO DE ATIVIDADES
                </label>
                <span className="text-[10px] text-muted-foreground">
                  {timelineEvents.length} eventos registrados
                </span>
              </div>

              {loadingTimeline ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Carregando histórico do lead...
                </div>
              ) : timelineEvents.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                  Nenhum evento registrado até o momento.
                </div>
              ) : (
                <div className="relative border-l-2 border-border/60 ml-3.5 pl-4 space-y-4 py-1">
                  {timelineEvents.map((evt) => (
                    <div key={evt.id} className="relative group">
                      {/* Timeline Icon Badge */}
                      <span className="absolute -left-[27px] top-0 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-popover shadow-sm">
                        {evt.type === "deal_created" && <Sparkles className="h-3 w-3 text-blue-500" />}
                        {evt.type === "status_won" && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                        {evt.type === "status_lost" && <XCircle className="h-3.5 w-3.5 text-rose-500" />}
                        {evt.type === "message_inbound" && <MessageCircle className="h-3.5 w-3.5 text-emerald-500" />}
                        {evt.type === "message_outbound" && <Send className="h-3.5 w-3.5 text-primary" />}
                        {evt.type === "note" && <FileText className="h-3.5 w-3.5 text-amber-500" />}
                      </span>

                      {/* Event Details */}
                      <div className="rounded-lg border border-border/60 bg-muted/30 p-3 shadow-xs">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-bold text-foreground">{evt.title}</p>
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <Clock className="h-2.5 w-2.5" />
                            {new Date(evt.timestamp).toLocaleString("pt-BR", {
                              day: "2-digit",
                              month: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                        {evt.description && (
                          <p className="mt-1 text-xs text-muted-foreground/90 whitespace-pre-wrap">
                            {evt.description}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Sheet Footer */}
        <div className="border-t border-border/50 bg-popover p-4 space-y-3">
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1 border-border bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {t("cancel")}
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !title.trim() || !contactId || !stageId}
              className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
            >
              {saving ? t("saving") : deal ? t("saveChanges") : t("createDeal")}
            </Button>
          </div>

          {deal &&
            (confirmDelete ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs">
                <span className="text-red-600 dark:text-red-300 font-medium">{t("deletePrompt")}</span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleting}
                    className="rounded px-2 py-1 text-muted-foreground hover:bg-muted"
                  >
                    {t("cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={deleting}
                    className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {deleting ? t("deleting") : t("confirm")}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="flex w-full items-center justify-center gap-1.5 text-xs text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 transition-colors pt-1 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t("deleteDeal")}
              </button>
            ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
