'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';
import { KnowledgeManager } from './knowledge-manager';

interface AgentConfigState {
  provider: 'openai' | 'anthropic';
  model: string;
  apiKey: string;
  agentEnabled: boolean;
  pipelineMoveEnabled: boolean;
  autoReplyMaxPerConversation: number;
}

const DEFAULTS: AgentConfigState = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKey: '',
  agentEnabled: false,
  pipelineMoveEnabled: false,
  autoReplyMaxPerConversation: 3,
};

export function AgentConfig() {
  const t = useTranslations('Settings.agent');
  const { canEditSettings, profileLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [form, setForm] = useState<AgentConfigState>(DEFAULTS);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/ai/config')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.config) {
          setForm({ ...DEFAULTS, ...data.config, apiKey: '' });
          setHasStoredKey(Boolean(data.hasApiKey));
        }
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch('/api/ai/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t('saveError'));
        return;
      }
      toast.success(t('saved'));
      setHasStoredKey(true);
      setForm((f) => ({ ...f, apiKey: '' }));
    } catch {
      toast.error(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SettingsPanelHead title={t('title')} description={t('description')} />
      <Card>
        <CardHeader>
          <CardTitle>{t('providerTitle')}</CardTitle>
          <CardDescription>{t('providerDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t('providerLabel')}</Label>
            <select
              value={form.provider}
              onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value as 'openai' | 'anthropic' }))}
              disabled={!canEditSettings || profileLoading}
              className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>{t('modelLabel')}</Label>
            <Input
              value={form.model}
              onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
              disabled={!canEditSettings || profileLoading}
              className="bg-muted text-foreground"
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('apiKeyLabel')}</Label>
            <Input
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
              placeholder={hasStoredKey ? t('apiKeyStoredPlaceholder') : t('apiKeyPlaceholder')}
              disabled={!canEditSettings || profileLoading}
              className="bg-muted text-foreground"
            />
            {!canEditSettings && (
              <p className="text-xs text-muted-foreground">{t('adminOnlyHint')}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('behaviorTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">{t('agentEnabledLabel')}</p>
              <p className="text-xs text-muted-foreground">{t('agentEnabledHint')}</p>
            </div>
            <Switch
              checked={form.agentEnabled}
              onCheckedChange={(v) => setForm((f) => ({ ...f, agentEnabled: v }))}
              disabled={!canEditSettings || profileLoading}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">{t('pipelineMoveEnabledLabel')}</p>
              <p className="text-xs text-muted-foreground">{t('pipelineMoveEnabledHint')}</p>
            </div>
            <Switch
              checked={form.pipelineMoveEnabled}
              onCheckedChange={(v) => setForm((f) => ({ ...f, pipelineMoveEnabled: v }))}
              disabled={!canEditSettings || profileLoading}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('replyCapLabel')}</Label>
            <Input
              type="number"
              min={1}
              value={form.autoReplyMaxPerConversation}
              onChange={(e) =>
                setForm((f) => ({ ...f, autoReplyMaxPerConversation: Number(e.target.value) || 1 }))
              }
              disabled={!canEditSettings || profileLoading}
              className="w-24 bg-muted text-foreground"
            />
          </div>
        </CardContent>
      </Card>

      <KnowledgeManager />

      {canEditSettings && (
        <Button onClick={handleSave} disabled={saving || profileLoading}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {t('save')}
        </Button>
      )}
    </div>
  );
}
