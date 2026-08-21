'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Building2,
  ChevronRight,
  Columns3,
  Loader2,
  Search,
  ShieldOff,
  Store,
  UserPlus,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SettingsChip } from '@/components/settings/settings-chip';
import { BILLING_STATUS_LABEL, BILLING_STATUS_VARIANT } from '@/lib/billing/status';
import { useAuth } from '@/hooks/use-auth';
import type { PlatformOrganization } from '@/types';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

interface ColumnVisibility {
  ownerEmail: boolean;
  sellerCount: boolean;
  createdAt: boolean;
  billingStatus: boolean;
}

const DEFAULT_COLUMNS: ColumnVisibility = {
  ownerEmail: true,
  sellerCount: true,
  createdAt: true,
  billingStatus: true,
};

/**
 * The platform admin panel (/painel-a17c94fe2b6d). This component
 * assumes the page has already verified the caller is a platform
 * admin server-side (requirePlatformAdmin() + notFound() otherwise) —
 * it still calls admin-gated APIs itself, which independently 403 for
 * anyone who isn't, but never assumes that alone is the only guard.
 */
export function PlatformPanel() {
  const t = useTranslations('Platform');
  const { signOut } = useAuth();
  const router = useRouter();

  const [organizations, setOrganizations] = useState<PlatformOrganization[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [columns, setColumns] = useState<ColumnVisibility>(DEFAULT_COLUMNS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkWorking, setBulkWorking] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [storeName, setStoreName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/platform/organizations');
      const data = await res.json();
      if (res.ok) {
        setOrganizations(data.organizations ?? []);
      }
    } catch {
      // Leave the list empty — the retry is just reloading the page.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return organizations;
    return organizations.filter(
      (org) => org.name.toLowerCase().includes(q) || org.ownerEmail?.toLowerCase().includes(q),
    );
  }, [organizations, search]);

  const allFilteredSelected = filtered.length > 0 && filtered.every((o) => selected.has(o.id));
  const someFilteredSelected = filtered.some((o) => selected.has(o.id));

  function toggleSelectAll() {
    setSelected((prev) => {
      if (allFilteredSelected) {
        const next = new Set(prev);
        filtered.forEach((o) => next.delete(o.id));
        return next;
      }
      const next = new Set(prev);
      filtered.forEach((o) => next.add(o.id));
      return next;
    });
  }

  function toggleSelectOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkStatus(nextStatus: 'active' | 'suspended') {
    setBulkWorking(true);
    try {
      const ids = Array.from(selected);
      const results = await Promise.all(
        ids.map((id) =>
          fetch(`/api/platform/organizations/${id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: nextStatus }),
          }),
        ),
      );
      const failed = results.filter((r) => !r.ok).length;
      if (failed > 0) {
        toast.error(t('statusUpdateFailedToast'));
      } else {
        toast.success(t('statusUpdatedToast'));
      }
      setSelected(new Set());
      await load();
    } finally {
      setBulkWorking(false);
    }
  }

  async function handleCreate() {
    setCreating(true);
    try {
      const res = await fetch('/api/platform/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeName, ownerEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('createFailedToast'));
        return;
      }
      toast.success(t('createdToast', { email: ownerEmail }));
      setCreateOpen(false);
      setStoreName('');
      setOwnerEmail('');
      await load();
    } catch {
      toast.error(t('serverUnreachableToast'));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            {t('pageTitle')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('pageDesc')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button onClick={() => setCreateOpen(true)}>
            <UserPlus className="size-4" />
            {t('createStoreBtn')}
          </Button>
          <Button variant="outline" onClick={signOut}>
            {t('signOut')}
          </Button>
        </div>
      </div>

      {/* Search + column picker — same "filter + column selector" pattern
          the table redesign asked for. */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="bg-muted border-border pl-9 text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-muted px-2.5 text-xs text-muted-foreground hover:text-foreground">
            <Columns3 className="size-3.5" />
            {t('columnsLabel')}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="border-border bg-popover">
            <DropdownMenuCheckboxItem
              checked={columns.ownerEmail}
              onCheckedChange={(v) => setColumns((c) => ({ ...c, ownerEmail: !!v }))}
              className="text-sm text-popover-foreground"
            >
              {t('colOwnerEmail')}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={columns.sellerCount}
              onCheckedChange={(v) => setColumns((c) => ({ ...c, sellerCount: !!v }))}
              className="text-sm text-popover-foreground"
            >
              {t('colSellerCount')}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={columns.billingStatus}
              onCheckedChange={(v) => setColumns((c) => ({ ...c, billingStatus: !!v }))}
              className="text-sm text-popover-foreground"
            >
              {t('colBillingStatus')}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={columns.createdAt}
              onCheckedChange={(v) => setColumns((c) => ({ ...c, createdAt: !!v }))}
              className="text-sm text-popover-foreground"
            >
              {t('colCreatedAt')}
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Bulk-action bar — only appears once something is selected. */}
      {someFilteredSelected && (
        <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary-soft px-3 py-2 text-sm">
          <span className="text-foreground">{t('selectedCount', { count: selected.size })}</span>
          <Button
            size="sm"
            variant="outline"
            disabled={bulkWorking}
            onClick={() => handleBulkStatus('suspended')}
            className="ml-auto border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20"
          >
            {bulkWorking ? <Loader2 className="size-4 animate-spin" /> : <ShieldOff className="size-4" />}
            {t('bulkSuspend')}
          </Button>
          <Button size="sm" variant="outline" disabled={bulkWorking} onClick={() => handleBulkStatus('active')}>
            {t('bulkActivate')}
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t('loading')}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-10 text-center">
            <Building2 className="size-6 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">{t('noOrganizations')}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            {/* Header row — select-all + column labels, table-like even
                though rows are still buttons for navigation. */}
            <div className="flex items-center gap-3 border-b border-border px-4 py-2">
              <Checkbox
                checked={allFilteredSelected}
                indeterminate={!allFilteredSelected && someFilteredSelected}
                onCheckedChange={toggleSelectAll}
                aria-label={t('selectAll')}
              />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {t('tableStoreHeader')}
              </span>
            </div>
            <ul className="divide-y divide-border">
              {filtered.map((org) => (
                <li key={org.id} className="flex items-center gap-3 px-4 py-1">
                  <Checkbox
                    checked={selected.has(org.id)}
                    onCheckedChange={() => toggleSelectOne(org.id)}
                    aria-label={org.name}
                  />
                  <button
                    type="button"
                    onClick={() => router.push(`/painel-a17c94fe2b6d/lojas/${org.id}`)}
                    className="flex w-full min-w-0 flex-col gap-3 py-2 text-left transition-colors hover:bg-card-2 sm:flex-row sm:items-center sm:gap-4"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                        <Store className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">
                            {org.name}
                          </span>
                          <SettingsChip variant={org.status === 'active' ? 'ok' : 'warn'}>
                            {org.status === 'active' ? t('statusActive') : t('statusSuspended')}
                          </SettingsChip>
                          {columns.billingStatus && (
                            <SettingsChip variant={BILLING_STATUS_VARIANT[org.billingStatus]}>
                              {BILLING_STATUS_LABEL[org.billingStatus]}
                            </SettingsChip>
                          )}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {columns.ownerEmail && org.ownerEmail ? `${t('ownerLabel')}: ${org.ownerEmail} · ` : ''}
                          {columns.sellerCount ? `${t('sellersCount', { count: org.sellerCount })} · ` : ''}
                          {columns.createdAt ? t('createdOn', { date: fmtDate(org.createdAt) }) : ''}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-popover border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-popover-foreground">
              <UserPlus className="size-4 text-primary" />
              {t('createStoreBtn')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-muted-foreground">{t('storeNameLabel')}</Label>
              <Input
                placeholder={t('storeNamePlaceholder')}
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground">{t('ownerEmailLabel')}</Label>
              <Input
                type="email"
                placeholder={t('ownerEmailPlaceholder')}
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>
          </div>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              onClick={handleCreate}
              disabled={creating || !storeName.trim() || !ownerEmail.trim()}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {creating ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('creating')}
                </>
              ) : (
                t('createButton')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
