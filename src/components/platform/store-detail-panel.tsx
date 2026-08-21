'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Building2,
  KeyRound,
  Loader2,
  Mail,
  Pencil,
  ShieldOff,
  Store,
  Trash2,
  UserMinus,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SettingsChip } from '@/components/settings/settings-chip';
import { BILLING_STATUS_LABEL, BILLING_STATUS_VARIANT } from '@/lib/billing/status';
import type { PlatformAccountDetail, PlatformOrganizationDetail } from '@/types';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

async function postJson(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// ============================================================
// Edit account dialog — shared between the owner and every seller
// row. "name" means different things server-side (business name vs
// personal name) but the FORM here is identical either way — see
// PATCH /api/platform/accounts/[id]'s own comment for the
// disambiguation.
// ============================================================
function EditAccountDialog({
  account,
  onOpenChange,
  onSaved,
}: {
  account: PlatformAccountDetail | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

  // Syncs the form to whichever account was just clicked — the dialog
  // is remounted per-open via `account` changing identity, so this is
  // the reset step, not a derived-state loop.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (account) {
      setName(account.name ?? '');
      setEmail(account.email ?? '');
      setPhone(account.phone ?? '');
    }
  }, [account]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleSave() {
    if (!account) return;
    setSaving(true);
    const { ok, data } = await postJson(`/api/platform/accounts/${account.accountId}`, 'PATCH', {
      name,
      email,
      phone,
    });
    setSaving(false);
    if (!ok) {
      toast.error(data.error || 'Falha ao salvar as alterações');
      return;
    }
    toast.success('Dados atualizados');
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={account !== null} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">Editar conta</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-muted-foreground">Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label className="text-muted-foreground">E-mail (login)</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label className="text-muted-foreground">Telefone / contato</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Opcional" />
          </div>
        </div>
        <DialogFooter className="bg-popover border-border">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Reset password dialog — "send a link" is the primary, always-
// visible action. "set directly" is a collapsed secondary option;
// the password value never leaves this form once submitted (not
// reflected back in the UI, not logged — see the route's own
// comment).
// ============================================================
function ResetPasswordDialog({
  account,
  onOpenChange,
}: {
  account: PlatformAccountDetail | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [showDirect, setShowDirect] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [sending, setSending] = useState(false);

  // Resets the dialog's local state on close, so reopening it for a
  // different account never shows the previous one's leftover state.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!account) {
      setShowDirect(false);
      setNewPassword('');
    }
  }, [account]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleSendLink() {
    if (!account) return;
    setSending(true);
    const { ok, data } = await postJson(
      `/api/platform/accounts/${account.accountId}/reset-password`,
      'POST',
      { mode: 'link' },
    );
    setSending(false);
    if (!ok) {
      toast.error(data.error || 'Falha ao enviar o link');
      return;
    }
    toast.success(`Link de redefinição enviado para ${data.email}`);
    onOpenChange(false);
  }

  async function handleSetDirect() {
    if (!account) return;
    setSending(true);
    const { ok, data } = await postJson(
      `/api/platform/accounts/${account.accountId}/reset-password`,
      'POST',
      { mode: 'direct', newPassword },
    );
    setSending(false);
    if (!ok) {
      toast.error(data.error || 'Falha ao definir a senha');
      return;
    }
    setNewPassword('');
    toast.success('Nova senha definida');
    onOpenChange(false);
  }

  return (
    <Dialog open={account !== null} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-popover-foreground">
            <KeyRound className="size-4 text-primary" />
            Redefinir senha — {account?.name}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {account?.email}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-lg border border-border bg-muted p-3">
            <p className="text-sm text-foreground">Enviar link de redefinição por e-mail</p>
            <p className="mt-1 text-xs text-muted-foreground">
              A pessoa recebe um link seguro e define a própria senha. Recomendado.
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

// ============================================================
// Remove-seller dialog — two distinct, separately-confirmed actions.
// ============================================================
function RemoveSellerDialog({
  account,
  onOpenChange,
  onRemoved,
}: {
  account: PlatformAccountDetail | null;
  onOpenChange: (open: boolean) => void;
  onRemoved: () => void;
}) {
  const [mode, setMode] = useState<'unlink' | 'delete' | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    // Resets the mode choice when the dialog closes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!account) setMode(null);
  }, [account]);

  async function handleConfirm() {
    if (!account || !mode) return;
    setWorking(true);
    const { ok, data } = await postJson(`/api/platform/accounts/${account.accountId}`, 'DELETE', { mode });
    setWorking(false);
    if (!ok) {
      toast.error(data.error || 'Falha ao remover');
      return;
    }
    toast.success(mode === 'unlink' ? 'Vendedor removido da loja' : 'Conta excluída permanentemente');
    onOpenChange(false);
    onRemoved();
  }

  return (
    <Dialog open={account !== null} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">Remover {account?.name}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Escolha o que fazer com esta conta.
          </DialogDescription>
        </DialogHeader>

        {!mode ? (
          <div className="flex flex-col gap-2 py-2">
            <Button variant="outline" onClick={() => setMode('unlink')} className="justify-start">
              <UserMinus className="size-4" />
              Remover da loja (mantém a conta e os dados dela)
            </Button>
            <Button
              variant="outline"
              onClick={() => setMode('delete')}
              className="justify-start border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20"
            >
              <Trash2 className="size-4" />
              Excluir conta permanentemente
            </Button>
          </div>
        ) : (
          <div className="py-2 text-sm text-muted-foreground">
            {mode === 'unlink'
              ? 'A conta deixa de fazer parte desta loja, mas nada é apagado.'
              : 'Isso apaga a conta e tudo que só pertence a ela (conversas, contatos, mensagens, conexão de WhatsApp). Não pode ser desfeito.'}
          </div>
        )}

        <DialogFooter className="bg-popover border-border">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          {mode && (
            <Button
              onClick={handleConfirm}
              disabled={working}
              className={mode === 'delete' ? 'bg-red-600 hover:bg-red-600/90 text-white' : ''}
            >
              {working ? <Loader2 className="size-4 animate-spin" /> : null}
              Confirmar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AccountRow({
  account,
  isOwner,
  onEdit,
  onResetPassword,
  onRemove,
}: {
  account: PlatformAccountDetail;
  isOwner: boolean;
  onEdit: () => void;
  onResetPassword: () => void;
  onRemove?: () => void;
}) {
  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
            isOwner ? 'bg-amber-500/10 text-amber-600 dark:text-amber-300' : 'bg-primary-soft text-primary'
          }`}
        >
          <Store className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{account.name}</span>
            {isOwner && <SettingsChip variant="owner">Dono</SettingsChip>}
            <SettingsChip variant={account.inviteStatus === 'accepted' ? 'ok' : 'warn'}>
              {account.inviteStatus === 'accepted' ? 'Ativo' : 'Convite pendente'}
            </SettingsChip>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {account.email}
            {account.phone ? ` · ${account.phone}` : ''} · Entrou em {fmtDate(account.joinedAt)}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Pencil className="size-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={onResetPassword}>
          <KeyRound className="size-4" />
        </Button>
        {onRemove && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRemove}
            className="border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20"
          >
            <UserMinus className="size-4" />
          </Button>
        )}
      </div>
    </li>
  );
}

export function StoreDetailPanel({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [data, setData] = useState<PlatformOrganizationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [editingName, setEditingName] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [savingName, setSavingName] = useState(false);

  const [statusWorking, setStatusWorking] = useState(false);

  const [editingAccount, setEditingAccount] = useState<PlatformAccountDetail | null>(null);
  const [resettingAccount, setResettingAccount] = useState<PlatformAccountDetail | null>(null);
  const [removingAccount, setRemovingAccount] = useState<PlatformAccountDetail | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/platform/organizations/${organizationId}`);
    if (res.status === 404) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    const json = (await res.json()) as PlatformOrganizationDetail;
    setData(json);
    setOrgName(json.organization.name);
    setLoading(false);
  }, [organizationId]);

  useEffect(() => {
    // Same load-on-mount pattern already used throughout this codebase
    // (platform-panel.tsx, organization-settings.tsx, ...).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function handleSaveName() {
    setSavingName(true);
    const { ok, data: res } = await postJson(`/api/platform/organizations/${organizationId}`, 'PATCH', {
      name: orgName,
    });
    setSavingName(false);
    if (!ok) {
      toast.error(res.error || 'Falha ao renomear a loja');
      return;
    }
    toast.success('Loja renomeada');
    setEditingName(false);
    await load();
  }

  async function handleToggleStatus() {
    if (!data) return;
    const nextStatus = data.organization.status === 'active' ? 'suspended' : 'active';
    setStatusWorking(true);
    const { ok, data: res } = await postJson(
      `/api/platform/organizations/${organizationId}/status`,
      'PATCH',
      { status: nextStatus },
    );
    setStatusWorking(false);
    if (!ok) {
      toast.error(res.error || 'Falha ao atualizar o status');
      return;
    }
    toast.success('Status atualizado');
    await load();
  }

  async function handleDelete() {
    setDeleting(true);
    const { ok, data: res } = await postJson(`/api/platform/organizations/${organizationId}`, 'DELETE', {
      confirmName: confirmText,
    });
    setDeleting(false);
    if (!ok) {
      toast.error(res.error || 'Falha ao excluir a loja');
      return;
    }
    toast.success('Loja excluída permanentemente');
    router.push('/painel-a17c94fe2b6d');
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Carregando…
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Loja não encontrada.{' '}
        <button onClick={() => router.push('/painel-a17c94fe2b6d')} className="text-primary underline">
          Voltar
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => router.push('/painel-a17c94fe2b6d')}>
          <ArrowLeft className="size-4" />
          Voltar
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="size-4" />
            Dados da loja
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {editingName ? (
            <div className="flex items-center gap-2">
              <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} className="max-w-xs" />
              <Button size="sm" onClick={handleSaveName} disabled={savingName || !orgName.trim()}>
                {savingName ? <Loader2 className="size-4 animate-spin" /> : 'Salvar'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditingName(false);
                  setOrgName(data.organization.name);
                }}
              >
                Cancelar
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold text-foreground">{data.organization.name}</span>
              <Button variant="outline" size="sm" onClick={() => setEditingName(true)}>
                <Pencil className="size-4" />
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <SettingsChip variant={data.organization.status === 'active' ? 'ok' : 'warn'}>
              {data.organization.status === 'active' ? 'Ativa' : 'Suspensa'}
            </SettingsChip>
            {/* Read-only — see src/lib/billing/README.md. Nothing acts on this yet. */}
            <SettingsChip variant={BILLING_STATUS_VARIANT[data.organization.billingStatus]}>
              {BILLING_STATUS_LABEL[data.organization.billingStatus]}
            </SettingsChip>
            <span>Criada em {fmtDate(data.organization.createdAt)}</span>
          </div>

          <Button
            variant="outline"
            onClick={handleToggleStatus}
            disabled={statusWorking}
            className={
              data.organization.status === 'active'
                ? 'w-fit border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20'
                : 'w-fit'
            }
          >
            {statusWorking ? <Loader2 className="size-4 animate-spin" /> : <ShieldOff className="size-4" />}
            {data.organization.status === 'active' ? 'Suspender loja' : 'Reativar loja'}
          </Button>
        </CardContent>
      </Card>

      {data.owner && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dono da loja</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              <AccountRow
                account={data.owner}
                isOwner
                onEdit={() => setEditingAccount(data.owner)}
                onResetPassword={() => setResettingAccount(data.owner)}
              />
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vendedores vinculados</CardTitle>
          <CardDescription>{data.sellers.length} vendedor(es)</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {data.sellers.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Nenhum vendedor vinculado ainda.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {data.sellers.map((seller) => (
                <AccountRow
                  key={seller.accountId}
                  account={seller}
                  isOwner={false}
                  onEdit={() => setEditingAccount(seller)}
                  onResetPassword={() => setResettingAccount(seller)}
                  onRemove={() => setRemovingAccount(seller)}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="border-red-500/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-red-400">
            <Trash2 className="size-4" />
            Zona de risco
          </CardTitle>
          <CardDescription>
            Excluir a loja apaga a organização, a conta do dono, todos os vendedores vinculados e tudo
            que pertence a essas contas. Não pode ser desfeito.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => setDeleteOpen(true)}
            className="bg-red-600 hover:bg-red-600/90 text-white"
          >
            <Trash2 className="size-4" />
            Excluir loja inteira
          </Button>
        </CardContent>
      </Card>

      <EditAccountDialog
        account={editingAccount}
        onOpenChange={(open) => !open && setEditingAccount(null)}
        onSaved={load}
      />
      <ResetPasswordDialog
        account={resettingAccount}
        onOpenChange={(open) => !open && setResettingAccount(null)}
      />
      <RemoveSellerDialog
        account={removingAccount}
        onOpenChange={(open) => !open && setRemovingAccount(null)}
        onRemoved={load}
      />

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) setConfirmText('');
        }}
      >
        <DialogContent className="bg-popover border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-400">Excluir &quot;{data.organization.name}&quot;?</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Isso é permanente. Digite <strong className="text-foreground">{data.organization.name}</strong>{' '}
              para confirmar.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={data.organization.name}
            />
          </div>
          <DialogFooter className="bg-popover border-border">
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleDelete}
              disabled={deleting || confirmText !== data.organization.name}
              className="bg-red-600 hover:bg-red-600/90 text-white disabled:opacity-40"
            >
              {deleting ? <Loader2 className="size-4 animate-spin" /> : null}
              Excluir permanentemente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
