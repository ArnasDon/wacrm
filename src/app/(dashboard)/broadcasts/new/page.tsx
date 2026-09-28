'use client';

import dynamic from 'next/dynamic';

// Client-only so the wizard can restore its saved draft on the first
// render (sessionStorage doesn't exist during server rendering).
const StandardCampaignWizard = dynamic(
  () =>
    import('@/components/campaigns/standard-wizard').then(
      (m) => m.StandardCampaignWizard
    ),
  { ssr: false }
);

export default function NewBroadcastPage() {
  return <StandardCampaignWizard />;
}
