'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import {
  uploadAccountMedia,
  deleteAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
  ALLOWED_MIME_TYPES_BY_KIND,
} from '@/lib/storage/upload-media';
import {
  Loader2,
  FileText,
  ArrowRight,
  Rocket,
  Smartphone,
  Plus,
  RefreshCw,
  ImagePlus,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { TemplatePickerModal } from './template-picker-modal';
import { categoryColors } from './template-category-colors';

/** Same bucket message-composer.tsx / template-manager.tsx upload chat/template media to. */
const CHAT_MEDIA_BUCKET = 'chat-media';

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
  const [templateModalOpen, setTemplateModalOpen] = useState(false);

  // Upload state for the external-channel image (Tarefa A1). `imagePath`
  // tracks the last object WE uploaded (not one pasted as a raw URL) so a
  // replacement upload can best-effort GC the previous object.
  const [uploading, setUploading] = useState(false);
  const [imagePath, setImagePath] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  async function handleImageFile(file: File) {
    const allowed = ALLOWED_MIME_TYPES_BY_KIND.image as readonly string[];
    if (!allowed.includes(file.type)) {
      toast.error(t('chooseTemplate.invalidImageType'));
      return;
    }
    if (file.size > MEDIA_MAX_BYTES_BY_KIND.image) {
      toast.error(t('chooseTemplate.imageTooLarge'));
      return;
    }

    setUploading(true);
    try {
      const { publicUrl, path } = await uploadAccountMedia(CHAT_MEDIA_BUCKET, file);
      const previousPath = imagePath;
      setImagePath(path);
      onImageUrlChange(publicUrl);
      if (previousPath) {
        void deleteAccountMedia(CHAT_MEDIA_BUCKET, previousPath).catch(() => {});
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('chooseTemplate.uploadFailed'));
    } finally {
      setUploading(false);
    }
  }

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

      {/* Path selector — spec section 1: "Enviar pelo CRM" (official API template) vs "Envio externo" (WhatsApp Web, free text). */}
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
        <div className="rounded-xl border border-border bg-card/50 p-4">
          {selectedTemplate ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-medium text-foreground">{selectedTemplate.name}</h3>
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                    categoryColors[selectedTemplate.category] ?? categoryColors.Utility
                  }`}
                >
                  {selectedTemplate.category}
                </span>
              </div>
              <p className="line-clamp-3 text-xs text-muted-foreground">
                {selectedTemplate.body_text}
              </p>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span>{selectedTemplate.language ?? 'en_US'}</span>
              </div>
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setTemplateModalOpen(true)}
                  className="border-border text-foreground"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {t('chooseTemplate.changeTemplateButton')}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => setTemplateModalOpen(true)}
              className="w-full border-dashed border-border text-foreground"
            >
              <Plus className="h-4 w-4" />
              {t('chooseTemplate.selectTemplateButton')}
            </Button>
          )}
        </div>
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
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImageFile(file);
                e.target.value = '';
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="border-border text-foreground"
            >
              {uploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ImagePlus className="h-3.5 w-3.5" />
              )}
              {uploading ? t('chooseTemplate.uploading') : t('chooseTemplate.addImageButton')}
            </Button>
            <p className="mt-2.5 text-xs text-muted-foreground">
              {t('chooseTemplate.imageUrlSecondaryLabel')}
            </p>
            <Input
              type="url"
              value={imageUrl}
              onChange={(e) => onImageUrlChange(e.target.value)}
              placeholder={t('chooseTemplate.imagePlaceholder')}
              className="mt-1.5 border-border bg-muted text-foreground placeholder:text-muted-foreground"
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

      <TemplatePickerModal
        open={templateModalOpen}
        onOpenChange={setTemplateModalOpen}
        templates={templates}
        loading={loading}
        error={error}
        selectedTemplate={selectedTemplate}
        onConfirm={onSelectTemplate}
      />
    </div>
  );
}
