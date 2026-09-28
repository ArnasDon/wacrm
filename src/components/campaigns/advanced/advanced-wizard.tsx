'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Layers, Loader2 } from 'lucide-react';
import { PageHero } from '@/components/layout/page-hero';
import { WizardFooter, WizardShell } from '@/components/campaigns/wizard-shell';
import { WizardStepper } from '@/components/campaigns/wizard-stepper';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { createClient } from '@/lib/supabase/client';
import {
  ADVANCED_DRAFT_KEY,
  clearDraft,
  loadDraft,
  saveDraft,
} from '@/lib/campaigns/draft-storage';
import {
  SPEED_DEFAULT,
  referencedColumns,
  templateKey,
} from '@/lib/campaigns/advanced';
import type { MessageTemplate } from '@/types';
import type { Channel } from '@/components/whatsapp/channel-types';
import { Button } from '@/components/ui/button';
import { TestTemplateDialog } from '@/components/templates/test-template-dialog';
import { StepSetup } from './step-setup';
import { StepAudience } from './step-audience';
import { StepVariables } from './step-variables';
import { StepLaunch, toLocalInput } from './step-launch';
import {
  audienceStats,
  effectiveMappings,
  groupTemplates,
  mappingsComplete,
  type WizardState,
} from './types';

const STEPS = ['setup', 'audience', 'variables', 'launch'] as const;

/**
 * Advanced campaign wizard: channels + ordered templates + speed →
 * CSV upload and column pick → variable mapping per template → name,
 * schedule, launch. The server does the sending (advanced-runner).
 */
export function AdvancedCampaignWizard({
  initialName = '',
}: {
  initialName?: string;
}) {
  const t = useTranslations('Broadcasts.advanced');
  const tBadge = useTranslations('Broadcasts.detail.advancedInfo');
  const router = useRouter();

  const [channels, setChannels] = useState<Channel[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  // A refresh restores the tab's draft (see draft-storage).
  const [draft] = useState(() =>
    loadDraft<{ state: WizardState; step: number }>(ADVANCED_DRAFT_KEY)
  );
  const [step, setStep] = useState(draft?.step ?? 0);
  const [submitting, setSubmitting] = useState(false);
  const [minSchedule] = useState(() => toLocalInput(new Date()));
  const [state, setState] = useState<WizardState>(
    () =>
      draft?.state ?? {
        channelIds: [],
        templates: [],
        speed: SPEED_DEFAULT,
        csv: null,
        phoneColumn: null,
        nameColumn: null,
        mappings: {},
        sameValues: true,
        shared: { body: {} },
        name: initialName,
        scheduleMode: 'now',
        scheduleAt: toLocalInput(new Date(Date.now() + 60 * 60 * 1000)),
      }
  );

  useEffect(() => {
    saveDraft(ADVANCED_DRAFT_KEY, { state, step }, (d) => ({
      // Too big to keep the CSV: keep the rest, send the user back to
      // the upload step.
      state: { ...d.state, csv: null },
      step: Math.min(d.step, 1),
    }));
  }, [state, step]);
  const update = (patch: Partial<WizardState>) =>
    setState((s) => ({ ...s, ...patch }));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [channelRes, { data: rows }] = await Promise.all([
        fetch('/api/whatsapp/channels', { cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : { channels: [] }))
          .catch(() => ({ channels: [] })),
        createClient()
          .from('message_templates')
          .select('*')
          .eq('status', 'APPROVED')
          .order('name'),
      ]);
      if (cancelled) return;
      const list = (channelRes.channels ?? []) as Channel[];
      setChannels(list);
      setTemplates((rows ?? []) as MessageTemplate[]);
      // One connected channel? Pre-select it.
      const connected = list.filter((c) => c.status === 'connected');
      if (connected.length === 1)
        setState((s) => ({ ...s, channelIds: [connected[0].id] }));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(
    () => groupTemplates(templates, channels, state.channelIds),
    [templates, channels, state.channelIds]
  );
  const templateCountByChannel = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of channels) {
      m.set(c.id, groupTemplates(templates, [c], [c.id]).length);
    }
    return m;
  }, [templates, channels]);
  const stats = useMemo(
    () => audienceStats(state.csv, state.phoneColumn),
    [state.csv, state.phoneColumn]
  );
  const [testing, setTesting] = useState<MessageTemplate | null>(null);

  // A template stops being available when its channel is deselected.
  const liveTemplates = state.templates.filter((ref) =>
    groups.some((g) => g.key === templateKey(ref))
  );
  const covered = state.channelIds.every((id) =>
    liveTemplates.some((ref) =>
      groups.find((g) => g.key === templateKey(ref))?.channelIds.includes(id)
    )
  );

  const scheduleDate = new Date(state.scheduleAt);
  const canContinue = [
    state.channelIds.length > 0 && liveTemplates.length > 0 && covered,
    !!state.csv && !!state.phoneColumn && stats.valid > 0,
    mappingsComplete(groups, { ...state, templates: liveTemplates }),
    state.name.trim() !== '' &&
      (state.scheduleMode === 'now' ||
        (!Number.isNaN(scheduleDate.getTime()) &&
          scheduleDate.getTime() > Date.now())),
  ][step];

  async function launch() {
    if (!state.csv || !state.phoneColumn) return;
    if (!state.name.trim()) {
      toast.error(t('launch.errorName'));
      return;
    }
    if (
      state.scheduleMode === 'later' &&
      !(scheduleDate.getTime() > Date.now())
    ) {
      toast.error(t('launch.errorTime'));
      return;
    }
    setSubmitting(true);
    try {
      const csv = state.csv;
      const mappings = effectiveMappings({
        ...state,
        templates: liveTemplates,
      });
      const keep = [
        ...new Set([
          state.phoneColumn,
          ...referencedColumns({
            mappings,
            name_column: state.nameColumn,
          }),
        ]),
      ];
      const idx = keep.map((c) => csv.headers.indexOf(c));
      const rows = stats.validRows.map((i) =>
        Object.fromEntries(keep.map((c, k) => [c, csv.rows[i][idx[k]] ?? '']))
      );

      const res = await fetch('/api/campaigns/advanced', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: state.name.trim(),
          channel_ids: state.channelIds,
          templates: liveTemplates,
          phone_column: state.phoneColumn,
          name_column: state.nameColumn,
          mappings,
          speed: state.speed,
          schedule:
            state.scheduleMode === 'later'
              ? { mode: 'later', at: scheduleDate.toISOString() }
              : { mode: 'now' },
          rows,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error || `HTTP ${res.status}`);
        return;
      }
      toast.success(
        body.status === 'scheduled'
          ? t('launch.scheduled')
          : t('launch.started'),
        {
          description:
            stats.invalid || stats.duplicates
              ? t('launch.skipped', {
                  invalid: stats.invalid,
                  duplicates: stats.duplicates,
                })
              : undefined,
        }
      );
      clearDraft(ADVANCED_DRAFT_KEY);
      router.push(`/broadcasts/${body.broadcast_id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to launch');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <WizardShell>
      <PageHero
        icon={Layers}
        title={state.name.trim() || t('title')}
        description={t('subtitle')}
        actions={
          <span className="border-primary/30 bg-primary/10 text-primary rounded-full border px-3 py-1 font-mono text-[11px] tracking-[0.15em] uppercase">
            {tBadge('badge')}
          </span>
        }
      >
        <WizardStepper
          labels={STEPS.map((key) => t(`steps.${key}`))}
          current={step}
          onSelect={setStep}
        />
      </PageHero>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="text-primary size-6 animate-spin" />
        </div>
      ) : (
        <>
          {step === 0 ? (
            <StepSetup
              state={{ ...state, templates: liveTemplates }}
              update={update}
              channels={channels}
              groups={groups}
              templateCountByChannel={templateCountByChannel}
              onTest={(g) => setTesting(g.row)}
            />
          ) : step === 1 ? (
            <StepAudience state={state} update={update} stats={stats} />
          ) : step === 2 ? (
            <StepVariables
              state={{ ...state, templates: liveTemplates }}
              update={update}
              groups={groups}
              stats={stats}
            />
          ) : (
            <StepLaunch
              state={{ ...state, templates: liveTemplates }}
              update={update}
              channels={channels}
              stats={stats}
              minSchedule={minSchedule}
            />
          )}

          <WizardFooter>
            <Button
              variant="outline"
              onClick={() =>
                step === 0 ? router.push('/broadcasts/new') : setStep(step - 1)
              }
            >
              <ArrowLeft className="size-4" />
              {t('previous')}
            </Button>
            <div className="flex items-center gap-3">
              {step === 2 && !canContinue ? (
                <span className="hidden text-sm text-amber-700 sm:inline dark:text-amber-400">
                  {t('variables.incomplete')}
                </span>
              ) : null}
              {step < STEPS.length - 1 ? (
                <Button
                  onClick={() => setStep(step + 1)}
                  disabled={!canContinue}
                >
                  {t('next')}
                  <ArrowRight className="size-4" />
                </Button>
              ) : (
                <Button onClick={launch} disabled={!canContinue || submitting}>
                  {submitting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  {submitting
                    ? t('launch.launching')
                    : state.scheduleMode === 'later'
                      ? t('launch.schedule')
                      : t('launch.launch')}
                </Button>
              )}
            </div>
          </WizardFooter>
        </>
      )}

      <TestTemplateDialog
        template={testing}
        channels={channels.filter((c) => state.channelIds.includes(c.id))}
        onClose={() => setTesting(null)}
      />
    </WizardShell>
  );
}
