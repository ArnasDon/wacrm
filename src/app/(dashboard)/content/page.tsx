'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, FileText, Loader2 } from 'lucide-react';
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

interface ContentRow {
  id: string;
  title: string;
  content_type: string;
  status: string;
  updated_at: string;
  translations: { id: string; language: string }[];
  voice_notes: { id: string; language: string }[];
}

const STATUS_FILTERS = [
  'all',
  'Draft',
  'In Review',
  'Approved',
  'Scheduled',
  'Published',
  'Archived',
] as const;

const STATUS_VARIANT: Record<
  string,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  Draft: 'outline',
  'In Review': 'secondary',
  Approved: 'secondary',
  Scheduled: 'default',
  Published: 'default',
  Failed: 'destructive',
  Archived: 'outline',
};

export default function ContentListPage() {
  const { loading: authLoading, accountId } = useAuth();
  const [items, setItems] = useState<ContentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]>('all');

  const load = useCallback(async (status: string) => {
    setLoading(true);
    try {
      const qs =
        status === 'all' ? '' : `?status=${encodeURIComponent(status)}`;
      const res = await fetch(`/api/content${qs}`);
      const data = await res.json();
      if (res.ok) setItems(data.content ?? []);
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
          <h1 className="text-foreground text-2xl font-bold">Content Studio</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Create, localize, and schedule community posts.
          </p>
        </div>
        {/* Anchor styled with buttonVariants, not <Button asChild> — the
            wacrm Button is the Base UI ButtonPrimitive with no Radix-style
            asChild slot (see invite-member-dialog.tsx for the same note). */}
        <Link href="/content/new" className={buttonVariants()}>
          <Plus className="size-4" />
          New Content
        </Link>
      </div>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
        <TabsList>
          {STATUS_FILTERS.map((s) => (
            <TabsTrigger key={s} value={s}>
              {s === 'all' ? 'All' : s}
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
          <FileText className="text-muted-foreground size-8" />
          <p className="text-muted-foreground text-sm">
            No content yet. Create your first post to get started.
          </p>
          <Link href="/content/new" className={buttonVariants({ size: 'sm' })}>
            <Plus className="size-4" />
            New Content
          </Link>
        </div>
      ) : (
        <div className="border-border rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Languages</TableHead>
                <TableHead>Voice notes</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id} className="cursor-pointer">
                  <TableCell>
                    <Link
                      href={`/content/${item.id}`}
                      className="text-foreground font-medium hover:underline"
                    >
                      {item.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {item.content_type}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[item.status] ?? 'outline'}>
                      {item.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {item.translations.length === 0
                      ? '—'
                      : item.translations.map((t) => t.language).join(', ')}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {item.voice_notes.length}
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
