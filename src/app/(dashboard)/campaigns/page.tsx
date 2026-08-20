'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Megaphone, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface CampaignRow {
  id: string;
  campaign_name: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  updated_at: string;
  product: { id: string; product_name: string } | null;
}

const STATUS_FILTERS = [
  'all',
  'draft',
  'active',
  'paused',
  'completed',
  'archived',
] as const;

const STATUS_VARIANT: Record<
  string,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  draft: 'outline',
  active: 'default',
  paused: 'secondary',
  completed: 'secondary',
  archived: 'outline',
};

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function CampaignsListPage() {
  const { loading: authLoading, accountId } = useAuth();
  const [items, setItems] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]>('all');

  const load = useCallback(async (status: string) => {
    setLoading(true);
    try {
      const qs =
        status === 'all' ? '' : `?status=${encodeURIComponent(status)}`;
      const res = await fetch(`/api/campaigns${qs}`);
      const data = await res.json();
      if (res.ok) setItems(data.campaigns ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || !accountId) return;
    void load(filter);
  }, [authLoading, accountId, filter, load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-foreground text-2xl font-bold">Campaigns</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Group content and broadcasts around a product for attribution (§13).
          </p>
        </div>
        <Link href="/campaigns/new" className={buttonVariants()}>
          <Plus className="size-4" />
          New Campaign
        </Link>
      </div>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
        <TabsList>
          {STATUS_FILTERS.map((s) => (
            <TabsTrigger key={s} value={s}>
              {s === 'all' ? 'All' : capitalize(s)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="text-muted-foreground flex items-center justify-center py-16">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="border-border flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <Megaphone className="text-muted-foreground size-8" />
          <p className="text-muted-foreground text-sm">
            No campaigns yet. Create your first one to get started.
          </p>
          <Link
            href="/campaigns/new"
            className={buttonVariants({ size: 'sm' })}
          >
            <Plus className="size-4" />
            New Campaign
          </Link>
        </div>
      ) : (
        <div className="border-border rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id} className="cursor-pointer">
                  <TableCell>
                    <Link
                      href={`/campaigns/${item.id}`}
                      className="text-foreground font-medium hover:underline"
                    >
                      {item.campaign_name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {item.product?.product_name ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[item.status] ?? 'outline'}>
                      {capitalize(item.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {item.start_date ?? '—'} → {item.end_date ?? '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(item.updated_at).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
