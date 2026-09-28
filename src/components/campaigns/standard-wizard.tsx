'use client';

import type { CsvData } from '@/components/campaigns/advanced/types';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import { MessageTemplate } from '@/types';
import { Step1ChooseTemplate } from '@/components/broadcasts/step1-choose-template';
import { Step2SelectAudience } from '@/components/broadcasts/step2-select-audience';
import { Step3Personalize } from '@/components/broadcasts/step3-personalize';
import { Step4ScheduleSend } from '@/components/broadcasts/step4-schedule-send';
import { useBroadcastSending } from '@/hooks/use-broadcast-sending';
import { ArrowLeft, Megaphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHero } from '@/components/layout/page-hero';
import { WizardShell, WizardFooter } from '@/components/campaigns/wizard-shell';
import { WizardStepper } from '@/components/campaigns/wizard-stepper';
import { useTranslations } from 'next-intl';
import { CampaignTypeChooser } from '@/components/campaigns/campaign-type-chooser';
import {
  ADVANCED_DRAFT_KEY,
  STANDARD_DRAFT_KEY,
  clearDraft,
  loadDraft,
  saveDraft,
} from '@/lib/campaigns/draft-storage';

const steps = [
  { label: 'template', key: 'template' },
  { label: 'audience', key: 'audience' },
  { label: 'personalize', key: 'personalize' },
  { label: 'send', key: 'send' },
] as const;

type AudienceState = {
  type: 'all' | 'tags' | 'custom_field' | 'csv';
  tagIds?: string[];
  customField?: {
    fieldId: string;
    operator: 'is' | 'is_not' | 'contains';
    value: string;
  };
  csvContacts?: { phone: string; name?: string }[];
  /** The uploaded file and chosen columns — kept so the step can be revisited. */
  csvTable?: CsvData;
  csvPhoneColumn?: string | null;
  csvNameColumn?: string | null;
  excludeTagIds?: string[];
};

interface StandardDraft {
  choosing: boolean;
  currentStep: number;
  template: MessageTemplate | null;
  channelId: string | null;
  audience: AudienceState;
  variables: Record<
    string,
    { type: 'static' | 'field' | 'custom_field'; value: string }
  >;
  headerMediaUrl: string;
  name: string;
}

/**
 * Standard campaign wizard (template → audience → personalize → send).
 * Client-only (see the page), so the saved draft can seed the first
 * render: a refresh comes back to the same step with the same choices.
 */
export function StandardCampaignWizard() {
  const [draft] = useState(() => loadDraft<StandardDraft>(STANDARD_DRAFT_KEY));
  const router = useRouter();
  const t = useTranslations('Broadcasts.new');
  const tw = useTranslations('Broadcasts.wizard');
  const tl = useTranslations('Broadcasts.advanced.launch');
  const { accountId } = useAuth();
  const { createAndSendBroadcast, isProcessing, progress } =
    useBroadcastSending();
  // Standard vs advanced is picked first.
  const [choosing, setChoosing] = useState(draft?.choosing ?? true);

  const [currentStep, setCurrentStep] = useState(draft?.currentStep ?? 0);
  const [template, setTemplate] = useState<MessageTemplate | null>(
    draft?.template ?? null
  );
  const [channelId, setChannelId] = useState<string | null>(
    draft?.channelId ?? null
  );
  const [audience, setAudience] = useState<AudienceState>(
    draft?.audience ?? { type: 'all' }
  );
  const [variables, setVariables] = useState<StandardDraft['variables']>(
    draft?.variables ?? {}
  );
  const [headerMediaUrl, setHeaderMediaUrl] = useState(
    draft?.headerMediaUrl ?? ''
  );
  const [name, setName] = useState(draft?.name ?? '');

  // Keep the draft in step with every change (a too-big CSV is dropped
  // from the saved copy rather than losing the whole draft).
  useEffect(() => {
    saveDraft<StandardDraft>(
      STANDARD_DRAFT_KEY,
      {
        choosing,
        currentStep,
        template,
        channelId,
        audience,
        variables,
        headerMediaUrl,
        name,
      },
      (d) => ({
        ...d,
        audience: {
          ...d.audience,
          csvTable: undefined,
          csvContacts: undefined,
        },
        currentStep:
          d.audience.type === 'csv'
            ? Math.min(d.currentStep, 1)
            : d.currentStep,
      })
    );
  }, [
    choosing,
    currentStep,
    template,
    channelId,
    audience,
    variables,
    headerMediaUrl,
    name,
  ]);

  async function handleSend(scheduledAt?: Date) {
    if (!template) return;
    // The campaign is created now — a refresh mid-send must not offer
    // the same draft for a second send.
    clearDraft(STANDARD_DRAFT_KEY);

    try {
      const broadcastId = await createAndSendBroadcast({
        name,
        channelId,
        template,
        audience: {
          type: audience.type,
          tagIds: audience.tagIds,
          customField: audience.customField,
          csvContacts: audience.csvContacts,
          excludeTagIds: audience.excludeTagIds,
        },
        variables,
        headerMediaUrl,
        scheduledAt,
      });
      if (scheduledAt) toast.success(tl('scheduled'));
      router.push(`/broadcasts/${broadcastId}`);
    } catch (err) {
      // Previously swallowed with console.error — the wizard would
      // just no-op, leaving the user confused. Surface the reason.
      const message = err instanceof Error ? err.message : 'Campaign failed';
      console.error('Campaign failed:', err);
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

    const { error } = await supabase.from('broadcasts').insert({
      user_id: user.id,
      account_id: accountId,
      name: name.trim(),
      template_name: template.name,
      template_language: template.language ?? 'en_US',
      template_variables: variables,
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
    clearDraft(STANDARD_DRAFT_KEY);
    toast.success(t('toastDraftSaved'));
    router.push('/broadcasts');
  }

  return (
    <WizardShell width="max-w-4xl">
      <PageHero
        icon={Megaphone}
        title={name.trim() || t('title')}
        description={t('subtitle')}
      >
        {choosing ? null : (
          <WizardStepper
            labels={steps.map((s) => t(`steps.${s.label}`))}
            current={currentStep}
            onSelect={setCurrentStep}
          />
        )}
      </PageHero>

      {choosing ? (
        <>
          <CampaignTypeChooser
            name={name}
            onNameChange={setName}
            onStandard={() => setChoosing(false)}
            onAdvanced={() => {
              clearDraft(STANDARD_DRAFT_KEY, ADVANCED_DRAFT_KEY);
              router.push(
                `/broadcasts/new/advanced?name=${encodeURIComponent(name.trim())}`
              );
            }}
          />
          <WizardFooter>
            <Button
              variant="outline"
              onClick={() => router.push('/broadcasts')}
            >
              <ArrowLeft className="size-4" />
              {tw('back')}
            </Button>
          </WizardFooter>
        </>
      ) : (
        <>
          {/* Step Content */}
          <div className="relative">
            <div
              className="transition-all duration-300 ease-in-out"
              style={{
                opacity: isProcessing ? 0.6 : 1,
                pointerEvents: isProcessing ? 'none' : 'auto',
              }}
            >
              {currentStep === 0 && (
                <Step1ChooseTemplate
                  channelId={channelId}
                  onChannelChange={(id) => {
                    // Templates are per WABA — a new channel needs a new pick.
                    if (id !== channelId && channelId !== null)
                      setTemplate(null);
                    setChannelId(id);
                  }}
                  selectedTemplate={template}
                  onSelect={setTemplate}
                  onNext={() => setCurrentStep(1)}
                  onBack={() => setChoosing(true)}
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
              {currentStep === 3 && template && (
                <Step4ScheduleSend
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
        </>
      )}
    </WizardShell>
  );
}
