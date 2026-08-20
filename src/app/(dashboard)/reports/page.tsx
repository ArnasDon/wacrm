'use client';

// /reports — §7's target nav "Reports"; §13's campaign-analytics
// comparison table across the whole account (per-campaign numbers
// already live on each campaign's own detail page — this is the
// side-by-side attribution view). Plain-English copy, no next-intl,
// matching the convention Phase 5/6's other brand-new pages
// (`/campaigns`, `/leads`) already established — only nav labels get
// translated, not page content, on pages built after the pre-existing
// wacrm surfaces.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, BarChart3 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import {
  loadAllCampaignsAnalytics,
  loadAllProductsAnalytics,
} from '@/lib/dashboard/rimula-analytics';
import type {
  CampaignAnalytics,
  ProductAnalytics,
} from '@/lib/dashboard/types';
import { formatCurrency } from '@/lib/currency';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export default function ReportsPage() {
  const { loading: authLoading, accountId, defaultCurrency } = useAuth();
  const [campaigns, setCampaigns] = useState<CampaignAnalytics[] | null>(null);
  const [products, setProducts] = useState<ProductAnalytics[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const db = createClient();
      const [c, p] = await Promise.all([
        loadAllCampaignsAnalytics(db),
        loadAllProductsAnalytics(db),
      ]);
      setCampaigns(c);
      setProducts(p);
    } catch (err) {
      console.error('[reports] load failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || !accountId) return;
    void load();
  }, [authLoading, accountId, load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-foreground text-2xl font-bold">Reports</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Attribution across campaigns and products — real reach, engagement,
          leads, trials, and conversions (§13). Nothing here is estimated; a
          metric with no underlying data shows as 0 or a dash, never a guess.
        </p>
      </div>

      {loading ? (
        <div className="text-muted-foreground flex items-center justify-center py-16">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-foreground text-lg font-semibold">
              Campaign performance
            </h2>
            {!campaigns || campaigns.length === 0 ? (
              <EmptyState label="No campaigns yet." />
            ) : (
              <div className="border-border overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Campaign</TableHead>
                      <TableHead className="text-right">Reach</TableHead>
                      <TableHead className="text-right">Engagement</TableHead>
                      <TableHead className="text-right">Leads</TableHead>
                      <TableHead className="text-right">Trials</TableHead>
                      <TableHead className="text-right">Conversions</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right">Cost / lead</TableHead>
                      <TableHead className="text-right">Cost / trial</TableHead>
                      <TableHead className="text-right">
                        Cost / conversion
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {campaigns.map((c) => (
                      <TableRow key={c.campaignId}>
                        <TableCell>
                          <Link
                            href={`/campaigns/${c.campaignId}`}
                            className="text-foreground font-medium hover:underline"
                          >
                            {c.campaignName}
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-right tabular-nums">
                          {c.reach}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-right tabular-nums">
                          {c.engagement}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-right tabular-nums">
                          {c.leads}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-right tabular-nums">
                          {c.trials}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-right tabular-nums">
                          {c.conversions}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-right tabular-nums">
                          {c.cost != null
                            ? formatCurrency(c.cost, defaultCurrency)
                            : '—'}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-right tabular-nums">
                          {c.costPerLead != null
                            ? formatCurrency(c.costPerLead, defaultCurrency)
                            : '—'}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-right tabular-nums">
                          {c.costPerTrial != null
                            ? formatCurrency(c.costPerTrial, defaultCurrency)
                            : '—'}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-right tabular-nums">
                          {c.costPerConversion != null
                            ? formatCurrency(
                                c.costPerConversion,
                                defaultCurrency
                              )
                            : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-foreground text-lg font-semibold">
              Product performance
            </h2>
            {!products || products.length === 0 ? (
              <EmptyState label="No products yet." />
            ) : (
              <div className="border-border overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Viewed</TableHead>
                      <TableHead className="text-right">Clicked</TableHead>
                      <TableHead className="text-right">Enquiries</TableHead>
                      <TableHead className="text-right">Interest</TableHead>
                      <TableHead className="text-right">
                        Customer requests
                      </TableHead>
                      <TableHead className="text-right">Trials</TableHead>
                      <TableHead className="text-right">Conversions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {products.map((p) => (
                      <TableRow key={p.productId}>
                        <TableCell>
                          <Link
                            href={`/products/${p.productId}`}
                            className="text-foreground font-medium hover:underline"
                          >
                            {p.productName}
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-right tabular-nums">
                          {p.interactions.viewed}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-right tabular-nums">
                          {p.interactions.clicked}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-right tabular-nums">
                          {p.interactions.enquiry}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-right tabular-nums">
                          {p.interactions.interest}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-right tabular-nums">
                          {p.customerRequests}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-right tabular-nums">
                          {p.trials}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-right tabular-nums">
                          {p.conversions}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="border-border flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
      <BarChart3 className="text-muted-foreground size-8" />
      <p className="text-muted-foreground text-sm">{label}</p>
    </div>
  );
}
