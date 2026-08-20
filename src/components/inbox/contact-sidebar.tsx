'use client';

import { readResponseJson } from '@/lib/http/response-json';

import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { formatCurrency, CURRENCIES } from '@/lib/currency';
import type {
  Contact,
  Deal,
  ContactNote,
  Tag,
  PipelineStage,
  LeadTemperature,
  Quote,
} from '@/types';
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
  Pencil,
  X,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LeadTemperatureBadge } from '@/components/contacts/lead-temperature-badge';
import { QuoteBuilder } from '@/components/products/quote-builder';
import { addContactTag, deleteContactTag } from '@/lib/contacts/tag-api';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { useTranslations } from 'next-intl';

interface ContactSidebarProps {
  contact: Contact | null;
  /** Current open conversation, if any — lets a quote built here target
   *  it directly for "save and send" instead of resolving one server-side. */
  conversationId?: string | null;
  /** Overrides the default fixed-width desktop-panel chrome (w-70,
   *  border-l) — pass e.g. "w-full border-l-0" when embedding this in
   *  something that already provides its own frame, like the mobile
   *  contact-info dialog in message-thread.tsx. */
  className?: string;
}

export function ContactSidebar({
  contact,
  conversationId = null,
  className,
}: ContactSidebarProps) {
  const tSidebar = useTranslations('Inbox.sidebar');
  const tThread = useTranslations('Inbox.messageThread');
  const tTemp = useTranslations('Contacts.detailView');

  const { accountId, defaultCurrency } = useAuth();
  const canManageProducts = useCan('manage-products');
  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  // Every tag the account has (not just this contact's) — lets the
  // sidebar show a full toggle list instead of a read-only chip row.
  // Creating a *new* tag stays Settings-only (Angel's call — the
  // account owner already knows where that is); this only applies or
  // removes ones that exist.
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [savingTagId, setSavingTagId] = useState<string | null>(null);
  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [quoteBuilderOpen, setQuoteBuilderOpen] = useState(false);
  const [sendingQuoteId, setSendingQuoteId] = useState<string | null>(null);

  // Deal-action state: stages per pipeline (for the "move stage" picker
  // and to know which stage is "Venta cerrada"), a busy flag per deal
  // so two buttons on the same card don't fight, and the deal pending
  // the "mark won" confirm dialog.
  const [stagesByPipeline, setStagesByPipeline] = useState<
    Record<string, PipelineStage[]>
  >({});
  const [busyDealId, setBusyDealId] = useState<string | null>(null);
  const [confirmWinDeal, setConfirmWinDeal] = useState<Deal | null>(null);
  const [confirmDeleteDeal, setConfirmDeleteDeal] = useState<Deal | null>(null);
  const [deletingDeal, setDeletingDeal] = useState(false);
  const [confirmDeleteQuote, setConfirmDeleteQuote] = useState<Quote | null>(
    null
  );
  const [deletingQuote, setDeletingQuote] = useState(false);

  // All of the account's pipelines (with their stages), independent of
  // whether this contact has any deals yet — powers the "New deal"
  // quick-create below, which needs a pipeline+stage picker even when
  // `stagesByPipeline` (derived from existing deals) is empty.
  const [pipelines, setPipelines] = useState<
    { id: string; name: string; stages: PipelineStage[] }[]
  >([]);
  const [newDealOpen, setNewDealOpen] = useState(false);
  const [newDealTitle, setNewDealTitle] = useState('');
  const [newDealPipelineId, setNewDealPipelineId] = useState('');
  const [newDealStageId, setNewDealStageId] = useState('');
  const [newDealValue, setNewDealValue] = useState('');
  const [newDealCurrency, setNewDealCurrency] = useState(defaultCurrency);
  const [creatingDeal, setCreatingDeal] = useState(false);

  const [temperature, setTemperature] = useState<
    LeadTemperature | 'unclassified'
  >('unclassified');
  const [savingTemperature, setSavingTemperature] = useState(false);

  // Phone is editable in place — an Instagram/Facebook contact has no
  // phone identity by construction (see the Contact type's comment),
  // but an agent or the AI often learns the customer's real number
  // mid-conversation and needs somewhere to record it. Kept as local
  // state (mirroring `temperature` above) rather than mutating the
  // `contact` prop directly, and re-synced whenever the selected
  // contact changes via fetchContactData below.
  const [phone, setPhone] = useState<string | null>(null);
  const [phoneEditing, setPhoneEditing] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState('');
  const [savingPhone, setSavingPhone] = useState(false);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    // Fetch deals, notes, tags, and quotes in parallel
    const [dealsRes, notesRes, tagsRes, quotesRes] = await Promise.all([
      supabase
        .from('deals')
        .select('*, stage:pipeline_stages(*)')
        .eq('contact_id', contact.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('contact_notes')
        .select('*')
        .eq('contact_id', contact.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('contact_tags')
        .select('id, tag_id, tags(*)')
        .eq('contact_id', contact.id),
      supabase
        .from('quotes')
        .select('*')
        .eq('contact_id', contact.id)
        .order('created_at', { ascending: false }),
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
          .from('pipeline_stages')
          .select('*')
          .in('pipeline_id', pipelineIds)
          .order('position');
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
        .map((ct: Record<string, unknown>) => ct.tags as Tag);
      setTags(mapped);
    }
    setTemperature(
      (contact.lead_temperature as LeadTemperature | null) ?? 'unclassified'
    );
    setPhone(contact.phone ?? null);
    setPhoneEditing(false);
  }, [contact]);

  useEffect(() => {
    fetchContactData();
  }, [fetchContactData]);

  // Account-level pipelines, loaded once (not per-contact) so the
  // "New deal" quick-create has a pipeline/stage picker ready even
  // before this contact has any deals.
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const [pipelinesRes, stagesRes] = await Promise.all([
        supabase.from('pipelines').select('id, name').order('created_at'),
        supabase.from('pipeline_stages').select('*').order('position'),
      ]);
      if (cancelled) return;
      const stagesByPipelineId: Record<string, PipelineStage[]> = {};
      for (const stage of stagesRes.data ?? []) {
        (stagesByPipelineId[stage.pipeline_id] ??= []).push(stage);
      }
      setPipelines(
        (pipelinesRes.data ?? []).map((p) => ({
          id: p.id as string,
          name: p.name as string,
          stages: stagesByPipelineId[p.id as string] ?? [],
        }))
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  // Account-level tag list, loaded once (not per-contact) so the
  // sidebar can show every tag as a toggle instead of just the ones
  // already applied here.
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.from('tags').select('*').order('name');
      if (!cancelled) setAllTags(data ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const handleCopyPhone = useCallback(async () => {
    if (!phone) return;
    await navigator.clipboard.writeText(phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [phone]);

  async function toggleTag(tagId: string) {
    if (!contact) return;
    setSavingTagId(tagId);
    try {
      const isApplied = tags.some((t) => t.id === tagId);
      if (isApplied) {
        await deleteContactTag(contact.id, tagId);
        setTags((prev) => prev.filter((t) => t.id !== tagId));
      } else {
        await addContactTag(contact.id, tagId);
        const tag = allTags.find((t) => t.id === tagId);
        if (tag) setTags((prev) => [...prev, tag]);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : tSidebar('tagUpdateFailed')
      );
    } finally {
      setSavingTagId(null);
    }
  }

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
      .from('contact_notes')
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
      setNewNote('');
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

  const wonStageIdFor = useCallback(
    (pipelineId: string): string | null => {
      const stage = (stagesByPipeline[pipelineId] ?? []).find((s) => s.is_won);
      return stage?.id ?? null;
    },
    [stagesByPipeline]
  );

  async function moveDealStage(deal: Deal, stageId: string) {
    setBusyDealId(deal.id);
    try {
      const res = await fetch(`/api/deals/${deal.id}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage_id: stageId }),
      });
      if (!res.ok) {
        const data = await readResponseJson(res).catch(() => ({}));
        toast.error(data.error || tSidebar('dealMoveFailed'));
        return;
      }
      toast.success(tSidebar('dealMoveSuccess'));
      await fetchContactData();
    } finally {
      setBusyDealId(null);
    }
  }

  function openNewDeal() {
    const defaultPipeline = pipelines[0];
    setNewDealTitle(
      contact?.name || contact?.instagram_username || contact?.phone || ''
    );
    setNewDealPipelineId(defaultPipeline?.id ?? '');
    setNewDealStageId(defaultPipeline?.stages[0]?.id ?? '');
    setNewDealValue('');
    setNewDealCurrency(defaultCurrency);
    setNewDealOpen(true);
  }

  function handleNewDealPipelineChange(pipelineId: string) {
    setNewDealPipelineId(pipelineId);
    const pipeline = pipelines.find((p) => p.id === pipelineId);
    setNewDealStageId(pipeline?.stages[0]?.id ?? '');
  }

  async function handleCreateDeal() {
    if (
      !contact ||
      !accountId ||
      !newDealTitle.trim() ||
      !newDealPipelineId ||
      !newDealStageId
    )
      return;
    setCreatingDeal(true);
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      toast.error(tSidebar('dealCreateFailed'));
      setCreatingDeal(false);
      return;
    }
    const { error } = await supabase.from('deals').insert({
      title: newDealTitle.trim(),
      value: parseFloat(newDealValue) || 0,
      currency: newDealCurrency,
      contact_id: contact.id,
      pipeline_id: newDealPipelineId,
      stage_id: newDealStageId,
      user_id: user.id,
      account_id: accountId,
      status: 'open',
    });
    setCreatingDeal(false);
    if (error) {
      toast.error(tSidebar('dealCreateFailed'));
      return;
    }
    toast.success(tSidebar('dealCreateSuccess'));
    setNewDealOpen(false);
    await fetchContactData();
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

  async function handleDeleteDeal() {
    if (!confirmDeleteDeal) return;
    setDeletingDeal(true);
    try {
      const { error } = await createClient()
        .from('deals')
        .delete()
        .eq('id', confirmDeleteDeal.id);
      if (error) {
        toast.error(tSidebar('dealDeleteFailed'));
        return;
      }
      toast.success(tSidebar('dealDeleteSuccess'));
      setConfirmDeleteDeal(null);
      await fetchContactData();
    } finally {
      setDeletingDeal(false);
    }
  }

  async function handleDeleteQuote() {
    if (!confirmDeleteQuote) return;
    setDeletingQuote(true);
    try {
      const res = await fetch(`/api/quotes/${confirmDeleteQuote.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await readResponseJson(res).catch(() => ({}));
        toast.error(data.error || tSidebar('quoteDeleteFailed'));
        return;
      }
      toast.success(tSidebar('quoteDeleteSuccess'));
      setConfirmDeleteQuote(null);
      await fetchContactData();
    } finally {
      setDeletingQuote(false);
    }
  }

  async function handleTemperatureChange(
    value: LeadTemperature | 'unclassified'
  ) {
    if (!contact) return;
    setTemperature(value);
    setSavingTemperature(true);
    try {
      const res = await fetch(`/api/contacts/${contact.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_temperature: value === 'unclassified' ? null : value,
        }),
      });
      if (!res.ok) {
        const data = await readResponseJson(res).catch(() => ({}));
        toast.error(data.error || tSidebar('temperatureSaveFailed'));
        return;
      }
    } finally {
      setSavingTemperature(false);
    }
  }

  function startEditingPhone() {
    setPhoneDraft(phone ?? '');
    setPhoneEditing(true);
  }

  async function handleSavePhone() {
    if (!contact || !phoneDraft.trim()) return;
    setSavingPhone(true);
    try {
      const res = await fetch(`/api/contacts/${contact.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneDraft.trim() }),
      });
      const data = await readResponseJson(res).catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || tSidebar('phoneSaveFailed'));
        return;
      }
      setPhone((data.phone as string | undefined) ?? phoneDraft.trim());
      setPhoneEditing(false);
      toast.success(tSidebar('phoneSaveSuccess'));
    } finally {
      setSavingPhone(false);
    }
  }

  async function handleViewQuotePdf(quote: Quote) {
    let url = quote.pdf_url;
    if (!url) {
      const res = await fetch(`/api/quotes/${quote.id}/pdf`, {
        method: 'POST',
      });
      const data = await readResponseJson(res).catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || tSidebar('quotePdfFailed'));
        return;
      }
      url = data.pdf_url;
      await fetchContactData();
    }
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function handleResendQuote(quote: Quote) {
    setSendingQuoteId(quote.id);
    try {
      const res = await fetch(`/api/quotes/${quote.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          conversationId ? { conversation_id: conversationId } : {}
        ),
      });
      const data = await readResponseJson(res).catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || tSidebar('quoteSendFailed'));
        return;
      }
      toast.success(tSidebar('quoteSendSuccess'));
      await fetchContactData();
    } finally {
      setSendingQuoteId(null);
    }
  }

  if (!contact) {
    return (
      <div
        className={cn(
          'border-border bg-card flex h-full w-70 items-center justify-center border-l',
          className
        )}
      >
        <p className="text-muted-foreground text-sm">
          {tThread('selectConversation')}
        </p>
      </div>
    );
  }

  const displayName =
    contact.name || contact.instagram_username || contact.phone || '';
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div
      className={cn(
        'border-border bg-card flex h-full w-70 flex-col border-l',
        className
      )}
    >
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="bg-muted text-foreground flex h-16 w-16 items-center justify-center rounded-full text-lg font-semibold">
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
            <h3 className="text-foreground mt-3 text-sm font-semibold">
              {displayName}
            </h3>
            {contact.company && (
              <p className="text-muted-foreground text-xs">{contact.company}</p>
            )}
          </div>

          {/* Phone — always shown and editable, even for an
              Instagram/Facebook contact with no phone identity yet, so
              an agent or the AI has somewhere to record the number once
              the customer shares it in chat. That number then feeds the
              KPIs Excel export's Contacts sheet automatically. */}
          <div className="mt-4 space-y-2">
            {phoneEditing ? (
              <div className="flex items-center gap-1.5 px-1">
                <Input
                  autoFocus
                  value={phoneDraft}
                  onChange={(e) => setPhoneDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSavePhone();
                    if (e.key === 'Escape') setPhoneEditing(false);
                  }}
                  placeholder="+502 5555 5555"
                  className="border-border bg-muted h-8 flex-1 text-sm"
                />
                <Button
                  size="sm"
                  className="bg-primary hover:bg-primary/90 h-8 w-8 p-0"
                  disabled={!phoneDraft.trim() || savingPhone}
                  onClick={handleSavePhone}
                >
                  {savingPhone ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Check className="size-3.5" />
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-foreground h-8 w-8 p-0"
                  disabled={savingPhone}
                  onClick={() => setPhoneEditing(false)}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ) : phone ? (
              <div className="group text-muted-foreground hover:bg-muted flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors">
                <Phone className="text-muted-foreground h-4 w-4" />
                <button onClick={handleCopyPhone} className="flex-1 text-left">
                  {phone}
                </button>
                <button
                  onClick={handleCopyPhone}
                  aria-label={tSidebar('copyPhone')}
                  className="shrink-0"
                >
                  {copied ? (
                    <Check className="text-primary h-3 w-3" />
                  ) : (
                    <Copy className="text-muted-foreground h-3 w-3" />
                  )}
                </button>
                <button
                  onClick={startEditingPhone}
                  aria-label={tSidebar('editPhone')}
                  className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Pencil className="text-muted-foreground h-3 w-3" />
                </button>
              </div>
            ) : (
              <button
                onClick={startEditingPhone}
                className="text-muted-foreground hover:bg-muted flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors"
              >
                <Phone className="text-muted-foreground h-4 w-4" />
                <span className="flex-1 text-left">{tSidebar('addPhone')}</span>
                <Plus className="text-muted-foreground h-3 w-3" />
              </button>
            )}

            {contact.instagram_username && (
              <div className="text-muted-foreground flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm">
                <Camera className="text-muted-foreground h-4 w-4" />
                <span className="flex-1 text-left">
                  @{contact.instagram_username}
                </span>
              </div>
            )}

            {contact.facebook_username && (
              <div className="text-muted-foreground flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm">
                <Camera className="text-muted-foreground h-4 w-4" />
                <span className="flex-1 text-left">
                  {contact.facebook_username}
                </span>
              </div>
            )}

            {contact.email && (
              <div className="text-muted-foreground flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
                <Mail className="text-muted-foreground h-4 w-4" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="border-border my-4 border-t" />

          {/* Temperature */}
          <div>
            <div className="text-muted-foreground flex items-center gap-2 px-1 text-xs font-medium tracking-wider uppercase">
              <Thermometer className="h-3 w-3" />
              {tSidebar('temperature')}
            </div>
            <div className="mt-2 flex items-center gap-2 px-1">
              <LeadTemperatureBadge
                value={temperature === 'unclassified' ? null : temperature}
                labels={{
                  cold: tTemp('temperatureCold'),
                  warm: tTemp('temperatureWarm'),
                  hot: tTemp('temperatureHot'),
                }}
              />
              <Select
                value={temperature}
                onValueChange={(value) =>
                  value &&
                  handleTemperatureChange(
                    value as LeadTemperature | 'unclassified'
                  )
                }
                disabled={savingTemperature}
                items={{
                  unclassified: tTemp('temperatureUnclassified'),
                  cold: tTemp('temperatureCold'),
                  warm: tTemp('temperatureWarm'),
                  hot: tTemp('temperatureHot'),
                }}
              >
                <SelectTrigger className="bg-muted border-border h-7 flex-1 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unclassified">
                    {tTemp('temperatureUnclassified')}
                  </SelectItem>
                  <SelectItem value="cold">
                    {tTemp('temperatureCold')}
                  </SelectItem>
                  <SelectItem value="warm">
                    {tTemp('temperatureWarm')}
                  </SelectItem>
                  <SelectItem value="hot">{tTemp('temperatureHot')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Divider */}
          <div className="border-border my-4 border-t" />

          {/* Tags — click any tag to apply/remove it from this contact.
              Creating a brand-new tag stays Settings-only (Fields &
              tags); this list only toggles ones that already exist. */}
          <div>
            <div className="text-muted-foreground flex items-center gap-2 px-1 text-xs font-medium tracking-wider uppercase">
              <TagIcon className="h-3 w-3" />
              {tSidebar('tags')}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {allTags.length === 0 ? (
                <p className="text-muted-foreground px-1 text-xs">
                  {tSidebar('noTagsInAccount')}
                </p>
              ) : (
                allTags.map((tag) => {
                  const applied = tags.some((t) => t.id === tag.id);
                  const saving = savingTagId === tag.id;
                  return (
                    <button
                      key={tag.id}
                      onClick={() => toggleTag(tag.id)}
                      disabled={saving}
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-opacity ${
                        applied ? '' : 'opacity-50 hover:opacity-80'
                      }`}
                      style={{
                        backgroundColor: `${tag.color}20`,
                        color: tag.color,
                        ...(applied
                          ? { boxShadow: `inset 0 0 0 1px ${tag.color}` }
                          : {}),
                      }}
                    >
                      {saving ? (
                        <Loader2 className="size-2.5 animate-spin" />
                      ) : (
                        applied && <Check className="size-2.5" />
                      )}
                      {tag.name}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="border-border my-4 border-t" />

          {/* Active Deals */}
          <div>
            <div className="flex items-center justify-between px-1">
              <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wider uppercase">
                <DollarSign className="h-3 w-3" />
                {tSidebar('deals')}
              </div>
              {!newDealOpen && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-foreground h-6 px-1.5 text-xs"
                  disabled={pipelines.length === 0}
                  onClick={openNewDeal}
                >
                  <Plus className="h-3 w-3" />
                  {tSidebar('newDeal')}
                </Button>
              )}
            </div>
            <div className="mt-2 space-y-2">
              {newDealOpen && (
                <div className="border-border bg-muted space-y-1.5 rounded-lg border px-3 py-2">
                  <Input
                    autoFocus
                    value={newDealTitle}
                    onChange={(e) => setNewDealTitle(e.target.value)}
                    placeholder={tSidebar('dealTitlePlaceholder')}
                    className="border-border bg-card h-7 text-xs"
                  />
                  {pipelines.length > 1 && (
                    <Select
                      value={newDealPipelineId}
                      onValueChange={(v) => v && handleNewDealPipelineChange(v)}
                      items={Object.fromEntries(
                        pipelines.map((p) => [p.id, p.name])
                      )}
                    >
                      <SelectTrigger className="bg-card border-border h-7 w-full text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {pipelines.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <Select
                    value={newDealStageId}
                    onValueChange={(v) => v && setNewDealStageId(v)}
                    items={Object.fromEntries(
                      (
                        pipelines.find((p) => p.id === newDealPipelineId)
                          ?.stages ?? []
                      ).map((s) => [s.id, s.name])
                    )}
                  >
                    <SelectTrigger className="bg-card border-border h-7 w-full text-xs">
                      <SelectValue
                        placeholder={tSidebar('dealStagePlaceholder')}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {(
                        pipelines.find((p) => p.id === newDealPipelineId)
                          ?.stages ?? []
                      ).map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex gap-1.5">
                    <div className="relative flex-1">
                      <DollarSign className="text-muted-foreground absolute top-1/2 left-2 h-3 w-3 -translate-y-1/2" />
                      <Input
                        type="number"
                        value={newDealValue}
                        onChange={(e) => setNewDealValue(e.target.value)}
                        placeholder="0"
                        className="border-border bg-card h-7 pl-6 text-xs"
                      />
                    </div>
                    <select
                      value={newDealCurrency}
                      onChange={(e) => setNewDealCurrency(e.target.value)}
                      className="border-border bg-card text-foreground focus:border-primary h-7 w-[4.5rem] rounded-lg border px-1.5 text-xs outline-none"
                    >
                      {CURRENCIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-1.5 pt-0.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-border text-muted-foreground hover:bg-muted h-7 flex-1 text-xs"
                      disabled={creatingDeal}
                      onClick={() => setNewDealOpen(false)}
                    >
                      {tSidebar('cancel')}
                    </Button>
                    <Button
                      size="sm"
                      className="bg-primary text-primary-foreground hover:bg-primary/90 h-7 flex-1 text-xs"
                      disabled={
                        creatingDeal || !newDealTitle.trim() || !newDealStageId
                      }
                      onClick={handleCreateDeal}
                    >
                      {creatingDeal ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        tSidebar('createDeal')
                      )}
                    </Button>
                  </div>
                </div>
              )}
              {deals.length === 0 && !newDealOpen ? (
                <p className="text-muted-foreground px-1 text-xs">
                  {tSidebar('noDeals')}
                </p>
              ) : (
                deals.map((deal) => {
                  const stages = stagesByPipeline[deal.pipeline_id] ?? [];
                  const wonStageId = wonStageIdFor(deal.pipeline_id);
                  const isWon =
                    deal.status === 'won' || deal.stage_id === wonStageId;
                  const busy = busyDealId === deal.id;
                  return (
                    <div
                      key={deal.id}
                      className="group bg-muted rounded-lg px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-foreground text-sm font-medium">
                          {deal.title}
                        </p>
                        <button
                          onClick={() => setConfirmDeleteDeal(deal)}
                          aria-label={tSidebar('deleteDeal')}
                          className="text-muted-foreground hover:text-destructive shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                      <div className="text-muted-foreground mt-1 flex items-center justify-between text-xs">
                        <span>
                          {deal.currency ?? '$'}
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
                              if (stageId && stageId !== deal.stage_id)
                                moveDealStage(deal, stageId);
                            }}
                            disabled={busy}
                            items={Object.fromEntries(
                              stages.map((s) => [s.id, s.name])
                            )}
                          >
                            <SelectTrigger className="bg-card border-border h-7 w-full text-xs">
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
                              className="h-7 w-full border-emerald-700/50 bg-emerald-950/20 text-xs text-emerald-300 hover:bg-emerald-950/40"
                              disabled={busy}
                              onClick={() => setConfirmWinDeal(deal)}
                            >
                              {busy ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <Trophy className="size-3" />
                              )}
                              {tSidebar('markWon')}
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
          <div className="border-border my-4 border-t" />

          {/* Quotes */}
          <div>
            <div className="flex items-center justify-between px-1">
              <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wider uppercase">
                <FileText className="h-3 w-3" />
                {tSidebar('quotes')}
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground hover:text-foreground h-6 px-1.5 text-xs"
                disabled={!canManageProducts}
                onClick={() => setQuoteBuilderOpen(true)}
              >
                <Plus className="h-3 w-3" />
                {tSidebar('newQuote')}
              </Button>
            </div>
            <div className="mt-2 space-y-2">
              {quotes.length === 0 ? (
                <p className="text-muted-foreground px-1 text-xs">
                  {tSidebar('noQuotes')}
                </p>
              ) : (
                quotes.map((quote) => (
                  <div key={quote.id} className="bg-muted rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between">
                      <p className="text-foreground text-sm font-medium">
                        {formatCurrency(quote.total, quote.currency)}
                      </p>
                      <span className="text-muted-foreground text-[10px] uppercase">
                        {quote.status}
                      </span>
                    </div>
                    <div className="mt-1.5 flex gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-border h-6 flex-1 text-[11px]"
                        onClick={() => handleViewQuotePdf(quote)}
                      >
                        <FileText className="size-3" />
                        {tSidebar('viewPdf')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-border h-6 flex-1 text-[11px]"
                        disabled={
                          !canManageProducts || sendingQuoteId === quote.id
                        }
                        onClick={() => handleResendQuote(quote)}
                      >
                        {sendingQuoteId === quote.id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Send className="size-3" />
                        )}
                        {tSidebar('resend')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-border text-muted-foreground hover:border-destructive/50 hover:text-destructive h-6 w-6 shrink-0 p-0"
                        disabled={!canManageProducts}
                        onClick={() => setConfirmDeleteQuote(quote)}
                        aria-label={tSidebar('deleteQuote')}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="border-border my-4 border-t" />

          {/* Notes */}
          <div>
            <div className="text-muted-foreground flex items-center gap-2 px-1 text-xs font-medium tracking-wider uppercase">
              <StickyNote className="h-3 w-3" />
              {tSidebar('notes')}
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder={tSidebar('addNotePlaceholder')}
                  rows={2}
                  className="border-border bg-muted text-foreground placeholder-muted-foreground focus:border-primary/50 flex-1 resize-none rounded-lg border px-3 py-2 text-xs outline-none"
                />
                <Button
                  size="sm"
                  className="bg-primary hover:bg-primary/90 h-auto px-2"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {notes.map((note) => (
                  <div key={note.id} className="bg-muted rounded-lg px-3 py-2">
                    <p className="text-muted-foreground text-xs whitespace-pre-wrap">
                      {note.note_text}
                    </p>
                    <p className="text-muted-foreground mt-1 text-[10px]">
                      {format(new Date(note.created_at), 'MMM d, yyyy HH:mm')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>

      <Dialog
        open={confirmWinDeal != null}
        onOpenChange={(open) => !open && setConfirmWinDeal(null)}
      >
        <DialogContent className="border-border bg-popover sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {tSidebar('confirmWonTitle')}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {tSidebar('confirmWonDesc', {
                title: confirmWinDeal?.title ?? '',
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmWinDeal(null)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {tSidebar('cancel')}
            </Button>
            <Button
              onClick={handleConfirmWon}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Trophy className="size-4" />
              {tSidebar('confirmWonBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmDeleteDeal != null}
        onOpenChange={(open) => !open && setConfirmDeleteDeal(null)}
      >
        <DialogContent className="border-border bg-popover sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {tSidebar('deleteDealTitle')}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {tSidebar('deleteDealDesc', {
                title: confirmDeleteDeal?.title ?? '',
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDeleteDeal(null)}
              className="border-border text-muted-foreground hover:bg-muted"
              disabled={deletingDeal}
            >
              {tSidebar('cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteDeal}
              disabled={deletingDeal}
            >
              {deletingDeal ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              {tSidebar('deleteDealBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmDeleteQuote != null}
        onOpenChange={(open) => !open && setConfirmDeleteQuote(null)}
      >
        <DialogContent className="border-border bg-popover sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {tSidebar('deleteQuoteTitle')}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {tSidebar('deleteQuoteDesc')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDeleteQuote(null)}
              className="border-border text-muted-foreground hover:bg-muted"
              disabled={deletingQuote}
            >
              {tSidebar('cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteQuote}
              disabled={deletingQuote}
            >
              {deletingQuote ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              {tSidebar('deleteQuoteBtn')}
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
