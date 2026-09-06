'use client';

import { useCallback, useEffect, useState } from 'react';
import { Banknote, Building2, LifeBuoy, Plus, RefreshCw } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import {
  CompanyMasterDetail,
  type PlatformCompany,
} from '@/components/admin/company-master-detail';
import { AiDemo } from '@/components/admin/ai-demo';

type Company = PlatformCompany;

function toDateInputValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
interface Invitation {
  id: string;
  company_name: string;
  invited_email: string;
  created_at: string;
  expires_at: string;
}

interface Ticket {
  id: string;
  ticket_number: number;
  account_name: string;
  reporter_name: string;
  reporter_email: string | null;
  description: string;
  status: 'open' | 'resolved';
  admin_note: string | null;
  created_at: string;
  resolved_at: string | null;
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
  const [addingSeatId, setAddingSeatId] = useState<string | null>(null);
  const [changingVerticalId, setChangingVerticalId] = useState<string | null>(
    null
  );
  const [resendingInviteId, setResendingInviteId] = useState<string | null>(null);
  const [deletingCompanyId, setDeletingCompanyId] = useState<string | null>(null);
  const [addingNumberId, setAddingNumberId] = useState<string | null>(null);
  const [savingBillingId, setSavingBillingId] = useState<string | null>(null);

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(true);
  const [updatingTicketId, setUpdatingTicketId] = useState<string | null>(null);
  const [noteTicket, setNoteTicket] = useState<Ticket | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);

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

  const loadTickets = useCallback(async () => {
    setLoadingTickets(true);
    try {
      const response = await fetch('/api/admin/tickets', { cache: 'no-store' });
      const body = await readResponseJson<{
        error?: string;
        tickets: Ticket[];
      }>(response);
      if (!response.ok)
        throw new Error(body.error ?? 'No se pudieron cargar los tickets');
      setTickets(body.tickets);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'No se pudieron cargar los tickets'
      );
    } finally {
      setLoadingTickets(false);
    }
  }, []);

  useEffect(() => {
    if (isPlatformAdmin) void loadTickets();
    else if (!profileLoading) setLoadingTickets(false);
  }, [isPlatformAdmin, profileLoading, loadTickets]);

  const toggleTicketStatus = async (ticket: Ticket) => {
    const nextStatus = ticket.status === 'open' ? 'resolved' : 'open';
    setUpdatingTicketId(ticket.id);
    setError(null);
    try {
      const response = await fetch(`/api/admin/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      const body = await readResponseJson<{ error?: string }>(response);
      if (!response.ok)
        throw new Error(body.error ?? 'No se pudo actualizar el ticket');
      await loadTickets();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'No se pudo actualizar el ticket'
      );
    } finally {
      setUpdatingTicketId(null);
    }
  };

  const openNoteDialog = (ticket: Ticket) => {
    setNoteTicket(ticket);
    setNoteDraft(ticket.admin_note ?? '');
  };

  const saveTicketNote = async () => {
    if (!noteTicket) return;
    setSavingNote(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/tickets/${noteTicket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_note: noteDraft }),
      });
      const body = await readResponseJson<{ error?: string }>(response);
      if (!response.ok)
        throw new Error(body.error ?? 'No se pudo guardar la nota');
      setNoteTicket(null);
      await loadTickets();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'No se pudo guardar la nota'
      );
    } finally {
      setSavingNote(false);
    }
  };

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

  const addSeat = async (company: Company) => {
    if (
      !window.confirm(
        `¿Habilitar un usuario adicional para ${company.name}? Pasará de ${company.seatLimit} a ${company.seatLimit + 1} cupos.`
      )
    )
      return;
    setAddingSeatId(company.id);
    setError(null);
    try {
      const response = await fetch(`/api/admin/companies/${company.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ add_seats: 1 }),
      });
      const body = await readResponseJson<{ error?: string }>(response);
      if (!response.ok)
        throw new Error(body.error ?? 'No se pudo habilitar el cupo');
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'No se pudo habilitar el cupo'
      );
    } finally {
      setAddingSeatId(null);
    }
  };

  const resendInvite = async (company: Company) => {
    if (
      !window.confirm(
        `¿Reenviar el correo de acceso a ${company.name}? Se enviará un enlace para restablecer la contraseña al correo del propietario.`
      )
    )
      return;
    setResendingInviteId(company.id);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/companies/${company.id}/resend-invite`,
        { method: 'POST' }
      );
      const body = await readResponseJson<{ error?: string; email?: string }>(
        response
      );
      if (!response.ok)
        throw new Error(body.error ?? 'No se pudo reenviar el acceso');
      window.alert(
        `Correo de acceso enviado a ${body.email ?? 'el propietario'}.`
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'No se pudo reenviar el acceso'
      );
    } finally {
      setResendingInviteId(null);
    }
  };

  const deleteCompany = async (company: Company) => {
    const typed = window.prompt(
      `Esto elimina PERMANENTEMENTE a "${company.name}" y todos sus datos (contactos, conversaciones, negocios, productos, flujos, integraciones, archivos y las cuentas de sus usuarios). No se puede deshacer.\n\nEscribe el nombre de la empresa para confirmar:`
    );
    if (typed === null) return;
    if (typed.trim().toLowerCase() !== company.name.trim().toLowerCase()) {
      setError('El nombre no coincide — no se eliminó nada.');
      return;
    }
    setDeletingCompanyId(company.id);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/companies/${company.id}/delete`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirm_name: typed.trim() }),
        }
      );
      const body = await readResponseJson<{
        error?: string;
        deleted?: { members?: number };
        warnings?: string[];
      }>(response);
      if (!response.ok)
        throw new Error(body.error ?? 'No se pudo eliminar la empresa');
      const warn = body.warnings?.length
        ? `\n\nAvisos:\n- ${body.warnings.join('\n- ')}`
        : '';
      window.alert(
        `"${company.name}" eliminada. Cuentas de usuario borradas: ${body.deleted?.members ?? 0}.${warn}`
      );
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'No se pudo eliminar la empresa'
      );
    } finally {
      setDeletingCompanyId(null);
    }
  };

  const setCompanyVertical = async (company: Company, vertical: string) => {
    setChangingVerticalId(company.id);
    setError(null);
    try {
      const response = await fetch(`/api/admin/companies/${company.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ set_vertical: vertical }),
      });
      const body = await readResponseJson<{ error?: string }>(response);
      if (!response.ok)
        throw new Error(body.error ?? 'No se pudo cambiar la industria');
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'No se pudo cambiar la industria'
      );
    } finally {
      setChangingVerticalId(null);
    }
  };

  const applyCompanyVerticalKit = async (company: Company, vertical: string) => {
    if (
      !window.confirm(
        `¿Aplicar el kit de arranque "${vertical}" a ${company.name}? Crea pipeline, campos, flujos y documentos. No borra nada y se puede repetir.`
      )
    )
      return;
    setChangingVerticalId(company.id);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/companies/${company.id}/apply-vertical`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vertical }),
        }
      );
      const body = await readResponseJson<{ error?: string }>(response);
      if (!response.ok)
        throw new Error(body.error ?? 'No se pudo aplicar el kit');
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'No se pudo aplicar el kit'
      );
    } finally {
      setChangingVerticalId(null);
    }
  };

  const addWhatsAppNumber = async (company: Company) => {
    if (
      !window.confirm(
        `¿Habilitar un número de WhatsApp adicional para ${company.name}? Pasará de ${company.whatsappNumberLimit} a ${company.whatsappNumberLimit + 1} números.`
      )
    )
      return;
    setAddingNumberId(company.id);
    setError(null);
    try {
      const response = await fetch(`/api/admin/companies/${company.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ add_whatsapp_numbers: 1 }),
      });
      const body = await readResponseJson<{ error?: string }>(response);
      if (!response.ok)
        throw new Error(body.error ?? 'No se pudo habilitar el número');
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'No se pudo habilitar el número'
      );
    } finally {
      setAddingNumberId(null);
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

  const saveCompanyBilling = async (
    company: Company,
    amount: number | null,
    currency: string
  ) => {
    setSavingBillingId(company.id);
    setError(null);
    try {
      const response = await fetch(`/api/admin/companies/${company.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription_amount: amount,
          subscription_currency: currency,
        }),
      });
      const body = await readResponseJson<{ error?: string }>(response);
      if (!response.ok)
        throw new Error(body.error ?? 'No se pudo guardar el monto');
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'No se pudo guardar el monto'
      );
    } finally {
      setSavingBillingId(null);
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
            onClick={() =>
              document
                .getElementById('tickets')
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }
          >
            <LifeBuoy />
            Historial de tickets
            {tickets.some((t) => t.status === 'open') ? (
              <span className="bg-primary text-primary-foreground ml-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold">
                {tickets.filter((t) => t.status === 'open').length}
              </span>
            ) : null}
          </Button>
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

      <CompanyMasterDetail
        companies={companies}
        loading={loading}
        busyIds={{
          suspension: changingId,
          paid: markingPaidId,
          dueDate: savingDueDateId,
          seat: addingSeatId,
          number: addingNumberId,
          billing: savingBillingId,
          vertical: changingVerticalId,
          resendInvite: resendingInviteId,
          deleteCompany: deletingCompanyId,
        }}
        onSuspend={(company) => void changeSuspension(company)}
        onResendInvite={(company) => void resendInvite(company)}
        onDeleteCompany={(company) => void deleteCompany(company)}
        onMarkPaid={(company) => void markPaid(company)}
        onAddSeat={(company) => void addSeat(company)}
        onAddNumber={(company) => void addWhatsAppNumber(company)}
        onDueDate={(company, value) => void changeDueDate(company, value)}
        onBilling={(company, amount, currency) =>
          void saveCompanyBilling(company, amount, currency)
        }
        onSetVertical={(company, vertical) =>
          void setCompanyVertical(company, vertical)
        }
        onApplyVerticalKit={(company, vertical) =>
          void applyCompanyVerticalKit(company, vertical)
        }
      />

      <AiDemo />

      {/* Legacy company table retained as a rollback reference while the
          master-detail view above carries every existing action. */}
      <Card className="hidden">
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
                <TableHead>Cupos</TableHead>
                <TableHead>Números WhatsApp</TableHead>
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
                    <div className="flex items-center gap-2">
                      <span
                        className={
                          company.memberCount >= company.seatLimit
                            ? 'text-amber-500'
                            : 'text-muted-foreground'
                        }
                      >
                        {company.memberCount} / {company.seatLimit}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={addingSeatId === company.id}
                        onClick={() => void addSeat(company)}
                      >
                        {addingSeatId === company.id
                          ? 'Guardando…'
                          : '+1 asiento'}
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span
                        className={
                          company.whatsappNumberCount >=
                          company.whatsappNumberLimit
                            ? 'text-amber-500'
                            : 'text-muted-foreground'
                        }
                      >
                        {company.whatsappNumberCount} /{' '}
                        {company.whatsappNumberLimit}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={addingNumberId === company.id}
                        onClick={() => void addWhatsAppNumber(company)}
                      >
                        {addingNumberId === company.id
                          ? 'Guardando…'
                          : '+1 número'}
                      </Button>
                    </div>
                  </TableCell>
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
                    colSpan={12}
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

      <Card id="tickets" className="scroll-mt-6">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <LifeBuoy className="text-primary size-5" />
                Tickets de soporte
              </CardTitle>
              <CardDescription>
                Reportes enviados desde &quot;Reportar un problema&quot; en cada
                cuenta.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              onClick={() => void loadTickets()}
              disabled={loadingTickets}
            >
              <RefreshCw className={loadingTickets ? 'animate-spin' : ''} />
              Actualizar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticket</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>Reportado por</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead className="text-right">Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tickets.map((ticket) => (
                <TableRow key={ticket.id}>
                  <TableCell className="font-medium">
                    #{ticket.ticket_number}
                  </TableCell>
                  <TableCell>{ticket.account_name}</TableCell>
                  <TableCell>
                    <div>{ticket.reporter_name}</div>
                    <div className="text-muted-foreground text-xs">
                      {ticket.reporter_email || 'Sin correo'}
                    </div>
                  </TableCell>
                  <TableCell
                    className="max-w-72 truncate"
                    title={ticket.description}
                  >
                    {ticket.description}
                  </TableCell>
                  <TableCell>
                    <span
                      className={
                        ticket.status === 'resolved'
                          ? 'text-emerald-500'
                          : 'text-amber-500'
                      }
                    >
                      {ticket.status === 'resolved' ? 'Solucionado' : 'Abierto'}
                    </span>
                  </TableCell>
                  <TableCell>
                    {new Date(ticket.created_at).toLocaleDateString('es-GT')}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openNoteDialog(ticket)}
                      >
                        {ticket.admin_note ? 'Ver nota' : 'Agregar nota'}
                      </Button>
                      <Button
                        size="sm"
                        variant={
                          ticket.status === 'resolved' ? 'outline' : 'default'
                        }
                        disabled={updatingTicketId === ticket.id}
                        onClick={() => void toggleTicketStatus(ticket)}
                      >
                        {updatingTicketId === ticket.id
                          ? 'Guardando…'
                          : ticket.status === 'resolved'
                            ? 'Reabrir'
                            : 'Marcar solucionado'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!loadingTickets && tickets.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-muted-foreground py-8 text-center"
                  >
                    No hay tickets reportados.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog
        open={noteTicket !== null}
        onOpenChange={(next) => {
          if (!next) setNoteTicket(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Nota para el ticket #{noteTicket?.ticket_number}
            </DialogTitle>
            <DialogDescription>
              Visible para {noteTicket?.account_name} en Configuración →
              Tickets.
            </DialogDescription>
          </DialogHeader>
          <div className="my-4">
            <Textarea
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              placeholder="Ej. Ya estamos revisando esto, te avisamos apenas quede resuelto…"
              rows={5}
              maxLength={2000}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setNoteTicket(null)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void saveTicketNote()}
              disabled={savingNote}
            >
              {savingNote ? 'Guardando…' : 'Guardar nota'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
