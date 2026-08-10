"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { CURRENCIES } from "@/lib/currency";
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
  Calendar,
  User,
  Tag,
  DollarSign,
  Flame,
  ShoppingBag,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

interface DealFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal?: Deal | null;
  pipelineId: string;
  pipelines?: Pipeline[];
  stages: PipelineStage[];
  defaultStageId?: string;
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

export function DealForm({
  open,
  onOpenChange,
  deal,
  pipelineId,
  pipelines = [],
  stages: initialStages,
  defaultStageId,
  onSaved,
}: DealFormProps) {
  const t = useTranslations("Pipelines.form");
  const supabase = createClient();
  const { accountId, defaultCurrency } = useAuth();

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
      setTitle("");
      setValue("");
      setCurrency(defaultCurrency);
      setContactId("");
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
  }, [open, deal, pipelineId, defaultStageId, initialStages, defaultCurrency]);
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

  // Load linked conversation for contact
  useEffect(() => {
    if (!open || !contactId) {
      /* eslint-disable-next-line react-hooks/set-state-in-effect */
      setLinkedConversation(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("conversations")
        .select("*")
        .eq("contact_id", contactId)
        .order("last_message_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setLinkedConversation((data as Conversation | null) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, contactId, supabase]);

  const selectedContact = contacts.find((c) => c.id === contactId);

  async function handleSave() {
    if (!title.trim() || !contactId || !stageId) {
      toast.error(t("toastRequired"));
      return;
    }
    setSaving(true);

    const metaPayload: DealMeta = {
      temperature,
      leadType,
      lastPurchaseDate,
      source,
      product,
      userNotes: userNotes.trim(),
    };

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
        .insert({ ...payload, user_id: user.id, account_id: accountId, status: "open" });
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
    const { error } = await supabase
      .from("deals")
      .update({ status })
      .eq("id", deal.id);
    setStatusAction(null);
    if (error) {
      toast.error(t("toastFailedStatus"));
      return;
    }
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
        className="bg-[#0e0f12] text-foreground border-l border-border/50 sm:max-w-lg w-full p-0 flex flex-col h-full shadow-2xl"
      >
        {/* Header matching screenshot */}
        <div className="flex items-start justify-between border-b border-border/40 px-6 pt-5 pb-4 bg-muted/20">
          <div className="flex-1 space-y-1.5 pr-4">
            <div className="flex items-center gap-2">
              <span className="rounded bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary">
                {leadType || "LEAD"}
              </span>
              {temperature && (
                <span
                  className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${
                    temperature === "Quente"
                      ? "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                      : temperature === "Morno"
                      ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                      : "bg-blue-500/20 text-blue-400 border border-blue-500/30"
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
            <select
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              className="h-7 w-full bg-transparent text-xs text-muted-foreground outline-none cursor-pointer hover:text-foreground border-b border-border/30 pb-1"
            >
              <option value="" className="bg-[#121318] text-foreground">
                Selecionar produtos...
              </option>
              <option value="Consultoria Premium" className="bg-[#121318] text-foreground">
                Consultoria Premium
              </option>
              <option value="Plano Mensal" className="bg-[#121318] text-foreground">
                Plano Mensal
              </option>
              <option value="Tratamento Odontológico" className="bg-[#121318] text-foreground">
                Tratamento Odontológico
              </option>
              <option value="Procedimento Estético" className="bg-[#121318] text-foreground">
                Procedimento Estético
              </option>
              <option value="Outro Produto/Serviço" className="bg-[#121318] text-foreground">
                Outro Produto/Serviço
              </option>
            </select>
          </div>

          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Row 1: VALOR & TEMPERATURA */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
                VALOR
              </label>
              <div className="relative">
                <Input
                  type="number"
                  step="0.01"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="R$ 47,90"
                  className="h-10 border-border/50 bg-[#16181f] text-sm font-bold text-primary focus:border-primary focus:ring-1 focus:ring-primary pl-3"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
                TEMPERATURA
              </label>
              <select
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
                className="h-10 w-full rounded-md border border-border/50 bg-[#16181f] px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="Frio" className="bg-[#121318]">
                  Frio
                </option>
                <option value="Morno" className="bg-[#121318]">
                  Morno
                </option>
                <option value="Quente" className="bg-[#121318]">
                  Quente
                </option>
              </select>
            </div>
          </div>

          {/* Row 2: TIPO & ÚLTIMA COMPRA */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
                TIPO
              </label>
              <select
                value={leadType}
                onChange={(e) => setLeadType(e.target.value)}
                className="h-10 w-full rounded-md border border-border/50 bg-[#16181f] px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="Lead" className="bg-[#121318]">
                  Lead
                </option>
                <option value="Cliente" className="bg-[#121318]">
                  Cliente
                </option>
                <option value="Parceiro" className="bg-[#121318]">
                  Parceiro
                </option>
                <option value="Outro" className="bg-[#121318]">
                  Outro
                </option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
                ÚLTIMA COMPRA
              </label>
              <Input
                type="date"
                value={lastPurchaseDate}
                onChange={(e) => setLastPurchaseDate(e.target.value)}
                className="h-10 border-border/50 bg-[#16181f] text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {/* STATUS DO NEGÓCIO Section */}
          <div className="space-y-2 pt-1">
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
              STATUS DO NEGÓCIO
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Button
                type="button"
                onClick={() => handleStatusChange("won")}
                disabled={!!statusAction || deal?.status === "won"}
                className={`h-11 font-semibold text-sm transition-all rounded-lg ${
                  deal?.status === "won"
                    ? "bg-emerald-600 text-white border border-emerald-500"
                    : "border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500"
                }`}
              >
                {statusAction === "won" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Check className="mr-1.5 h-4 w-4" />
                    Marcar como ganho
                  </>
                )}
              </Button>

              <Button
                type="button"
                onClick={() => handleStatusChange("lost")}
                disabled={!!statusAction || deal?.status === "lost"}
                className={`h-11 font-semibold text-sm transition-all rounded-lg ${
                  deal?.status === "lost"
                    ? "bg-rose-600 text-white border border-rose-500"
                    : "border border-rose-500/40 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 hover:border-rose-500"
                }`}
              >
                {statusAction === "lost" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <X className="mr-1.5 h-4 w-4" />
                    Marcar como perdido
                  </>
                )}
              </Button>
            </div>

            {deal?.status && deal.status !== "open" && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleStatusChange("open")}
                disabled={!!statusAction}
                className="w-full text-xs text-muted-foreground hover:text-foreground mt-1"
              >
                Reabrir negócio
              </Button>
            )}
          </div>

          {/* CONTATO Section */}
          <div className="space-y-2 pt-1">
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
              CONTATO
            </label>
            <select
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              className="h-10 w-full rounded-md border border-border/50 bg-[#16181f] px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            >
              <option value="">Selecione um contato...</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || c.phone} {c.phone ? `(${c.phone})` : ""}
                </option>
              ))}
            </select>

            {selectedContact && (
              <div className="flex items-center justify-between rounded-lg border border-border/50 bg-[#14161d] p-3 mt-2">
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
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
                FUNIL
              </label>
              <select
                value={currentPipelineId}
                onChange={(e) => setCurrentPipelineId(e.target.value)}
                className="h-10 w-full rounded-md border border-border/50 bg-[#16181f] px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                {allPipelines.map((p) => (
                  <option key={p.id} value={p.id} className="bg-[#121318]">
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
                ETAPA
              </label>
              <select
                value={stageId}
                onChange={(e) => setStageId(e.target.value)}
                className="h-10 w-full rounded-md border border-border/50 bg-[#16181f] px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                {availableStages.map((s) => (
                  <option key={s.id} value={s.id} className="bg-[#121318]">
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* RESPONSÁVEL & ORIGEM Row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
                RESPONSÁVEL
              </label>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="h-10 w-full rounded-md border border-border/50 bg-[#16181f] px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="" className="bg-[#121318]">
                  Não atribuído
                </option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id} className="bg-[#121318]">
                    {p.full_name || p.email}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
                ORIGEM
              </label>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="h-10 w-full rounded-md border border-border/50 bg-[#16181f] px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="—" className="bg-[#121318]">
                  —
                </option>
                <option value="WhatsApp" className="bg-[#121318]">
                  WhatsApp
                </option>
                <option value="Instagram" className="bg-[#121318]">
                  Instagram
                </option>
                <option value="Site" className="bg-[#121318]">
                  Site
                </option>
                <option value="Indicação" className="bg-[#121318]">
                  Indicação
                </option>
                <option value="Anúncio" className="bg-[#121318]">
                  Anúncio
                </option>
                <option value="Outro" className="bg-[#121318]">
                  Outro
                </option>
              </select>
            </div>
          </div>

          {/* Timestamps Row */}
          <div className="grid grid-cols-2 gap-4 rounded-lg border border-border/40 bg-[#14161d] p-3">
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
                {deal?.updated_at || linkedConversation?.last_message_at
                  ? new Date(
                      deal?.updated_at || linkedConversation?.last_message_at!
                    ).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "—"}
              </p>
            </div>
          </div>

          {/* OBSERVAÇÕES */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
              OBSERVAÇÕES
            </label>
            <Textarea
              value={userNotes}
              onChange={(e) => setUserNotes(e.target.value)}
              placeholder="Adicione observações ou anotações detalhadas sobre este negócio..."
              className="min-h-[85px] border-border/50 bg-[#16181f] text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        {/* Sheet Footer */}
        <div className="border-t border-border/40 bg-[#121318] p-4 space-y-3">
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1 border-border/60 bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
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
                <span className="text-red-300">{t("deletePrompt")}</span>
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
                className="flex w-full items-center justify-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition-colors pt-1"
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
