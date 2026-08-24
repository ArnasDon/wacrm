'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Copy, Link2, Loader2, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type { Organization, OrganizationAccount } from '@/types';

function fmtDateTime(iso: string | null): string {
  if (!iso) return 'Nunca';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Formats a digits-only phone for display, e.g. "5511987654321" →
 * "+55 11 98765-4321". Best-effort — falls back to the raw digits
 * for shapes it doesn't recognize (other countries, landlines).
 */
function fmtPhone(digits: string): string {
  const m = digits.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  if (m) return `+55 ${m[1]} ${m[2]}-${m[3]}`;
  return `+${digits}`;
}

interface SellerRowState {
  phone: string;
  rotationEnabled: boolean;
  saving: boolean;
}

/**
 * Settings → Organization's "Distribuição de leads" card. Lets the
 * owner:
 *   1. Copy the public redirect link to paste as the destination URL
 *      on a Meta/Google Ads "click to WhatsApp" campaign.
 *   2. Set each linked account's (including the owner's own store
 *      account) WhatsApp number and whether it currently takes a
 *      turn in the round-robin.
 *   3. Set a store-wide fallback number/message for when nobody is
 *      eligible.
 *
 * See 048_lead_distribution.sql for the underlying round-robin logic
 * and GET/PATCH /api/organization + PATCH /api/organization/sellers/[id]
 * + PATCH /api/account/lead-settings for the endpoints this drives.
 */
export function LeadDistributionSettings({
  organization,
  accounts,
  ownAccountId,
  onChanged,
}: {
  organization: Organization;
  accounts: OrganizationAccount[];
  ownAccountId: string | null;
  onChanged: () => void;
}) {
  const [copying, setCopying] = useState(false);

  const [fallbackPhone, setFallbackPhone] = useState(organization.fallback_lead_phone ?? '');
  const [messageTemplate, setMessageTemplate] = useState(organization.lead_message_template ?? '');
  const [savingFallback, setSavingFallback] = useState(false);

  const [rows, setRows] = useState<Record<string, SellerRowState>>(() =>
    Object.fromEntries(
      accounts.map((a) => [
        a.id,
        { phone: a.leadRedirectPhone ?? '', rotationEnabled: a.leadRotationEnabled, saving: false },
      ]),
    ),
  );

  const redirectLink =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/leads/redirect?org=${organization.id}`
      : '';

  const eligibleCount = accounts.filter(
    (a) => a.leadRotationEnabled && a.leadRedirectPhone,
  ).length;

  function handleCopyLink() {
    navigator.clipboard.writeText(redirectLink);
    toast.success('Link copiado — cole como URL de destino no anúncio.');
    setCopying(true);
    setTimeout(() => setCopying(false), 1500);
  }

  async function handleSaveFallback() {
    setSavingFallback(true);
    try {
      const res = await fetch('/api/organization', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fallbackLeadPhone: fallbackPhone.trim() || null,
          leadMessageTemplate: messageTemplate.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Falha ao salvar');
        return;
      }
      toast.success('Configuração de fallback salva');
      onChanged();
    } catch {
      toast.error('Não foi possível conectar ao servidor');
    } finally {
      setSavingFallback(false);
    }
  }

  function updateRow(accountId: string, patch: Partial<SellerRowState>) {
    setRows((prev) => ({ ...prev, [accountId]: { ...prev[accountId], ...patch } }));
  }

  async function handleSaveRow(account: OrganizationAccount) {
    const row = rows[account.id];
    if (!row) return;
    updateRow(account.id, { saving: true });
    try {
      const endpoint =
        account.id === ownAccountId
          ? '/api/account/lead-settings'
          : `/api/organization/sellers/${account.id}`;
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadRedirectPhone: row.phone.trim() || null,
          leadRotationEnabled: row.rotationEnabled,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Falha ao salvar');
        return;
      }
      toast.success(`Configuração de ${account.name} salva`);
      onChanged();
    } catch {
      toast.error('Não foi possível conectar ao servidor');
    } finally {
      updateRow(account.id, { saving: false });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageCircle className="size-4" />
          Distribuição de leads dos anúncios
        </CardTitle>
        <CardDescription>
          Cada clique no anúncio é encaminhado para o próximo vendedor da fila (quem está há mais
          tempo sem receber um lead), em rodízio.{' '}
          {eligibleCount === 0 ? (
            <span className="text-amber-500">
              Nenhum vendedor está pronto para receber leads ainda — configure o WhatsApp de pelo
              menos um abaixo.
            </span>
          ) : (
            `${eligibleCount} vendedor(es) participando do rodízio agora.`
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <Label className="text-muted-foreground">Link para colocar no anúncio (Meta Ads)</Label>
          <div className="flex gap-2">
            <Input readOnly value={redirectLink} className="font-mono text-xs" />
            <Button variant="outline" size="icon" onClick={handleCopyLink} className="shrink-0">
              {copying ? <Link2 className="size-4" /> : <Copy className="size-4" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Use este link como a URL de destino da campanha. Cada clique já sai direto no WhatsApp
            do vendedor da vez.
          </p>
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <p className="text-sm font-medium text-foreground">Vendedores no rodízio</p>
          <ul className="flex flex-col gap-3">
            {accounts.map((account) => {
              const row = rows[account.id];
              if (!row) return null;
              return (
                <li
                  key={account.id}
                  className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-end sm:gap-3"
                >
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {account.name}
                      {account.leadRedirectPhone && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {fmtPhone(account.leadRedirectPhone)}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Último lead recebido: {fmtDateTime(account.lastLeadAssignedAt)}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5 sm:w-56">
                    <Label className="text-xs text-muted-foreground">
                      WhatsApp (com DDI e DDD, só números)
                    </Label>
                    <Input
                      placeholder="5511987654321"
                      value={row.phone}
                      onChange={(e) => updateRow(account.id, { phone: e.target.value })}
                    />
                  </div>
                  <div className="flex items-center gap-2 pb-1.5">
                    <Switch
                      checked={row.rotationEnabled}
                      onCheckedChange={(checked) => updateRow(account.id, { rotationEnabled: checked })}
                    />
                    <span className="text-xs text-muted-foreground">No rodízio</span>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleSaveRow(account)}
                    disabled={row.saving}
                    className="sm:self-end"
                  >
                    {row.saving ? <Loader2 className="size-3.5 animate-spin" /> : 'Salvar'}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <p className="text-sm font-medium text-foreground">Fallback (quando ninguém está disponível)</p>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">WhatsApp de backup</Label>
            <Input
              placeholder="5511987654321 (opcional)"
              value={fallbackPhone}
              onChange={(e) => setFallbackPhone(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Mensagem pré-preenchida no WhatsApp</Label>
            <Input
              placeholder="Olá! Vi o anúncio e gostaria de mais informações."
              value={messageTemplate}
              onChange={(e) => setMessageTemplate(e.target.value)}
            />
          </div>
          <Button size="sm" onClick={handleSaveFallback} disabled={savingFallback} className="self-start">
            {savingFallback ? <Loader2 className="size-3.5 animate-spin" /> : 'Salvar fallback'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
