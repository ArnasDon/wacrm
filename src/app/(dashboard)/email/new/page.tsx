'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import { EmailTemplate } from '@/types';
import { Step1ChooseEmailTemplate } from '@/components/email/step1-choose-email-template';
import { Step2SelectAudience } from '@/components/broadcasts/step2-select-audience';
import { Step3EmailPreview } from '@/components/email/step3-email-preview';
import { Step4EmailSend } from '@/components/email/step4-email-send';
import { useEmailCampaignSending } from '@/hooks/use-email-campaign-sending';
import { CampaignStepper, type CampaignStep } from '@/components/campaigns/campaign-stepper';
import { useTranslations } from 'next-intl';

const steps: readonly CampaignStep[] = [
  { key: 'template', labelKey: 'template' },
  { key: 'audience', labelKey: 'audience' },
  { key: 'personalize', labelKey: 'personalize' },
  { key: 'send', labelKey: 'send' },
] as const;

export default function NewEmailCampaignPage() {
  const router = useRouter();
  const t = useTranslations('EmailCampaigns.new');
  const { accountId } = useAuth();
  const { createAndSendCampaign, isProcessing, progress } = useEmailCampaignSending();

  const [currentStep, setCurrentStep] = useState(0);
  const [template, setTemplate] = useState<EmailTemplate | null>(null);
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
  const [name, setName] = useState('');

  async function handleSend() {
    if (!template) return;

    try {
      const campaignId = await createAndSendCampaign({
        name,
        template,
        audience: {
          type: audience.type,
          tagIds: audience.tagIds,
          customField: audience.customField,
          csvContacts: audience.csvContacts,
          excludeTagIds: audience.excludeTagIds,
        },
        variables: {},
      });
      router.push(`/email/${campaignId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Campaign failed';
      console.error('Email campaign failed:', err);
      toast.error(message);
    }
  }

  async function handleSaveDraft() {
    if (!template || !name.trim()) {
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

    const { error } = await supabase.from('email_campaigns').insert({
      user_id: user.id,
      account_id: accountId,
      name: name.trim(),
      subject: template.subject,
      body_html: template.body_html,
      template_id: template.id,
      template_variables: {},
      audience_filter: {
        type: audience.type,
        tagIds: audience.tagIds,
        customField: audience.customField,
      },
      status: 'draft',
      total_recipients: 0,
      sent_count: 0,
      delivered_count: 0,
      opened_count: 0,
      clicked_count: 0,
      failed_count: 0,
    });

    if (error) {
      toast.error(t('toastFailedDraft', { error: error.message }));
      return;
    }
    toast.success(t('toastDraftSaved'));
    router.push('/email');
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {/* Step Indicator */}
      <CampaignStepper currentStep={currentStep} steps={steps} t={t} />

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
            <Step1ChooseEmailTemplate
              selectedTemplate={template}
              onSelect={setTemplate}
              onNext={() => setCurrentStep(1)}
              onBack={() => router.push('/email')}
              onCreateTemplate={() => router.push('/email?tab=templates')}
            />
          )}
          {currentStep === 1 && (
            <Step2SelectAudience
              audience={audience}
              onUpdate={setAudience}
              onNext={() => setCurrentStep(2)}
              onBack={() => setCurrentStep(0)}
            />
          )}
          {currentStep === 2 && template && (
            <Step3EmailPreview
              template={template}
              variables={{}}
              onNext={() => setCurrentStep(3)}
              onBack={() => setCurrentStep(1)}
            />
          )}
          {currentStep === 3 && template && (
            <Step4EmailSend
              name={name}
              onNameChange={setName}
              template={template}
              audience={audience}
              onSend={handleSend}
              onSaveDraft={handleSaveDraft}
              onBack={() => setCurrentStep(2)}
              isProcessing={isProcessing}
              progress={progress}
            />
          )}
        </div>
      </div>
    </div>
  );
}