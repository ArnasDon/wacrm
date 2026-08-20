'use client';

// §11/§13's product analytics: interaction breakdown (viewed, clicked,
// enquiry, interest, trial request, lead, conversion — the exact
// `product_interactions.interaction_type` enum, migration 047) plus
// linked customer requests / trials / conversions. Data comes from
// `src/lib/dashboard/rimula-analytics.ts::loadProductAnalytics`.

import type { LucideIcon } from 'lucide-react';
import {
  Loader2,
  Eye,
  MousePointerClick,
  MessageCircleQuestion,
  Heart,
  FlaskConical,
  GitBranch,
  Check,
  MessageSquare,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import type { ProductAnalytics as ProductAnalyticsData } from '@/lib/dashboard/types';

interface ProductAnalyticsProps {
  analytics: ProductAnalyticsData | null;
  loading: boolean;
}

export function ProductAnalytics({
  analytics,
  loading,
}: ProductAnalyticsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-foreground">Analytics</CardTitle>
        <CardDescription>
          Interactions and commercial outcomes attributed to this product
          (§11/§13).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading || !analytics ? (
          <div className="text-muted-foreground flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                Interactions
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Tile
                  icon={Eye}
                  label="Viewed"
                  value={analytics.interactions.viewed}
                />
                <Tile
                  icon={MousePointerClick}
                  label="Clicked"
                  value={analytics.interactions.clicked}
                />
                <Tile
                  icon={MessageCircleQuestion}
                  label="Enquiries"
                  value={analytics.interactions.enquiry}
                />
                <Tile
                  icon={Heart}
                  label="Interest"
                  value={analytics.interactions.interest}
                />
              </div>
            </div>
            <div>
              <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                Commercial
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Tile
                  icon={MessageSquare}
                  label="Customer requests"
                  value={analytics.customerRequests}
                />
                <Tile
                  icon={FlaskConical}
                  label="Trials"
                  value={analytics.trials}
                />
                <Tile
                  icon={GitBranch}
                  label="Trial requests"
                  value={analytics.interactions.trial_request}
                />
                <Tile
                  icon={Check}
                  label="Conversions"
                  value={analytics.conversions}
                />
              </div>
              <p className="text-muted-foreground mt-2 text-xs">
                Conversions are trials for this product that reached
                &quot;Converted&quot;. Leads (deals) carry no direct product
                link — attribution runs through the campaign&apos;s product
                instead (§9.0), so a product-level lead count is omitted here
                rather than showing a misleading partial figure.
              </p>
            </div>
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
  value: number;
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
