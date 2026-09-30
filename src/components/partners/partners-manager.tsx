'use client';

// ============================================================
// PartnersManager — the /partners page body (Main Users only).
//
// Lists the caller's Partners (SubUsers + their invitations) from
// GET /api/partners and drives resend / revoke / enable / disable.
// Every action is re-authorised server-side; this component only
// mirrors the rules to decide which buttons to show.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import {
  AlertTriangle,
  Ban,
  Copy,
  Handshake,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { PageHero } from '@/components/layout/page-hero';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { CreatePartnerDialog, type InviteResult } from './create-partner-dialog';

type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';
type AccountStatus = 'ACTIVE' | 'DISABLED';

interface Partner {
  id: string;
  companyName: string;
  partnerName: string | null;
  email: string;
  phone: string;
  status: AccountStatus | null;
  invitationStatus: InvitationStatus;
  invitationSentAt: string | null;
  invitationExpiresAt: string;
  createdAt: string;
  userId: string | null;
}

const INVITATION_BADGE: Record<InvitationStatus, string> = {
  PENDING: 'border-amber-500/40 bg-amber-500/10 text-amber-500',
  ACCEPTED: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500',
  EXPIRED: 'border-border bg-muted text-muted-foreground',
  REVOKED: 'border-red-500/40 bg-red-500/10 text-red-500',
};

const STATUS_BADGE: Record<AccountStatus, string> = {
  ACTIVE: 'border-primary/40 bg-primary/10 text-primary',
  DISABLED: 'border-red-500/40 bg-red-500/10 text-red-500',
};

type Confirm =
  | { kind: 'disable'; partner: Partner }
  | { kind: 'revoke'; partner: Partner };

function formatDate(value: string | null): string {
  if (!value) return '—';
  return format(new Date(value), 'MMM d, yyyy HH:mm');
}

export function PartnersManager() {
  const t = useTranslations('Partners');
  const [partners, setPartners] = useState<Partner[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  // Shown when an invitation was created but the email couldn't be
  // delivered, so the Main User can pass the link on manually.
  const [manualLink, setManualLink] = useState<{ email: string; url: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/partners', { cache: 'no-store' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(payload.error || t('loadFailed'));
        return;
      }
      setLoadError(null);
      setPartners(payload.partners as Partner[]);
    } catch {
      setLoadError(t('loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  function handleDelivery(result: { emailSent: boolean; signupUrl?: string }, email: string, successMsg: string) {
    if (result.emailSent) {
      toast.success(successMsg);
    } else if (result.signupUrl) {
      toast.warning(t('emailNotSent'));
      setManualLink({ email, url: result.signupUrl });
    }
  }

  function handleCreated(result: InviteResult) {
    handleDelivery(result, result.email, t('inviteSent'));
    load();
  }

  async function runAction(
    partner: Partner,
    url: string,
    init: RequestInit,
    onSuccess: (payload: Record<string, unknown>) => void,
  ) {
    setBusyId(partner.id);
    try {
      const res = await fetch(url, init);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || t('actionFailed'));
        return;
      }
      onSuccess(payload);
      await load();
    } catch {
      toast.error(t('actionFailed'));
    } finally {
      setBusyId(null);
    }
  }

  function resend(partner: Partner) {
    runAction(partner, `/api/partners/${partner.id}/resend-invitation`, { method: 'POST' }, (p) =>
      handleDelivery(
        p as { emailSent: boolean; signupUrl?: string },
        partner.email,
        t('inviteResent'),
      ),
    );
  }

  function setStatus(partner: Partner, status: AccountStatus) {
    runAction(
      partner,
      `/api/partners/${partner.id}/status`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      },
      () => toast.success(status === 'DISABLED' ? t('disabled') : t('enabled')),
    );
  }

  function revoke(partner: Partner) {
    runAction(partner, `/api/partners/${partner.id}/revoke-invitation`, { method: 'POST' }, () =>
      toast.success(t('revoked')),
    );
  }

  async function copyLink() {
    if (!manualLink) return;
    try {
      await navigator.clipboard.writeText(manualLink.url);
      toast.success(t('linkCopied'));
    } catch {
      toast.error(t('clipboardBlocked'));
    }
  }

  return (
    <section className="animate-in fade-in-50 space-y-4 duration-200">
      <PageHero
        icon={Handshake}
        iconClassName="bg-violet-500/15 text-violet-500"
        title={t('title')}
        description={t('description')}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            {t('createPartner')}
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          {loadError ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
              <p className="text-sm text-destructive">{loadError}</p>
              <Button variant="outline" onClick={load}>
                {t('retry')}
              </Button>
            </div>
          ) : partners === null ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : partners.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10">
                <Handshake className="size-6 text-primary" />
              </div>
              <p className="text-sm font-medium text-foreground">{t('emptyTitle')}</p>
              <p className="max-w-sm text-sm text-muted-foreground">{t('emptyDesc')}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('col.company')}</TableHead>
                  <TableHead>{t('col.partner')}</TableHead>
                  <TableHead>{t('col.email')}</TableHead>
                  <TableHead>{t('col.phone')}</TableHead>
                  <TableHead>{t('col.status')}</TableHead>
                  <TableHead>{t('col.invitation')}</TableHead>
                  <TableHead>{t('col.sent')}</TableHead>
                  <TableHead>{t('col.expiry')}</TableHead>
                  <TableHead>{t('col.created')}</TableHead>
                  <TableHead className="text-right">{t('col.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {partners.map((p) => {
                  const canResend = p.invitationStatus === 'PENDING' || p.invitationStatus === 'EXPIRED';
                  const busy = busyId === p.id;
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium text-foreground">{p.companyName}</TableCell>
                      <TableCell>{p.partnerName ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>{p.email}</TableCell>
                      <TableCell className="whitespace-nowrap">{p.phone}</TableCell>
                      <TableCell>
                        {p.status ? (
                          <Badge className={cn('border', STATUS_BADGE[p.status])}>
                            {t(`status.${p.status}`)}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge className={cn('border', INVITATION_BADGE[p.invitationStatus])}>
                          {t(`invitationStatus.${p.invitationStatus}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(p.invitationSentAt)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {p.invitationStatus === 'ACCEPTED' ? '—' : formatDate(p.invitationExpiresAt)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(p.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        {p.invitationStatus === 'REVOKED' ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              aria-label={t('actionsFor', { company: p.companyName })}
                              disabled={busy}
                              className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                            >
                              {busy ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <MoreHorizontal className="size-4" />
                              )}
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="min-w-44 border-border bg-popover">
                              {canResend && (
                                <DropdownMenuItem onClick={() => resend(p)}>
                                  <RefreshCw className="size-4" />
                                  {t('actions.resend')}
                                </DropdownMenuItem>
                              )}
                              {canResend && (
                                <DropdownMenuItem
                                  onClick={() => setConfirm({ kind: 'revoke', partner: p })}
                                  className="text-destructive focus:text-destructive"
                                >
                                  <XCircle className="size-4" />
                                  {t('actions.revoke')}
                                </DropdownMenuItem>
                              )}
                              {p.status === 'ACTIVE' && (
                                <DropdownMenuItem
                                  onClick={() => setConfirm({ kind: 'disable', partner: p })}
                                  className="text-destructive focus:text-destructive"
                                >
                                  <Ban className="size-4" />
                                  {t('actions.disable')}
                                </DropdownMenuItem>
                              )}
                              {p.status === 'DISABLED' && (
                                <DropdownMenuItem onClick={() => setStatus(p, 'ACTIVE')}>
                                  <ShieldCheck className="size-4" />
                                  {t('actions.enable')}
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CreatePartnerDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={handleCreated} />

      {/* Disable / revoke confirmation */}
      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent className="bg-popover border-border sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-popover-foreground">
              <AlertTriangle className="size-4 text-amber-400" />
              {confirm?.kind === 'revoke' ? t('confirmRevoke.title') : t('confirmDisable.title')}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {confirm?.kind === 'revoke' ? t('confirmRevoke.desc') : t('confirmDisable.desc')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setConfirm(null)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              onClick={() => {
                if (!confirm) return;
                if (confirm.kind === 'revoke') revoke(confirm.partner);
                else setStatus(confirm.partner, 'DISABLED');
                setConfirm(null);
              }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {confirm?.kind === 'revoke' ? t('confirmRevoke.confirm') : t('confirmDisable.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Email-not-delivered fallback: hand the link to the Main User. */}
      <Dialog open={manualLink !== null} onOpenChange={(open) => !open && setManualLink(null)}>
        <DialogContent className="bg-popover border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-popover-foreground">
              <Send className="size-4 text-primary" />
              {t('manualLink.title')}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('manualLink.desc', { email: manualLink?.email ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 py-2">
            <Input readOnly value={manualLink?.url ?? ''} className="border-border bg-muted text-foreground" onFocus={(e) => e.currentTarget.select()} />
            <Button variant="outline" onClick={copyLink} aria-label={t('manualLink.copy')}>
              <Copy className="size-4" />
            </Button>
          </div>
          <DialogFooter className="bg-popover border-border">
            <Button onClick={() => setManualLink(null)}>{t('manualLink.done')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
