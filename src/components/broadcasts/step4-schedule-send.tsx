'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  ArrowLeft,
  CalendarClock,
  Send,
  Loader2,
  Rocket,
  Users,
  Save,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toLocalInput } from '@/components/campaigns/advanced/step-launch';
import { useTranslations } from 'next-intl';
import { WizardFooter } from '@/components/campaigns/wizard-shell';

interface AudienceConfig {
  type: string;
  tagIds?: string[];
  csvContacts?: { phone: string; name?: string }[];
}

interface Step4Props {
  name: string;
  onNameChange: (name: string) => void;
  template: MessageTemplate;
  audience: AudienceConfig;
  /** Send now, or schedule when a time is given. */
  onSend: (scheduledAt?: Date) => void;
  onSaveDraft?: () => void;
  onBack: () => void;
  isProcessing: boolean;
  progress: number;
}

export function Step4ScheduleSend({
  name,
  onNameChange,
  template,
  audience,
  onSend,
  onSaveDraft,
  onBack,
  isProcessing,
  progress,
}: Step4Props) {
  const t = useTranslations('Broadcasts.wizard');
  const tl = useTranslations('Broadcasts.advanced.launch');
  const [showConfirm, setShowConfirm] = useState(false);
  const [mode, setMode] = useState<'now' | 'later'>('now');
  const [minSchedule] = useState(() => toLocalInput(new Date()));
  const [scheduleAt, setScheduleAt] = useState(() =>
    toLocalInput(new Date(Date.now() + 60 * 60 * 1000))
  );
  const scheduleDate = new Date(scheduleAt);
  const scheduleValid =
    mode === 'now' ||
    (!Number.isNaN(scheduleDate.getTime()) &&
      scheduleDate.getTime() > Date.now());
  const [estimatedReach, setEstimatedReach] = useState<number>(0);
  const [loadingReach, setLoadingReach] = useState(true);

  useEffect(() => {
    async function calculateReach() {
      setLoadingReach(true);
      try {
        const supabase = createClient();

        if (audience.type === 'all') {
          const { count } = await supabase
            .from('contacts')
            .select('*', { count: 'exact', head: true });
          setEstimatedReach(count ?? 0);
        } else if (
          audience.type === 'tags' &&
          audience.tagIds &&
          audience.tagIds.length > 0
        ) {
          const { data: contactTags } = await supabase
            .from('contact_tags')
            .select('contact_id')
            .in('tag_id', audience.tagIds);

          const uniqueIds = new Set(
            (contactTags ?? []).map((ct) => ct.contact_id)
          );
          setEstimatedReach(uniqueIds.size);
        } else if (audience.type === 'csv' && audience.csvContacts) {
          setEstimatedReach(audience.csvContacts.length);
        } else {
          setEstimatedReach(0);
        }
      } finally {
        setLoadingReach(false);
      }
    }

    calculateReach();
  }, [audience]);

  const audienceLabel =
    audience.type === 'all'
      ? t('scheduleSend.audienceAll')
      : audience.type === 'tags'
        ? t('scheduleSend.audienceTags')
        : audience.type === 'csv'
          ? t('scheduleSend.audienceCsv')
          : t('scheduleSend.audienceField');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-foreground text-lg font-semibold">
          {t('scheduleSend.title')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('scheduleSend.subtitle')}
        </p>
      </div>

      {/* Broadcast Name */}
      <div>
        <label className="text-foreground mb-1.5 block text-sm font-medium">
          {t('scheduleSend.broadcastName')}
        </label>
        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={t('scheduleSend.broadcastNamePlaceholder')}
          className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {/* When to send */}
      <div className="border-border bg-card rounded-xl border p-4">
        <p className="text-foreground mb-3 text-sm font-medium">{tl('when')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              {
                key: 'now',
                icon: Rocket,
                title: tl('now'),
                hint: tl('nowHint'),
              },
              {
                key: 'later',
                icon: CalendarClock,
                title: tl('later'),
                hint: tl('laterHint'),
              },
            ] as const
          ).map(({ key, icon: Icon, title, hint }) => {
            const active = mode === key;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => setMode(key)}
                className={cn(
                  'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                  active
                    ? 'border-primary bg-primary/5 ring-primary ring-1'
                    : 'border-border hover:bg-muted/50'
                )}
              >
                <Icon
                  className={cn(
                    'mt-0.5 size-5',
                    active ? 'text-primary' : 'text-muted-foreground'
                  )}
                />
                <span>
                  <span className="text-foreground block text-sm font-medium">
                    {title}
                  </span>
                  <span className="text-muted-foreground block text-xs">
                    {hint}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        {mode === 'later' ? (
          <label className="mt-4 block">
            <span className="text-foreground mb-1.5 block text-sm font-medium">
              {tl('at')}
            </span>
            <input
              type="datetime-local"
              value={scheduleAt}
              min={minSchedule}
              onChange={(e) => setScheduleAt(e.target.value)}
              className="border-border bg-background focus-visible:border-ring h-10 w-full rounded-md border px-3 text-sm outline-none sm:w-72"
            />
            {!scheduleValid ? (
              <span className="mt-1 block text-xs text-red-600 dark:text-red-400">
                {tl('errorTime')}
              </span>
            ) : null}
          </label>
        ) : null}
      </div>

      {/* Summary Card */}
      <div className="border-border bg-card/50 space-y-3 rounded-xl border p-4">
        <p className="text-foreground text-sm font-medium">
          {t('scheduleSend.summary')}
        </p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-muted-foreground text-xs">
              {t('scheduleSend.template')}
            </p>
            <p className="text-foreground">{template.name}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">
              {t('scheduleSend.audience')}
            </p>
            <p className="text-foreground">{audienceLabel}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">
              {t('scheduleSend.estimatedReach')}
            </p>
            <div className="flex items-center gap-1.5">
              {loadingReach ? (
                <Loader2 className="text-primary h-3 w-3 animate-spin" />
              ) : (
                <>
                  <Users className="text-primary h-3.5 w-3.5" />
                  <p className="text-foreground font-medium">
                    {estimatedReach.toLocaleString()}
                  </p>
                </>
              )}
            </div>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">
              {t('scheduleSend.language')}
            </p>
            <p className="text-foreground">{template.language ?? 'en_US'}</p>
          </div>
        </div>
      </div>

      {/* Processing overlay */}
      {isProcessing && (
        <div className="border-primary/20 bg-primary/5 rounded-xl border p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className="text-primary h-4 w-4 animate-spin" />
              <p className="text-foreground text-sm font-medium">
                {t('scheduleSend.sending')}
              </p>
            </div>
            <span className="text-primary text-xs font-medium">
              {progress}%
            </span>
          </div>
          <div className="bg-muted h-1.5 w-full rounded-full">
            <div
              className="bg-primary h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      <WizardFooter>
        <Button
          variant="outline"
          onClick={onBack}
          disabled={isProcessing}
          className="border-border text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('back')}
        </Button>

        <div className="flex items-center gap-2">
          {onSaveDraft && (
            <Button
              variant="outline"
              onClick={onSaveDraft}
              disabled={!name.trim() || isProcessing}
              className="border-border text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {t('scheduleSend.saveDraft')}
            </Button>
          )}

          <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
            <DialogTrigger
              render={
                <Button
                  disabled={!name.trim() || isProcessing || !scheduleValid}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                />
              }
            >
              {mode === 'later' ? (
                <CalendarClock className="h-4 w-4" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {mode === 'later' ? tl('schedule') : t('scheduleSend.sendNow')}
            </DialogTrigger>
            <DialogContent className="border-border bg-popover sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="text-popover-foreground">
                  {t('scheduleSend.confirmTitle')}
                </DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  {t.rich('scheduleSend.confirmDesc', {
                    count: estimatedReach,
                    template: template.name,
                    b: (chunks) => (
                      <span className="text-popover-foreground font-medium">
                        {chunks}
                      </span>
                    ),
                  })}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setShowConfirm(false)}
                  className="border-border text-muted-foreground"
                >
                  {t('cancel')}
                </Button>
                <Button
                  onClick={() => {
                    setShowConfirm(false);
                    onSend(mode === 'later' ? scheduleDate : undefined);
                  }}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {mode === 'later' ? (
                    <CalendarClock className="h-4 w-4" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  {mode === 'later'
                    ? tl('schedule')
                    : t('scheduleSend.sendNow')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </WizardFooter>
    </div>
  );
}
