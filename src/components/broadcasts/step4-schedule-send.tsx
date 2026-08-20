'use client';

import { useEffect, useState } from 'react';
import { MessageTemplate, Contact } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ArrowLeft, Send, Loader2, Users, Save, Eye, CheckCircle2, Rocket, Smartphone } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useBroadcastSending, type AudienceConfig } from '@/hooks/use-broadcast-sending';

type SendChannel = 'api' | 'external';

interface Step4Props {
  name: string;
  onNameChange: (name: string) => void;
  description: string;
  onDescriptionChange: (description: string) => void;
  sendChannel: SendChannel;
  /** Required (non-null) when sendChannel === 'api'. */
  template: MessageTemplate | null;
  /** Required (non-empty) when sendChannel === 'external'. */
  messageText: string;
  imageUrl: string;
  audience: AudienceConfig;
  /** 'api' only — WACRM never sends 'external' campaigns itself (spec section 4/7). */
  onSend: () => void;
  onSaveDraft?: () => void;
  /**
   * "Salvar como pronta para envio" — materializes recipients without
   * sending (spec section 3). For 'external' this is the only action:
   * WACRM prepares + registers the campaign for the outside executor.
   */
  onSaveReady?: () => void;
  onBack: () => void;
  isProcessing: boolean;
  progress: number;
}

const AUDIENCE_LABEL_KEY: Record<AudienceConfig['type'], string> = {
  all: 'scheduleSend.audienceAll',
  tags: 'scheduleSend.audienceTags',
  custom_field: 'scheduleSend.audienceField',
  csv: 'scheduleSend.audienceCsv',
  segment: 'scheduleSend.audienceSegment',
  pipeline_stage: 'scheduleSend.audiencePipelineStage',
  contacts: 'scheduleSend.audienceContacts',
};

export function Step4ScheduleSend({
  name,
  onNameChange,
  description,
  onDescriptionChange,
  sendChannel,
  template,
  messageText,
  imageUrl,
  audience,
  onSend,
  onSaveDraft,
  onSaveReady,
  onBack,
  isProcessing,
  progress,
}: Step4Props) {
  const t = useTranslations('Campaigns.wizard');
  const { previewAudience } = useBroadcastSending();
  const [showConfirm, setShowConfirm] = useState(false);
  const [showRecipients, setShowRecipients] = useState(false);
  const [recipients, setRecipients] = useState<Contact[] | null>(null);
  const [loadingReach, setLoadingReach] = useState(true);

  // The same resolver the send engine uses (use-broadcast-sending.ts) —
  // "X contatos encontrados" and "who actually gets messaged" are
  // always the same list (spec section 3), never a second estimate
  // that can drift from what's actually sent.
  useEffect(() => {
    let cancelled = false;
    setLoadingReach(true);
    previewAudience(audience)
      .then((contacts) => {
        if (!cancelled) setRecipients(contacts);
      })
      .catch(() => {
        if (!cancelled) setRecipients([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingReach(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(audience)]);

  const estimatedReach = recipients?.length ?? 0;
  const audienceLabel = t(AUDIENCE_LABEL_KEY[audience.type] ?? 'scheduleSend.audienceField');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('scheduleSend.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('scheduleSend.subtitle')}
        </p>
      </div>

      {/* Campaign name + description */}
      <div className="space-y-3">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground">{t('scheduleSend.broadcastName')}</label>
          <Input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder={t('scheduleSend.broadcastNamePlaceholder')}
            className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground">{t('scheduleSend.descriptionLabel')}</label>
          <Textarea
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder={t('scheduleSend.descriptionPlaceholder')}
            className="min-h-16 border-border bg-muted text-foreground placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* Channel indicator — spec section 2: "o usuário deve conseguir
          visualizar claramente qual caminho está usando antes do envio." */}
      <div
        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
          sendChannel === 'api'
            ? 'border-primary/20 bg-primary/5 text-primary'
            : 'border-amber-500/20 bg-amber-500/5 text-amber-300'
        }`}
      >
        {sendChannel === 'api' ? <Rocket className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
        <span className="font-medium">
          {sendChannel === 'api' ? t('scheduleSend.channelApiBadge') : t('scheduleSend.channelExternalBadge')}
        </span>
      </div>

      {/* Summary Card */}
      <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
        <p className="text-sm font-medium text-foreground">{t('scheduleSend.summary')}</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          {sendChannel === 'api' ? (
            <>
              <div>
                <p className="text-xs text-muted-foreground">{t('scheduleSend.template')}</p>
                <p className="text-foreground">{template?.name}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t('scheduleSend.language')}</p>
                <p className="text-foreground">{template?.language ?? 'en_US'}</p>
              </div>
            </>
          ) : (
            <div className="col-span-2">
              <p className="text-xs text-muted-foreground">{t('scheduleSend.messagePreview')}</p>
              <p className="whitespace-pre-wrap text-foreground">{messageText}</p>
              {imageUrl.trim() && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageUrl.trim()}
                  alt="Preview"
                  className="mt-2 max-h-32 rounded-lg border border-border object-contain"
                />
              )}
            </div>
          )}
          <div>
            <p className="text-xs text-muted-foreground">{t('scheduleSend.audience')}</p>
            <p className="text-foreground">{audienceLabel}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('scheduleSend.estimatedReach')}</p>
            <div className="flex items-center gap-1.5">
              {loadingReach ? (
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
              ) : (
                <>
                  <Users className="h-3.5 w-3.5 text-primary" />
                  <p className="font-medium text-foreground">{estimatedReach.toLocaleString()}</p>
                  <button
                    type="button"
                    onClick={() => setShowRecipients(true)}
                    disabled={estimatedReach === 0}
                    className="ml-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline disabled:pointer-events-none disabled:opacity-40"
                  >
                    <Eye className="h-3 w-3" />
                    {t('scheduleSend.viewRecipients')}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {sendChannel === 'external' && (
        <p className="text-xs text-muted-foreground">{t('scheduleSend.externalExplainer')}</p>
      )}

      {/* Recipients preview — section 3: "mostrar X contatos e permitir
          visualizar a lista antes de iniciar" */}
      <Dialog open={showRecipients} onOpenChange={setShowRecipients}>
        <DialogContent className="border-border bg-popover sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {t('scheduleSend.recipientsPreviewTitle', { count: estimatedReach })}
            </DialogTitle>
          </DialogHeader>
          {recipients && recipients.length > 0 ? (
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {recipients.map((contact) => (
                <div
                  key={contact.id}
                  className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                >
                  <span className="text-popover-foreground">{contact.name || contact.phone}</span>
                  <span className="text-xs text-muted-foreground">{contact.phone}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('scheduleSend.recipientsPreviewEmpty')}</p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowRecipients(false)}
              className="border-border text-muted-foreground"
            >
              {t('scheduleSend.recipientsPreviewClose')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Processing overlay */}
      {isProcessing && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <p className="text-sm font-medium text-foreground">{t('scheduleSend.sending')}</p>
            </div>
            <span className="text-xs font-medium text-primary">{progress}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted">
            <div
              className="h-1.5 rounded-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        <Button
          variant="outline"
          onClick={onBack}
          disabled={isProcessing}
          className="border-border text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('back')}
        </Button>

        <div className="flex flex-wrap items-center gap-2">
          {onSaveDraft && (
            <Button
              variant="outline"
              onClick={onSaveDraft}
              disabled={!name.trim() || isProcessing}
              className="border-border text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {t('scheduleSend.saveDraft')}
            </Button>
          )}

          {onSaveReady && (
            <Button
              variant="outline"
              onClick={onSaveReady}
              disabled={!name.trim() || estimatedReach === 0 || isProcessing}
              className="border-border text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" />
              {sendChannel === 'external' ? t('scheduleSend.prepareExternal') : t('scheduleSend.saveReady')}
            </Button>
          )}

          {/* 'external' campaigns are never sent from WACRM (spec
              section 4/7) — saveReady above is the only action. */}
          {sendChannel === 'api' && (
            <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
              <DialogTrigger
                render={
                  <Button
                    disabled={!name.trim() || estimatedReach === 0 || isProcessing}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  />
                }
              >
                <Send className="h-4 w-4" />
                {t('scheduleSend.sendNow')}
              </DialogTrigger>
              <DialogContent className="border-border bg-popover sm:max-w-md">
                <DialogHeader>
                  <DialogTitle className="text-popover-foreground">{t('scheduleSend.confirmTitle')}</DialogTitle>
                  <DialogDescription className="text-muted-foreground">
                    {t('scheduleSend.confirmDesc', {
                      count: estimatedReach,
                      template: template?.name ?? '',
                    })}
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setShowConfirm(false)}
                    className="border-border text-muted-foreground"
                  >
                    {t('cancel')}
                  </Button>
                  <Button
                    onClick={() => {
                      setShowConfirm(false);
                      onSend();
                    }}
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    <Send className="h-4 w-4" />
                    {t('scheduleSend.sendNow')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>
    </div>
  );
}
