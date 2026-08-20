'use client';

import { useCallback, useEffect, useState } from 'react';
import { Banknote, Building2, Plus, RefreshCw } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { readResponseJson } from '@/lib/http/response-json';

interface Company {
  id: string;
  name: string;
  createdAt: string;
  memberCount: number;
  suspendedAt: string | null;
  suspendedReason: string | null;
  nextPaymentDueAt: string | null;
  lastMarkedPaidAt: string | null;
  owner: { name: string | null; email: string } | null;
  usage30d: { messages: number; conversations: number; aiTokens: number };
}

interface PlatformBankSettings {
  bank_name: string | null;
  account_number: string | null;
  account_type: string | null;
  account_holder: string | null;
}

// Local YYYY-MM-DD for an <input type="date">, in the browser's own
// timezone — avoids the classic UTC-conversion off-by-one where a
// date picked as "today" renders as "yesterday" for someone west of
// UTC.
function toDateInputValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface Invitation {
  id: string;
  company_name: string;
  invited_email: string;
  created_at: string;
  expires_at: string;
}

export default function PlatformAdminPage() {
  const { isPlatformAdmin, profileLoading } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [changingId, setChangingId] = useState<string | null>(null);
  const [markingPaidId, setMarkingPaidId] = useState<string | null>(null);
  const [savingDueDateId, setSavingDueDateId] = useState<string | null>(null);

  const [bankForm, setBankForm] = useState<PlatformBankSettings>({
    bank_name: '',
    account_number: '',
    account_type: '',
    account_holder: '',
  });
  const [savingBank, setSavingBank] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/companies', {
        cache: 'no-store',
      });
      const body = await readResponseJson<{
        error?: string;
        companies: Company[];
        invitations: Invitation[];
      }>(response);
      if (!response.ok)
        throw new Error(body.error ?? 'No se pudo cargar la plataforma');
      setCompanies(body.companies);
      setInvitations(body.invitations);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'No se pudo cargar la plataforma'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isPlatformAdmin) void load();
    else if (!profileLoading) setLoading(false);
  }, [isPlatformAdmin, profileLoading, load]);

  useEffect(() => {
    if (!isPlatformAdmin) return;
    let cancelled = false;
    (async () => {
      const { data } = await createClient()
        .from('platform_settings')
        .select('bank_name, account_number, account_type, account_holder')
        .eq('id', 1)
        .maybeSingle();
      if (cancelled || !data) return;
      setBankForm(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [isPlatformAdmin]);

  const invite = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName, email }),
      });
      const body = await readResponseJson<{ error?: string }>(response);
      if (!response.ok)
        throw new Error(body.error ?? 'No se pudo crear la invitación');
      setCompanyName('');
      setEmail('');
      setOpen(false);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'No se pudo crear la invitación'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const changeSuspension = async (company: Company) => {
    const suspending = !company.suspendedAt;
    const reason = suspending
      ? window.prompt('Motivo de la suspensión', 'Falta de pago')
      : null;
    if (suspending && reason === null) return;
    if (
      !window.confirm(
        suspending
          ? `¿Suspender ${company.name}?`
          : `¿Reactivar ${company.name}?`
      )
    )
      return;

    setChangingId(company.id);
    setError(null);
    try {
      const response = await fetch(`/api/admin/companies/${company.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suspended: suspending, reason }),
      });
      const body = await readResponseJson<{ error?: string }>(response);
      if (!response.ok)
        throw new Error(body.error ?? 'No se pudo cambiar la suscripción');
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'No se pudo cambiar la suscripción'
      );
    } finally {
      setChangingId(null);
    }
  };

  const markPaid = async (company: Company) => {
    if (
      !window.confirm(
        `¿Marcar ${company.name} como pagada y avanzar un mes su próximo pago?`
      )
    )
      return;
    setMarkingPaidId(company.id);
    setError(null);
    try {
      const response = await fetch(`/api/admin/companies/${company.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mark_paid: true }),
      });
      const body = await readResponseJson<{ error?: string }>(response);
      if (!response.ok)
        throw new Error(body.error ?? 'No se pudo marcar como pagada');
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'No se pudo marcar como pagada'
      );
    } finally {
      setMarkingPaidId(null);
    }
  };

  const changeDueDate = async (company: Company, value: string) => {
    setSavingDueDateId(company.id);
    setError(null);
    try {
      const iso = value ? new Date(`${value}T00:00:00`).toISOString() : null;
      const response = await fetch(`/api/admin/companies/${company.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ next_payment_due_at: iso }),
      });
      const body = await readResponseJson<{ error?: string }>(response);
      if (!response.ok)
        throw new Error(body.error ?? 'No se pudo cambiar la fecha de pago');
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'No se pudo cambiar la fecha de pago'
      );
    } finally {
      setSavingDueDateId(null);
    }
  };

  const saveBankSettings = async (event: React.FormEvent) => {
    event.preventDefault();
    setSavingBank(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/platform-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bankForm),
      });
      const body = await readResponseJson<{
        error?: string;
        settings: PlatformBankSettings;
      }>(response);
      if (!response.ok)
        throw new Error(
          body.error ?? 'No se pudieron guardar los datos bancarios'
        );
      setBankForm(body.settings);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'No se pudieron guardar los datos bancarios'
      );
    } finally {
      setSavingBank(false);
    }
  };

  if (!profileLoading && !isPlatformAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Acceso restringido</CardTitle>
          <CardDescription>
            Esta sección solo está disponible para el operador de Chat Sandía.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Building2 className="text-primary size-6" />
            Plataforma
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Empresas afiliadas a Chat Sandía y sus invitaciones.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw className={loading ? 'animate-spin' : ''} />
            Actualizar
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button />}>
              <Plus />
              Nueva empresa
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={invite}>
                <DialogHeader>
                  <DialogTitle>Nueva empresa afiliada</DialogTitle>
                  <DialogDescription>
                    Crearemos una invitación para el dueño. Al aceptarla se
                    generará una empresa aislada con todas las funciones.
                  </DialogDescription>
                </DialogHeader>
                <div className="my-5 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="companyName">Nombre de la empresa</Label>
                    <Input
                      id="companyName"
                      value={companyName}
                      onChange={(event) => setCompanyName(event.target.value)}
                      required
                      maxLength={120}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ownerEmail">Correo del dueño</Label>
                    <Input
                      id="ownerEmail"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setOpen(false)}
                  >
                    Cancelar
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? 'Enviando…' : 'Enviar invitación'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {error ? (
        <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-4 py-3 text-sm">
          {error}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Empresas</CardTitle>
          <CardDescription>
            {companies.length} empresas registradas · consumo de los últimos 30
            días
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead>
                <TableHead>Dueño</TableHead>
                <TableHead>Usuarios</TableHead>
                <TableHead>Conversaciones</TableHead>
                <TableHead>Mensajes</TableHead>
                <TableHead>Tokens IA</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Próximo pago</TableHead>
                <TableHead>Alta</TableHead>
                <TableHead className="text-right">Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((company) => (
                <TableRow key={company.id}>
                  <TableCell className="font-medium">{company.name}</TableCell>
                  <TableCell>
                    <div>{company.owner?.name || 'Sin nombre'}</div>
                    <div className="text-muted-foreground text-xs">
                      {company.owner?.email || 'Sin correo'}
                    </div>
                  </TableCell>
                  <TableCell>{company.memberCount}</TableCell>
                  <TableCell>
                    {company.usage30d.conversations.toLocaleString('es-GT')}
                  </TableCell>
                  <TableCell>
                    {company.usage30d.messages.toLocaleString('es-GT')}
                  </TableCell>
                  <TableCell>
                    {company.usage30d.aiTokens.toLocaleString('es-GT')}
                  </TableCell>
                  <TableCell>
                    <span
                      className={
                        company.suspendedAt
                          ? 'text-destructive'
                          : 'text-emerald-500'
                      }
                    >
                      {company.suspendedAt ? 'Suspendida' : 'Activa'}
                    </span>
                    {company.suspendedReason ? (
                      <div
                        className="text-muted-foreground max-w-48 truncate text-xs"
                        title={company.suspendedReason}
                      >
                        {company.suspendedReason}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Input
                      type="date"
                      defaultValue={toDateInputValue(company.nextPaymentDueAt)}
                      disabled={savingDueDateId === company.id}
                      onBlur={(event) => {
                        if (
                          event.target.value !==
                          toDateInputValue(company.nextPaymentDueAt)
                        )
                          void changeDueDate(company, event.target.value);
                      }}
                      className="h-8 w-36 text-xs"
                    />
                    {company.lastMarkedPaidAt ? (
                      <div className="text-muted-foreground mt-1 text-xs">
                        Último pago:{' '}
                        {new Date(company.lastMarkedPaidAt).toLocaleDateString(
                          'es-GT'
                        )}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {new Date(company.createdAt).toLocaleDateString('es-GT')}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={markingPaidId === company.id}
                        onClick={() => void markPaid(company)}
                      >
                        {markingPaidId === company.id
                          ? 'Guardando…'
                          : 'Marcar pagada'}
                      </Button>
                      <Button
                        size="sm"
                        variant={
                          company.suspendedAt ? 'outline' : 'destructive'
                        }
                        disabled={changingId === company.id}
                        onClick={() => void changeSuspension(company)}
                      >
                        {changingId === company.id
                          ? 'Guardando…'
                          : company.suspendedAt
                            ? 'Reactivar'
                            : 'Suspender'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && companies.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={10}
                    className="text-muted-foreground py-8 text-center"
                  >
                    No hay empresas registradas.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invitaciones pendientes</CardTitle>
          <CardDescription>
            Vencen siete días después de enviarse.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead>
                <TableHead>Correo</TableHead>
                <TableHead>Enviada</TableHead>
                <TableHead>Vence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.map((invitation) => (
                <TableRow key={invitation.id}>
                  <TableCell className="font-medium">
                    {invitation.company_name}
                  </TableCell>
                  <TableCell>{invitation.invited_email}</TableCell>
                  <TableCell>
                    {new Date(invitation.created_at).toLocaleDateString(
                      'es-GT'
                    )}
                  </TableCell>
                  <TableCell>
                    {new Date(invitation.expires_at).toLocaleDateString(
                      'es-GT'
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!loading && invitations.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="text-muted-foreground py-8 text-center"
                  >
                    No hay invitaciones pendientes.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Banknote className="text-primary size-5" />
            Mis datos bancarios
          </CardTitle>
          <CardDescription>
            Se muestran a todas las empresas en Configuración → Facturación.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={saveBankSettings}
            className="grid gap-4 sm:grid-cols-2"
          >
            <div className="space-y-2">
              <Label htmlFor="bankName">Banco</Label>
              <Input
                id="bankName"
                value={bankForm.bank_name ?? ''}
                onChange={(event) =>
                  setBankForm((prev) => ({
                    ...prev,
                    bank_name: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="accountNumber">Número de cuenta</Label>
              <Input
                id="accountNumber"
                value={bankForm.account_number ?? ''}
                onChange={(event) =>
                  setBankForm((prev) => ({
                    ...prev,
                    account_number: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="accountType">Tipo de cuenta</Label>
              <Input
                id="accountType"
                value={bankForm.account_type ?? ''}
                onChange={(event) =>
                  setBankForm((prev) => ({
                    ...prev,
                    account_type: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="accountHolder">Titular</Label>
              <Input
                id="accountHolder"
                value={bankForm.account_holder ?? ''}
                onChange={(event) =>
                  setBankForm((prev) => ({
                    ...prev,
                    account_holder: event.target.value,
                  }))
                }
              />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={savingBank}>
                {savingBank ? 'Guardando…' : 'Guardar datos bancarios'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
