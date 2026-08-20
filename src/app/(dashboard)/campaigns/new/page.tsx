'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import { MessageTemplate } from '@/types';
import { Step1ChooseTemplate } from '@/components/broadcasts/step1-choose-template';
import { Step2SelectAudience } from '@/components/broadcasts/step2-select-audience';
import { Step3Personalize } from '@/components/broadcasts/step3-personalize';
import { Step4ScheduleSend } from '@/components/broadcasts/step4-schedule-send';
import { useBroadcastSending, type AudienceConfig } from '@/hooks/use-broadcast-sending';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';

type SendChannel = 'api' | 'external';

const steps = [
  { label: 'template', key: 'template' },
  { label: 'audience', key: 'audience' },
  { label: 'personalize', key: 'personalize' },
  { label: 'send', key: 'send' },
] as const;

export default function NewCampaignPage() {
  const router = useRouter();
  const t = useTranslations('Campaigns.new');
  const { accountId } = useAuth();
  const { createAndSendBroadcast, saveCampaignReady, isProcessing, progress } =
    useBroadcastSending();

  const [currentStep, setCurrentStep] = useState(0);
  const [sendChannel, setSendChannel] = useState<SendChannel>('api');
  const [template, setTemplate] = useState<MessageTemplate | null>(null);
  const [messageText, setMessageText] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [audience, setAudience] = useState<AudienceConfig>({ type: 'all' });
  const [variables, setVariables] = useState<
    Record<string, { type: 'static' | 'field' | 'custom_field'; value: string }>
  >({});
  const [headerMediaUrl, setHeaderMediaUrl] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  // 'external' has no template variables to map, so the wizard skips
  // straight from "Público" to "Enviar" — same trilha, one fewer stop
  // for a path that has nothing to personalize (spec section 1/2).
  const personalizeStepIndex = 2;
  const sendStepIndex = sendChannel === 'external' ? 2 : 3;

  function goToAudienceNext() {
    setCurrentStep(sendChannel === 'external' ? sendStepIndex : personalizeStepIndex);
  }

  function goBackFromSend() {
    setCurrentStep(sendChannel === 'external' ? 1 : personalizeStepIndex);
  }

  async function handleSend() {
    if (sendChannel !== 'api' || !template) return;

    try {
      const campaignId = await createAndSendBroadcast({
        sendChannel: 'api',
        name,
        description,
        template,
        audience,
        variables,
        headerMediaUrl,
      });
      router.push(`/campaigns/${campaignId}`);
    } catch (err) {
      // Previously swallowed with console.error — the wizard would
      // just no-op, leaving the user confused. Surface the reason.
      const message = err instanceof Error ? err.message : 'Campaign failed';
      console.error('Campaign failed:', err);
      toast.error(message);
    }
  }

  /**
   * "Salvar como pronta para envio" (spec section 3) — resolves the
   * audience and materializes recipient rows so the count/list are
   * locked in and reviewable. For 'api' the campaign lands 'ready' to
   * send from its detail page; for 'external' this is the ONLY
   * materialization action — WACRM prepares + registers the campaign
   * for the outside executor (spec section 4/7), it never sends it.
   */
  async function handleSaveReady() {
    try {
      const campaignId = await saveCampaignReady(
        sendChannel === 'api'
          ? {
              sendChannel: 'api',
              name,
              description,
              template: template!,
              audience,
              variables,
              headerMediaUrl,
            }
          : {
              sendChannel: 'external',
              name,
              description,
              audience,
              messageText,
              imageUrl,
            },
      );
      toast.success(t('toastReadySaved'));
      router.push(`/campaigns/${campaignId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save campaign';
      toast.error(t('toastFailedReady', { error: message }));
    }
  }

  /**
   * Writes a draft campaign row — no recipients, no sending. The user
   * can revisit it via the list page to finish the flow later. We
   * don't persist the in-progress audience/variable config here
   * because the current schema doesn't carry it past `audience_filter`
   * and `template_variables`; those are enough for the user to
   * recognize the draft but not to exactly round-trip into the wizard.
   * A full resume-draft UX is a future polish.
   */
  async function handleSaveDraft() {
    if (!name.trim()) {
      toast.error(t('toastGiveName'));
      return;
    }
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      toast.error(t('toastNotSignedIn'));
      return;
    }
    if (!accountId) {
      toast.error(t('toastNotLinked'));
      return;
    }

    const { error } = await supabase.from('broadcasts').insert({
      user_id: user.id,
      account_id: accountId,
      name: name.trim(),
      description: description.trim() || null,
      send_channel: sendChannel,
      template_name: sendChannel === 'api' ? (template?.name ?? null) : null,
      template_language: sendChannel === 'api' ? (template?.language ?? 'en_US') : 'en_US',
      template_variables: sendChannel === 'api' ? variables : null,
      message_text: sendChannel === 'external' ? messageText.trim() || null : null,
      header_media_url: sendChannel === 'api' ? headerMediaUrl.trim() || null : imageUrl.trim() || null,
      audience_filter: {
        type: audience.type,
        tagIds: audience.tagIds,
        matchAll: audience.matchAll,
        customFields: audience.customFields,
        segmentId: audience.segmentId,
        pipelineStageId: audience.pipelineStageId,
        contactIds: audience.contactIds,
      },
      status: 'draft',
      total_recipients: 0,
      sent_count: 0,
      delivered_count: 0,
      read_count: 0,
      replied_count: 0,
      failed_count: 0,
    });

    if (error) {
      toast.error(t('toastFailedDraft', { error: error.message }));
      return;
    }
    toast.success(t('toastDraftSaved'));
    router.push('/campaigns');
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('subtitle')}
        </p>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center justify-between">
        {steps.map((step, index) => {
          // 'external' never visits "Personalizar" — render 3 dots for it.
          if (sendChannel === 'external' && step.key === 'personalize') return null;
          const isActive = index === currentStep;
          const isCompleted = index < currentStep;

          return (
            <div key={step.key} className="flex flex-1 items-center">
              <div className="flex items-center gap-2">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-all ${
                    isCompleted
                      ? 'bg-primary text-primary-foreground'
                      : isActive
                        ? 'border-2 border-primary bg-primary/10 text-primary'
                        : 'border border-border bg-muted text-muted-foreground'
                  }`}
                >
                  {isCompleted ? <Check className="h-4 w-4" /> : index + 1}
                </div>
                <span
                  className={`hidden text-sm font-medium sm:block ${
                    isActive ? 'text-foreground' : isCompleted ? 'text-primary' : 'text-muted-foreground'
                  }`}
                >
                  {t(`steps.${step.label}`)}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={`mx-3 h-px flex-1 ${
                    index < currentStep ? 'bg-primary' : 'bg-muted'
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Step Content */}
      <div className="relative min-h-[400px]">
        <div
          className="transition-all duration-300 ease-in-out"
          style={{
            opacity: isProcessing ? 0.6 : 1,
            pointerEvents: isProcessing ? 'none' : 'auto',
          }}
        >
          {currentStep === 0 && (
            <Step1ChooseTemplate
              sendChannel={sendChannel}
              onSendChannelChange={setSendChannel}
              selectedTemplate={template}
              onSelectTemplate={setTemplate}
              messageText={messageText}
              onMessageTextChange={setMessageText}
              imageUrl={imageUrl}
              onImageUrlChange={setImageUrl}
              onNext={() => setCurrentStep(1)}
              onBack={() => router.push('/campaigns')}
            />
          )}
          {currentStep === 1 && (
            <Step2SelectAudience
              audience={audience}
              onUpdate={setAudience}
              onNext={goToAudienceNext}
              onBack={() => setCurrentStep(0)}
            />
          )}
          {currentStep === personalizeStepIndex && sendChannel === 'api' && template && (
            <Step3Personalize
              template={template}
              variables={variables}
              onUpdate={setVariables}
              headerMediaUrl={headerMediaUrl}
              onHeaderMediaUrlChange={setHeaderMediaUrl}
              onNext={() => setCurrentStep(3)}
              onBack={() => setCurrentStep(1)}
            />
          )}
          {currentStep === sendStepIndex && (
            <Step4ScheduleSend
              name={name}
              onNameChange={setName}
              description={description}
              onDescriptionChange={setDescription}
              sendChannel={sendChannel}
              template={template}
              messageText={messageText}
              imageUrl={imageUrl}
              audience={audience}
              onSend={handleSend}
              onSaveDraft={handleSaveDraft}
              onSaveReady={handleSaveReady}
              onBack={goBackFromSend}
              isProcessing={isProcessing}
              progress={progress}
            />
          )}
        </div>
      </div>
    </div>
  );
}
