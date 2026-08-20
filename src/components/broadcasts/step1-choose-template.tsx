'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Loader2, FileText, ArrowRight, Rocket, Smartphone } from 'lucide-react';
import { useTranslations } from 'next-intl';

const categoryColors: Record<string, string> = {
  Marketing: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  Utility: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  Authentication: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
};

type SendChannel = 'api' | 'external';

interface Step1Props {
  sendChannel: SendChannel;
  onSendChannelChange: (channel: SendChannel) => void;
  selectedTemplate: MessageTemplate | null;
  onSelectTemplate: (template: MessageTemplate) => void;
  messageText: string;
  onMessageTextChange: (text: string) => void;
  imageUrl: string;
  onImageUrlChange: (url: string) => void;
  onNext: () => void;
  onBack: () => void;
}

/**
 * "Mensagem" — was "Template". Now the entry point for BOTH send
 * paths (spec section 1): 'api' keeps the exact template picker that
 * lived here before; 'external' is new — a free-text message (+
 * optional image) for manual WhatsApp Web sends, no template
 * involved. Same step, same position in the wizard — not a parallel
 * flow.
 */
export function Step1ChooseTemplate({
  sendChannel,
  onSendChannelChange,
  selectedTemplate,
  onSelectTemplate,
  messageText,
  onMessageTextChange,
  imageUrl,
  onImageUrlChange,
  onNext,
  onBack,
}: Step1Props) {
  const t = useTranslations('Campaigns.wizard');
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTemplates() {
      try {
        const supabase = createClient();
        // Only APPROVED templates can be sent via Meta — anything else
        // would 400 at broadcast time. Hide them rather than letting
        // the user pick a template that will fail.
        const { data, error: fetchError } = await supabase
          .from('message_templates')
          .select('*')
          .eq('status', 'APPROVED')
          .order('created_at', { ascending: false });

        if (fetchError) throw fetchError;
        setTemplates(data ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('chooseTemplate.errorLoad'));
      } finally {
        setLoading(false);
      }
    }

    fetchTemplates();
  }, []);

  const isValid =
    sendChannel === 'api' ? Boolean(selectedTemplate) : messageText.trim().length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('chooseTemplate.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('chooseTemplate.subtitle')}
        </p>
      </div>

      {/* Path selector — spec section 1: WACRM (official API template) vs Externo (WhatsApp Web, free text). */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          onClick={() => onSendChannelChange('api')}
          className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-all ${
            sendChannel === 'api'
              ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
              : 'border-border bg-card/50 hover:border-border'
          }`}
        >
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              sendChannel === 'api' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
            }`}
          >
            <Rocket className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">{t('chooseTemplate.channelApi')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('chooseTemplate.channelApiDesc')}</p>
          </div>
        </button>
        <button
          onClick={() => onSendChannelChange('external')}
          className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-all ${
            sendChannel === 'external'
              ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
              : 'border-border bg-card/50 hover:border-border'
          }`}
        >
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              sendChannel === 'external' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
            }`}
          >
            <Smartphone className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">{t('chooseTemplate.channelExternal')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('chooseTemplate.channelExternalDesc')}</p>
          </div>
        </button>
      </div>

      {sendChannel === 'api' ? (
        loading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        ) : templates.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-border bg-card/50">
            <FileText className="mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t('chooseTemplate.noTemplates')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('chooseTemplate.createFirst')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((template) => {
              const isSelected = selectedTemplate?.id === template.id;
              const catColor = categoryColors[template.category] ?? categoryColors.Utility;

              return (
                <button
                  key={template.id}
                  onClick={() => onSelectTemplate(template)}
                  className={`flex flex-col gap-3 rounded-xl border p-4 text-left transition-all ${
                    isSelected
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                      : 'border-border bg-card/50 hover:border-border hover:bg-card'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <h3 className="text-sm font-medium text-foreground">{template.name}</h3>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${catColor}`}
                    >
                      {template.category}
                    </span>
                  </div>
                  <p className="line-clamp-3 text-xs text-muted-foreground">{template.body_text}</p>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>{template.language ?? 'en_US'}</span>
                    {/* Status is omitted on purpose — every template
                        shown here is already filtered to APPROVED,
                        so the chip carried no information. */}
                  </div>
                </button>
              );
            })}
          </div>
        )
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card/50 p-4">
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              {t('chooseTemplate.messageLabel')}
            </label>
            <Textarea
              value={messageText}
              onChange={(e) => onMessageTextChange(e.target.value)}
              placeholder={t('chooseTemplate.messagePlaceholder')}
              className="min-h-32 border-border bg-muted text-foreground placeholder:text-muted-foreground"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">{t('chooseTemplate.messageHint')}</p>
          </div>
          <div className="rounded-xl border border-border bg-card/50 p-4">
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              {t('chooseTemplate.imageLabel')}
            </label>
            <Input
              type="url"
              value={imageUrl}
              onChange={(e) => onImageUrlChange(e.target.value)}
              placeholder={t('chooseTemplate.imagePlaceholder')}
              className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
            />
            {imageUrl.trim() && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl.trim()}
                alt="Preview"
                className="mt-3 max-h-40 rounded-lg border border-border object-contain"
              />
            )}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button variant="outline" onClick={onBack} className="border-border text-muted-foreground">
          {t('back')}
        </Button>
        <Button
          onClick={onNext}
          disabled={!isValid}
          className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {t('next')}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
