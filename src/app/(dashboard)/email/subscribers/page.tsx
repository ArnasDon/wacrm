'use client';

import { useEffect, useState, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Loader2, Search, Users2, MessageSquare } from 'lucide-react';
import { EmailNav } from '@/components/email/email-nav';
import { ListmonkGate } from '@/components/email/listmonk-status';
import type { ListmonkSubscriber } from '@/lib/listmonk/types';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

export default function SubscribersPage() {
  const t = useTranslations('Email.subscribers');
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-foreground text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
      </div>
      <EmailNav />
      <ListmonkGate>{() => <SubscribersTable />}</ListmonkGate>
    </div>
  );
}

const STATUS_CLASSES: Record<string, string> = {
  enabled: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
  disabled: 'border-border bg-muted text-muted-foreground',
  blocklisted: 'border-red-500/40 bg-red-500/10 text-red-400',
};

function SubscribersTable() {
  const t = useTranslations('Email.subscribers');
  const [subscribers, setSubscribers] = useState<ListmonkSubscriber[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchSubscribers = useCallback(async (p: number, q: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p) });
      if (q) params.set('search', q);
      const res = await fetch(`/api/email/subscribers?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed');
      setSubscribers(data.subscribers ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Debounce so typing doesn't fire a query per keystroke against
    // listmonk's Postgres.
    const id = setTimeout(() => fetchSubscribers(page, search), 300);
    return () => clearTimeout(id);
  }, [page, search, fetchSubscribers]);

  const totalPages = Math.max(1, Math.ceil(total / 50));

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
        <Input
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
          placeholder={t('searchPlaceholder')}
          className="pl-9"
        />
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="text-primary h-6 w-6 animate-spin" />
        </div>
      ) : subscribers.length === 0 ? (
        <div className="border-border bg-card flex h-64 flex-col items-center justify-center rounded-xl border">
          <Users2 className="text-muted-foreground mb-3 h-10 w-10" />
          <p className="text-foreground text-sm font-medium">{t('none')}</p>
          <p className="text-muted-foreground mt-1 text-xs">{t('noneHelp')}</p>
        </div>
      ) : (
        <>
          <div className="border-border bg-card overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-muted-foreground">
                    {t('table.name')}
                  </TableHead>
                  <TableHead className="text-muted-foreground">
                    {t('table.email')}
                  </TableHead>
                  <TableHead className="text-muted-foreground hidden md:table-cell">
                    {t('table.phone')}
                  </TableHead>
                  <TableHead className="text-muted-foreground">
                    {t('table.status')}
                  </TableHead>
                  <TableHead className="text-muted-foreground hidden lg:table-cell">
                    {t('table.lists')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subscribers.map((s) => {
                  // Set by the CRM sync — its presence is what tells
                  // you this person also exists as a WhatsApp contact.
                  const phone = s.attribs?.phone as string | undefined;
                  const fromWacrm = s.attribs?.source === 'wacrm';
                  return (
                    <TableRow
                      key={s.id}
                      className="border-border hover:bg-muted/50"
                    >
                      <TableCell className="text-foreground font-medium">
                        <span className="flex items-center gap-2">
                          {s.name}
                          {fromWacrm && (
                            <MessageSquare
                              className="text-primary h-3.5 w-3.5"
                              aria-label={t('fromCrm')}
                            />
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {s.email}
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden md:table-cell">
                        {phone ?? '—'}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${
                            STATUS_CLASSES[s.status] ?? STATUS_CLASSES.disabled
                          }`}
                        >
                          {s.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden text-xs lg:table-cell">
                        {s.lists?.length ?? 0}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="text-muted-foreground flex items-center justify-between text-sm">
            <span>{t('countLabel', { total })}</span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                {t('prev')}
              </Button>
              <span className="py-1.5 tabular-nums">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('next')}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
