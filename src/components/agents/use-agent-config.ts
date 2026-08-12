'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { AI_PROVIDER_DEFAULT_MODEL } from '@/lib/ai/defaults';
import type { AiProvider, ProductQualificationOrder } from '@/lib/ai/types';
import type { AccountMember } from '@/types';
import { fetchAccountMembers } from '@/lib/account/members';

export const MASKED_KEY = '••••••••••••••••';
export const HANDOFF_QUEUE = '__queue__';

/**
 * All state + load/save logic for the account's single ai_configs row,
 * shared by every Agentes tab that reads or writes a slice of it
 * (Identidade & Comportamento, Modelo & Runtime, Segurança & Handoff).
 * One fetch, one save-the-whole-record — exactly how the single POST
 * /api/ai/config endpoint already works; splitting the UI into tabs
 * does not split the underlying record.
 */
export function useAgentConfig() {
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
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [embeddingsKey, setEmbeddingsKey] = useState('');
  const [embeddingsKeyEdited, setEmbeddingsKeyEdited] = useState(false);
  const [hasStoredEmbeddingsKey, setHasStoredEmbeddingsKey] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [maxPerConversation, setMaxPerConversation] = useState(3);
  const [bufferWindowSeconds, setBufferWindowSeconds] = useState(12);
  const [maxReplyChunks, setMaxReplyChunks] = useState(3);
  const [usdToMznRate, setUsdToMznRate] = useState(63.91);
  const [usdToMznRateUpdatedAt, setUsdToMznRateUpdatedAt] = useState<string | null>(null);
  const [handoffAgentId, setHandoffAgentId] = useState('');
  const [members, setMembers] = useState<AccountMember[]>([]);
  const [temperatureEnabled, setTemperatureEnabled] = useState(false);
  const [temperature, setTemperature] = useState(0.7);

  const [agentName, setAgentName] = useState('');
  const [agentRole, setAgentRole] = useState('');
  const [agentLanguage, setAgentLanguage] = useState('');
  const [agentDescription, setAgentDescription] = useState('');

  const [maxProducts, setMaxProducts] = useState(3);
  const [preferVisual, setPreferVisual] = useState(true);
  const [autoRecommend, setAutoRecommend] = useState(true);
  const [checkStock, setCheckStock] = useState(true);
  const [keepSelectedProduct, setKeepSelectedProduct] = useState(true);
  const [qualificationOrder, setQualificationOrder] =
    useState<ProductQualificationOrder>('size_then_color');

  const loadedAccountIdRef = useRef<string | null>(null);

  const resetCommercialStrategy = () => {
    setMaxProducts(3);
    setPreferVisual(true);
    setAutoRecommend(true);
    setCheckStock(true);
    setKeepSelectedProduct(true);
    setQualificationOrder('size_then_color');
  };

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
        setBufferWindowSeconds(data.buffer_window_seconds ?? 12);
        setMaxReplyChunks(data.max_reply_chunks ?? 3);
        setUsdToMznRate(data.usd_to_mzn_rate ?? 63.91);
        setUsdToMznRateUpdatedAt(data.usd_to_mzn_rate_updated_at ?? null);
        setHandoffAgentId(data.handoff_agent_id ?? '');
        setHasStoredKey(Boolean(data.has_key));
        setApiKey(data.has_key ? MASKED_KEY : '');
        setKeyEdited(false);
        setHasStoredEmbeddingsKey(Boolean(data.has_embeddings_key));
        setEmbeddingsKey(data.has_embeddings_key ? MASKED_KEY : '');
        setEmbeddingsKeyEdited(false);
        setTemperatureEnabled(typeof data.temperature === 'number');
        setTemperature(typeof data.temperature === 'number' ? data.temperature : 0.7);
        setAgentName(data.agent_name ?? '');
        setAgentRole(data.agent_role ?? '');
        setAgentLanguage(data.agent_language ?? '');
        setAgentDescription(data.agent_description ?? '');

        const strategy = data.commercial_strategy ?? {};
        setMaxProducts(strategy.max_products ?? 3);
        setPreferVisual(strategy.prefer_visual ?? true);
        setAutoRecommend(strategy.auto_recommend ?? true);
        setCheckStock(strategy.check_stock ?? true);
        setKeepSelectedProduct(strategy.keep_selected_product ?? true);
        setQualificationOrder(
          strategy.qualification_order === 'color_then_size'
            ? 'color_then_size'
            : 'size_then_color',
        );
      } else {
        resetCommercialStrategy();
      }
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchConfig();
    void fetchAccountMembers().then(setMembers);
  }, [accountId, fetchConfig]);

  const handleProviderChange = (next: AiProvider) => {
    setProvider(next);
    const isDefaultModel =
      model === AI_PROVIDER_DEFAULT_MODEL.openai ||
      model === AI_PROVIDER_DEFAULT_MODEL.anthropic ||
      model.trim() === '';
    if (isDefaultModel) setModel(AI_PROVIDER_DEFAULT_MODEL[next]);
  };

  const keyPayload = () => (keyEdited ? apiKey.trim() : undefined);
  const embeddingsKeyPayload = () =>
    embeddingsKeyEdited ? embeddingsKey.trim() || null : undefined;

  const buildBody = () => ({
    provider,
    model: model.trim(),
    api_key: keyPayload(),
    embeddings_api_key: embeddingsKeyPayload(),
    system_prompt: systemPrompt.trim() || null,
    commercial_strategy: {
      max_products: maxProducts,
      prefer_visual: preferVisual,
      auto_recommend: autoRecommend,
      check_stock: checkStock,
      keep_selected_product: keepSelectedProduct,
      qualification_order: qualificationOrder,
    },
    is_active: isActive,
    auto_reply_enabled: autoReplyEnabled,
    auto_reply_max_per_conversation: maxPerConversation,
    buffer_window_seconds: bufferWindowSeconds,
    max_reply_chunks: maxReplyChunks,
    handoff_agent_id: handoffAgentId || null,
    temperature: temperatureEnabled ? temperature : null,
    agent_name: agentName.trim() || null,
    agent_role: agentRole.trim() || null,
    agent_language: agentLanguage.trim() || null,
    agent_description: agentDescription.trim() || null,
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
      return false;
    }
    if (!configured && !keyEdited) {
      toast.error(t('missingApiKey'));
      return false;
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
        return true;
      }
      toast.error(data.error ?? t('saveFailed'));
      return false;
    } catch {
      toast.error(t('saveFailed'));
      return false;
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
        setBufferWindowSeconds(12);
        setMaxReplyChunks(3);
        setSystemPrompt('');
        setHandoffAgentId('');
        setTemperatureEnabled(false);
        setTemperature(0.7);
        setAgentName('');
        setAgentRole('');
        setAgentLanguage('');
        setAgentDescription('');
        resetCommercialStrategy();
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

  return {
    t,
    loading: loading || profileLoading,
    saving,
    testing,
    removing,
    canEdit,
    configured,
    provider,
    setProvider: handleProviderChange,
    model,
    setModel,
    apiKey,
    setApiKey,
    keyEdited,
    setKeyEdited,
    hasStoredKey,
    embeddingsKey,
    setEmbeddingsKey,
    embeddingsKeyEdited,
    setEmbeddingsKeyEdited,
    hasStoredEmbeddingsKey,
    systemPrompt,
    setSystemPrompt,
    isActive,
    setIsActive,
    autoReplyEnabled,
    setAutoReplyEnabled,
    maxPerConversation,
    setMaxPerConversation,
    bufferWindowSeconds,
    setBufferWindowSeconds,
    maxReplyChunks,
    setMaxReplyChunks,
    usdToMznRate,
    usdToMznRateUpdatedAt,
    handoffAgentId,
    setHandoffAgentId,
    members,
    temperatureEnabled,
    setTemperatureEnabled,
    temperature,
    setTemperature,
    agentName,
    setAgentName,
    agentRole,
    setAgentRole,
    agentLanguage,
    setAgentLanguage,
    agentDescription,
    setAgentDescription,
    maxProducts,
    setMaxProducts,
    preferVisual,
    setPreferVisual,
    autoRecommend,
    setAutoRecommend,
    checkStock,
    setCheckStock,
    keepSelectedProduct,
    setKeepSelectedProduct,
    qualificationOrder,
    setQualificationOrder,
    handleTest,
    handleSave,
    handleRemove,
  };
}

export type AgentConfigState = ReturnType<typeof useAgentConfig>;
