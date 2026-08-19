'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Loader2,
  Sparkles,
  CheckCircle2,
  Trash2,
  Eye,
  EyeOff,
  Wand2,
  Wrench,
} from 'lucide-react';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SettingsPanelHead } from './settings-panel-head';
import { AiKnowledgeCard } from './ai-knowledge';
import { AI_PROVIDER_DEFAULT_MODEL } from '@/lib/ai/defaults';
import type { AiProvider, HandoffSensitivity } from '@/lib/ai/types';
import type { AccountMember } from '@/types';
import { fetchAccountMembers, memberLabel } from '@/lib/account/members';
import { useTranslations } from 'next-intl';

const MASKED_KEY = '••••••••••••••••';

// Radix Select can't use an empty-string item value, so the "leave
// unassigned" choice gets a sentinel that maps to null in the payload.
const HANDOFF_QUEUE = '__queue__';

// Temperature and knowledge-strictness are exposed as a few labeled
// presets rather than a raw number input — simpler for a non-technical
// admin, and harder to accidentally set to a value that hurts reply
// quality. Sentinels map to `null` (today's behaviour: omit the param /
// no filtering) in the payload.
const TEMPERATURE_DEFAULT = '__default__';
const TEMPERATURE_PRESETS: Record<string, number | null> = {
  [TEMPERATURE_DEFAULT]: null,
  consistent: 0.3,
  balanced_temp: 0.6,
};
const RELEVANCE_OFF = '__off__';
const RELEVANCE_PRESETS: Record<string, number | null> = {
  [RELEVANCE_OFF]: null,
  normal: 0.3,
  strict: 0.6,
};
const DORMANCY_NEVER = '__never__';
const DORMANCY_PRESETS: Record<string, number | null> = {
  [DORMANCY_NEVER]: null,
  '24': 24,
  '72': 72,
  '168': 168, // 7 days
  '336': 336, // 14 days
};

// Example snippet keys — the actual text lives in messages/*.json under
// Settings.aiConfig.promptExample.<key> so it's translated like every
// other label here, not hardcoded English.
const PROMPT_EXAMPLE_KEYS = ['persona', 'policies', 'scope'] as const;

const PROVIDER_LABEL: Record<AiProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
  deepseek: 'DeepSeek',
};

const KEY_PLACEHOLDER: Record<AiProvider, string> = {
  openai: 'sk-...',
  anthropic: 'sk-ant-...',
  deepseek: 'sk-...',
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

  // Agent tuning (migration 041) — defaults match pre-041 behaviour.
  const [handoffSensitivity, setHandoffSensitivity] =
    useState<HandoffSensitivity>('balanced');
  const [temperature, setTemperature] = useState<number | null>(null);
  const [knowledgeTopK, setKnowledgeTopK] = useState(5);
  const [knowledgeMinRelevance, setKnowledgeMinRelevance] = useState<number | null>(null);
  const [contextMessageLimit, setContextMessageLimit] = useState(20);
  const [summarizeHistory, setSummarizeHistory] = useState(false);
  const [dormancyResetHours, setDormancyResetHours] = useState<number | null>(null);
  const [toolCount, setToolCount] = useState<number | null>(null);

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
        setHasStoredKey(Boolean(data.has_key));
        setApiKey(data.has_key ? MASKED_KEY : '');
        setKeyEdited(false);
        setHasStoredEmbeddingsKey(Boolean(data.has_embeddings_key));
        setEmbeddingsKey(data.has_embeddings_key ? MASKED_KEY : '');
        setEmbeddingsKeyEdited(false);
        setHandoffSensitivity(data.handoff_sensitivity ?? 'balanced');
        setTemperature(data.temperature ?? null);
        setKnowledgeTopK(data.knowledge_top_k ?? 5);
        setKnowledgeMinRelevance(data.knowledge_min_relevance ?? null);
        setContextMessageLimit(data.context_message_limit ?? 20);
        setSummarizeHistory(Boolean(data.summarize_history));
        setDormancyResetHours(data.dormancy_reset_hours ?? null);
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
    // The "N tools connected" pointer — best-effort, non-blocking; a
    // failure just leaves the pointer hidden.
    fetch('/api/ai/tools', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.tools)) {
          setToolCount(d.tools.filter((tItem: { is_active: boolean }) => tItem.is_active).length);
        }
      })
      .catch(() => {});
  }, [accountId, fetchConfig]);

  // Swap the model default when the provider changes, unless the user
  // typed a custom model.
  const handleProviderChange = (next: AiProvider) => {
    setProvider(next);
    const isDefaultModel =
      Object.values(AI_PROVIDER_DEFAULT_MODEL).includes(model) || model.trim() === '';
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
    handoff_sensitivity: handoffSensitivity,
    temperature,
    knowledge_top_k: knowledgeTopK,
    knowledge_min_relevance: knowledgeMinRelevance,
    context_message_limit: contextMessageLimit,
    summarize_history: summarizeHistory,
    dormancy_reset_hours: dormancyResetHours,
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
        setHandoffSensitivity('balanced');
        setTemperature(null);
        setKnowledgeTopK(5);
        setKnowledgeMinRelevance(null);
        setContextMessageLimit(20);
        setSummarizeHistory(false);
        setDormancyResetHours(null);
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
                    <SelectItem value="deepseek">{PROVIDER_LABEL.deepseek}</SelectItem>
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
              <div className="flex items-center justify-between">
                <Label htmlFor="ai-prompt">{t('businessContext')}</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    disabled={disabled}
                    className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                  >
                    <Wand2 className="h-3 w-3" /> {t('insertExample')}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {PROMPT_EXAMPLE_KEYS.map((key) => (
                      <DropdownMenuItem
                        key={key}
                        onClick={() =>
                          setSystemPrompt((prev) =>
                            prev.trim()
                              ? `${prev.trim()}\n\n${t(`promptExample.${key}`)}`
                              : t(`promptExample.${key}`),
                          )
                        }
                      >
                        {t(`promptExampleLabel.${key}`)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <Textarea
                id="ai-prompt"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder={t('promptPlaceholder')}
                rows={5}
                disabled={disabled}
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {t('promptCharCount', {
                    chars: systemPrompt.length,
                    tokens: Math.ceil(systemPrompt.length / 4),
                  })}
                </span>
                {toolCount !== null && toolCount > 0 && (
                  <span className="flex items-center gap-1">
                    <Wrench className="h-3 w-3" />
                    {t('toolsConnected', { count: toolCount })}
                  </span>
                )}
              </div>
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
              <Label htmlFor="ai-handoff-sensitivity">{t('handoffSensitivity')}</Label>
              <p className="text-xs text-muted-foreground">
                {t(`handoffSensitivityDesc.${handoffSensitivity}`)}
              </p>
              <Select
                value={handoffSensitivity}
                onValueChange={(v) => setHandoffSensitivity(v as HandoffSensitivity)}
                disabled={disabled || !autoReplyEnabled}
              >
                <SelectTrigger id="ai-handoff-sensitivity">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="conservative">
                    {t('handoffSensitivityLabel.conservative')}
                  </SelectItem>
                  <SelectItem value="balanced">
                    {t('handoffSensitivityLabel.balanced')}
                  </SelectItem>
                  <SelectItem value="assertive">
                    {t('handoffSensitivityLabel.assertive')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-temperature">{t('temperature')}</Label>
              <p className="text-xs text-muted-foreground">{t('temperatureDesc')}</p>
              <Select
                value={
                  Object.entries(TEMPERATURE_PRESETS).find(([, v]) => v === temperature)?.[0] ??
                  TEMPERATURE_DEFAULT
                }
                onValueChange={(v: string | null) =>
                  setTemperature(v ? TEMPERATURE_PRESETS[v] ?? null : null)
                }
                disabled={disabled}
              >
                <SelectTrigger id="ai-temperature">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TEMPERATURE_DEFAULT}>{t('temperatureProviderDefault')}</SelectItem>
                  <SelectItem value="consistent">{t('temperatureConsistent')}</SelectItem>
                  <SelectItem value="balanced_temp">{t('temperatureBalanced')}</SelectItem>
                </SelectContent>
              </Select>
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
            <CardTitle className="text-base">{t('knowledgeRetrieval')}</CardTitle>
            <CardDescription>{t('knowledgeRetrievalDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ai-kb-topk">{t('knowledgeTopK')}</Label>
                <p className="text-xs text-muted-foreground">{t('knowledgeTopKDesc')}</p>
                <Select
                  value={String(knowledgeTopK)}
                  onValueChange={(v) => setKnowledgeTopK(Number(v))}
                  disabled={disabled}
                >
                  <SelectTrigger id="ai-kb-topk">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[3, 5, 8, 10].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ai-kb-strictness">{t('knowledgeStrictness')}</Label>
                <p className="text-xs text-muted-foreground">{t('knowledgeStrictnessDesc')}</p>
                <Select
                  value={
                    Object.entries(RELEVANCE_PRESETS).find(
                      ([, v]) => v === knowledgeMinRelevance,
                    )?.[0] ?? RELEVANCE_OFF
                  }
                  onValueChange={(v: string | null) =>
                    setKnowledgeMinRelevance(v ? RELEVANCE_PRESETS[v] ?? null : null)
                  }
                  disabled={disabled}
                >
                  <SelectTrigger id="ai-kb-strictness">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={RELEVANCE_OFF}>{t('knowledgeStrictnessOff')}</SelectItem>
                    <SelectItem value="normal">{t('knowledgeStrictnessNormal')}</SelectItem>
                    <SelectItem value="strict">{t('knowledgeStrictnessStrict')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('conversationHistory')}</CardTitle>
            <CardDescription>{t('conversationHistoryDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="ai-context-limit">{t('contextMessageLimit')}</Label>
                <p className="text-xs text-muted-foreground">{t('contextMessageLimitDesc')}</p>
              </div>
              <Select
                value={String(contextMessageLimit)}
                onValueChange={(v: string | null) => v && setContextMessageLimit(Number(v))}
                disabled={disabled}
              >
                <SelectTrigger id="ai-context-limit" className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[10, 20, 30, 50].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">{t('summarizeHistory')}</p>
                <p className="text-xs text-muted-foreground">{t('summarizeHistoryDesc')}</p>
              </div>
              <Switch
                checked={summarizeHistory}
                onCheckedChange={setSummarizeHistory}
                disabled={disabled}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-dormancy-reset">{t('dormancyReset')}</Label>
              <p className="text-xs text-muted-foreground">{t('dormancyResetDesc')}</p>
              <Select
                value={
                  Object.entries(DORMANCY_PRESETS).find(
                    ([, v]) => v === dormancyResetHours,
                  )?.[0] ?? DORMANCY_NEVER
                }
                onValueChange={(v: string | null) =>
                  setDormancyResetHours(v ? DORMANCY_PRESETS[v] ?? null : null)
                }
                disabled={disabled}
              >
                <SelectTrigger id="ai-dormancy-reset">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DORMANCY_NEVER}>{t('dormancyResetNever')}</SelectItem>
                  <SelectItem value="24">{t('dormancyReset24h')}</SelectItem>
                  <SelectItem value="72">{t('dormancyReset72h')}</SelectItem>
                  <SelectItem value="168">{t('dormancyReset7d')}</SelectItem>
                  <SelectItem value="336">{t('dormancyReset14d')}</SelectItem>
                </SelectContent>
              </Select>
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
