'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { CalendarClock, CheckCircle2, ExternalLink, Loader2, XCircle } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SettingsPanelHead } from './settings-panel-head';
import type { BusinessHours, Weekday } from '@/lib/eter/repo/calendar-config.repo';

const WEEKDAYS: { key: Weekday; label: string }[] = [
  { key: 'mon', label: 'Segunda' },
  { key: 'tue', label: 'Terça' },
  { key: 'wed', label: 'Quarta' },
  { key: 'thu', label: 'Quinta' },
  { key: 'fri', label: 'Sexta' },
  { key: 'sat', label: 'Sábado' },
  { key: 'sun', label: 'Domingo' },
];

interface CalendarConfigDto {
  connected: boolean;
  calendarId?: string;
  timezone?: string;
  businessHours?: BusinessHours;
  defaultDurationMin?: number;
  bufferMin?: number;
  minLeadTimeMin?: number;
  isActive?: boolean;
}

// One text window per day, e.g. "09:00-13:00, 14:00-19:00". Kept as a
// single editable string per day rather than a dynamic add/remove-row
// UI — the JSONB shape supports multiple windows/day (split lunch
// hours etc.), and free-text with clear parsing is a straightforward,
// low-surface way to let a user express that without a heavier
// multi-row form. Parsed with `parseWindowsInput` and any window that
// doesn't match "HH:MM-HH:MM" is dropped rather than silently
// misread — the caller sees the row simplify on save if they typed
// something invalid.
function windowsToText(windows: [string, string][] | undefined): string {
  return (windows ?? []).map(([start, end]) => `${start}-${end}`).join(', ');
}

function parseWindowsInput(text: string): [string, string][] {
  return text
    .split(',')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => chunk.split('-').map((t) => t.trim()))
    .filter((parts): parts is [string, string] => parts.length === 2)
    .map(([start, end]) => [start, end] as [string, string]);
}

const CALENDAR_ERROR_MESSAGES: Record<string, string> = {
  google_access_denied: 'Ligação cancelada — não concedeu acesso ao Google Calendar.',
  missing_params: 'Resposta do Google incompleta. Tente ligar novamente.',
  session_expired: 'A sua sessão expirou a meio da ligação. Tente novamente.',
  account_mismatch: 'A ligação foi iniciada noutra conta. Tente novamente nesta conta.',
  no_refresh_token:
    'O Google não devolveu uma autorização reutilizável. Revogue o acesso em myaccount.google.com/permissions e tente ligar de novo.',
  exchange_failed: 'Falha ao trocar o código de autorização com o Google. Tente novamente.',
};

function calendarErrorMessage(code: string | null): string {
  if (!code) return 'Falha ao ligar ao Google Calendar.';
  if (code.startsWith('state_')) return 'O link de ligação expirou ou é inválido. Tente novamente.';
  if (code.startsWith('google_')) return CALENDAR_ERROR_MESSAGES.google_access_denied;
  return CALENDAR_ERROR_MESSAGES[code] ?? 'Falha ao ligar ao Google Calendar.';
}

export function CalendarConfig() {
  const { accountId, accountRole, profileLoading } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;
  const searchParams = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [config, setConfig] = useState<CalendarConfigDto | null>(null);

  const [calendarId, setCalendarId] = useState('primary');
  const [timezone, setTimezone] = useState('Europe/Lisbon');
  const [defaultDurationMin, setDefaultDurationMin] = useState(30);
  const [bufferMin, setBufferMin] = useState(15);
  const [minLeadTimeMin, setMinLeadTimeMin] = useState(60);
  const [isActive, setIsActive] = useState(false);
  const [hoursText, setHoursText] = useState<Record<Weekday, string>>({
    mon: '',
    tue: '',
    wed: '',
    thu: '',
    fri: '',
    sat: '',
    sun: '',
  });

  const loadedAccountIdRef = useRef<string | null>(null);
  const handledRedirectRef = useRef(false);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/calendar/config');
      const data = (await res.json()) as CalendarConfigDto;
      setConfig(data);
      if (data.connected) {
        setCalendarId(data.calendarId ?? 'primary');
        setTimezone(data.timezone ?? 'Europe/Lisbon');
        setDefaultDurationMin(data.defaultDurationMin ?? 30);
        setBufferMin(data.bufferMin ?? 15);
        setMinLeadTimeMin(data.minLeadTimeMin ?? 60);
        setIsActive(data.isActive ?? false);
        const hours = data.businessHours ?? {};
        setHoursText({
          mon: windowsToText(hours.mon),
          tue: windowsToText(hours.tue),
          wed: windowsToText(hours.wed),
          thu: windowsToText(hours.thu),
          fri: windowsToText(hours.fri),
          sat: windowsToText(hours.sat),
          sun: windowsToText(hours.sun),
        });
      }
    } catch (err) {
      console.error('Failed to load calendar config:', err);
      toast.error('Falha ao carregar a configuração do calendário.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (profileLoading) return;
    if (!accountId) {
      loadedAccountIdRef.current = null;
      setLoading(false);
      return;
    }
    if (loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    fetchConfig();
  }, [profileLoading, accountId, fetchConfig]);

  // Surface the OAuth callback's redirect params exactly once.
  useEffect(() => {
    if (handledRedirectRef.current) return;
    const connected = searchParams.get('calendar');
    const errorCode = searchParams.get('calendar_error');
    if (connected === 'connected') {
      handledRedirectRef.current = true;
      toast.success('Google Calendar ligado. Reveja as definições abaixo e active a marcação de reuniões.');
      fetchConfig();
    } else if (errorCode) {
      handledRedirectRef.current = true;
      toast.error(calendarErrorMessage(errorCode), { duration: 8000 });
    }
  }, [searchParams, fetchConfig]);

  function handleConnect() {
    setConnecting(true);
    window.location.href = '/api/calendar/google/authorize';
  }

  async function handleSave() {
    try {
      setSaving(true);
      const businessHours: BusinessHours = {};
      for (const { key } of WEEKDAYS) {
        const windows = parseWindowsInput(hoursText[key]);
        if (windows.length > 0) businessHours[key] = windows;
      }

      const res = await fetch('/api/calendar/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          calendarId: calendarId.trim(),
          timezone: timezone.trim(),
          businessHours,
          defaultDurationMin,
          bufferMin,
          minLeadTimeMin,
          isActive,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Falha ao guardar a configuração.');
        return;
      }
      setConfig(data);
      toast.success('Configuração do calendário guardada.');
    } catch (err) {
      console.error('Save calendar config error:', err);
      toast.error('Falha ao guardar a configuração.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead title="Calendário" description="Ligue o Google Calendar para o agente marcar reuniões automaticamente." />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  const connected = Boolean(config?.connected);

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead title="Calendário" description="Ligue o Google Calendar para o agente marcar reuniões automaticamente." />

      <div className="space-y-6">
        <Alert className="bg-card border-border">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              {connected ? (
                <CheckCircle2 className="size-4 text-primary" />
              ) : (
                <XCircle className="size-4 text-red-500" />
              )}
              <div>
                <AlertTitle className="text-foreground mb-0">
                  {connected ? 'Google Calendar ligado' : 'Google Calendar não ligado'}
                </AlertTitle>
                <AlertDescription className="text-muted-foreground">
                  {connected
                    ? 'A conta tem uma ligação Google válida. Reveja calendário, horário e definições abaixo.'
                    : 'Ligue uma conta Google para o agente conseguir consultar disponibilidade e marcar reuniões.'}
                </AlertDescription>
              </div>
            </div>
            {canEdit && (
              <Button onClick={handleConnect} disabled={connecting}>
                {connecting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    A abrir o Google…
                  </>
                ) : (
                  <>
                    <CalendarClock className="size-4" />
                    {connected ? 'Voltar a ligar' : 'Ligar Google Calendar'}
                  </>
                )}
              </Button>
            )}
          </div>
        </Alert>

        {!canEdit && (
          <Alert className="bg-card border-border">
            <AlertDescription className="text-muted-foreground text-sm">
              Só administradores podem ligar ou alterar as definições do calendário.
            </AlertDescription>
          </Alert>
        )}

        {connected && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-foreground">Ligação</CardTitle>
                <CardDescription className="text-muted-foreground">
                  Qual calendário Google usar e em que fuso horário mostrar os eventos.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-muted-foreground">Calendar ID</Label>
                  <Input
                    placeholder="primary ou um endereço de calendário Google"
                    value={calendarId}
                    onChange={(e) => setCalendarId(e.target.value)}
                    disabled={!canEdit}
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                  />
                  <p className="text-xs text-muted-foreground">
                    Use <code>primary</code> para o calendário principal da conta ligada, ou o ID de um
                    calendário secundário (visível em Definições do Google Calendar → Integrar calendário).
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-muted-foreground">Fuso horário</Label>
                  <Input
                    placeholder="Europe/Lisbon"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    disabled={!canEdit}
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                  />
                </div>

                <div className="flex items-center justify-between rounded-md border border-border p-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Marcação de reuniões activa</p>
                    <p className="text-xs text-muted-foreground">
                      Enquanto desligado, o agente não cria/altera/cancela eventos reais — útil enquanto
                      configura horários e testa.
                    </p>
                  </div>
                  <Switch checked={isActive} onCheckedChange={setIsActive} disabled={!canEdit} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-foreground">Marcações</CardTitle>
                <CardDescription className="text-muted-foreground">
                  Duração por defeito, intervalo entre reuniões e antecedência mínima para marcar.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label className="text-muted-foreground">Duração (min)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={defaultDurationMin}
                    onChange={(e) => setDefaultDurationMin(Number(e.target.value) || 0)}
                    disabled={!canEdit}
                    className="bg-muted border-border text-foreground"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-muted-foreground">Buffer entre reuniões (min)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={bufferMin}
                    onChange={(e) => setBufferMin(Number(e.target.value) || 0)}
                    disabled={!canEdit}
                    className="bg-muted border-border text-foreground"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-muted-foreground">Antecedência mínima (min)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={minLeadTimeMin}
                    onChange={(e) => setMinLeadTimeMin(Number(e.target.value) || 0)}
                    disabled={!canEdit}
                    className="bg-muted border-border text-foreground"
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-foreground">Horário de funcionamento</CardTitle>
                <CardDescription className="text-muted-foreground">
                  Um ou mais intervalos por dia, formato <code>HH:MM-HH:MM</code>, separados por vírgula
                  (ex.: <code>09:00-13:00, 14:00-19:00</code>). Deixe vazio para fechado nesse dia.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {WEEKDAYS.map(({ key, label }) => (
                  <div key={key} className="grid grid-cols-[100px_1fr] items-center gap-3">
                    <Label className="text-muted-foreground">{label}</Label>
                    <Input
                      placeholder="fechado"
                      value={hoursText[key]}
                      onChange={(e) => setHoursText((prev) => ({ ...prev, [key]: e.target.value }))}
                      disabled={!canEdit}
                      className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                    />
                  </div>
                ))}
              </CardContent>
            </Card>

            {canEdit && (
              <div className="flex justify-end">
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      A guardar…
                    </>
                  ) : (
                    'Guardar configuração'
                  )}
                </Button>
              </div>
            )}
          </>
        )}

        <a
          href="https://myaccount.google.com/permissions"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors"
        >
          <ExternalLink className="size-3.5" />
          Gerir acessos concedidos na sua Conta Google
        </a>
      </div>
    </section>
  );
}
