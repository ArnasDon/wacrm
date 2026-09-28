import { AdvancedCampaignWizardClient } from '@/components/campaigns/advanced/advanced-wizard-client';

export default async function NewAdvancedCampaignPage({
  searchParams,
}: {
  searchParams: Promise<{ name?: string | string[] }>;
}) {
  // The campaign is named on the type chooser (/broadcasts/new).
  const { name } = await searchParams;
  return (
    <AdvancedCampaignWizardClient
      initialName={typeof name === 'string' ? name.slice(0, 120) : ''}
    />
  );
}
