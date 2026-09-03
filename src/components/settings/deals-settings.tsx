'use client';

import { readResponseJson } from '@/lib/http/response-json';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Coins, Loader2, Clock, Building2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { CURRENCIES } from '@/lib/currency';
import { COMMON_TIMEZONES } from '@/lib/timezone';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { useTranslations } from 'next-intl';
import { SettingsPanelHead } from './settings-panel-head';

/**
 * Deals settings — account-wide default currency.
 *
 * One currency per account (issue #218): the chosen code seeds new
 * deals and formats every aggregated total. Existing deals keep their
 * own saved currency. Writes go straight to `accounts.default_currency`;
 * the `accounts_update` RLS policy (017) already restricts that to
 * admins+, so non-admins see a disabled, read-only control.
 */
export function DealsSettings() {
  const supabase = createClient();
  const {
    account,
    accountId,
    defaultCurrency,
    canEditSettings,
    profileLoading,
    refreshProfile,
  } = useAuth();

  const [selected, setSelected] = useState(defaultCurrency);
  const [saving, setSaving] = useState(false);
  const t = useTranslations('Settings.deals');

  // Company name — goes through PATCH /api/account (not a direct
  // Supabase update like currency/timezone below) because it's free
  // text: that route already validates length/emptiness and rate-limits
  // renames, and duplicating that here would just be a second place for
  // those rules to drift out of sync.
  const [companyName, setCompanyName] = useState(account?.name ?? '');
  const [companyNameSaving, setCompanyNameSaving] = useState(false);

  useEffect(() => {
    setCompanyName(account?.name ?? '');
  }, [account?.name]);

  const companyNameDirty =
    companyName.trim() !== (account?.name ?? '') &&
    companyName.trim().length > 0;

  async function handleSaveCompanyName() {
    if (!companyNameDirty) return;
    setCompanyNameSaving(true);
    try {
      const res = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: companyName.trim() }),
      });
      const data = await readResponseJson(res).catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || t('companyNameSaveFailed'));
        return;
      }
      await refreshProfile();
      toast.success(t('companyNameSaveSuccess'));
    } catch {
      toast.error(t('companyNameSaveFailed'));
    } finally {
      setCompanyNameSaving(false);
    }
  }

  // Keep the select in sync once the profile (and its account default)
  // resolves, and after a save round-trips through refreshProfile.
  useEffect(() => {
    setSelected(defaultCurrency);
  }, [defaultCurrency]);

  const dirty = selected !== defaultCurrency;

  async function handleSave() {
    if (!accountId || !dirty) return;
    setSaving(true);
    const { error } = await supabase
      .from('accounts')
      .update({ default_currency: selected })
      .eq('id', accountId);
    if (error) {
      toast.error(t('saveFailed'));
      setSaving(false);
      return;
    }
    // Pull the new value back into the auth context so the deal form
    // and every total pick it up without a full reload.
    await refreshProfile();
    setSaving(false);
    toast.success(t('saveSuccess'));
  }

  // Timezone isn't threaded through the global auth context (unlike
  // default_currency) — fetched/saved locally here, same lightweight
  // "own its own settings state" pattern as ai-config.tsx. Drives what
  // the AI shows itself as "now" when reasoning about appointment
  // scheduling (see src/lib/timezone.ts / src/lib/ai/defaults.ts).
  const [timezone, setTimezone] = useState<string | null>(null);
  const [timezoneSaving, setTimezoneSaving] = useState(false);
  const [timezoneLoading, setTimezoneLoading] = useState(true);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    setTimezoneLoading(true);
    (async () => {
      try {
        const { data } = await supabase
          .from('accounts')
          .select('timezone')
          .eq('id', accountId)
          .maybeSingle();
        if (cancelled) return;
        setTimezone(data?.timezone ?? 'America/Guatemala');
      } finally {
        if (!cancelled) setTimezoneLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, supabase]);

  async function handleSaveTimezone() {
    if (!accountId || !timezone) return;
    setTimezoneSaving(true);
    const { error } = await supabase
      .from('accounts')
      .update({ timezone })
      .eq('id', accountId);
    setTimezoneSaving(false);
    if (error) {
      toast.error(t('saveFailed'));
      return;
    }
    toast.success(t('saveSuccess'));
  }

  // Lead cooling — same "own its own state, direct accounts update"
  // pattern as timezone above. The sweep that acts on these lives in
  // src/lib/contacts/temperature-sweep.ts (migration 103/104).
  const [cooldownEnabled, setCooldownEnabled] = useState(false);
  const [cooldownDays, setCooldownDays] = useState(14);
  const [cooldownLoading, setCooldownLoading] = useState(true);
  const [cooldownSaving, setCooldownSaving] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    setCooldownLoading(true);
    (async () => {
      try {
        const { data } = await supabase
          .from('accounts')
          .select('lead_cooldown_enabled, lead_cooldown_days')
          .eq('id', accountId)
          .maybeSingle();
        if (cancelled || !data) return;
        setCooldownEnabled(!!data.lead_cooldown_enabled);
        setCooldownDays(
          typeof data.lead_cooldown_days === 'number' ? data.lead_cooldown_days : 14,
        );
      } finally {
        if (!cancelled) setCooldownLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, supabase]);

  async function handleSaveCooldown() {
    if (!accountId) return;
    setCooldownSaving(true);
    const days = Math.min(365, Math.max(1, Math.floor(cooldownDays || 14)));
    const { error } = await supabase
      .from('accounts')
      .update({ lead_cooldown_enabled: cooldownEnabled, lead_cooldown_days: days })
      .eq('id', accountId);
    setCooldownSaving(false);
    if (error) {
      toast.error(t('leadCooldownSaveFailed'));
      return;
    }
    setCooldownDays(days);
    toast.success(t('leadCooldownSaveSuccess'));
  }

  return (
    <section className="animate-in fade-in-50 max-w-2xl duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground flex items-center gap-2">
            <Building2 className="text-primary size-4" />
            {t('companyNameTitle')}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t('companyNameDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:max-w-xs">
            <Label className="text-muted-foreground">
              {t('companyNameLabel')}
            </Label>
            <Input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              disabled={!canEditSettings || profileLoading}
              maxLength={80}
              className="bg-muted border-border text-foreground"
            />
            {!canEditSettings && (
              <p className="text-muted-foreground text-xs">
                {t('adminOnlyHint')}
              </p>
            )}
          </div>

          {canEditSettings && (
            <Button
              onClick={handleSaveCompanyName}
              disabled={companyNameSaving || !companyNameDirty}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {companyNameSaving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('saving')}
                </>
              ) : (
                t('save')
              )}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-foreground flex items-center gap-2">
            <Coins className="text-primary size-4" />
            {t('defaultCurrency')}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t('defaultCurrencyDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:max-w-xs">
            <Label className="text-muted-foreground">
              {t('currencyLabel')}
            </Label>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              disabled={!canEditSettings || profileLoading}
              className="border-border bg-muted text-foreground focus:border-primary focus:ring-primary h-9 w-full rounded-lg border px-2.5 text-sm outline-none focus:ring-1 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.label}
                </option>
              ))}
            </select>
            {!canEditSettings && (
              <p className="text-muted-foreground text-xs">
                {t('adminOnlyHint')}
              </p>
            )}
          </div>

          {canEditSettings && (
            <Button
              onClick={handleSave}
              disabled={saving || !dirty}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('saving')}
                </>
              ) : (
                t('save')
              )}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-foreground flex items-center gap-2">
            <Clock className="text-primary size-4" />
            {t('timezoneTitle')}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t('timezoneDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:max-w-xs">
            <Label className="text-muted-foreground">
              {t('timezoneLabel')}
            </Label>
            <select
              value={timezone ?? ''}
              onChange={(e) => setTimezone(e.target.value)}
              disabled={!canEditSettings || timezoneLoading}
              className="border-border bg-muted text-foreground focus:border-primary focus:ring-primary h-9 w-full rounded-lg border px-2.5 text-sm outline-none focus:ring-1 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
            {!canEditSettings && (
              <p className="text-muted-foreground text-xs">
                {t('adminOnlyHint')}
              </p>
            )}
          </div>

          {canEditSettings && (
            <Button
              onClick={handleSaveTimezone}
              disabled={timezoneSaving || timezoneLoading || !timezone}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {timezoneSaving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('saving')}
                </>
              ) : (
                t('save')
              )}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-foreground flex items-center gap-2">
            <Clock className="text-primary size-4" />
            {t('leadCooldownTitle')}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t('leadCooldownDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="border-border flex items-center justify-between gap-4 rounded-md border p-3">
            <div className="min-w-0">
              <p className="text-foreground text-sm font-medium">
                {t('leadCooldownEnable')}
              </p>
              <p className="text-muted-foreground text-xs">
                {t('leadCooldownEnableDesc')}
              </p>
            </div>
            <Switch
              checked={cooldownEnabled}
              onCheckedChange={setCooldownEnabled}
              disabled={!canEditSettings || cooldownLoading}
            />
          </div>

          <div className="grid gap-2 sm:max-w-xs">
            <Label className="text-muted-foreground">
              {t('leadCooldownDaysLabel')}
            </Label>
            <Input
              type="number"
              min={1}
              max={365}
              value={cooldownDays}
              onChange={(e) =>
                setCooldownDays(
                  Math.min(365, Math.max(1, Math.floor(Number(e.target.value) || 0))),
                )
              }
              disabled={!canEditSettings || cooldownLoading || !cooldownEnabled}
              className="bg-muted border-border text-foreground w-28"
            />
            <p className="text-muted-foreground text-xs">
              {t('leadCooldownDaysHint')}
            </p>
            {!canEditSettings && (
              <p className="text-muted-foreground text-xs">{t('adminOnlyHint')}</p>
            )}
          </div>

          {canEditSettings && (
            <Button
              onClick={handleSaveCooldown}
              disabled={cooldownSaving || cooldownLoading}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {cooldownSaving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('saving')}
                </>
              ) : (
                t('save')
              )}
            </Button>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
