'use client';

import { useEffect, useState } from 'react';
import { Bot, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { SettingsPanelHead } from './settings-panel-head';

type AgentConfig = {
  id: string | null;
  enabled: boolean;
  model_provider: string;
  model_name: string;
  instructions: string;
  auto_reply: boolean;
  auto_move_deals: boolean;
  handoff_keywords: string[];
  max_messages: number;
  cooldown_seconds: number;
};

type MessageParams = Record<string, string | number | null | undefined>;

const COPY: Record<string, string> = {
  'common.loading': 'Loading...',
  'settings.aiAgent.title': 'AI inbox agent',
  'settings.aiAgent.description': 'Configure the agent that can answer WhatsApp conversations and update deals from the inbox.',
  'settings.aiAgent.configuration': 'Agent configuration',
  'settings.aiAgent.configurationDescription': 'The agent runs after inbound WhatsApp messages that were not consumed by a Flow.',
  'settings.aiAgent.enabled': 'Enable agent',
  'settings.aiAgent.enabledDescription': 'Allow the agent to evaluate new WhatsApp inbound messages.',
  'settings.aiAgent.modelProvider': 'Model provider',
  'settings.aiAgent.modelName': 'Model name',
  'settings.aiAgent.instructions': 'Instructions',
  'settings.aiAgent.autoReply': 'Auto reply',
  'settings.aiAgent.autoReplyDescription': 'Let the agent send WhatsApp replies when it is confident.',
  'settings.aiAgent.autoMoveDeals': 'Move deals',
  'settings.aiAgent.autoMoveDealsDescription': 'Allow the agent to create, move, and update active conversation deals.',
  'settings.aiAgent.handoffKeywords': 'Handoff keywords',
  'settings.aiAgent.handoffKeywordsDescription': 'Comma-separated terms that immediately pause the agent and hand the thread to a human.',
  'settings.aiAgent.maxMessages': 'Context messages',
  'settings.aiAgent.cooldownSeconds': 'Cooldown seconds',
  'settings.aiAgent.adminOnly': 'Only admins can edit this configuration.',
  'settings.aiAgent.loadFailed': 'Failed to load AI agent settings',
  'settings.aiAgent.saveFailed': 'Failed to save AI agent settings',
  'settings.aiAgent.saved': 'AI agent settings saved',
  'settings.aiAgent.validationFailed': 'Review the AI agent limits before saving.',
}

function t(key: string, params: MessageParams = {}): string {
  const template = COPY[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name];
    return value === null || value === undefined ? '' : String(value);
  });
}

const DEFAULT_CONFIG: AgentConfig = {
  id: null,
  enabled: false,
  model_provider: 'openai',
  model_name: 'gpt-4.1-mini',
  instructions: '',
  auto_reply: true,
  auto_move_deals: false,
  handoff_keywords: ['humano', 'atendente', 'cancelar'],
  max_messages: 20,
  cooldown_seconds: 15,
};

export function AiAgentSettings() {
  const { canEditSettings } = useAuth();
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [keywords, setKeywords] = useState(
    DEFAULT_CONFIG.handoff_keywords.join(', ')
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch('/api/ai-agent/config');
        const payload = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(payload.error || t('settings.aiAgent.loadFailed'));
        if (active) {
          setConfig(payload as AgentConfig);
          setKeywords((payload.handoff_keywords as string[]).join(', '));
        }
      } catch (error) {
        console.error('[AiAgentSettings] load error:', error);
        toast.error(
          error instanceof Error
            ? error.message
            : t('settings.aiAgent.loadFailed')
        );
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  function update<K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) {
    setConfig((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    const normalizedKeywords = keywords
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    if (
      config.instructions.length > 4000 ||
      !Number.isInteger(config.max_messages) ||
      config.max_messages < 1 ||
      config.max_messages > 50 ||
      !Number.isInteger(config.cooldown_seconds) ||
      config.cooldown_seconds < 5 ||
      config.cooldown_seconds > 3600 ||
      normalizedKeywords.length > 20 ||
      normalizedKeywords.some((item) => item.length > 40)
    ) {
      toast.error(t('settings.aiAgent.validationFailed'));
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/ai-agent/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...config,
          handoff_keywords: normalizedKeywords,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(payload.error || t('settings.aiAgent.saveFailed'));
      setConfig(payload as AgentConfig);
      setKeywords((payload.handoff_keywords as string[]).join(', '));
      toast.success(t('settings.aiAgent.saved'));
    } catch (error) {
      console.error('[AiAgentSettings] save error:', error);
      toast.error(
        error instanceof Error
          ? error.message
          : t('settings.aiAgent.saveFailed')
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="max-w-2xl">
        <SettingsPanelHead
          title={t('settings.aiAgent.title')}
          description={t('settings.aiAgent.description')}
        />
        <div className="text-muted-foreground flex items-center gap-2 py-8 text-sm">
          <Loader2 className="size-4 animate-spin" />
          {t('common.loading')}
        </div>
      </section>
    );
  }

  return (
    <section className="animate-in fade-in-50 max-w-2xl duration-200">
      <SettingsPanelHead
        title={t('settings.aiAgent.title')}
        description={t('settings.aiAgent.description')}
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground flex items-center gap-2">
            <Bot className="text-primary size-4" />
            {t('settings.aiAgent.configuration')}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t('settings.aiAgent.configurationDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="ai-agent-enabled">
                {t('settings.aiAgent.enabled')}
              </Label>
              <p className="text-muted-foreground mt-1 text-xs">
                {t('settings.aiAgent.enabledDescription')}
              </p>
            </div>
            <Switch
              id="ai-agent-enabled"
              checked={config.enabled}
              onCheckedChange={(value) => update('enabled', value)}
              disabled={!canEditSettings}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('settings.aiAgent.modelProvider')}>
              <Input
                value={config.model_provider}
                maxLength={40}
                onChange={(event) =>
                  update('model_provider', event.target.value)
                }
                disabled={!canEditSettings}
              />
            </Field>
            <Field label={t('settings.aiAgent.modelName')}>
              <Input
                value={config.model_name}
                maxLength={80}
                onChange={(event) => update('model_name', event.target.value)}
                disabled={!canEditSettings}
              />
            </Field>
          </div>
          <Field label={t('settings.aiAgent.instructions')}>
            <Textarea
              value={config.instructions}
              maxLength={4000}
              onChange={(event) => update('instructions', event.target.value)}
              disabled={!canEditSettings}
              className="min-h-32 resize-y"
            />
            <p className="text-muted-foreground text-right text-xs">
              {config.instructions.length}/4000
            </p>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <SwitchField
              id="ai-agent-auto-reply"
              label={t('settings.aiAgent.autoReply')}
              description={t('settings.aiAgent.autoReplyDescription')}
              checked={config.auto_reply}
              onCheckedChange={(value) => update('auto_reply', value)}
              disabled={!canEditSettings}
            />
            <SwitchField
              id="ai-agent-auto-move"
              label={t('settings.aiAgent.autoMoveDeals')}
              description={t('settings.aiAgent.autoMoveDealsDescription')}
              checked={config.auto_move_deals}
              onCheckedChange={(value) => update('auto_move_deals', value)}
              disabled={!canEditSettings}
            />
          </div>
          <Field
            label={t('settings.aiAgent.handoffKeywords')}
            description={t('settings.aiAgent.handoffKeywordsDescription')}
          >
            <Input
              value={keywords}
              onChange={(event) => setKeywords(event.target.value)}
              disabled={!canEditSettings}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('settings.aiAgent.maxMessages')}>
              <Input
                type="number"
                min={1}
                max={50}
                value={config.max_messages}
                onChange={(event) =>
                  update('max_messages', Number(event.target.value))
                }
                disabled={!canEditSettings}
              />
            </Field>
            <Field label={t('settings.aiAgent.cooldownSeconds')}>
              <Input
                type="number"
                min={5}
                max={3600}
                value={config.cooldown_seconds}
                onChange={(event) =>
                  update('cooldown_seconds', Number(event.target.value))
                }
                disabled={!canEditSettings}
              />
            </Field>
          </div>
          {!canEditSettings && (
            <p className="text-muted-foreground text-xs">
              {t('settings.aiAgent.adminOnly')}
            </p>
          )}
          {canEditSettings && (
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-muted-foreground">{label}</Label>
      {description && (
        <p className="text-muted-foreground text-xs">{description}</p>
      )}
      {children}
    </div>
  );
}

function SwitchField({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  disabled: boolean;
}) {
  return (
    <div className="border-border flex items-start justify-between gap-3 rounded-md border p-3">
      <div>
        <Label htmlFor={id}>{label}</Label>
        <p className="text-muted-foreground mt-1 text-xs">{description}</p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </div>
  );
}
