'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Loader2, FileText, ArrowRight, Radio } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { WizardFooter } from '@/components/campaigns/wizard-shell';
import { ChannelDetails } from '@/components/campaigns/channel-details';
import { ChannelPicker } from '@/components/campaigns/channel-picker';
import type { Channel } from '@/components/whatsapp/channel-types';

const categoryColors: Record<string, string> = {
  Marketing: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  Utility: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  Authentication: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
};

interface Step1Props {
  channelId: string | null;
  onChannelChange: (id: string) => void;
  selectedTemplate: MessageTemplate | null;
  onSelect: (template: MessageTemplate) => void;
  onNext: () => void;
  onBack: () => void;
}

export function Step1ChooseTemplate({
  channelId,
  onChannelChange,
  selectedTemplate,
  onSelect,
  onNext,
  onBack,
}: Step1Props) {
  const t = useTranslations('Broadcasts.wizard');
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTemplates() {
      try {
        const supabase = createClient();
        // Only APPROVED templates can be sent via Meta — anything else
        // would 400 at broadcast time. Hide them rather than letting
        // the user pick a template that will fail.
        const [{ data, error: fetchError }, { data: channels }] =
          await Promise.all([
            supabase
              .from('message_templates')
              .select('*')
              .eq('status', 'APPROVED')
              .order('created_at', { ascending: false }),
            // Full channel rows (health, limits) for the details card.
            fetch('/api/whatsapp/channels', { cache: 'no-store' })
              .then((r) => (r.ok ? r.json() : { channels: [] }))
              .then((b) => ({ data: (b.channels ?? []) as Channel[] }))
              .catch(() => ({ data: [] as Channel[] })),
          ]);

        if (fetchError) throw fetchError;
        // A channel can only send its own WABA's templates (migration
        // 047), so the list below follows the chosen channel.
        const list = (channels ?? []) as Channel[];
        setChannels(list);
        setTemplates((data ?? []) as MessageTemplate[]);
        // No channel is pre-selected: the user picks one first.
      } catch (err) {
        setError(
          err instanceof Error ? err.message : t('chooseTemplate.errorLoad')
        );
      } finally {
        setLoading(false);
      }
    }

    fetchTemplates();
    // Loads once; the channel default is only applied when none is set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const channel = channels.find((c) => c.id === channelId) ?? null;
  const visible = channel?.waba_id
    ? templates.filter((r) => !r.waba_id || r.waba_id === channel.waba_id)
    : templates;

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-primary h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-foreground text-lg font-semibold">
          {t('chooseTemplate.title')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('chooseTemplate.subtitle')}
        </p>
      </div>

      <div className="border-border bg-card rounded-xl border p-4">
        <label
          htmlFor="campaign-channel"
          className="text-foreground block text-sm font-medium"
        >
          {t('chooseTemplate.channelLabel')}
        </label>
        {channels.length === 0 ? (
          <p className="text-muted-foreground mt-1 text-sm">
            {t('chooseTemplate.noChannels')}
          </p>
        ) : (
          <>
            <div className="mt-2">
              <ChannelPicker
                id="campaign-channel"
                channels={channels}
                value={channelId ? [channelId] : []}
                onChange={(ids) => ids[0] && onChannelChange(ids[0])}
              />
            </div>
            <p className="text-muted-foreground mt-1 text-xs">
              {t('chooseTemplate.channelHint')}
            </p>
            {channel ? (
              <ChannelDetails channel={channel} className="mt-4" />
            ) : null}
          </>
        )}
      </div>

      {!channel ? (
        <div className="border-border bg-card/50 flex h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 text-center">
          <Radio className="text-muted-foreground h-7 w-7" />
          <p className="text-muted-foreground text-sm">
            {t('chooseTemplate.pickChannelFirst')}
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="border-border bg-card/50 flex h-48 flex-col items-center justify-center rounded-xl border">
          <FileText className="text-muted-foreground mb-2 h-8 w-8" />
          <p className="text-muted-foreground text-sm">
            {t('chooseTemplate.noTemplates')}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            {t('chooseTemplate.createFirst')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((template) => {
            const isSelected = selectedTemplate?.id === template.id;
            const catColor =
              categoryColors[template.category] ?? categoryColors.Utility;

            return (
              <button
                key={template.id}
                onClick={() => onSelect(template)}
                className={`flex flex-col gap-3 rounded-xl border p-4 text-left transition-all ${
                  isSelected
                    ? 'border-primary bg-primary/5 ring-primary/30 ring-1'
                    : 'border-border bg-card/50 hover:border-border hover:bg-card'
                }`}
              >
                <div className="flex items-start justify-between">
                  <h3 className="text-foreground text-sm font-medium">
                    {template.name}
                  </h3>
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${catColor}`}
                  >
                    {template.category}
                  </span>
                </div>
                <p className="text-muted-foreground line-clamp-3 text-xs">
                  {template.body_text}
                </p>
                <div className="text-muted-foreground flex items-center gap-2 text-[10px]">
                  <span>{template.language ?? 'en_US'}</span>
                  {/* Status is omitted on purpose — every template
                      shown here is already filtered to APPROVED,
                      so the chip carried no information. */}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <WizardFooter>
        <Button
          variant="outline"
          onClick={onBack}
          className="border-border text-muted-foreground"
        >
          {t('back')}
        </Button>
        <Button
          onClick={onNext}
          disabled={!selectedTemplate}
          className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {t('next')}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </WizardFooter>
    </div>
  );
}
