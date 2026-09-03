'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { toast } from 'sonner';
import {
  Sheet as SheetIcon,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SettingsPanelHead } from './settings-panel-head';
import { readResponseJson } from '@/lib/http/response-json';

// Deliberately hardcoded Spanish (like the notification bodies in
// google-sheets/oauth.ts) rather than adding a Settings.googleSheets
// block to en/ko/es.json — keeps this feature self-contained.

const EVENT_LABELS: Record<string, string> = {
  'deal.won': 'Venta cerrada (deal ganado)',
  'deal.stage_changed': 'Cambio de etapa del pipeline',
  'quote.created': 'Cotización creada',
  'contact.created': 'Contacto / lead nuevo',
  'contact.lead_temperature_changed': 'Cambio de temperatura del lead',
  'appointment.scheduled': 'Cita agendada',
  'broadcast.completed': 'Difusión finalizada',
  'csat.received': 'Encuesta de satisfacción respondida',
};

const EXPORT_ENTITIES: { key: string; label: string }[] = [
  { key: 'deals', label: 'Negociaciones' },
  { key: 'quotes', label: 'Cotizaciones' },
  { key: 'contacts', label: 'Contactos' },
  { key: 'products', label: 'Productos' },
];

interface ConfigPayload {
  connected?: boolean;
  reason?: string;
  message?: string;
  needs_reset?: boolean;
  google_email?: string | null;
  spreadsheet_id?: string | null;
  spreadsheet_name?: string | null;
  sheet_tab?: string | null;
  events?: string[];
  last_write_at?: string | null;
  sheetable_events?: string[];
}

export function GoogleSheetsConfig() {
  const { user, accountId, loading: authLoading, profileLoading } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [exportingEntity, setExportingEntity] = useState<string | null>(null);
  const [cfg, setCfg] = useState<ConfigPayload | null>(null);

  const [spreadsheetInput, setSpreadsheetInput] = useState('');
  const [sheetTab, setSheetTab] = useState('Ventas');
  const [events, setEvents] = useState<string[]>(['deal.won']);

  const loadedAccountIdRef = useRef<string | null>(null);
  const consumedRedirectRef = useRef(false);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/google-sheets/config');
      const payload = await readResponseJson<ConfigPayload>(res);
      setCfg(payload);
      if (payload.spreadsheet_id) setSpreadsheetInput(payload.spreadsheet_id);
      if (payload.sheet_tab) setSheetTab(payload.sheet_tab);
      if (payload.events && payload.events.length) setEvents(payload.events);
    } catch (err) {
      console.error('[google-sheets] status fetch failed:', err);
      setCfg({ connected: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || profileLoading) return;
    if (!user || !accountId) {
      loadedAccountIdRef.current = null;
      setLoading(false);
      return;
    }
    if (loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    fetchStatus();
  }, [authLoading, profileLoading, user, accountId, fetchStatus]);

  useEffect(() => {
    if (consumedRedirectRef.current) return;
    const connected = searchParams.get('connected');
    const error = searchParams.get('error');
    if (!connected && !error) return;
    consumedRedirectRef.current = true;
    if (connected) {
      toast.success('Google Sheets conectado');
      fetchStatus();
    } else if (error) {
      toast.error(`No se pudo conectar Google Sheets: ${error}`);
    }
    router.replace(`${pathname}?tab=google-sheets`);
  }, [searchParams, router, pathname, fetchStatus]);

  const sheetableEvents = cfg?.sheetable_events ?? Object.keys(EVENT_LABELS);
  const isConnected = Boolean(cfg?.connected);
  const hasSpreadsheet = Boolean(cfg?.spreadsheet_id);

  function toggleEvent(ev: string) {
    setEvents((prev) => (prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]));
  }

  async function handleSave() {
    if (!spreadsheetInput.trim()) {
      toast.error('Pegá el ID o la URL de tu Google Sheet');
      return;
    }
    if (events.length === 0) {
      toast.error('Elegí al menos un evento');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/google-sheets/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spreadsheet_url: spreadsheetInput.trim(), sheet_tab: sheetTab.trim() || 'Ventas', events }),
      });
      const data = await readResponseJson<{ error?: string; spreadsheet_name?: string }>(res).catch(
        (): { error?: string; spreadsheet_name?: string } => ({}),
      );
      if (!res.ok) {
        toast.error(data.error || 'No se pudo guardar');
        return;
      }
      toast.success(`Conectado a "${data.spreadsheet_name}"`);
      fetchStatus();
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm('¿Desconectar Google Sheets? El CRM dejará de escribir filas.')) return;
    setDisconnecting(true);
    try {
      const res = await fetch('/api/google-sheets/config', { method: 'DELETE' });
      if (!res.ok) {
        toast.error('No se pudo desconectar');
        return;
      }
      toast.success('Google Sheets desconectado');
      setCfg({ connected: false });
      setSpreadsheetInput('');
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleExport(entity: string) {
    setExportingEntity(entity);
    try {
      const res = await fetch('/api/google-sheets/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity }),
      });
      const data = await readResponseJson<{
        error?: string;
        tab?: string;
        row_count?: number;
        truncated?: boolean;
      }>(res).catch((): { error?: string; tab?: string; row_count?: number; truncated?: boolean } => ({}));
      if (!res.ok) {
        toast.error(data.error || 'No se pudo exportar');
        return;
      }
      toast.success(
        `${data.row_count} filas exportadas a "${data.tab}"` + (data.truncated ? ' (limitado a 5000)' : ''),
      );
    } finally {
      setExportingEntity(null);
    }
  }

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead title="Google Sheets" description="Envía reportes del CRM a una hoja de cálculo." />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="text-primary size-6 animate-spin" />
        </div>
      </section>
    );
  }

  return (
    <section className="animate-in fade-in-50 duration-200 space-y-6">
      <SettingsPanelHead
        title="Google Sheets"
        description="Cada venta cerrada, cotización o lead nuevo se agrega como fila en tu hoja — en vivo. También podés exportar tablas completas cuando quieras."
      />

      {cfg?.needs_reset && cfg.message && (
        <Alert className="border-amber-600/40 bg-amber-950/40">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-400" />
            <div className="flex-1">
              <AlertTitle className="mb-1 text-amber-200">Reconexión necesaria</AlertTitle>
              <AlertDescription className="text-sm text-amber-100/80">{cfg.message}</AlertDescription>
            </div>
          </div>
        </Alert>
      )}

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-foreground flex items-center gap-2">
            <SheetIcon className="text-primary size-4" />
            Conexión
          </CardTitle>
          <CardDescription>
            {isConnected ? (
              <span className="flex items-center gap-1.5 text-emerald-400">
                <CheckCircle2 className="size-3.5" />
                Conectado{cfg?.google_email ? ` como ${cfg.google_email}` : ''}
              </span>
            ) : (
              <span className="text-muted-foreground flex items-center gap-1.5">
                <XCircle className="size-3.5" />
                No conectado
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!isConnected ? (
            <a href="/api/google-sheets/oauth/start">
              <Button>
                Conectar Google Sheets <ExternalLink className="ml-1.5 size-3.5" />
              </Button>
            </a>
          ) : (
            <Button variant="outline" onClick={handleDisconnect} disabled={disconnecting}>
              {disconnecting && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
              Desconectar
            </Button>
          )}
        </CardContent>
      </Card>

      {isConnected && (
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-foreground text-base">Hoja destino y eventos</CardTitle>
            <CardDescription>
              {hasSpreadsheet && cfg?.spreadsheet_name
                ? `Escribiendo en "${cfg.spreadsheet_name}"`
                : 'Elegí a qué hoja de cálculo escribir.'}
              {cfg?.last_write_at ? ` · última escritura ${new Date(cfg.last_write_at).toLocaleString()}` : ''}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="gs-spreadsheet">ID o URL del Google Sheet</Label>
              <Input
                id="gs-spreadsheet"
                value={spreadsheetInput}
                onChange={(e) => setSpreadsheetInput(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/…/edit"
              />
              <p className="text-muted-foreground text-xs">
                La cuenta de Google conectada debe poder abrir esta hoja.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="gs-tab">Pestaña base</Label>
              <Input id="gs-tab" value={sheetTab} onChange={(e) => setSheetTab(e.target.value)} placeholder="Ventas" />
              <p className="text-muted-foreground text-xs">
                Las cotizaciones van a &quot;{sheetTab || 'Ventas'} - Cotizaciones&quot;, los leads a &quot;… - Leads&quot;, etc.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Eventos que agregan una fila</Label>
              <div className="space-y-2">
                {sheetableEvents.map((ev) => (
                  <label key={ev} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={events.includes(ev)} onCheckedChange={() => toggleEvent(ev)} />
                    {EVENT_LABELS[ev] ?? ev}
                  </label>
                ))}
              </div>
            </div>

            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
              Guardar
            </Button>
          </CardContent>
        </Card>
      )}

      {isConnected && hasSpreadsheet && (
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-foreground text-base">Exportar ahora</CardTitle>
            <CardDescription>
              Vuelca la tabla completa (hasta 5000 filas) a una pestaña &quot;Export …&quot;, reemplazando lo que haya.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {EXPORT_ENTITIES.map((e) => (
              <Button
                key={e.key}
                variant="outline"
                size="sm"
                onClick={() => handleExport(e.key)}
                disabled={exportingEntity !== null}
              >
                {exportingEntity === e.key && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
                {e.label}
              </Button>
            ))}
          </CardContent>
        </Card>
      )}
    </section>
  );
}
