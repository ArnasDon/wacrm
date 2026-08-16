"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { formatCurrency } from "@/lib/currency";
import type { Contact, Deal, ContactNote, Tag, PipelineStage, LeadTemperature, Quote } from "@/types";
import {
  Phone,
  Mail,
  Copy,
  Check,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Plus,
  Camera,
  Trophy,
  Loader2,
  Thermometer,
  FileText,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LeadTemperatureBadge } from "@/components/contacts/lead-temperature-badge";
import { QuoteBuilder } from "@/components/products/quote-builder";
import { toast } from "sonner";
import { format } from "date-fns";
import { useTranslations } from "next-intl";

interface ContactSidebarProps {
  contact: Contact | null;
  /** Current open conversation, if any — lets a quote built here target
   *  it directly for "save and send" instead of resolving one server-side. */
  conversationId?: string | null;
}

export function ContactSidebar({ contact, conversationId = null }: ContactSidebarProps) {
  const tSidebar = useTranslations("Inbox.sidebar");
  const tThread = useTranslations("Inbox.messageThread");
  const tTemp = useTranslations("Contacts.detailView");

  const { accountId } = useAuth();
  const canManageProducts = useCan("manage-products");
  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [quoteBuilderOpen, setQuoteBuilderOpen] = useState(false);
  const [sendingQuoteId, setSendingQuoteId] = useState<string | null>(null);

  // Deal-action state: stages per pipeline (for the "move stage" picker
  // and to know which stage is "Venta cerrada"), a busy flag per deal
  // so two buttons on the same card don't fight, and the deal pending
  // the "mark won" confirm dialog.
  const [stagesByPipeline, setStagesByPipeline] = useState<Record<string, PipelineStage[]>>({});
  const [busyDealId, setBusyDealId] = useState<string | null>(null);
  const [confirmWinDeal, setConfirmWinDeal] = useState<Deal | null>(null);

  const [temperature, setTemperature] = useState<LeadTemperature | "unclassified">("unclassified");
  const [savingTemperature, setSavingTemperature] = useState(false);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    // Fetch deals, notes, tags, and quotes in parallel
    const [dealsRes, notesRes, tagsRes, quotesRes] = await Promise.all([
      supabase
        .from("deals")
        .select("*, stage:pipeline_stages(*)")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_notes")
        .select("*")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_tags")
        .select("id, tag_id, tags(*)")
        .eq("contact_id", contact.id),
      supabase
        .from("quotes")
        .select("*")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
    ]);
    if (quotesRes.data) setQuotes(quotesRes.data);

    if (dealsRes.data) {
      setDeals(dealsRes.data);
      // Load every stage of every pipeline these deals belong to, so
      // the "move stage" picker and the "is there a won stage at all"
      // check don't need a round-trip per deal.
      const pipelineIds = [...new Set(dealsRes.data.map((d) => d.pipeline_id))];
      if (pipelineIds.length > 0) {
        const { data: stages } = await supabase
          .from("pipeline_stages")
          .select("*")
          .in("pipeline_id", pipelineIds)
          .order("position");
        const grouped: Record<string, PipelineStage[]> = {};
        for (const stage of stages ?? []) {
          (grouped[stage.pipeline_id] ??= []).push(stage);
        }
        setStagesByPipeline(grouped);
      } else {
        setStagesByPipeline({});
      }
    } else {
      setDeals([]);
      setStagesByPipeline({});
    }
    if (notesRes.data) setNotes(notesRes.data);
    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: Record<string, unknown>) => ct.tags)
        .map((ct: Record<string, unknown>) => ({
          ...(ct.tags as Tag),
          contact_tag_id: ct.id as string,
        }));
      setTags(mapped);
    }
    setTemperature((contact.lead_temperature as LeadTemperature | null) ?? "unclassified");
  }, [contact]);

  useEffect(() => {
    fetchContactData();
  }, [fetchContactData]);

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    if (!accountId) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    const { data, error } = await supabase
      .from("contact_notes")
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: user?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote("");
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

  const wonStageIdFor = useCallback(
    (pipelineId: string): string | null => {
      const stage = (stagesByPipeline[pipelineId] ?? []).find((s) => s.is_won);
      return stage?.id ?? null;
    },
    [stagesByPipeline],
  );

  async function moveDealStage(deal: Deal, stageId: string) {
    setBusyDealId(deal.id);
    try {
      const res = await fetch(`/api/deals/${deal.id}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage_id: stageId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || tSidebar("dealMoveFailed"));
        return;
      }
      toast.success(tSidebar("dealMoveSuccess"));
      await fetchContactData();
    } finally {
      setBusyDealId(null);
    }
  }

  async function handleConfirmWon() {
    if (!confirmWinDeal) return;
    const wonStageId = wonStageIdFor(confirmWinDeal.pipeline_id);
    if (!wonStageId) {
      setConfirmWinDeal(null);
      return;
    }
    const deal = confirmWinDeal;
    setConfirmWinDeal(null);
    await moveDealStage(deal, wonStageId);
  }

  async function handleTemperatureChange(value: LeadTemperature | "unclassified") {
    if (!contact) return;
    setTemperature(value);
    setSavingTemperature(true);
    try {
      const res = await fetch(`/api/contacts/${contact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_temperature: value === "unclassified" ? null : value }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || tSidebar("temperatureSaveFailed"));
        return;
      }
    } finally {
      setSavingTemperature(false);
    }
  }

  async function handleViewQuotePdf(quote: Quote) {
    let url = quote.pdf_url;
    if (!url) {
      const res = await fetch(`/api/quotes/${quote.id}/pdf`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || tSidebar("quotePdfFailed"));
        return;
      }
      url = data.pdf_url;
      await fetchContactData();
    }
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  async function handleResendQuote(quote: Quote) {
    setSendingQuoteId(quote.id);
    try {
      const res = await fetch(`/api/quotes/${quote.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(conversationId ? { conversation_id: conversationId } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || tSidebar("quoteSendFailed"));
        return;
      }
      toast.success(tSidebar("quoteSendSuccess"));
      await fetchContactData();
    } finally {
      setSendingQuoteId(null);
    }
  }

  if (!contact) {
    return (
      <div className="flex h-full w-70 items-center justify-center border-l border-border bg-card">
        <p className="text-sm text-muted-foreground">{tThread("selectConversation")}</p>
      </div>
    );
  }

  const displayName = contact.name || contact.instagram_username || contact.phone || "";
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex h-full w-70 flex-col border-l border-border bg-card">
      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-lg font-semibold text-foreground">
              {contact.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <h3 className="mt-3 text-sm font-semibold text-foreground">
              {displayName}
            </h3>
            {contact.company && (
              <p className="text-xs text-muted-foreground">{contact.company}</p>
            )}
          </div>

          {/* Phone */}
          <div className="mt-4 space-y-2">
            {contact.phone ? (
              <button
                onClick={handleCopyPhone}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
              >
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 text-left">{contact.phone}</span>
                {copied ? (
                  <Check className="h-3 w-3 text-primary" />
                ) : (
                  <Copy className="h-3 w-3 text-muted-foreground" />
                )}
              </button>
            ) : contact.instagram_username ? (
              <div className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground">
                <Camera className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 text-left">@{contact.instagram_username}</span>
              </div>
            ) : null}

            {contact.email && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Temperature */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <Thermometer className="h-3 w-3" />
              {tSidebar("temperature")}
            </div>
            <div className="mt-2 flex items-center gap-2 px-1">
              <LeadTemperatureBadge
                value={temperature === "unclassified" ? null : temperature}
                labels={{
                  cold: tTemp("temperatureCold"),
                  warm: tTemp("temperatureWarm"),
                  hot: tTemp("temperatureHot"),
                }}
              />
              <Select
                value={temperature}
                onValueChange={(value) => handleTemperatureChange(value as LeadTemperature | "unclassified")}
                disabled={savingTemperature}
              >
                <SelectTrigger className="h-7 flex-1 bg-muted border-border text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unclassified">{tTemp("temperatureUnclassified")}</SelectItem>
                  <SelectItem value="cold">{tTemp("temperatureCold")}</SelectItem>
                  <SelectItem value="warm">{tTemp("temperatureWarm")}</SelectItem>
                  <SelectItem value="hot">{tTemp("temperatureHot")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Tags */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <TagIcon className="h-3 w-3" />
              {tSidebar("tags")}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{tSidebar("noTags")}</p>
              ) : (
                tags.map((tag) => (
                  <span
                    key={tag.contact_tag_id}
                    className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Active Deals */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <DollarSign className="h-3 w-3" />
              {tSidebar("deals")}
            </div>
            <div className="mt-2 space-y-2">
              {deals.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{tSidebar("noDeals")}</p>
              ) : (
                deals.map((deal) => {
                  const stages = stagesByPipeline[deal.pipeline_id] ?? [];
                  const wonStageId = wonStageIdFor(deal.pipeline_id);
                  const isWon = deal.status === "won" || deal.stage_id === wonStageId;
                  const busy = busyDealId === deal.id;
                  return (
                    <div
                      key={deal.id}
                      className="rounded-lg bg-muted px-3 py-2"
                    >
                      <p className="text-sm font-medium text-foreground">
                        {deal.title}
                      </p>
                      <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                          {deal.currency ?? "$"}
                          {deal.value.toLocaleString()}
                        </span>
                        {deal.stage && (
                          <span
                            className="rounded-full px-1.5 py-0.5 text-[10px]"
                            style={{
                              backgroundColor: `${deal.stage.color}20`,
                              color: deal.stage.color,
                            }}
                          >
                            {deal.stage.name}
                          </span>
                        )}
                      </div>

                      {stages.length > 0 && (
                        <div className="mt-2 flex flex-col gap-1.5">
                          <Select
                            value={deal.stage_id}
                            onValueChange={(stageId) => {
                              if (stageId && stageId !== deal.stage_id) moveDealStage(deal, stageId);
                            }}
                            disabled={busy}
                          >
                            <SelectTrigger className="h-7 w-full bg-card border-border text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {stages.map((s) => (
                                <SelectItem key={s.id} value={s.id}>
                                  {s.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {!isWon && wonStageId && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 w-full border-emerald-700/50 bg-emerald-950/20 text-emerald-300 hover:bg-emerald-950/40 text-xs"
                              disabled={busy}
                              onClick={() => setConfirmWinDeal(deal)}
                            >
                              {busy ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <Trophy className="size-3" />
                              )}
                              {tSidebar("markWon")}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Quotes */}
          <div>
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <FileText className="h-3 w-3" />
                {tSidebar("quotes")}
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground"
                disabled={!canManageProducts}
                onClick={() => setQuoteBuilderOpen(true)}
              >
                <Plus className="h-3 w-3" />
                {tSidebar("newQuote")}
              </Button>
            </div>
            <div className="mt-2 space-y-2">
              {quotes.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{tSidebar("noQuotes")}</p>
              ) : (
                quotes.map((quote) => (
                  <div key={quote.id} className="rounded-lg bg-muted px-3 py-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-foreground">
                        {formatCurrency(quote.total, quote.currency)}
                      </p>
                      <span className="text-[10px] uppercase text-muted-foreground">{quote.status}</span>
                    </div>
                    <div className="mt-1.5 flex gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 flex-1 border-border text-[11px]"
                        onClick={() => handleViewQuotePdf(quote)}
                      >
                        <FileText className="size-3" />
                        {tSidebar("viewPdf")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 flex-1 border-border text-[11px]"
                        disabled={!canManageProducts || sendingQuoteId === quote.id}
                        onClick={() => handleResendQuote(quote)}
                      >
                        {sendingQuoteId === quote.id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Send className="size-3" />
                        )}
                        {tSidebar("resend")}
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Notes */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <StickyNote className="h-3 w-3" />
              {tSidebar("notes")}
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder={tSidebar("addNotePlaceholder")}
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
                />
                <Button
                  size="sm"
                  className="h-auto bg-primary px-2 hover:bg-primary/90"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                      {note.note_text}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {format(new Date(note.created_at), "MMM d, yyyy HH:mm")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>

      <Dialog open={confirmWinDeal != null} onOpenChange={(open) => !open && setConfirmWinDeal(null)}>
        <DialogContent className="border-border bg-popover sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{tSidebar("confirmWonTitle")}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {tSidebar("confirmWonDesc", { title: confirmWinDeal?.title ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmWinDeal(null)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {tSidebar("cancel")}
            </Button>
            <Button
              onClick={handleConfirmWon}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Trophy className="size-4" />
              {tSidebar("confirmWonBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <QuoteBuilder
        open={quoteBuilderOpen}
        onOpenChange={setQuoteBuilderOpen}
        contact={contact}
        conversationId={conversationId}
        onSaved={fetchContactData}
      />
    </div>
  );
}
