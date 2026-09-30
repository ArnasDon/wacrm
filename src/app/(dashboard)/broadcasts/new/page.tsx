import { CampaignWizardClient } from '@/components/campaigns/wizard/campaign-wizard-client';

export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; draft?: string; name?: string }>;
}) {
  const { mode, draft, name } = await searchParams;
  return (
    <CampaignWizardClient
      // A new ?draft= opens a different campaign: remount.
      key={draft ?? 'new'}
      initialMode={mode === 'standard' ? 'standard' : 'advanced'}
      initialName={typeof name === 'string' ? name.slice(0, 120) : ''}
      draftId={typeof draft === 'string' ? draft : null}
    />
  );
}
