'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Package, Loader2 } from 'lucide-react';
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

interface ProductRow {
  id: string;
  product_name: string;
  product_code: string | null;
  status: string;
  updated_at: string;
  category: { id: string; name: string } | null;
}

const STATUS_FILTERS = [
  'all',
  'draft',
  'pending_review',
  'published',
  'archived',
] as const;

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  pending_review: 'Pending review',
  published: 'Published',
  archived: 'Archived',
};

const STATUS_VARIANT: Record<
  string,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  draft: 'outline',
  pending_review: 'secondary',
  published: 'default',
  archived: 'outline',
};

export default function ProductsListPage() {
  const { loading: authLoading, accountId, canEditSettings } = useAuth();
  const [items, setItems] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]>('all');

  const load = useCallback(async (status: string) => {
    setLoading(true);
    try {
      const qs =
        status === 'all' ? '' : `?status=${encodeURIComponent(status)}`;
      const res = await fetch(`/api/products${qs}`);
      const data = await res.json();
      if (res.ok) setItems(data.products ?? []);
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
          <h1 className="text-foreground text-2xl font-bold">Products</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            The catalog Content, Campaigns, and the AI assistant draw approved
            product data from.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/products/vehicles"
            className={buttonVariants({ variant: 'outline' })}
          >
            Vehicles
          </Link>
          {canEditSettings && (
            <Link href="/products/new" className={buttonVariants()}>
              <Plus className="size-4" />
              New Product
            </Link>
          )}
        </div>
      </div>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
        <TabsList>
          {STATUS_FILTERS.map((s) => (
            <TabsTrigger key={s} value={s}>
              {s === 'all' ? 'All' : STATUS_LABEL[s]}
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
          <Package className="text-muted-foreground size-8" />
          <p className="text-muted-foreground text-sm">
            No products yet.{' '}
            {canEditSettings
              ? 'Add your first one to get started.'
              : 'An admin can add one from Products.'}
          </p>
          {canEditSettings && (
            <Link
              href="/products/new"
              className={buttonVariants({ size: 'sm' })}
            >
              <Plus className="size-4" />
              New Product
            </Link>
          )}
        </div>
      ) : (
        <div className="border-border rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id} className="cursor-pointer">
                  <TableCell>
                    <Link
                      href={`/products/${item.id}`}
                      className="text-foreground font-medium hover:underline"
                    >
                      {item.product_name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {item.product_code || '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {item.category?.name ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[item.status] ?? 'outline'}>
                      {STATUS_LABEL[item.status] ?? item.status}
                    </Badge>
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
