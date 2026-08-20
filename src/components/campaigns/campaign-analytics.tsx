'use client';

// §13's campaign analytics: reach, engagement, leads, trials,
// conversions, cost, cost/lead, cost/trial, cost/conversion. Cost
// metrics only render when the campaign has real cost data — never a
// fabricated estimate. Data comes from
// `src/lib/dashboard/rimula-analytics.ts::loadCampaignAnalytics`.

import type { LucideIcon } from 'lucide-react';
import {
  Loader2,
  Radio,
  Heart,
  GitBranch,
  FlaskConical,
  Check,
  DollarSign,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { formatCurrency } from '@/lib/currency';
import type { CampaignAnalytics as CampaignAnalyticsData } from '@/lib/dashboard/types';

interface CampaignAnalyticsProps {
  analytics: CampaignAnalyticsData | null;
  loading: boolean;
  currency: string;
}

export function CampaignAnalytics({
  analytics,
  loading,
  currency,
}: CampaignAnalyticsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-foreground">Analytics</CardTitle>
        <CardDescription>
          Reach, engagement, and commercial outcomes attributed to this campaign
          (§13).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading || !analytics ? (
          <div className="text-muted-foreground flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Tile icon={Radio} label="Reach" value={analytics.reach} />
              <Tile
                icon={Heart}
                label="Engagement"
                value={analytics.engagement}
              />
              <Tile icon={GitBranch} label="Leads" value={analytics.leads} />
              <Tile
                icon={FlaskConical}
                label="Trials"
                value={analytics.trials}
              />
              <Tile
                icon={Check}
                label="Conversions"
                value={analytics.conversions}
              />
            </div>

            {analytics.cost != null ? (
              <div>
                <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                  Cost
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Tile
                    icon={DollarSign}
                    label="Total cost"
                    value={formatCurrency(analytics.cost, currency)}
                  />
                  <Tile
                    icon={DollarSign}
                    label="Cost / lead"
                    value={
                      analytics.costPerLead != null
                        ? formatCurrency(analytics.costPerLead, currency)
                        : '—'
                    }
                  />
                  <Tile
                    icon={DollarSign}
                    label="Cost / trial"
                    value={
                      analytics.costPerTrial != null
                        ? formatCurrency(analytics.costPerTrial, currency)
                        : '—'
                    }
                  />
                  <Tile
                    icon={DollarSign}
                    label="Cost / conversion"
                    value={
                      analytics.costPerConversion != null
                        ? formatCurrency(analytics.costPerConversion, currency)
                        : '—'
                    }
                  />
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground text-xs">
                No cost data — add a cost above to see
                cost-per-lead/trial/conversion.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Tile({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
}) {
  return (
    <div className="border-border bg-muted/50 flex items-center gap-2.5 rounded-lg border p-2.5">
      <Icon className="text-primary size-4 shrink-0" />
      <div className="min-w-0">
        <p className="text-foreground text-sm font-semibold tabular-nums">
          {value}
        </p>
        <p className="text-muted-foreground truncate text-[11px]">{label}</p>
      </div>
    </div>
  );
}
