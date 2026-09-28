'use client';

import dynamic from 'next/dynamic';

// Client-only so the wizard can restore its saved draft on the first
// render (sessionStorage doesn't exist during server rendering).
export const AdvancedCampaignWizardClient = dynamic(
  () => import('./advanced-wizard').then((m) => m.AdvancedCampaignWizard),
  { ssr: false }
);
