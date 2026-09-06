'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Hash,
  Mail,
  MessageSquare,
  Phone,
  Search,
  UserRound,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CURRENCIES, formatCurrency } from '@/lib/currency';
import { listVerticals } from '@/lib/verticals';
import { cn } from '@/lib/utils';

export interface PlatformCompany {
  id: string;
  name: string;
  createdAt: string;
  memberCount: number;
  seatLimit: number;
  whatsappNumberCount: number;
  whatsappNumberLimit: number;
  suspendedAt: string | null;
  suspendedReason: string | null;
  nextPaymentDueAt: string | null;
  lastMarkedPaidAt: string | null;
  subscriptionAmount: number | null;
  subscriptionCurrency: string;
  industryVertical: string;
  verticalAppliedAt: string | null;
  owner: { name: string | null; email: string } | null;
  usage30d: { messages: number; conversations: number; aiTokens: number };
  handoffs30d: {
    transferred: number;
    attended: number;
    pending: number;
    avgResponseMinutes: number | null;
  };
}

function dateValue(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function Metric({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="border-border bg-card-2 rounded-xl border p-4">
      <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
        <Icon className="text-primary size-4" />
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold tracking-tight">{value}</div>
      {detail ? (
        <p className="text-muted-foreground mt-1 text-xs">{detail}</p>
      ) : null}
    </div>
  );
}

interface Props {
  companies: PlatformCompany[];
  loading: boolean;
  busyIds: {
    suspension: string | null;
    paid: string | null;
    dueDate: string | null;
    seat: string | null;
    number: string | null;
    billing: string | null;
    vertical: string | null;
    resendInvite: string | null;
  };
  onSuspend(company: PlatformCompany): void;
  /** Re-send an access / password-reset email to the company owner. */
  onResendInvite(company: PlatformCompany): void;
  onMarkPaid(company: PlatformCompany): void;
  onAddSeat(company: PlatformCompany): void;
  onAddNumber(company: PlatformCompany): void;
  onDueDate(company: PlatformCompany, value: string): void;
  onBilling(
    company: PlatformCompany,
    amount: number | null,
    currency: string
  ): void;
  /** Relabel only — does not seed. */
  onSetVertical(company: PlatformCompany, vertical: string): void;
  /** Set the vertical AND seed its starter kit (idempotent). */
  onApplyVerticalKit(company: PlatformCompany, vertical: string): void;
}

export function CompanyMasterDetail({
  companies,
  loading,
  busyIds,
  onSuspend,
  onMarkPaid,
  onAddSeat,
  onAddNumber,
  onDueDate,
  onBilling,
  onSetVertical,
  onApplyVerticalKit,
  onResendInvite,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const selected =
    companies.find((company) => company.id === selectedId) ??
    companies[0] ??
    null;
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('GTQ');
  const [vertical, setVertical] = useState('generic');

  useEffect(() => {
    if (!selected) return;
    // Reset the editable draft when the operator selects another company.
    setAmount(selected.subscriptionAmount?.toString() ?? '');
    setCurrency(selected.subscriptionCurrency || 'GTQ');
    setVertical(selected.industryVertical || 'generic');
    // Narrow deps on purpose: re-sync the draft only when the selected
    // company or its subscription fields change, not on every re-render
    // that produces a fresh `selected` object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selected?.id,
    selected?.subscriptionAmount,
    selected?.subscriptionCurrency,
    selected?.industryVertical,
  ]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return companies;
    return companies.filter((company) =>
      `${company.name} ${company.owner?.name ?? ''} ${company.owner?.email ?? ''}`
        .toLowerCase()
        .includes(term)
    );
  }, [companies, search]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-border border-b">
        <CardTitle>Empresas</CardTitle>
        <CardDescription>
          {companies.length} empresas registradas · selecciona una para ver y
          administrar sus datos
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="grid min-h-[38rem] lg:grid-cols-[20rem_minmax(0,1fr)]">
          <aside className="border-border bg-card-2/40 border-b p-3 lg:border-r lg:border-b-0">
            <div className="relative mb-3">
              <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar empresa..."
                className="pl-9"
              />
            </div>
            <div className="app-scroll max-h-80 space-y-1 overflow-y-auto lg:max-h-[34rem]">
              {filtered.map((company) => (
                <button
                  key={company.id}
                  type="button"
                  onClick={() => setSelectedId(company.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors',
                    selected?.id === company.id
                      ? 'border-primary/30 bg-primary-soft text-foreground'
                      : 'hover:border-border hover:bg-muted/60 border-transparent'
                  )}
                >
                  <span className="bg-background flex size-10 shrink-0 items-center justify-center rounded-xl">
                    <Building2 className="text-primary size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {company.name}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {company.owner?.email ?? 'Sin propietario'}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'size-2 shrink-0 rounded-full',
                      company.suspendedAt ? 'bg-destructive' : 'bg-emerald-500'
                    )}
                  />
                  <ChevronRight className="text-muted-foreground size-4 shrink-0" />
                </button>
              ))}
              {!loading && filtered.length === 0 ? (
                <p className="text-muted-foreground py-8 text-center text-sm">
                  No hay empresas coincidentes.
                </p>
              ) : null}
            </div>
          </aside>

          {selected ? (
            <section className="min-w-0 space-y-6 p-4 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-bold">{selected.name}</h2>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-medium',
                        selected.suspendedAt
                          ? 'bg-destructive/10 text-destructive'
                          : 'bg-emerald-500/10 text-emerald-500'
                      )}
                    >
                      {selected.suspendedAt ? 'Suspendida' : 'Activa'}
                    </span>
                  </div>
                  <p className="text-muted-foreground mt-1 text-sm">
                    Cliente desde{' '}
                    {new Date(selected.createdAt).toLocaleDateString('es-GT')}
                  </p>
                </div>
                <Button
                  variant={selected.suspendedAt ? 'outline' : 'destructive'}
                  disabled={busyIds.suspension === selected.id}
                  onClick={() => onSuspend(selected)}
                >
                  {busyIds.suspension === selected.id
                    ? 'Guardando...'
                    : selected.suspendedAt
                      ? 'Reactivar empresa'
                      : 'Suspender empresa'}
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Metric
                  icon={MessageSquare}
                  label="Conversaciones (30 días)"
                  value={selected.usage30d.conversations.toLocaleString(
                    'es-GT'
                  )}
                />
                <Metric
                  icon={Hash}
                  label="Mensajes (30 días)"
                  value={selected.usage30d.messages.toLocaleString('es-GT')}
                />
                <Metric
                  icon={Bot}
                  label="Transferidas por IA"
                  value={selected.handoffs30d.transferred.toLocaleString(
                    'es-GT'
                  )}
                  detail={`${selected.handoffs30d.pending} pendientes`}
                />
                <Metric
                  icon={CheckCircle2}
                  label="Atendidas por humano"
                  value={selected.handoffs30d.attended.toLocaleString('es-GT')}
                  detail={
                    selected.handoffs30d.avgResponseMinutes === null
                      ? 'Sin respuestas registradas'
                      : `Promedio ${selected.handoffs30d.avgResponseMinutes.toFixed(1)} min`
                  }
                />
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className="border-border rounded-xl border p-4">
                  <h3 className="flex items-center gap-2 font-semibold">
                    <UserRound className="text-primary size-4" />
                    Empresa y capacidad
                  </h3>
                  <div className="mt-4 space-y-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-muted-foreground flex min-w-0 items-center gap-2">
                        <Mail className="size-4 shrink-0" />
                        <span className="truncate">
                          {selected.owner?.name || 'Sin nombre'} ·{' '}
                          {selected.owner?.email || 'Sin correo'}
                        </span>
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyIds.resendInvite === selected.id}
                        onClick={() => onResendInvite(selected)}
                      >
                        {busyIds.resendInvite === selected.id
                          ? 'Enviando...'
                          : 'Reenviar acceso'}
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        <Users className="text-muted-foreground mr-2 inline size-4" />
                        Usuarios: {selected.memberCount} / {selected.seatLimit}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyIds.seat === selected.id}
                        onClick={() => onAddSeat(selected)}
                      >
                        +1 asiento
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        <Phone className="text-muted-foreground mr-2 inline size-4" />
                        WhatsApp: {selected.whatsappNumberCount} /{' '}
                        {selected.whatsappNumberLimit}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyIds.number === selected.id}
                        onClick={() => onAddNumber(selected)}
                      >
                        +1 número
                      </Button>
                    </div>
                    <div className="text-muted-foreground">
                      Tokens IA (30 días):{' '}
                      {selected.usage30d.aiTokens.toLocaleString('es-GT')}
                    </div>
                  </div>
                </div>

                <div className="border-border rounded-xl border p-4">
                  <h3 className="flex items-center gap-2 font-semibold">
                    <CircleDollarSign className="text-primary size-4" />
                    Cobro y suscripción
                  </h3>
                  <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_7rem]">
                    <div>
                      <Label htmlFor={`amount-${selected.id}`}>
                        Monto que debe pagar
                      </Label>
                      <Input
                        id={`amount-${selected.id}`}
                        type="number"
                        min="0"
                        step="0.01"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <Label htmlFor={`currency-${selected.id}`}>Moneda</Label>
                      <select
                        id={`currency-${selected.id}`}
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value)}
                        className="border-input bg-background h-8 w-full rounded-lg border px-2 text-sm"
                      >
                        {CURRENCIES.map((item) => (
                          <option key={item.code} value={item.code}>
                            {item.code}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="text-primary mt-2 text-sm font-semibold">
                    {amount
                      ? formatCurrency(Number(amount), currency)
                      : 'Monto no configurado'}
                  </div>
                  <Button
                    className="mt-3"
                    size="sm"
                    disabled={busyIds.billing === selected.id}
                    onClick={() =>
                      onBilling(
                        selected,
                        amount === '' ? null : Number(amount),
                        currency
                      )
                    }
                  >
                    {busyIds.billing === selected.id
                      ? 'Guardando...'
                      : 'Guardar monto'}
                  </Button>
                  <div className="mt-4">
                    <Label htmlFor={`due-${selected.id}`}>Próximo pago</Label>
                    <Input
                      id={`due-${selected.id}`}
                      type="date"
                      defaultValue={dateValue(selected.nextPaymentDueAt)}
                      disabled={busyIds.dueDate === selected.id}
                      onBlur={(event) => {
                        if (
                          event.target.value !==
                          dateValue(selected.nextPaymentDueAt)
                        )
                          onDueDate(selected, event.target.value);
                      }}
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-muted-foreground text-xs">
                      {selected.lastMarkedPaidAt
                        ? `Último pago: ${new Date(selected.lastMarkedPaidAt).toLocaleDateString('es-GT')}`
                        : 'Sin pagos marcados'}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyIds.paid === selected.id}
                      onClick={() => onMarkPaid(selected)}
                    >
                      {busyIds.paid === selected.id
                        ? 'Guardando...'
                        : 'Marcar pagada'}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="border-border rounded-xl border p-4">
                <h3 className="flex items-center gap-2 font-semibold">
                  <Building2 className="text-primary size-4" />
                  Industria
                </h3>
                <p className="text-muted-foreground mt-1 text-xs">
                  Define qué configuración de arranque recibe la empresa. &quot;Aplicar kit&quot;
                  crea pipeline, campos, flujos y documentos — no borra nada existente y se
                  puede volver a ejecutar.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select
                    id={`vertical-${selected.id}`}
                    value={vertical}
                    onChange={(e) => setVertical(e.target.value)}
                    disabled={busyIds.vertical === selected.id}
                    className="border-input bg-background h-8 rounded-lg border px-2 text-sm"
                  >
                    {listVerticals().map((v) => (
                      <option key={v.slug} value={v.slug}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      busyIds.vertical === selected.id ||
                      vertical === selected.industryVertical
                    }
                    onClick={() => onSetVertical(selected, vertical)}
                  >
                    Solo cambiar etiqueta
                  </Button>
                  <Button
                    size="sm"
                    disabled={busyIds.vertical === selected.id}
                    onClick={() => onApplyVerticalKit(selected, vertical)}
                  >
                    {busyIds.vertical === selected.id
                      ? 'Aplicando...'
                      : 'Aplicar kit de arranque'}
                  </Button>
                </div>
                <p className="text-muted-foreground mt-2 text-xs">
                  {selected.verticalAppliedAt
                    ? `Kit aplicado por última vez: ${new Date(selected.verticalAppliedAt).toLocaleString('es-GT')}`
                    : 'Kit no aplicado todavía'}
                </p>
              </div>

              {selected.suspendedReason ? (
                <div className="border-destructive/20 bg-destructive/5 text-destructive rounded-xl border p-3 text-sm">
                  Motivo de suspensión: {selected.suspendedReason}
                </div>
              ) : null}
              <div className="text-muted-foreground flex items-center gap-2 text-xs">
                <Clock3 className="size-4" />
                Las métricas de uso y transferencias corresponden a los últimos
                30 días.
              </div>
            </section>
          ) : (
            <div className="text-muted-foreground flex items-center justify-center p-12">
              Selecciona una empresa.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
