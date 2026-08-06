'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import type { EmailTemplate } from '@/types';
import { resolveAudience } from '@/lib/campaigns/audience';
import type { AudienceConfig, VariableMapping } from '@/lib/campaigns/types';

interface EmailCampaignPayload {
  name: string;
  template: EmailTemplate;
  audience: AudienceConfig;
  variables: Record<string, VariableMapping>;
}

interface UseEmailCampaignSendingReturn {
  createAndSendCampaign: (payload: EmailCampaignPayload) => Promise<string>;
  isProcessing: boolean;
  progress: number;
}

/** `email_campaign_recipients` inserts; batch para no superar el cap de postgREST. */
const INSERT_BATCH_SIZE = 200;

/**
 * Envío de campañas de email. Espeja `useBroadcastSending`: reutiliza el
 * resolver de audiencia compartido (`src/lib/campaigns/audience.ts`), inserta
 * la campaña + recipients y delega el envío real al server
 * (`/api/email/campaign/send`), que reusa la lib Resend y contactText.
 */
export function useEmailCampaignSending(): UseEmailCampaignSendingReturn {
  const { accountId } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  async function createCampaignRowAndRecipients(payload: EmailCampaignPayload) {
    const supabase = createClient();

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) throw new Error('You are not signed in.');
    if (!accountId) throw new Error('Your profile is not linked to an account.');

    setProgress(5);
    const contacts = await resolveAudience(supabase, accountId, payload.audience);

    setProgress(10);
    const { data: campaign, error: campErr } = await supabase
      .from('email_campaigns')
      .insert({
        user_id: user.id,
        account_id: accountId,
        name: payload.name,
        subject: payload.template.subject,
        body_html: payload.template.body_html,
        template_id: payload.template.id,
        template_variables: payload.variables,
        audience_filter: {
          type: payload.audience.type,
          tagIds: payload.audience.tagIds,
          customField: payload.audience.customField,
          excludeTagIds: payload.audience.excludeTagIds,
        },
        status: 'draft',
        total_recipients: contacts.length,
      })
      .select()
      .single();

    if (campErr || !campaign) {
      throw new Error(`Failed to create campaign: ${campErr?.message ?? 'unknown error'}`);
    }

    setProgress(20);
    const recipientRows = contacts.map((contact) => ({
      email_campaign_id: campaign.id,
      contact_id: contact.id,
      status: 'pending' as const,
    }));

    for (let i = 0; i < recipientRows.length; i += INSERT_BATCH_SIZE) {
      const chunk = recipientRows.slice(i, i + INSERT_BATCH_SIZE);
      const { error: recErr } = await supabase
        .from('email_campaign_recipients')
        .insert(chunk);
      if (recErr) throw new Error(`Failed to insert recipient batch: ${recErr.message}`);
    }

    return { campaign };
  }

  async function createAndSendCampaign(payload: EmailCampaignPayload): Promise<string> {
    setIsProcessing(true);
    setProgress(0);
    try {
      const { campaign } = await createCampaignRowAndRecipients(payload);

      setProgress(40);
      const res = await fetch('/api/email/campaign/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: campaign.id }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Campaign send failed');

      setProgress(100);
      return campaign.id;
    } finally {
      setIsProcessing(false);
    }
  }

  return { createAndSendCampaign, isProcessing, progress };
}