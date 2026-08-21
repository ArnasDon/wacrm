'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Broadcast, BroadcastRecipient } from '@/types';
import { resolveExternalMessage } from '@/lib/whatsapp/external-message';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  Pencil,
  Trash2,
  RotateCcw,
  CheckCircle2,
  Download,
  Loader2,
  X,
  Check,
} from 'lucide-react';

interface ExportedRecipient {
  id: string;
  contact_id: string | null;
  name: string;
  phone: string;
  message: string;
  order: number;
}

interface Props {
  campaign: Broadcast;
  /** Only 'pending' recipients — the ones still eligible for review (spec section 3). */
  recipients: BroadcastRecipient[];
  onRefresh: () => Promise<void>;
}

/**
 * "Pré-visualizar → revisar individualmente → aprovar → exportar" for
 * 'external'-channel campaigns (migration 077). WACRM computes each
 * recipient's message from campaign.message_text ({{nome}} → contact
 * name) but never sends it — this component only edits
 * broadcast_recipients.message_text / removes rows / sets
 * broadcasts.approved_at, all via the same tables and RLS policies
 * the rest of Campaigns already uses. After approval the list is
 * read-only and the exported file is exactly what was approved.
 */
export function ExternalCampaignReview({ campaign, recipients, onRefresh }: Props) {
  const t = useTranslations('Campaigns.detail');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [exporting, setExporting] = useState(false);

  const isApproved = Boolean(campaign.approved_at);
  const template = campaign.message_text ?? '';

  // Send order = the order recipients were added to the campaign, not
  // the "newest first" order the parent page displays the status
  // table in — a review/export list reads naturally top-to-bottom as
  // "who goes first".
  const ordered = [...recipients].sort((a, b) => a.created_at.localeCompare(b.created_at));

  function messageFor(r: BroadcastRecipient): string {
    if (r.message_text != null && r.message_text !== '') return r.message_text;
    return resolveExternalMessage(template, { name: r.contact?.name, phone: r.contact?.phone });
  }

  function startEdit(r: BroadcastRecipient) {
    setEditingId(r.id);
    setDraft(messageFor(r));
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft('');
  }

  async function saveEdit(r: BroadcastRecipient) {
    setBusyId(r.id);
    const supabase = createClient();
    const { error } = await supabase
      .from('broadcast_recipients')
      .update({ message_text: draft })
      .eq('id', r.id);
    setBusyId(null);
    if (error) {
      toast.error(t('toastEditFailed', { error: error.message }));
      return;
    }
    setEditingId(null);
    await onRefresh();
  }

  async function resetToDefault(r: BroadcastRecipient) {
    if (r.message_text == null) return;
    setBusyId(r.id);
    const supabase = createClient();
    const { error } = await supabase
      .from('broadcast_recipients')
      .update({ message_text: null })
      .eq('id', r.id);
    setBusyId(null);
    if (error) {
      toast.error(t('toastEditFailed', { error: error.message }));
      return;
    }
    await onRefresh();
  }

  async function removeRecipient(r: BroadcastRecipient) {
    setBusyId(r.id);
    const supabase = createClient();
    const { error: delErr } = await supabase
      .from('broadcast_recipients')
      .delete()
      .eq('id', r.id);
    if (!delErr) {
      // total_recipients isn't trigger-maintained (only the per-status
      // counts are) — keep it accurate by hand, same discipline
      // addCampaignRecipients already uses when growing the list.
      await supabase
        .from('broadcasts')
        .update({ total_recipients: Math.max(0, campaign.total_recipients - 1) })
        .eq('id', campaign.id);
    }
    setBusyId(null);
    if (delErr) {
      toast.error(t('toastRemoveFailed', { error: delErr.message }));
      return;
    }
    toast.success(t('toastRemoved'));
    await onRefresh();
  }

  async function approve() {
    if (ordered.length === 0) {
      toast.error(t('toastNoRecipientsToApprove'));
      return;
    }
    setApproving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from('broadcasts')
      .update({ approved_at: new Date().toISOString() })
      .eq('id', campaign.id);
    setApproving(false);
    if (error) {
      toast.error(t('toastApproveFailed', { error: error.message }));
      return;
    }
    toast.success(t('toastApproved'));
    await onRefresh();
  }

  async function exportPackage() {
    setExporting(true);
    try {
      const exportRecipients: ExportedRecipient[] = ordered.map((r, i) => ({
        id: r.id,
        contact_id: r.contact_id,
        name: r.contact?.name ?? '',
        phone: r.contact?.phone ?? '',
        message: messageFor(r),
        order: i + 1,
      }));

      const payload = {
        campaign: {
          id: campaign.id,
          name: campaign.name,
          type: 'external',
          created_at: campaign.created_at,
          approved_at: campaign.approved_at,
        },
        // The creative is already a hosted URL (the wizard never
        // uploads a local file for 'external' campaigns) — Cloud Code
        // fetches it itself. No binary bundling needed.
        creative: campaign.header_media_url ? { url: campaign.header_media_url } : null,
        recipients: exportRecipients,
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = campaign.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
      a.download = `campanha-${safeName}-${campaign.id.slice(0, 8)}-cloudcode.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      const supabase = createClient();
      await supabase
        .from('broadcasts')
        .update({ exported_at: new Date().toISOString() })
        .eq('id', campaign.id);
      toast.success(t('toastExported'));
      await onRefresh();
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">
            {isApproved ? t('reviewTitleApproved') : t('reviewTitle')}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {isApproved
              ? t('reviewSubtitleApproved', {
                  date: campaign.approved_at
                    ? new Date(campaign.approved_at).toLocaleString()
                    : '',
                })
              : t('reviewSubtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!isApproved && (
            <Button
              size="sm"
              disabled={approving || ordered.length === 0}
              onClick={approve}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {approving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              {t('approveCampaign')}
            </Button>
          )}
          {isApproved && (
            <Button
              size="sm"
              disabled={exporting}
              onClick={exportPackage}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {exporting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {t('exportForCloudCode')}
            </Button>
          )}
        </div>
      </div>

      {ordered.length === 0 ? (
        <div className="flex h-24 items-center justify-center">
          <p className="text-sm text-muted-foreground">{t('noRecipients')}</p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {ordered.map((r, i) => {
            const isEditing = editingId === r.id;
            const isOverridden = r.message_text != null && r.message_text !== '';
            const displayText = messageFor(r);
            const isBusy = busyId === r.id;
            return (
              <div key={r.id} className="p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">#{i + 1}</span>
                    <p className="text-sm font-medium text-foreground">
                      {r.contact?.name ?? t('unknownContact')}
                    </p>
                    <span className="text-xs text-muted-foreground">{r.contact?.phone}</span>
                    {isOverridden && (
                      <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        {t('edited')}
                      </span>
                    )}
                  </div>
                  {!isApproved && !isEditing && (
                    <div className="flex items-center gap-1">
                      {isOverridden && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isBusy}
                          onClick={() => resetToDefault(r)}
                          className="h-7 border-border text-muted-foreground hover:bg-muted"
                          title={t('resetToDefault')}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isBusy}
                        onClick={() => startEdit(r)}
                        className="h-7 border-border text-muted-foreground hover:bg-muted"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        {t('editMessage')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isBusy}
                        onClick={() => removeRecipient(r)}
                        className="h-7 border-red-500/30 text-red-400 hover:bg-red-500/10"
                      >
                        {isBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                        {t('removeRecipient')}
                      </Button>
                    </div>
                  )}
                </div>

                {campaign.header_media_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={campaign.header_media_url}
                    alt="Creative"
                    className="mb-2 max-h-32 rounded-lg border border-border object-contain"
                  />
                )}

                {isEditing ? (
                  <div className="space-y-2">
                    <Textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      className="min-h-24 border-border bg-muted text-foreground"
                      autoFocus
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        disabled={isBusy || !draft.trim()}
                        onClick={() => saveEdit(r)}
                        className="h-7 bg-primary text-primary-foreground hover:bg-primary/90"
                      >
                        {isBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                        {t('saveEdit')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isBusy}
                        onClick={cancelEdit}
                        className="h-7 border-border text-muted-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                        {t('cancel')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg bg-[#0e1a12] p-3">
                    <div className="max-w-[85%] rounded-lg bg-primary/30 px-3 py-2 shadow-sm">
                      <p className="whitespace-pre-wrap text-sm text-white">{displayText}</p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
