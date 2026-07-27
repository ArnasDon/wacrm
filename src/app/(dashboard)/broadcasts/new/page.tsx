'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import { MessageTemplate } from '@/types';
import { Step1ChooseTemplate } from '@/components/broadcasts/step1-choose-template';
import { Step1ComposeText, type FreeTextMediaKind } from '@/components/broadcasts/step1-compose-text';
import { Step2SelectAudience } from '@/components/broadcasts/step2-select-audience';
import { Step3Personalize } from '@/components/broadcasts/step3-personalize';
import { Step4ScheduleSend } from '@/components/broadcasts/step4-schedule-send';
import { useBroadcastSending } from '@/hooks/use-broadcast-sending';
import { Check, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

const steps = [
  { label: 'template', key: 'template' },
  { label: 'audience', key: 'audience' },
  { label: 'personalize', key: 'personalize' },
  { label: 'send', key: 'send' },
] as const;

export default function NewBroadcastPage() {
  const router = useRouter();
  const t = useTranslations('Broadcasts.new');
  const { accountId } = useAuth();
  const { createAndSendBroadcast, isProcessing, progress } = useBroadcastSending();

  // Meta requires an approved template for business-initiated
  // broadcasts (Meta's own policy); uazapi has no such pipeline, so
  // accounts on it compose free text instead (Step1ComposeText). This
  // is the one place in the wizard that genuinely forks by provider —
  // audience selection and scheduling are identical either way.
  const [provider, setProvider] = useState<'meta' | 'uazapi' | null>(null);
  const [loadingProvider, setLoadingProvider] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/whatsapp/provider');
        const data = await res.json();
        setProvider(res.ok ? (data.provider ?? 'meta') : 'meta');
      } catch {
        setProvider('meta');
      } finally {
        setLoadingProvider(false);
      }
    })();
  }, []);

  const [currentStep, setCurrentStep] = useState(0);
  const [template, setTemplate] = useState<MessageTemplate | null>(null);
  const [bodyText, setBodyText] = useState('');
  const [freeTextMediaUrl, setFreeTextMediaUrl] = useState('');
  const [freeTextMediaKind, setFreeTextMediaKind] = useState<FreeTextMediaKind>('');
  const [audience, setAudience] = useState<{
    type: 'all' | 'tags' | 'custom_field' | 'csv';
    tagIds?: string[];
    customField?: {
      fieldId: string;
      operator: 'is' | 'is_not' | 'contains';
      value: string;
    };
    csvContacts?: { phone: string; name?: string }[];
    excludeTagIds?: string[];
  }>({ type: 'all' });
  const [variables, setVariables] = useState<
    Record<string, { type: 'static' | 'field' | 'custom_field'; value: string }>
  >({});
  const [headerMediaUrl, setHeaderMediaUrl] = useState('');
  const [name, setName] = useState('');

  const isUazapi = provider === 'uazapi';
  // Whether step 1's content requirement is satisfied — gates steps 2-4.
  const hasContent = isUazapi ? bodyText.trim().length > 0 : template !== null;

  async function handleSend() {
    if (!hasContent) return;

    try {
      const broadcastId = await createAndSendBroadcast(
        isUazapi
          ? {
              name,
              bodyText,
              mediaUrl: freeTextMediaKind ? freeTextMediaUrl : undefined,
              mediaKind: freeTextMediaKind || undefined,
              audience: {
                type: audience.type,
                tagIds: audience.tagIds,
                customField: audience.customField,
                csvContacts: audience.csvContacts,
                excludeTagIds: audience.excludeTagIds,
              },
              variables,
            }
          : {
              name,
              template: template!,
              audience: {
                type: audience.type,
                tagIds: audience.tagIds,
                customField: audience.customField,
                csvContacts: audience.csvContacts,
                excludeTagIds: audience.excludeTagIds,
              },
              variables,
              headerMediaUrl,
            },
      );
      router.push(`/broadcasts/${broadcastId}`);
    } catch (err) {
      // Previously swallowed with console.error — the wizard would
      // just no-op, leaving the user confused. Surface the reason.
      const message = err instanceof Error ? err.message : 'Falha no disparo';
      console.error('Broadcast failed:', err);
      toast.error(message);
    }
  }

  /**
   * Writes a draft broadcast row — no recipients, no sending. The user
   * can revisit it via the list page to finish the flow later. We
   * don't persist the in-progress audience/variable config here
   * because the current schema doesn't carry it past `audience_filter`
   * and `template_variables`; those are enough for the user to
   * recognize the draft but not to exactly round-trip into the wizard.
   * A full resume-draft UX is a future polish.
   */
  async function handleSaveDraft() {
    if (!hasContent || !name.trim()) {
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
      template_name: isUazapi ? null : template!.name,
      template_language: isUazapi ? null : (template!.language ?? 'en_US'),
      template_variables: variables,
      body_text: isUazapi ? bodyText : null,
      media_url: isUazapi && freeTextMediaKind ? freeTextMediaUrl : null,
      media_kind: isUazapi && freeTextMediaKind ? freeTextMediaKind : null,
      audience_filter: {
        type: audience.type,
        tagIds: audience.tagIds,
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
    router.push('/broadcasts');
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
        {loadingProvider ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <div
            className="transition-all duration-300 ease-in-out"
            style={{
              opacity: isProcessing ? 0.6 : 1,
              pointerEvents: isProcessing ? 'none' : 'auto',
            }}
          >
            {currentStep === 0 && (
              isUazapi ? (
                <Step1ComposeText
                  bodyText={bodyText}
                  onBodyTextChange={setBodyText}
                  mediaUrl={freeTextMediaUrl}
                  onMediaUrlChange={setFreeTextMediaUrl}
                  mediaKind={freeTextMediaKind}
                  onMediaKindChange={setFreeTextMediaKind}
                  onNext={() => setCurrentStep(1)}
                  onBack={() => router.push('/broadcasts')}
                />
              ) : (
                <Step1ChooseTemplate
                  selectedTemplate={template}
                  onSelect={setTemplate}
                  onNext={() => setCurrentStep(1)}
                  onBack={() => router.push('/broadcasts')}
                />
              )
            )}
            {currentStep === 1 && (
              <Step2SelectAudience
                audience={audience}
                onUpdate={setAudience}
                onNext={() => setCurrentStep(2)}
                onBack={() => setCurrentStep(0)}
              />
            )}
            {currentStep === 2 && hasContent && (
              <Step3Personalize
                template={
                  isUazapi
                    ? { body_text: bodyText, header_type: undefined, header_media_url: undefined }
                    : template!
                }
                variables={variables}
                onUpdate={setVariables}
                headerMediaUrl={isUazapi ? '' : headerMediaUrl}
                onHeaderMediaUrlChange={isUazapi ? () => {} : setHeaderMediaUrl}
                onNext={() => setCurrentStep(3)}
                onBack={() => setCurrentStep(1)}
              />
            )}
            {currentStep === 3 && hasContent && (
              <Step4ScheduleSend
                name={name}
                onNameChange={setName}
                template={isUazapi ? { name: t('freeTextLabel'), language: undefined } : template!}
                audience={audience}
                onSend={handleSend}
                onSaveDraft={handleSaveDraft}
                onBack={() => setCurrentStep(2)}
                isProcessing={isProcessing}
                progress={progress}
                showBanRiskWarning={isUazapi}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
