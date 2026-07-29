'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Building2, Loader2, ShieldOff, Store, UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SettingsChip } from '@/components/settings/settings-chip';
import { useAuth } from '@/hooks/use-auth';
import type { PlatformOrganization } from '@/types';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * The platform admin panel (/painel-plataforma). This component
 * assumes the page has already verified the caller is a platform
 * admin server-side (requirePlatformAdmin() + notFound() otherwise) —
 * it still calls admin-gated APIs itself, which independently 403 for
 * anyone who isn't, but never assumes that alone is the only guard.
 */
export function PlatformPanel() {
  const t = useTranslations('Platform');
  const { signOut } = useAuth();

  const [organizations, setOrganizations] = useState<PlatformOrganization[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [storeName, setStoreName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [creating, setCreating] = useState(false);

  const [statusTarget, setStatusTarget] = useState<PlatformOrganization | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

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

  async function handleConfirmStatus() {
    if (!statusTarget) return;
    const nextStatus = statusTarget.status === 'active' ? 'suspended' : 'active';
    setUpdatingStatus(true);
    try {
      const res = await fetch(`/api/platform/organizations/${statusTarget.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('statusUpdateFailedToast'));
        return;
      }
      toast.success(t('statusUpdatedToast'));
      setStatusTarget(null);
      await load();
    } catch {
      toast.error(t('serverUnreachableToast'));
    } finally {
      setUpdatingStatus(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4 sm:p-6">
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

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t('loading')}
        </div>
      ) : organizations.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-10 text-center">
            <Building2 className="size-6 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">{t('noOrganizations')}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {organizations.map((org) => (
                <li
                  key={org.id}
                  className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
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
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {org.ownerEmail ? `${t('ownerLabel')}: ${org.ownerEmail} · ` : ''}
                        {t('sellersCount', { count: org.sellerCount })} · {t('createdOn', { date: fmtDate(org.createdAt) })}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setStatusTarget(org)}
                    className={
                      org.status === 'active'
                        ? 'border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 hover:border-red-500/60 hover:text-red-200'
                        : ''
                    }
                  >
                    <ShieldOff className="size-4" />
                    {org.status === 'active' ? t('suspendButton') : t('activateButton')}
                  </Button>
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

      <Dialog open={statusTarget !== null} onOpenChange={(open) => !open && setStatusTarget(null)}>
        <DialogContent className="bg-popover border-border sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {statusTarget?.status === 'active' ? t('suspendConfirmTitle') : t('activateConfirmTitle')}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {statusTarget?.status === 'active'
                ? t('suspendConfirmDesc', { name: statusTarget?.name ?? '' })
                : t('activateConfirmDesc', { name: statusTarget?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setStatusTarget(null)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              onClick={handleConfirmStatus}
              disabled={updatingStatus}
              className={
                statusTarget?.status === 'active'
                  ? 'bg-red-600 hover:bg-red-600/90 text-white'
                  : 'bg-primary hover:bg-primary/90 text-primary-foreground'
              }
            >
              {updatingStatus ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('updating')}
                </>
              ) : (
                t('confirm')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
