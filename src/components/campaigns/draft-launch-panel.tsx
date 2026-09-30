'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CalendarClock,
  Loader2,
  Pencil,
  Rocket,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import type { Channel } from '@/components/whatsapp/channel-types';
import {
  buildCampaignPayload,
  channelLabel,
  draftProblems,
  localAudience,
  toLocalInput,
  type WizardState,
} from '@/components/campaigns/wizard/state';
import { WIZARD_DRAFT_KEY, clearDraft } from '@/lib/campaigns/draft-storage';
import { createClient } from '@/lib/supabase/client';
import type { MessageTemplate } from '@/types';

/**
 * A saved draft on its campaign page ("Continue setup" lands here): what
 * it will send, what (if anything) still blocks it, and Launch now /
 * Schedule / Edit setup. Launching sends exactly what the wizard's own
 * Launch button would (buildCampaignPayload) and opens the new campaign.
 */
export function DraftLaunchPanel({
  draftId,
  state,
}: {
  draftId: string;
  state: WizardState;
}) {
  const t = useTranslations('Broadcasts.detail.draft');
  const format = useFormatter();
  const router = useRouter();
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [templates, setTemplates] = useState<MessageTemplate[] | null>(null);
  const [contactCount, setContactCount] = useState<number | null>(null);
  const [busy, setBusy] = useState<'launch' | 'schedule' | null>(null);
  const [scheduleAt, setScheduleAt] = useState(() =>
    new Date(state.scheduleAt).getTime() > Date.now()
      ? state.scheduleAt
      : toLocalInput(new Date(Date.now() + 60 * 60 * 1000))
  );
  const [minSchedule] = useState(() => toLocalInput(new Date()));

  // The draft as saved, with its own id so launching replaces the draft.
  const draft = useMemo(() => ({ ...state, draftId }), [state, draftId]);
  const a = draft.audience;
  const local = useMemo(() => localAudience(draft), [draft]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const db = createClient();
      const [ch, tpl] = await Promise.all([
        fetch('/api/whatsapp/channels', { cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : { channels: [] }))
          .catch(() => ({ channels: [] })),
        db
          .from('message_templates')
          .select('*')
          .eq('status', 'APPROVED')
          .order('name'),
      ]);
      if (cancelled) return;
      setChannels((ch.channels ?? []) as Channel[]);
      setTemplates((tpl.data ?? []) as MessageTemplate[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Contact audiences are counted by the server, as in the wizard.
  useEffect(() => {
    if (!(a.source === 'all' || a.source === 'tags' || a.source === 'segment'))
      return;
    let cancelled = false;
    fetch('/api/campaigns/audience-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: a.source,
        tagIds: a.source === 'tags' ? a.tagIds : [],
        tagMatch: a.tagMatch,
        segment: a.source === 'segment' ? a.segment : undefined,
        excludeTagIds: a.excludeTagIds,
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (!cancelled) setContactCount(b ? Number(b.valid ?? 0) : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [a.source, a.tagIds, a.tagMatch, a.segment, a.excludeTagIds]);

  const ready = channels !== null && templates !== null;
  const problems = ready ? draftProblems(draft, channels, templates) : [];
  const recipients = local ? local.stats.valid : contactCount;
  const blocked =
    !ready || problems.length > 0 || (!local && contactCount === 0);

  const editSetup = () => {
    clearDraft(WIZARD_DRAFT_KEY);
    router.push(`/broadcasts/new?draft=${draftId}`);
  };

  async function launch(kind: 'launch' | 'schedule') {
    if (!ready) return;
    const at = new Date(scheduleAt);
    if (kind === 'schedule' && !(at.getTime() > Date.now())) {
      toast.error(t('scheduleInPast'));
      return;
    }
    setBusy(kind);
    try {
      const res = await fetch('/api/campaigns/advanced', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          buildCampaignPayload(
            draft,
            templates,
            kind === 'schedule'
              ? { mode: 'later', at: at.toISOString() }
              : { mode: 'now' }
          )
        ),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error || `HTTP ${res.status}`);
        return;
      }
      toast.success(kind === 'schedule' ? t('scheduled') : t('launched'));
      // The draft became this campaign (the API removed the draft row).
      router.replace(`/broadcasts/${body.broadcast_id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(null);
    }
  }

  const channelName = (id: string) => {
    const c = channels?.find((x) => x.id === id);
    return c ? channelLabel(c) : '—';
  };

  return (
    <section className="border-primary/30 bg-card space-y-5 rounded-xl border p-4 sm:p-6">
      <div>
        <h3 className="text-foreground text-lg font-semibold">{t('title')}</h3>
        <p className="text-muted-foreground mt-0.5 text-sm">{t('subtitle')}</p>
      </div>

      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground text-xs tracking-wide uppercase">
            {t('type')}
          </dt>
          <dd className="text-foreground mt-1">
            {draft.mode === 'standard' ? t('standard') : t('advanced')}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs tracking-wide uppercase">
            {t('audience')}
          </dt>
          <dd className="text-foreground mt-1">
            {a.source ? t(`sources.${a.source}`) : '—'}
            {recipients != null ? (
              <span className="text-muted-foreground">
                {' · '}
                {t('recipients', { count: recipients })}
              </span>
            ) : null}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground text-xs tracking-wide uppercase">
            {t('channelsTemplates')}
          </dt>
          <dd className="mt-1 space-y-1">
            {draft.channelIds.length === 0 ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              draft.channelIds.map((id) => (
                <div key={id} className="text-foreground">
                  <span className="font-medium">{channelName(id)}</span>
                  <span className="text-muted-foreground">
                    {' → '}
                    {(draft.channelTemplates[id] ?? [])
                      .map((r) => r.name)
                      .join(', ') || '—'}
                  </span>
                </div>
              ))
            )}
          </dd>
        </div>
      </dl>

      {!ready ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" />
          {t('checking')}
        </p>
      ) : problems.length > 0 ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <p className="text-foreground flex items-center gap-2 font-medium">
            <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
            {t('problemsTitle')}
          </p>
          <ul className="text-muted-foreground mt-2 list-disc space-y-1 pl-6">
            {problems.map((p) => (
              <li key={p}>{t(`problems.${p}`)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <Button
          onClick={() => launch('launch')}
          disabled={blocked || busy !== null}
        >
          {busy === 'launch' ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Rocket className="size-4" />
          )}
          {t('launchNow')}
        </Button>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-muted-foreground flex flex-col gap-1 text-xs">
            {t('scheduleAt')}
            <input
              type="datetime-local"
              value={scheduleAt}
              min={minSchedule}
              onChange={(e) => setScheduleAt(e.target.value)}
              className="border-input bg-background text-foreground h-9 rounded-md border px-2 text-sm"
            />
          </label>
          <Button
            variant="outline"
            onClick={() => launch('schedule')}
            disabled={blocked || busy !== null}
          >
            {busy === 'schedule' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CalendarClock className="size-4" />
            )}
            {t('schedule')}
          </Button>
        </div>
        <Button variant="ghost" onClick={editSetup} disabled={busy !== null}>
          <Pencil className="size-4" />
          {t('editSetup')}
        </Button>
      </div>
      {scheduleAt ? (
        <p className="text-muted-foreground text-xs">
          {t('scheduleHint', {
            at: format.dateTime(new Date(scheduleAt), {
              dateStyle: 'medium',
              timeStyle: 'short',
            }),
          })}
        </p>
      ) : null}
    </section>
  );
}
