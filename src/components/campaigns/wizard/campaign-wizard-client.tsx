'use client';

import dynamic from 'next/dynamic';

// Client-only so the wizard can restore the tab's autosaved draft on the
// first render (sessionStorage doesn't exist during server rendering).
export const CampaignWizardClient = dynamic(
  () => import('./campaign-wizard').then((m) => m.CampaignWizard),
  { ssr: false }
);
