'use client';

import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, Plus, Mail, RefreshCw } from 'lucide-react';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';
import { EmailNav } from '@/components/email/email-nav';
import { ListmonkGate } from '@/components/email/listmonk-status';
import type { ListmonkList } from '@/lib/listmonk/types';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

export default function EmailListsPage() {
  const t = useTranslations('Email.lists');
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-foreground text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
      </div>
      <EmailNav />
      <ListmonkGate>{() => <ListsTable />}</ListmonkGate>
    </div>
  );
}

interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: string[];
  processed: number;
  total_with_email: number;
  without_email: number;
  next_offset: number | null;
}

function ListsTable() {
  const t = useTranslations('Email.lists');
  const canManage = useCan('edit-settings');
  const [lists, setLists] = useState<ListmonkList[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const [syncOpen, setSyncOpen] = useState(false);
  const [syncListId, setSyncListId] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  const fetchLists = useCallback(async () => {
    try {
      const res = await fetch('/api/email/lists');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed');
      setLists(data.lists ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLists();
  }, [fetchLists]);

  async function createList() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/email/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), type: 'private' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed');
      toast.success(t('created'));
      setCreateOpen(false);
      setNewName('');
      await fetchLists();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally {
      setCreating(false);
    }
  }

  /**
   * Walk every page of contacts. The API caps each call so a large
   * book can't outlive one request; we accumulate totals across the
   * pages and only report once at the end.
   */
  async function runSync() {
    if (!syncListId) return;
    setSyncing(true);
    setSyncResult(null);

    const totals: SyncResult = {
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      errors: [],
      processed: 0,
      total_with_email: 0,
      without_email: 0,
      next_offset: null,
    };

    try {
      let offset: number | null = 0;
      while (offset !== null) {
        const res: Response = await fetch('/api/email/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ list_ids: [syncListId], offset }),
        });
        // Annotated rather than inferred: `offset` is assigned from
        // this value and also feeds the request above, which makes
        // the inference circular (TS7022) without an explicit type.
        const data: SyncResult & { error?: string } = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Sync failed');

        totals.created += data.created;
        totals.updated += data.updated;
        totals.skipped += data.skipped;
        totals.failed += data.failed;
        totals.processed += data.processed;
        totals.total_with_email = data.total_with_email;
        totals.without_email = data.without_email;
        totals.errors.push(...data.errors);
        offset = data.next_offset;
      }

      setSyncResult(totals);
      toast.success(
        t('syncDone', { created: totals.created, updated: totals.updated })
      );
      await fetchLists();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-primary h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <GatedButton
          canAct={canManage}
          gateReason="sync contacts"
          variant="outline"
          onClick={() => {
            setSyncListId(lists[0]?.id ?? null);
            setSyncResult(null);
            setSyncOpen(true);
          }}
        >
          <RefreshCw className="h-4 w-4" />
          {t('syncContacts')}
        </GatedButton>
        <GatedButton
          canAct={canManage}
          gateReason="create lists"
          onClick={() => setCreateOpen(true)}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          {t('newList')}
        </GatedButton>
      </div>

      {lists.length === 0 ? (
        <div className="border-border bg-card flex h-64 flex-col items-center justify-center rounded-xl border">
          <Mail className="text-muted-foreground mb-3 h-10 w-10" />
          <p className="text-foreground text-sm font-medium">{t('noLists')}</p>
        </div>
      ) : (
        <div className="border-border bg-card overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">
                  {t('table.name')}
                </TableHead>
                <TableHead className="text-muted-foreground">
                  {t('table.type')}
                </TableHead>
                <TableHead className="text-muted-foreground">
                  {t('table.optin')}
                </TableHead>
                <TableHead className="text-muted-foreground text-right">
                  {t('table.subscribers')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lists.map((l) => (
                <TableRow
                  key={l.id}
                  className="border-border hover:bg-muted/50"
                >
                  <TableCell className="text-foreground font-medium">
                    {l.name}
                    {l.tags.some((tag) => tag.startsWith('wacrm:')) && (
                      <span className="border-primary/40 bg-primary/10 text-primary ml-2 rounded-full border px-2 py-0.5 text-[10px]">
                        {t('managedHere')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {l.type}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {l.optin}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right tabular-nums">
                    {l.subscriber_count}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('newList')}</DialogTitle>
            <DialogDescription>{t('newListHelp')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="list-name">{t('table.name')}</Label>
            <Input
              id="list-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('newListPlaceholder')}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={createList} disabled={creating || !newName.trim()}>
              {creating && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={syncOpen} onOpenChange={setSyncOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('syncTitle')}</DialogTitle>
            <DialogDescription>{t('syncHelp')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="sync-list">{t('syncTarget')}</Label>
            <select
              id="sync-list"
              value={syncListId ?? ''}
              onChange={(e) => setSyncListId(Number(e.target.value))}
              className="border-border bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm"
            >
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          {syncResult && (
            <div className="border-border bg-muted/40 rounded-lg border p-3 text-sm">
              <div className="grid grid-cols-2 gap-1 text-xs">
                <span className="text-muted-foreground">
                  {t('resultCreated')}
                </span>
                <span className="text-foreground text-right tabular-nums">
                  {syncResult.created}
                </span>
                <span className="text-muted-foreground">
                  {t('resultUpdated')}
                </span>
                <span className="text-foreground text-right tabular-nums">
                  {syncResult.updated}
                </span>
                <span className="text-muted-foreground">
                  {t('resultNoEmail')}
                </span>
                <span className="text-foreground text-right tabular-nums">
                  {syncResult.without_email}
                </span>
                <span className="text-muted-foreground">
                  {t('resultSkipped')}
                </span>
                <span className="text-foreground text-right tabular-nums">
                  {syncResult.skipped}
                </span>
                <span className="text-muted-foreground">
                  {t('resultFailed')}
                </span>
                <span className="text-foreground text-right tabular-nums">
                  {syncResult.failed}
                </span>
              </div>
              {syncResult.errors.length > 0 && (
                <ul className="mt-2 max-h-24 overflow-y-auto text-[11px] text-red-400">
                  {syncResult.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSyncOpen(false)}>
              {t('close')}
            </Button>
            <Button onClick={runSync} disabled={syncing || !syncListId}>
              {syncing && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('runSync')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
