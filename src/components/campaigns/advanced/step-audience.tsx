'use client';

import { CsvAudiencePanel } from '@/components/campaigns/csv-audience-panel';
import type { AudienceStats, WizardState } from './types';

export function StepAudience({
  state,
  update,
  stats,
}: {
  state: WizardState;
  update: (patch: Partial<WizardState>) => void;
  stats: AudienceStats;
}) {
  return (
    <CsvAudiencePanel
      value={state}
      stats={stats}
      onChange={(patch) =>
        // A new file renames the columns — earlier mappings point nowhere.
        update(
          patch.csv ? { ...patch, mappings: {}, shared: { body: {} } } : patch
        )
      }
    />
  );
}
