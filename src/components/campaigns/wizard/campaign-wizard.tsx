'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, Loader2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { SPEED_MAX, templateKey } from '@/lib/campaigns/advanced';
import {
  WIZARD_DRAFT_KEY,
  clearDraft,
  loadDraft,
  saveDraft,
} from '@/lib/campaigns/draft-storage';
import type { MessageTemplate } from '@/types';
import type { Channel } from '@/components/whatsapp/channel-types';
import { Button } from '@/components/ui/button';
import { TestTemplateDialog } from '@/components/templates/test-template-dialog';
import { WizardFooter, WizardShell } from '@/components/campaigns/wizard-shell';
import { StepBasics } from './step-basics';
import { StepAudience } from './step-audience';
import { StepTemplates } from './step-templates';
import { StepDistribution } from './step-distribution';
import { StepReview, type ReviewChecks } from './step-review';
import {
  chosenTemplates,
  csvRowObjects,
  initialState,
  manualRows,
  missingCount,
  rowFor,
  rowStats,
  stepsFor,
  templatesForChannel,
  toLocalInput,
  unionSlots,
  type AudienceStats,
  type CustomFieldOption,
  type Mode,
  type StepKey,
  type TagOption,
  type WizardState,
  buildCampaignPayload,
  type LaunchSchedule,
} from './state';

const SESSION_KEY = WIZARD_DRAFT_KEY;

interface Props {
  initialMode: Mode;
  initialName?: string;
  /** Open this saved draft (broadcasts row, status 'draft'). */
  draftId?: string | null;
}

/**
 * The campaign wizard — Basics → Audience → Templates → (Distribution)
 * → Review. Standard mode is one number and one template; advanced adds
 * several of each and a distribution step. The server sends everything
 * (POST /api/campaigns/advanced).
 */
export function CampaignWizard({
  initialMode,
  initialName = '',
  draftId = null,
}: Props) {
  const t = useTranslations('Campaigns.wizard');
  const router = useRouter();

  const [restored] = useState(() =>
    draftId
      ? null
      : loadDraft<{ state: WizardState; step: number }>(SESSION_KEY)
  );
  const [state, setState] = useState<WizardState>(
    () => restored?.state ?? { ...initialState(initialMode, initialName) }
  );
  const [step, setStep] = useState(restored?.step ?? 0);
  const update = (patch: Partial<WizardState>) =>
    setState((s) => ({ ...s, ...patch }));

  const [channels, setChannels] = useState<Channel[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [tags, setTags] = useState<TagOption[]>([]);
  const [customFields, setCustomFields] = useState<CustomFieldOption[]>([]);
  const [contactCount, setContactCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'launch' | 'schedule' | 'draft' | null>(
    null
  );
  const [testing, setTesting] = useState<{
    template: MessageTemplate;
    channel: Channel;
  } | null>(null);
  const [minSchedule] = useState(() => toLocalInput(new Date()));

  // ── Data (+ the saved draft, when opened from the list) ─────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const db = createClient();
      const [channelRes, tpl, tagRows, fields, contacts, draft] =
        await Promise.all([
          fetch('/api/whatsapp/channels', { cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : { channels: [] }))
            .catch(() => ({ channels: [] })),
          db
            .from('message_templates')
            .select('*')
            .eq('status', 'APPROVED')
            .order('name'),
          db.from('tags').select('id, name, color').order('name'),
          db.from('custom_fields').select('id, field_name').order('field_name'),
          db.from('contacts').select('id', { count: 'exact', head: true }),
          draftId
            ? db
                .from('broadcasts')
                .select('id, name, config')
                .eq('id', draftId)
                .eq('status', 'draft')
                .maybeSingle()
            : Promise.resolve({ data: null }),
        ]);
      if (cancelled) return;
      setChannels((channelRes.channels ?? []) as Channel[]);
      setTemplates((tpl.data ?? []) as MessageTemplate[]);
      setTags((tagRows.data ?? []) as TagOption[]);
      setCustomFields((fields.data ?? []) as CustomFieldOption[]);
      setContactCount(contacts.count ?? 0);
      if (draftId) {
        const saved = (
          draft.data?.config as { draft_state?: Partial<WizardState> } | null
        )?.draft_state;
        if (saved) {
          const next = { ...initialState(initialMode), ...saved, draftId };
          setState(next);
          // "Continue setup" opens on Review — ready to launch; any step
          // is one click away in the stepper.
          setStep(stepsFor(next.mode).length - 1);
        } else toast.error(t('toast.draftLoadFailed'));
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // Loads once per opened wizard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave to this tab (a refresh comes back to the same step).
  useEffect(() => {
    saveDraft(SESSION_KEY, { state, step }, (d) => ({
      state: { ...d.state, audience: { ...d.state.audience, csv: null } },
      step: Math.min(d.step, 1),
    }));
  }, [state, step]);

  const steps = stepsFor(state.mode);
  const current: StepKey = steps[Math.min(step, steps.length - 1)];

  // ── Audience health ────────────────────────────────────────────
  const a = state.audience;
  const rowsAudience = useMemo(() => {
    if (a.source === 'csv' && a.csv)
      return {
        rows: csvRowObjects(a.csv),
        phone: a.phoneColumn ?? a.csv.headers[0],
      };
    if (a.source === 'manual')
      return { rows: manualRows(a.manualText), phone: 'phone' };
    return null;
  }, [a.source, a.csv, a.phoneColumn, a.manualText]);
  const localStats = useMemo(
    () =>
      rowsAudience ? rowStats(rowsAudience.rows, rowsAudience.phone) : null,
    [rowsAudience]
  );

  // Contact-based audiences are counted by the server.
  const previewSpec =
    a.source === 'all' || a.source === 'tags' || a.source === 'segment'
      ? JSON.stringify({
          source: a.source,
          tagIds: a.source === 'tags' ? a.tagIds : [],
          tagMatch: a.tagMatch,
          segment: a.source === 'segment' ? a.segment : undefined,
          excludeTagIds: a.excludeTagIds,
        })
      : null;
  const [remote, setRemote] = useState<{
    key: string;
    stats: AudienceStats | null;
    error: boolean;
  } | null>(null);
  useEffect(() => {
    if (!previewSpec) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/campaigns/audience-preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: previewSpec,
        });
        const body = await res.json();
        if (!cancelled)
          setRemote({
            key: previewSpec,
            stats: res.ok ? body : null,
            error: !res.ok,
          });
      } catch {
        if (!cancelled)
          setRemote({ key: previewSpec, stats: null, error: true });
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [previewSpec]);
  const checking = !!previewSpec && remote?.key !== previewSpec;
  const stats: AudienceStats | null = previewSpec
    ? remote?.key === previewSpec
      ? remote.stats
      : null
    : localStats;

  const sampleRow = useMemo(() => {
    if (!rowsAudience || !localStats?.validRows.length) return null;
    return rowsAudience.rows[localStats.validRows[0]];
  }, [rowsAudience, localStats]);

  // ── Validation ─────────────────────────────────────────────────
  const selected = channels.filter((c) => state.channelIds.includes(c.id));
  const union = chosenTemplates(state);
  const rowMap = new Map(
    union
      .map(
        (ref) => [templateKey(ref), rowFor(templates, undefined, ref)] as const
      )
      .filter((e): e is [string, MessageTemplate] => !!e[1])
  );
  const slots = unionSlots([...rowMap.values()]);
  const templatesOk =
    state.channelIds.length > 0 &&
    state.channelIds.every((id) => {
      const list = state.channelTemplates[id] ?? [];
      const ch = channels.find((c) => c.id === id);
      if (
        !ch ||
        list.length === 0 ||
        (state.mode === 'standard' && list.length !== 1)
      )
        return false;
      const available = new Set(
        templatesForChannel(templates, ch).map(
          (x) => `${x.name}:${x.language ?? 'en_US'}`
        )
      );
      return list.every((r) => available.has(templateKey(r)));
    });
  const variablesOk = missingCount(slots, state.shared) === 0;
  const audienceOk =
    !!a.source &&
    !!stats &&
    stats.valid > 0 &&
    (a.source !== 'segment' || !!a.segment.fieldId);
  const basicsOk =
    state.name.trim() !== '' &&
    (state.mode === 'standard'
      ? state.channelIds.length === 1
      : state.channelIds.length > 0);

  const blocked: Record<StepKey, string | null> = {
    basics: !state.name.trim()
      ? t('blocked.name')
      : !basicsOk
        ? t('blocked.channel')
        : null,
    audience: audienceOk ? null : t('blocked.audience'),
    templates: !templatesOk
      ? t('blocked.templates')
      : !variablesOk
        ? t('blocked.variables')
        : null,
    distribution: null,
    review: null,
  };
  const checks: ReviewChecks = {
    templates: templatesOk,
    channels:
      selected.length > 0 && selected.every((c) => c.status === 'connected'),
    audience: audienceOk,
    variables: variablesOk,
  };
  const reachable = (i: number) => steps.slice(0, i).every((k) => !blocked[k]);

  // ── Submit ─────────────────────────────────────────────────────
  const payload = (schedule: LaunchSchedule) =>
    buildCampaignPayload(state, templates, schedule);

  async function submit(kind: 'launch' | 'schedule') {
    const at = new Date(state.scheduleAt);
    if (kind === 'schedule' && !(at.getTime() > Date.now())) {
      toast.error(t('blocked.schedule'));
      return;
    }
    setBusy(kind);
    try {
      const res = await fetch('/api/campaigns/advanced', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          payload(
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
      clearDraft(SESSION_KEY);
      toast.success(
        kind === 'schedule' ? t('toast.scheduled') : t('toast.launched'),
        {
          description:
            body.invalid || body.duplicates || body.excluded
              ? t('toast.skipped', {
                  invalid: body.invalid ?? 0,
                  duplicates: body.duplicates ?? 0,
                  excluded: body.excluded ?? 0,
                })
              : undefined,
        }
      );
      router.push(`/broadcasts/${body.broadcast_id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(null);
    }
  }

  async function saveAsDraft() {
    setBusy('draft');
    try {
      const res = await fetch('/api/campaigns/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: state.draftId,
          name: state.name,
          state: { ...state, draftId: undefined },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error || `HTTP ${res.status}`);
        return;
      }
      clearDraft(SESSION_KEY);
      toast.success(
        body.csv_dropped ? t('toast.csvDropped') : t('toast.draftSaved')
      );
      router.push('/broadcasts');
    } finally {
      setBusy(null);
    }
  }

  const isLast = current === 'review';
  const nextKey = steps[step + 1];

  return (
    <WizardShell width="max-w-7xl">
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => router.push('/broadcasts')}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4" />
          {t('back')}
        </button>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-foreground text-2xl font-bold tracking-tight sm:text-3xl">
              {state.name.trim() || t('title')}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm sm:text-base">
              {state.mode === 'standard'
                ? t('subtitleStandard')
                : t('subtitleAdvanced')}
            </p>
          </div>
          <span className="border-border bg-card text-muted-foreground inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs sm:px-3 sm:py-1.5 sm:text-sm">
            <Zap className="size-4 text-amber-500" />
            {t('autosave')}
          </span>
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        {/* Vertical stepper */}
        <nav className="lg:sticky lg:top-0">
          <ol className="flex gap-2 overflow-x-auto lg:flex-col lg:gap-1">
            {steps.map((key, i) => {
              const done = i < step;
              const active = i === step;
              const can = i <= step || reachable(i);
              return (
                <li key={key} className="shrink-0">
                  <button
                    type="button"
                    disabled={!can}
                    onClick={() => setStep(i)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left transition-colors disabled:cursor-default sm:gap-3 sm:px-3 sm:py-3',
                      active
                        ? 'border-border bg-card border shadow-sm'
                        : 'hover:bg-muted/50 border border-transparent'
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold sm:size-8 sm:text-sm',
                        done
                          ? 'bg-emerald-600 text-white'
                          : active
                            ? 'bg-foreground text-background'
                            : 'border-border text-muted-foreground border'
                      )}
                    >
                      {done ? <Check className="size-4" /> : i + 1}
                    </span>
                    <span className="min-w-0">
                      <span
                        className={cn(
                          'block text-xs font-medium sm:text-sm',
                          active || done
                            ? 'text-foreground'
                            : 'text-muted-foreground'
                        )}
                      >
                        {t(`steps.${key}`)}
                      </span>
                      {active ? (
                        <span className="text-muted-foreground block text-xs">
                          {t('stepOf', { n: i + 1, total: steps.length })}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="min-w-0">
          {loading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="text-primary size-6 animate-spin" />
            </div>
          ) : current === 'basics' ? (
            <StepBasics state={state} update={update} channels={channels} />
          ) : current === 'audience' ? (
            <StepAudience
              state={state}
              update={update}
              stats={stats}
              checking={checking}
              previewError={
                !!previewSpec && remote?.key === previewSpec && remote.error
              }
              contactCount={contactCount}
              tags={tags}
              customFields={customFields}
            />
          ) : current === 'templates' ? (
            <StepTemplates
              state={state}
              update={update}
              channels={channels}
              templates={templates}
              customFields={customFields}
              sampleRow={sampleRow}
              onTest={(template, channel) => setTesting({ template, channel })}
            />
          ) : current === 'distribution' ? (
            <StepDistribution
              state={state}
              update={update}
              channels={channels}
              recipients={stats?.valid ?? 0}
            />
          ) : (
            <StepReview
              state={{
                ...state,
                speed: SPEED_MAX,
              }}
              update={update}
              channels={channels}
              templates={templates}
              stats={stats}
              sampleRow={sampleRow}
              checks={checks}
              busy={busy}
              minSchedule={minSchedule}
              onLaunch={() => submit('launch')}
              onSchedule={() => submit('schedule')}
              onSaveDraft={saveAsDraft}
            />
          )}
        </div>
      </div>

      <WizardFooter>
        <Button
          variant="outline"
          size="default"
          onClick={() =>
            step === 0 ? router.push('/broadcasts') : setStep(step - 1)
          }
        >
          <ArrowLeft className="size-4" />
          {t('previous')}
        </Button>
        {!isLast ? (
          <Button
            size="default"
            onClick={() => setStep(step + 1)}
            disabled={!!blocked[current] || loading}
          >
            {blocked[current] ??
              t('continueTo', { step: t(`steps.${nextKey}`) })}
            <ArrowRight className="size-4" />
          </Button>
        ) : null}
      </WizardFooter>

      <TestTemplateDialog
        template={testing?.template ?? null}
        channels={testing ? [testing.channel] : []}
        onClose={() => setTesting(null)}
      />
    </WizardShell>
  );
}
