'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Building2, Loader2, Store, UserPlus } from 'lucide-react';
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
import { SettingsPanelHead } from './settings-panel-head';
import type { Organization, OrganizationAccount } from '@/types';

interface OrgResponse {
  organization: Organization | null;
  accounts: OrganizationAccount[];
}

/**
 * Settings → Organization. Owner-only (see settings/page.tsx's
 * hiddenSections gating). Lets a store account:
 *   1. Bootstrap its organization (once).
 *   2. Invite seller accounts, each one a fully independent account
 *      linked for read-only consolidated visibility (migration 041) —
 *      never a membership on the store's own account.
 *
 * The consolidated Inbox/Contacts account picker (see
 * organization-account-select.tsx) reads the same GET /api/organization
 * this component does.
 */
export function OrganizationSettings() {
  const [loading, setLoading] = useState(true);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [accounts, setAccounts] = useState<OrganizationAccount[]>([]);

  const [orgName, setOrgName] = useState('');
  const [creatingOrg, setCreatingOrg] = useState(false);

  const [sellerName, setSellerName] = useState('');
  const [sellerEmail, setSellerEmail] = useState('');
  const [invitingSeller, setInvitingSeller] = useState(false);

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
        toast.error(data.error || 'Failed to create organization');
        return;
      }
      toast.success('Organization created');
      await load();
    } catch {
      toast.error('Could not reach the server');
    } finally {
      setCreatingOrg(false);
    }
  };

  const handleInviteSeller = async () => {
    setInvitingSeller(true);
    try {
      const res = await fetch('/api/organization/sellers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: sellerName, email: sellerEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to invite the seller');
        return;
      }
      toast.success(`Invite sent to ${sellerEmail}`);
      setSellerName('');
      setSellerEmail('');
      await load();
    } catch {
      toast.error('Could not reach the server');
    } finally {
      setInvitingSeller(false);
    }
  };

  if (loading) {
    return (
      <div>
        <SettingsPanelHead
          title="Organização"
          description="Gerencie as contas de vendedores vinculadas à sua loja."
        />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Carregando…
        </div>
      </div>
    );
  }

  if (!organization) {
    return (
      <div>
        <SettingsPanelHead
          title="Organização"
          description="Gerencie as contas de vendedores vinculadas à sua loja."
        />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="size-5" />
              Criar sua organização
            </CardTitle>
            <CardDescription>
              Isso transforma sua conta atual na conta-mãe (“loja”). Depois, você pode
              criar contas de vendedores vinculadas a ela — cada uma funciona como um
              CRM próprio, mas você continua enxergando tudo daqui.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="org-name">Nome da organização</Label>
              <Input
                id="org-name"
                placeholder="Ex: Loja de Veículos Silva"
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
                  Criando…
                </>
              ) : (
                'Criar organização'
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
        title="Organização"
        description={`"${organization.name}" — contas vinculadas abaixo. Você enxerga as conversas e contatos de todas elas a partir do seu login; cada conta de vendedor continua vendo só a própria.`}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contas vinculadas</CardTitle>
          <CardDescription>
            Leitura consolidada, nunca escrita em nome de outra conta — você só visualiza.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {accounts.map((acc) => (
            <div
              key={acc.id}
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
            >
              <Store className="size-4 text-muted-foreground" />
              <span className="text-foreground">{acc.name}</span>
              {acc.isOwnerAccount && (
                <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                  Loja
                </span>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus className="size-4" />
            Convidar novo vendedor
          </CardTitle>
          <CardDescription>
            Cria uma conta nova e independente para o vendedor, já vinculada à sua
            organização. Ele recebe um e-mail para definir a própria senha.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="seller-name">Nome do vendedor</Label>
            <Input
              id="seller-name"
              placeholder="Ex: João Pereira"
              value={sellerName}
              onChange={(e) => setSellerName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="seller-email">E-mail do vendedor</Label>
            <Input
              id="seller-email"
              type="email"
              placeholder="joao@exemplo.com"
              value={sellerEmail}
              onChange={(e) => setSellerEmail(e.target.value)}
            />
          </div>
          <Button
            onClick={handleInviteSeller}
            disabled={invitingSeller || !sellerName.trim() || !sellerEmail.trim()}
            className="self-start"
          >
            {invitingSeller ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Enviando convite…
              </>
            ) : (
              'Convidar vendedor'
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
