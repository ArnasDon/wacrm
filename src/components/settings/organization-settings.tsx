'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Building2,
  KeyRound,
  Loader2,
  Mail,
  Pencil,
  Store,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SettingsPanelHead } from './settings-panel-head';
import { SettingsChip } from './settings-chip';
import { InviteSellerDialog } from './invite-seller-dialog';
import { LeadDistributionSettings } from './lead-distribution-settings';
import type { Organization, OrganizationAccount } from '@/types';

interface OrgResponse {
  organization: Organization | null;
  accounts: OrganizationAccount[];
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ============================================================
// Reset-password dialog — mirrors the platform-admin panel's own
// (store-detail-panel.tsx's ResetPasswordDialog), scoped down to
// "a seller THIS owner's organization actually owns" via
// POST /api/organization/sellers/[id]/reset-password instead of the
// platform-wide route. Exists because "Ativo" only means "clicked the
// invite link at least once" (that's a real Supabase sign-in) — a
// seller who abandoned the /reset-password page before actually
// setting a password shows as Ativo but has no working password, and
// "resend invite" is refused past that point (Supabase's invite email
// stops applying once the user is no longer purely "invited"). This
// dialog is the recovery path for exactly that stuck state.
// ============================================================
function ResetSellerPasswordDialog({
  account,
  onOpenChange,
}: {
  account: OrganizationAccount | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [showDirect, setShowDirect] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!account) {
      setShowDirect(false);
      setNewPassword('');
    }
  }, [account]);

  async function handleSendLink() {
    if (!account) return;
    setSending(true);
    try {
      const res = await fetch(`/api/organization/sellers/${account.id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'link' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Falha ao enviar o link');
        return;
      }
      toast.success(`Link de redefinição enviado para ${data.email ?? account.name}`);
      onOpenChange(false);
    } catch {
      toast.error('Não foi possível conectar ao servidor');
    } finally {
      setSending(false);
    }
  }

  async function handleSetDirect() {
    if (!account) return;
    setSending(true);
    try {
      const res = await fetch(`/api/organization/sellers/${account.id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'direct', newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Falha ao definir a senha');
        return;
      }
      setNewPassword('');
      toast.success('Nova senha definida');
      onOpenChange(false);
    } catch {
      toast.error('Não foi possível conectar ao servidor');
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={account !== null} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-popover-foreground">
            <KeyRound className="size-4 text-primary" />
            Redefinir senha — {account?.name}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">{account?.email}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-lg border border-border bg-muted p-3">
            <p className="text-sm text-foreground">Enviar link de redefinição por e-mail</p>
            <p className="mt-1 text-xs text-muted-foreground">
              O vendedor recebe um link seguro e define a própria senha. Recomendado.
            </p>
            <Button onClick={handleSendLink} disabled={sending} className="mt-3">
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
              Enviar link
            </Button>
          </div>

          {!showDirect ? (
            <button
              type="button"
              onClick={() => setShowDirect(true)}
              className="text-xs text-muted-foreground underline hover:text-foreground"
            >
              Definir uma senha nova diretamente (não recomendado)
            </button>
          ) : (
            <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
              <Label className="text-muted-foreground">Nova senha</Label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
              />
              <Button
                variant="outline"
                onClick={handleSetDirect}
                disabled={sending || newPassword.length < 6}
                className="w-full"
              >
                {sending ? <Loader2 className="size-4 animate-spin" /> : null}
                Definir senha
              </Button>
            </div>
          )}
        </div>

        <DialogFooter className="bg-popover border-border">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Settings → Organization. Owner-only (see settings/page.tsx's
 * hiddenSections gating). Lets a store account:
 *   1. Bootstrap its organization (once).
 *   2. Invite seller accounts, each one a fully independent account
 *      linked for read-only consolidated visibility (migration 041) —
 *      never a membership on the store's own account.
 *   3. Rename a linked seller's label, resend their invite while
 *      still pending, reset their password if they're stuck, or
 *      unlink it (remove access) — all via /api/organization/sellers/[id]
 *      and its sub-routes. The store's own account row is never
 *      editable/removable here.
 *
 * The consolidated Inbox/Contacts account picker (see
 * organization-account-select.tsx) reads the same GET /api/organization
 * this component does.
 */
export function OrganizationSettings() {
  const t = useTranslations('Settings.organization');
  const { accountId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [accounts, setAccounts] = useState<OrganizationAccount[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);

  const [orgName, setOrgName] = useState('');
  const [creatingOrg, setCreatingOrg] = useState(false);

  const [editingAccount, setEditingAccount] = useState<OrganizationAccount | null>(null);
  const [editName, setEditName] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const [removingAccount, setRemovingAccount] = useState<OrganizationAccount | null>(null);
  const [removing, setRemoving] = useState(false);

  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resettingAccount, setResettingAccount] = useState<OrganizationAccount | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/organization');
      const data = (await res.json()) as OrgResponse;
      if (res.ok) {
        setOrganization(data.organization);
        setAccounts(data.accounts ?? []);
      }
    } catch {
      // Leave defaults — the form below still lets the owner retry.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreateOrg = async () => {
    setCreatingOrg(true);
    try {
      const res = await fetch('/api/organization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: orgName }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('createFailedToast'));
        return;
      }
      toast.success(t('createdToast'));
      await load();
    } catch {
      toast.error(t('serverUnreachableToast'));
    } finally {
      setCreatingOrg(false);
    }
  };

  function openEdit(acc: OrganizationAccount) {
    setEditingAccount(acc);
    setEditName(acc.name);
  }

  async function handleSaveEdit() {
    if (!editingAccount) return;
    const name = editName.trim();
    if (!name) return;
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/organization/sellers/${editingAccount.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || t('editFailedToast'));
        return;
      }
      toast.success(t('editedToast'));
      setAccounts((prev) =>
        prev.map((a) => (a.id === editingAccount.id ? { ...a, name } : a)),
      );
      setEditingAccount(null);
    } catch {
      toast.error(t('serverUnreachableToast'));
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleRemove() {
    if (!removingAccount) return;
    setRemoving(true);
    try {
      const res = await fetch(`/api/organization/sellers/${removingAccount.id}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || t('removeFailedToast'));
        return;
      }
      toast.success(t('removedToast', { name: removingAccount.name }));
      setAccounts((prev) => prev.filter((a) => a.id !== removingAccount.id));
      setRemovingAccount(null);
    } catch {
      toast.error(t('serverUnreachableToast'));
    } finally {
      setRemoving(false);
    }
  }

  async function handleResendInvite(acc: OrganizationAccount) {
    setResendingId(acc.id);
    try {
      const res = await fetch(`/api/organization/sellers/${acc.id}/resend-invite`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Falha ao reenviar o convite');
        return;
      }
      toast.success(`Convite reenviado para ${data.email ?? acc.name}`);
    } catch {
      toast.error(t('serverUnreachableToast'));
    } finally {
      setResendingId(null);
    }
  }

  if (loading) {
    return (
      <div>
        <SettingsPanelHead title={t('title')} description={t('description')} />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t('loading')}
        </div>
      </div>
    );
  }

  if (!organization) {
    return (
      <div>
        <SettingsPanelHead title={t('title')} description={t('description')} />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="size-5" />
              {t('createTitle')}
            </CardTitle>
            <CardDescription>{t('createDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="org-name">{t('orgNameLabel')}</Label>
              <Input
                id="org-name"
                placeholder={t('orgNamePlaceholder')}
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
              />
            </div>
            <Button
              onClick={handleCreateOrg}
              disabled={creatingOrg || !orgName.trim()}
              className="self-start"
            >
              {creatingOrg ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('creating')}
                </>
              ) : (
                t('createButton')
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <SettingsPanelHead
        title={t('title')}
        description={t('descriptionWithName', { name: organization.name })}
        action={
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus className="size-4" />
            {t('inviteSellerTitle')}
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('linkedAccountsTitle')}</CardTitle>
          <CardDescription>{t('linkedAccountsDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-border">
            {accounts.map((acc) => (
              <li
                key={acc.id}
                className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span
                    className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
                      acc.isOwnerAccount
                        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-300'
                        : 'bg-primary-soft text-primary'
                    }`}
                  >
                    <Store className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {acc.name}
                      </span>
                      {acc.isOwnerAccount && (
                        <SettingsChip variant="owner">{t('storeBadge')}</SettingsChip>
                      )}
                      <SettingsChip variant={acc.inviteStatus === 'accepted' ? 'ok' : 'warn'}>
                        {acc.inviteStatus === 'accepted' ? t('statusAccepted') : t('statusPending')}
                      </SettingsChip>
                    </div>
                    {acc.email && (
                      <p className="truncate text-xs text-muted-foreground">{acc.email}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 sm:justify-end">
                  <div className="text-xs text-muted-foreground sm:text-right">
                    {t('joined', { date: fmtDate(acc.joinedAt) })}
                  </div>
                  {/* Edit/remove only apply to sellers — the store's own
                      account row (isOwnerAccount) has neither, mirroring
                      the members-tab's owner-row exclusion. */}
                  {!acc.isOwnerAccount && (
                    <div className="flex items-center gap-2">
                      {acc.inviteStatus === 'pending' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleResendInvite(acc)}
                          disabled={resendingId === acc.id}
                          className="border-border text-muted-foreground hover:bg-muted"
                        >
                          {resendingId === acc.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Mail className="size-4" />
                          )}
                          Reenviar convite
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setResettingAccount(acc)}
                        className="border-border text-muted-foreground hover:bg-muted"
                        title="Redefinir senha — use quando o vendedor abriu o convite mas nunca conseguiu definir a senha"
                      >
                        <KeyRound className="size-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEdit(acc)}
                        className="border-border text-muted-foreground hover:bg-muted"
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setRemovingAccount(acc)}
                        className="border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 hover:border-red-500/60 hover:text-red-200"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <LeadDistributionSettings
        organization={organization}
        accounts={accounts}
        ownAccountId={accountId ?? null}
        onChanged={load}
      />

      <InviteSellerDialog open={inviteOpen} onOpenChange={setInviteOpen} onInvited={load} />

      <ResetSellerPasswordDialog
        account={resettingAccount}
        onOpenChange={(open) => !open && setResettingAccount(null)}
      />

      {/* Rename dialog */}
      <Dialog
        open={editingAccount !== null}
        onOpenChange={(open) => {
          if (!open) setEditingAccount(null);
        }}
      >
        <DialogContent className="bg-popover border-border sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t('editDialogTitle')}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('editDialogDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label className="text-muted-foreground">{t('sellerNameLabel')}</Label>
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="bg-muted border-border text-foreground"
            />
          </div>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setEditingAccount(null)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={savingEdit || !editName.trim()}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {savingEdit ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('saving')}
                </>
              ) : (
                t('saveChanges')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove (unlink) confirmation */}
      <Dialog
        open={removingAccount !== null}
        onOpenChange={(open) => {
          if (!open) setRemovingAccount(null);
        }}
      >
        <DialogContent className="bg-popover border-border sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-popover-foreground">
              <AlertTriangle className="size-4 text-amber-400" />
              {t('removeDialogTitle')}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t.rich('removeDialogDesc', {
                name: removingAccount?.name || '',
                bold: (chunks: React.ReactNode) => <strong>{chunks}</strong>,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setRemovingAccount(null)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              onClick={handleRemove}
              disabled={removing}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {removing ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('removing')}
                </>
              ) : (
                t('removeBtn')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
