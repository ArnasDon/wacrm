'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Clock } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { useTranslations } from 'next-intl';
import { extractVariableIndices } from '@/lib/whatsapp/template-validators';
import {
  FOLLOWUP_GOALS,
  FOLLOWUP_MAX_STEPS,
  FOLLOWUP_MIN_MINUTES,
  FOLLOWUP_TEXT_MAXLEN,
} from '@/lib/ai/followups';

export interface FollowupStepUI {
  after_minutes: number;
  type: 'text' | 'template';
  text: string;
  template_name: string;
  template_language: string;
}

export function emptyFollowupStep(): FollowupStepUI {
  return {
    after_minutes: 60,
    type: 'text',
    text: '',
    template_name: '',
    template_language: '',
  };
}

const SELECT_CLASS =
  'border-border bg-muted text-foreground focus:border-primary rounded-md border px-2 py-1.5 text-sm focus:outline-none';

type Unit = 'minutes' | 'hours' | 'days';

function toDisplay(minutes: number): { value: number; unit: Unit } {
  if (minutes % 1440 === 0 && minutes >= 1440)
    return { value: minutes / 1440, unit: 'days' };
  if (minutes % 60 === 0 && minutes >= 60)
    return { value: minutes / 60, unit: 'hours' };
  return { value: minutes, unit: 'minutes' };
}

function toMinutes(value: number, unit: Unit): number {
  const v = Math.max(1, Math.floor(value || 0));
  const mins = unit === 'days' ? v * 1440 : unit === 'hours' ? v * 60 : v;
  return Math.max(FOLLOWUP_MIN_MINUTES, mins);
}

interface Props {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  goal: string;
  onGoalChange: (v: string) => void;
  businessHoursOnly: boolean;
  onBusinessHoursOnlyChange: (v: boolean) => void;
  windowStart: number;
  windowEnd: number;
  onWindowChange: (start: number, end: number) => void;
  steps: FollowupStepUI[];
  onStepsChange: (steps: FollowupStepUI[]) => void;
  disabled: boolean;
}

export function AiFollowupsCard({
  enabled,
  onEnabledChange,
  goal,
  onGoalChange,
  businessHoursOnly,
  onBusinessHoursOnlyChange,
  windowStart,
  windowEnd,
  onWindowChange,
  steps,
  onStepsChange,
  disabled,
}: Props) {
  const t = useTranslations('Settings.aiConfig');
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('message_templates')
        .select('*')
        .eq('status', 'APPROVED')
        .order('name', { ascending: true });
      if (!cancelled) setTemplates((data as MessageTemplate[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const hasTemplateStepWithoutTemplates = useMemo(
    () => steps.some((s) => s.type === 'template') && templates.length === 0,
    [steps, templates],
  );

  const rowDisabled = disabled || !enabled;

  const patchStep = (i: number, patch: Partial<FollowupStepUI>) => {
    onStepsChange(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };
  const addStep = () => onStepsChange([...steps, emptyFollowupStep()]);
  const removeStep = (i: number) =>
    onStepsChange(steps.filter((_, idx) => idx !== i));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="text-primary h-4 w-4" /> {t('followupsTitle')}
        </CardTitle>
        <CardDescription>{t('followupsDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="border-border flex items-center justify-between gap-4 rounded-md border p-3">
          <div>
            <p className="text-foreground text-sm font-medium">
              {t('followupsEnable')}
            </p>
            <p className="text-muted-foreground text-xs">
              {t('followupsEnableDesc')}
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={onEnabledChange}
            disabled={disabled}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="followups-goal">{t('followupsGoal')}</Label>
          <select
            id="followups-goal"
            value={goal}
            onChange={(e) => onGoalChange(e.target.value)}
            disabled={rowDisabled}
            className={`${SELECT_CLASS} w-full`}
          >
            {FOLLOWUP_GOALS.map((g) => (
              <option key={g} value={g}>
                {t(`followupsGoal_${g}`)}
              </option>
            ))}
          </select>
          <p className="text-muted-foreground text-xs">
            {t('followupsGoalHint')}
          </p>
        </div>

        <div className="border-border flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
          <div className="min-w-0">
            <p className="text-foreground text-sm font-medium">
              {t('followupsBusinessHours')}
            </p>
            <p className="text-muted-foreground text-xs">
              {t('followupsBusinessHoursDesc')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              max={24}
              value={windowStart}
              onChange={(e) =>
                onWindowChange(
                  Math.min(24, Math.max(0, Number(e.target.value) || 0)),
                  windowEnd,
                )
              }
              disabled={rowDisabled || !businessHoursOnly}
              className="w-16"
              aria-label={t('followupsWindowStart')}
            />
            <span className="text-muted-foreground text-sm">–</span>
            <Input
              type="number"
              min={0}
              max={24}
              value={windowEnd}
              onChange={(e) =>
                onWindowChange(
                  windowStart,
                  Math.min(24, Math.max(0, Number(e.target.value) || 0)),
                )
              }
              disabled={rowDisabled || !businessHoursOnly}
              className="w-16"
              aria-label={t('followupsWindowEnd')}
            />
            <Switch
              checked={businessHoursOnly}
              onCheckedChange={onBusinessHoursOnlyChange}
              disabled={rowDisabled}
            />
          </div>
        </div>

        <div className="space-y-3">
          <Label>{t('followupsSteps')}</Label>
          <p className="text-muted-foreground text-xs">
            {t('followupsStepsHint', { max: FOLLOWUP_MAX_STEPS })}
          </p>

          {steps.length === 0 && (
            <p className="text-muted-foreground border-border rounded-md border border-dashed px-3 py-4 text-center text-xs">
              {t('followupsNoSteps')}
            </p>
          )}

          {steps.map((step, i) => {
            const disp = toDisplay(step.after_minutes);
            return (
              <div
                key={i}
                className="border-border space-y-2 rounded-md border p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground text-xs font-medium">
                    {t('followupsStepN', { n: i + 1 })}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeStep(i)}
                    disabled={rowDisabled}
                    className="text-destructive hover:text-destructive h-7 px-2"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground">
                    {t('followupsAfter')}
                  </span>
                  <Input
                    type="number"
                    min={1}
                    value={disp.value}
                    onChange={(e) =>
                      patchStep(i, {
                        after_minutes: toMinutes(
                          Number(e.target.value),
                          disp.unit,
                        ),
                      })
                    }
                    disabled={rowDisabled}
                    className="w-20"
                  />
                  <select
                    value={disp.unit}
                    onChange={(e) =>
                      patchStep(i, {
                        after_minutes: toMinutes(
                          disp.value,
                          e.target.value as Unit,
                        ),
                      })
                    }
                    disabled={rowDisabled}
                    className={SELECT_CLASS}
                  >
                    <option value="minutes">{t('followupsUnitMinutes')}</option>
                    <option value="hours">{t('followupsUnitHours')}</option>
                    <option value="days">{t('followupsUnitDays')}</option>
                  </select>
                  <span className="text-muted-foreground">
                    {t('followupsSendA')}
                  </span>
                  <select
                    value={step.type}
                    onChange={(e) =>
                      patchStep(i, { type: e.target.value as 'text' | 'template' })
                    }
                    disabled={rowDisabled}
                    className={SELECT_CLASS}
                  >
                    <option value="text">{t('followupsTypeText')}</option>
                    <option value="template">{t('followupsTypeTemplate')}</option>
                  </select>
                </div>

                {step.type === 'text' ? (
                  <div className="space-y-1">
                    <Textarea
                      value={step.text}
                      onChange={(e) => patchStep(i, { text: e.target.value })}
                      placeholder={t.raw('followupsTextPlaceholder')}
                      rows={2}
                      maxLength={FOLLOWUP_TEXT_MAXLEN}
                      disabled={rowDisabled}
                    />
                    <p className="text-muted-foreground text-xs">
                      {t.raw('followupsTextHint')}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {(() => {
                      const tpl = templates.find(
                        (x) => x.name === step.template_name,
                      );
                      const varCount = tpl
                        ? extractVariableIndices(tpl.body_text ?? '').length +
                          (tpl.header_type === 'text'
                            ? extractVariableIndices(tpl.header_content ?? '').length
                            : 0)
                        : 0;
                      return varCount > 0 ? (
                        <p className="text-xs text-amber-600 dark:text-amber-500">
                          {t('followupsTemplateHasVars')}
                        </p>
                      ) : null;
                    })()}
                    <select
                      value={step.template_name}
                      onChange={(e) => {
                        const tpl = templates.find(
                          (x) => x.name === e.target.value,
                        );
                        patchStep(i, {
                          template_name: e.target.value,
                          template_language: tpl?.language ?? '',
                        });
                      }}
                      disabled={rowDisabled || templates.length === 0}
                      className={`${SELECT_CLASS} w-full`}
                    >
                      <option value="">{t('followupsPickTemplate')}</option>
                      {templates.map((tpl) => (
                        <option key={tpl.id} value={tpl.name}>
                          {tpl.name}
                          {tpl.language ? ` (${tpl.language})` : ''}
                        </option>
                      ))}
                    </select>
                    <p className="text-muted-foreground text-xs">
                      {templates.length === 0
                        ? t('followupsNoTemplates')
                        : t('followupsTemplateHint')}
                    </p>
                  </div>
                )}
              </div>
            );
          })}

          {steps.length < FOLLOWUP_MAX_STEPS && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addStep}
              disabled={rowDisabled}
            >
              <Plus className="mr-2 h-3.5 w-3.5" />
              {t('followupsAddStep')}
            </Button>
          )}

          {hasTemplateStepWithoutTemplates && (
            <p className="text-xs text-amber-600 dark:text-amber-500">
              {t('followupsNoTemplates')}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
