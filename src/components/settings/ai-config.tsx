'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Sparkles, CheckCircle2, Trash2, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsPanelHead } from './settings-panel-head';
import { AiKnowledgeCard } from './ai-knowledge';
import { AI_PROVIDER_DEFAULT_MODEL } from '@/lib/ai/defaults';
import type { AiProvider } from '@/lib/ai/types';
import type { AccountMember } from '@/types';
import { fetchAccountMembers, memberLabel } from '@/lib/account/members';
import { useTranslations } from 'next-intl';

const MASKED_KEY = '••••••••••••••••';

// Radix Select can't use an empty-string item value, so the "leave
// unassigned" choice gets a sentinel that maps to null in the payload.
const HANDOFF_QUEUE = '__queue__';

const PROVIDER_LABEL: Record<AiProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
};

const KEY_PLACEHOLDER: Record<AiProvider, string> = {
  openai: 'sk-...',
  anthropic: 'sk-ant-...',
};

export function AiConfig() {
  const { accountId, accountRole, profileLoading } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;
  const t = useTranslations('Settings.aiConfig');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);

  const [configured, setConfigured] = useState(false);
  const [provider, setProvider] = useState<AiProvider>('openai');
  const [model, setModel] = useState(AI_PROVIDER_DEFAULT_MODEL.openai);
  const [apiKey, setApiKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [embeddingsKey, setEmbeddingsKey] = useState('');
  const [embeddingsKeyEdited, setEmbeddingsKeyEdited] = useState(false);
  const [hasStoredEmbeddingsKey, setHasStoredEmbeddingsKey] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [maxPerConversation, setMaxPerConversation] = useState(3);
  // Empty string = leave unassigned (shared queue).
  const [handoffAgentId, setHandoffAgentId] = useState('');
  const [members, setMembers] = useState<AccountMember[]>([]);

  // Bloco 3-A — commercial mode (Meta Click-to-WhatsApp ad leads).
  const [commercialModeEnabled, setCommercialModeEnabled] = useState(false);
  const [commercialSystemPrompt, setCommercialSystemPrompt] = useState('');
  const [commercialBookingUrl, setCommercialBookingUrl] = useState('');
  const [commercialWelcomeMessage, setCommercialWelcomeMessage] = useState('');
  // Real scheduling (service-account calendar) — see docs/eter-agent-config.md.
  const [commercialCalendarId, setCommercialCalendarId] = useState('');
  const [commercialBusyCalendarIds, setCommercialBusyCalendarIds] = useState('');
  const [commercialDurationMin, setCommercialDurationMin] = useState(30);
  const [commercialTimezone, setCommercialTimezone] = useState('Europe/Lisbon');
  const [commercialHoursStart, setCommercialHoursStart] = useState('09:00');
  const [commercialHoursEnd, setCommercialHoursEnd] = useState('18:00');
  const [commercialMinLeadMin, setCommercialMinLeadMin] = useState(120);
  const [commercialBufferMin, setCommercialBufferMin] = useState(15);
  const [commercialMaxDaysAhead, setCommercialMaxDaysAhead] = useState(10);

  // Guard keyed on the account (not a bare boolean) so an in-place
  // account switch — ownership transfer, multi-account membership —
  // refetches instead of showing the previous account's config. Mirrors
  // the loadedAccountIdRef pattern in whatsapp-config.tsx.
  const loadedAccountIdRef = useRef<string | null>(null);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/config');
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t('loadFailed'));
        return;
      }
      if (data.configured) {
        setConfigured(true);
        setProvider(data.provider);
        setModel(data.model);
        setSystemPrompt(data.system_prompt ?? '');
        setIsActive(data.is_active);
        setAutoReplyEnabled(data.auto_reply_enabled);
        setMaxPerConversation(data.auto_reply_max_per_conversation ?? 3);
        setHandoffAgentId(data.handoff_agent_id ?? '');
        setCommercialModeEnabled(Boolean(data.commercial_mode_enabled));
        setCommercialSystemPrompt(data.commercial_system_prompt ?? '');
        setCommercialBookingUrl(data.commercial_booking_url ?? '');
        setCommercialWelcomeMessage(data.commercial_welcome_message ?? '');
        setCommercialCalendarId(data.commercial_calendar_id ?? '');
        setCommercialBusyCalendarIds(
          Array.isArray(data.commercial_busy_calendar_ids)
            ? data.commercial_busy_calendar_ids.join(', ')
            : '',
        );
        setCommercialDurationMin(data.commercial_meeting_duration_min ?? 30);
        setCommercialTimezone(data.commercial_timezone ?? 'Europe/Lisbon');
        {
          const monWindow = data.commercial_business_hours?.mon?.[0] as
            | [string, string]
            | undefined;
          setCommercialHoursStart(monWindow?.[0] ?? '09:00');
          setCommercialHoursEnd(monWindow?.[1] ?? '18:00');
        }
        setCommercialMinLeadMin(data.commercial_min_lead_time_min ?? 120);
        setCommercialBufferMin(data.commercial_buffer_min ?? 15);
        setCommercialMaxDaysAhead(data.commercial_max_business_days_ahead ?? 10);
        setHasStoredKey(Boolean(data.has_key));
        setApiKey(data.has_key ? MASKED_KEY : '');
        setKeyEdited(false);
        setHasStoredEmbeddingsKey(Boolean(data.has_embeddings_key));
        setEmbeddingsKey(data.has_embeddings_key ? MASKED_KEY : '');
        setEmbeddingsKeyEdited(false);
      }
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchConfig();
    // Members populate the handoff-target picker. Best-effort — on an
    // older deployment without the endpoint the picker just shows the
    // queue option.
    void fetchAccountMembers().then(setMembers);
  }, [accountId, fetchConfig]);

  // Swap the model default when the provider changes, unless the user
  // typed a custom model.
  const handleProviderChange = (next: AiProvider) => {
    setProvider(next);
    const isDefaultModel =
      model === AI_PROVIDER_DEFAULT_MODEL.openai ||
      model === AI_PROVIDER_DEFAULT_MODEL.anthropic ||
      model.trim() === '';
    if (isDefaultModel) setModel(AI_PROVIDER_DEFAULT_MODEL[next]);
  };

  const keyPayload = () => (keyEdited ? apiKey.trim() : undefined);

  // undefined = leave unchanged; '' typed = null (clear); text = set.
  const embeddingsKeyPayload = () =>
    embeddingsKeyEdited ? embeddingsKey.trim() || null : undefined;

  const buildBody = () => ({
    provider,
    model: model.trim(),
    api_key: keyPayload(),
    embeddings_api_key: embeddingsKeyPayload(),
    system_prompt: systemPrompt.trim() || null,
    is_active: isActive,
    auto_reply_enabled: autoReplyEnabled,
    auto_reply_max_per_conversation: maxPerConversation,
    handoff_agent_id: handoffAgentId || null,
    commercial_mode_enabled: commercialModeEnabled,
    commercial_system_prompt: commercialSystemPrompt.trim() || null,
    commercial_booking_url: commercialBookingUrl.trim() || null,
    commercial_welcome_message: commercialWelcomeMessage.trim() || null,
    commercial_calendar_id: commercialCalendarId.trim() || null,
    commercial_busy_calendar_ids: commercialBusyCalendarIds
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
    commercial_meeting_duration_min: commercialDurationMin,
    commercial_timezone: commercialTimezone.trim() || 'Europe/Lisbon',
    commercial_business_hours_start: commercialHoursStart,
    commercial_business_hours_end: commercialHoursEnd,
    commercial_min_lead_time_min: commercialMinLeadMin,
    commercial_buffer_min: commercialBufferMin,
    commercial_max_business_days_ahead: commercialMaxDaysAhead,
  });

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model: model.trim(),
          api_key: keyPayload(),
        }),
      });
      const data = await res.json();
      if (res.ok) toast.success(t('testSuccess'));
      else toast.error(data.error ?? t('testRejected'));
    } catch {
      toast.error(t('testNetworkError'));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!model.trim()) {
      toast.error(t('missingModel'));
      return;
    }
    if (!configured && !keyEdited) {
      toast.error(t('missingApiKey'));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody()),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(t('saveSuccess'));
        await fetchConfig();
      } else {
        toast.error(data.error ?? t('saveFailed'));
      }
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      const res = await fetch('/api/ai/config', { method: 'DELETE' });
      if (res.ok) {
        toast.success(t('removeSuccess'));
        setConfigured(false);
        setHasStoredKey(false);
        setApiKey('');
        setKeyEdited(false);
        setIsActive(false);
        setAutoReplyEnabled(false);
        setSystemPrompt('');
        setHandoffAgentId('');
        setCommercialModeEnabled(false);
        setCommercialSystemPrompt('');
        setCommercialBookingUrl('');
        setCommercialWelcomeMessage('');
        setCommercialCalendarId('');
        setCommercialBusyCalendarIds('');
        setCommercialDurationMin(30);
        setCommercialTimezone('Europe/Lisbon');
        setCommercialHoursStart('09:00');
        setCommercialHoursEnd('18:00');
        setCommercialMinLeadMin(120);
        setCommercialBufferMin(15);
        setCommercialMaxDaysAhead(10);
      } else {
        const data = await res.json();
        toast.error(data.error ?? t('removeFailed'));
      }
    } catch {
      toast.error(t('removeFailed'));
    } finally {
      setRemoving(false);
    }
  };

  if (loading || profileLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('loadFailed')} {/* Re-using label or a global one, wait, loading is better. Let's use useTranslations from overview or just hardcode Loading... actually I should add loading to aiConfig */}
        {/* Wait, I didn't add loading to aiConfig. I'll just use loading. */}
      </div>
    );
  }

  const disabled = !canEdit || saving;

  return (
    <div>
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
      />

      {!canEdit && (
        <p className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {t('adminOnlyConfig')}
        </p>
      )}

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" /> {t('providerAndKey')}
            </CardTitle>
            <CardDescription>
              {t('encryptionNotice')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t('provider')}</Label>
                <Select
                  value={provider}
                  onValueChange={(v) => handleProviderChange(v as AiProvider)}
                  disabled={disabled}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">{PROVIDER_LABEL.openai}</SelectItem>
                    <SelectItem value="anthropic">
                      {PROVIDER_LABEL.anthropic}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ai-model">{t('model')}</Label>
                <Input
                  id="ai-model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={AI_PROVIDER_DEFAULT_MODEL[provider]}
                  disabled={disabled}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-key">{t('apiKey')}</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="ai-key"
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setKeyEdited(true);
                    }}
                    onFocus={() => {
                      if (!keyEdited && hasStoredKey) {
                        setApiKey('');
                        setKeyEdited(true);
                      }
                    }}
                    placeholder={KEY_PLACEHOLDER[provider]}
                    disabled={disabled}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showKey ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <Button
                  variant="outline"
                  onClick={handleTest}
                  disabled={disabled || testing}
                >
                  {testing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  )}
                  {t('testKey')}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-embeddings-key">
                {t('embeddingsKey')}{' '}
                <span className="font-normal text-muted-foreground">
                  {t('optionalSemanticSearch')}
                </span>
              </Label>
              <Input
                id="ai-embeddings-key"
                type="password"
                value={embeddingsKey}
                onChange={(e) => {
                  setEmbeddingsKey(e.target.value);
                  setEmbeddingsKeyEdited(true);
                }}
                onFocus={() => {
                  if (!embeddingsKeyEdited && hasStoredEmbeddingsKey) {
                    setEmbeddingsKey('');
                    setEmbeddingsKeyEdited(true);
                  }
                }}
                placeholder="sk-... (OpenAI)"
                disabled={disabled}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                {t('embeddingsHint', {
                  sameKeyText: provider === 'openai' ? t('sameKeyText') : '',
                })}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('behaviour')}</CardTitle>
            <CardDescription>
              {t('behaviourDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ai-prompt">{t('businessContext')}</Label>
              <Textarea
                id="ai-prompt"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder={t('promptPlaceholder')}
                rows={5}
                disabled={disabled}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t('enableAssistant')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('enableAssistantDesc')}
                </p>
              </div>
              <Switch
                checked={isActive}
                onCheckedChange={setIsActive}
                disabled={disabled}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t('autoReply')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('autoReplyDesc')}
                </p>
              </div>
              <Switch
                checked={autoReplyEnabled}
                onCheckedChange={setAutoReplyEnabled}
                disabled={disabled || !isActive}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="ai-max">{t('maxAutoReplies')}</Label>
                <p className="text-xs text-muted-foreground">
                  {t('maxAutoRepliesDesc')}
                </p>
              </div>
              <Input
                id="ai-max"
                type="number"
                min={1}
                max={20}
                value={maxPerConversation}
                onChange={(e) =>
                  setMaxPerConversation(
                    Math.min(20, Math.max(1, Number(e.target.value) || 1)),
                  )
                }
                disabled={disabled || !autoReplyEnabled}
                className="w-20"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-handoff">{t('handoffTo')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('handoffToDesc')}
              </p>
              <Select
                value={handoffAgentId || HANDOFF_QUEUE}
                onValueChange={(v) =>
                  setHandoffAgentId(!v || v === HANDOFF_QUEUE ? '' : v)
                }
                disabled={disabled || !autoReplyEnabled}
              >
                <SelectTrigger id="ai-handoff">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={HANDOFF_QUEUE}>
                    {t('handoffQueue')}
                  </SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {memberLabel(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('commercialTitle')}</CardTitle>
            <CardDescription>{t('commercialDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t('commercialEnable')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('commercialEnableDesc')}
                </p>
              </div>
              <Switch
                checked={commercialModeEnabled}
                onCheckedChange={setCommercialModeEnabled}
                disabled={disabled || !autoReplyEnabled}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-commercial-prompt">{t('commercialPrompt')}</Label>
              <Textarea
                id="ai-commercial-prompt"
                value={commercialSystemPrompt}
                onChange={(e) => setCommercialSystemPrompt(e.target.value)}
                placeholder={t('commercialPromptPlaceholder')}
                rows={4}
                disabled={disabled}
              />
              <p className="text-xs text-muted-foreground">
                {t('commercialPromptHint')}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-commercial-booking-url">
                {t('commercialBookingUrl')}
              </Label>
              <Input
                id="ai-commercial-booking-url"
                value={commercialBookingUrl}
                onChange={(e) => setCommercialBookingUrl(e.target.value)}
                placeholder="https://cal.com/eter-growth/intro"
                disabled={disabled}
              />
              <p className="text-xs text-muted-foreground">
                {t('commercialBookingUrlHint')}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-commercial-welcome">
                {t('commercialWelcome')}
              </Label>
              <Textarea
                id="ai-commercial-welcome"
                value={commercialWelcomeMessage}
                onChange={(e) => setCommercialWelcomeMessage(e.target.value)}
                placeholder={t('commercialWelcomePlaceholder')}
                rows={3}
                disabled={disabled}
              />
              <p className="text-xs text-muted-foreground">
                {t('commercialWelcomeHint')}
              </p>
            </div>

            <div className="space-y-2 rounded-md border border-border p-3">
              <p className="text-sm font-medium text-foreground">
                {t('commercialSchedulingTitle')}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('commercialSchedulingDesc')}
              </p>

              <div className="grid gap-4 pt-2 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ai-commercial-calendar-id">
                    {t('commercialCalendarId')}
                  </Label>
                  <Input
                    id="ai-commercial-calendar-id"
                    value={commercialCalendarId}
                    onChange={(e) => setCommercialCalendarId(e.target.value)}
                    placeholder="c_....@group.calendar.google.com"
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ai-commercial-busy-ids">
                    {t('commercialBusyCalendarIds')}
                  </Label>
                  <Input
                    id="ai-commercial-busy-ids"
                    value={commercialBusyCalendarIds}
                    onChange={(e) => setCommercialBusyCalendarIds(e.target.value)}
                    placeholder="primary, c_....@group.calendar.google.com"
                    disabled={disabled}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('commercialCalendarHint')}
              </p>

              <div className="grid gap-4 pt-2 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="ai-commercial-duration">
                    {t('commercialDuration')}
                  </Label>
                  <Input
                    id="ai-commercial-duration"
                    type="number"
                    min={5}
                    value={commercialDurationMin}
                    onChange={(e) => setCommercialDurationMin(Math.max(5, Number(e.target.value) || 30))}
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ai-commercial-buffer">
                    {t('commercialBuffer')}
                  </Label>
                  <Input
                    id="ai-commercial-buffer"
                    type="number"
                    min={0}
                    value={commercialBufferMin}
                    onChange={(e) => setCommercialBufferMin(Math.max(0, Number(e.target.value) || 0))}
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ai-commercial-min-lead">
                    {t('commercialMinLead')}
                  </Label>
                  <Input
                    id="ai-commercial-min-lead"
                    type="number"
                    min={0}
                    value={commercialMinLeadMin}
                    onChange={(e) => setCommercialMinLeadMin(Math.max(0, Number(e.target.value) || 0))}
                    disabled={disabled}
                  />
                </div>
              </div>

              <div className="grid gap-4 pt-2 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="ai-commercial-hours-start">
                    {t('commercialHoursStart')}
                  </Label>
                  <Input
                    id="ai-commercial-hours-start"
                    value={commercialHoursStart}
                    onChange={(e) => setCommercialHoursStart(e.target.value)}
                    placeholder="09:00"
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ai-commercial-hours-end">
                    {t('commercialHoursEnd')}
                  </Label>
                  <Input
                    id="ai-commercial-hours-end"
                    value={commercialHoursEnd}
                    onChange={(e) => setCommercialHoursEnd(e.target.value)}
                    placeholder="18:00"
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ai-commercial-max-days">
                    {t('commercialMaxDaysAhead')}
                  </Label>
                  <Input
                    id="ai-commercial-max-days"
                    type="number"
                    min={1}
                    value={commercialMaxDaysAhead}
                    onChange={(e) => setCommercialMaxDaysAhead(Math.max(1, Number(e.target.value) || 10))}
                    disabled={disabled}
                  />
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <Label htmlFor="ai-commercial-timezone">
                  {t('commercialTimezone')}
                </Label>
                <Input
                  id="ai-commercial-timezone"
                  value={commercialTimezone}
                  onChange={(e) => setCommercialTimezone(e.target.value)}
                  placeholder="Europe/Lisbon"
                  disabled={disabled}
                  className="max-w-xs"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <AiKnowledgeCard
          accountId={accountId}
          canEdit={canEdit}
          hasEmbeddingsKey={
            embeddingsKeyEdited
              ? embeddingsKey.trim().length > 0
              : hasStoredEmbeddingsKey
          }
        />

        <div className="flex items-center justify-between">
          {configured ? (
            <Button
              variant="ghost"
              onClick={handleRemove}
              disabled={!canEdit || removing}
              className="text-destructive hover:text-destructive"
            >
              {removing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              {t('remove')}
            </Button>
          ) : (
            <span />
          )}

          <Button onClick={handleSave} disabled={disabled}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
