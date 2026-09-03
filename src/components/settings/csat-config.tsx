'use client';

// Self-contained Spanish strings, like google-sheets-config.tsx — this
// feature doesn't add a Settings.csat block to the locale files.

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Star } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { readResponseJson } from '@/lib/http/response-json';
import type { MessageTemplate } from '@/types';
import {
  CSAT_COOLDOWN_MAX_DAYS,
  CSAT_DELAY_MAX_MINUTES,
} from '@/lib/csat/config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';

const SELECT_CLASS =
  'border-border bg-muted text-foreground focus:border-primary rounded-md border px-2 py-1.5 text-sm focus:outline-none';

type Unit = 'minutes' | 'hours' | 'days';

function toDisplay(minutes: number): { value: number; unit: Unit } {
  if (minutes % 1440 === 0 && minutes >= 1440) return { value: minutes / 1440, unit: 'days' };
  if (minutes % 60 === 0 && minutes >= 60) return { value: minutes / 60, unit: 'hours' };
  return { value: minutes, unit: 'minutes' };
}
function toMinutes(value: number, unit: Unit): number {
  const v = Math.max(0, Math.floor(value || 0));
  const mins = unit === 'days' ? v * 1440 : unit === 'hours' ? v * 60 : v;
  return Math.min(CSAT_DELAY_MAX_MINUTES, Math.max(0, mins));
}

interface CsatState {
  enabled: boolean;
  template_name: string | null;
  template_language: string | null;
  scale: 3 | 5;
  delay_minutes: number;
  cooldown_days: number;
}

const DEFAULTS: CsatState = {
  enabled: false,
  template_name: null,
  template_language: null,
  scale: 5,
  delay_minutes: 1440,
  cooldown_days: 30,
};

export function CsatConfig() {
  const { canEditSettings } = useAuth();
  const [state, setState] = useState<CsatState>(DEFAULTS);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cfgRes, tplRes] = await Promise.all([
          fetch('/api/csat/config'),
          createClient()
            .from('message_templates')
            .select('*')
            .eq('status', 'APPROVED')
            .order('name', { ascending: true }),
        ]);
        if (cancelled) return;
        const cfg = await readResponseJson(cfgRes).catch(() => null);
        if (cfg && typeof cfg === 'object') {
          setState({
            enabled: !!cfg.enabled,
            template_name: cfg.template_name ?? null,
            template_language: cfg.template_language ?? null,
            scale: cfg.scale === 3 ? 3 : 5,
            delay_minutes:
              typeof cfg.delay_minutes === 'number' ? cfg.delay_minutes : 1440,
            cooldown_days:
              typeof cfg.cooldown_days === 'number' ? cfg.cooldown_days : 30,
          });
        }
        setTemplates((tplRes.data as MessageTemplate[]) ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const patch = (p: Partial<CsatState>) => setState((s) => ({ ...s, ...p }));

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/csat/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      });
      const data = await readResponseJson(res).catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || 'No se pudo guardar la configuración.');
        return;
      }
      toast.success('Configuración de CSAT guardada.');
    } catch {
      toast.error('No se pudo guardar la configuración.');
    } finally {
      setSaving(false);
    }
  }, [state]);

  const disabled = !canEditSettings || loading || saving;
  const rowDisabled = disabled || !state.enabled;
  const delay = toDisplay(state.delay_minutes);

  return (
    <section className="animate-in fade-in-50 max-w-2xl duration-200">
      <SettingsPanelHead
        title="Satisfacción del cliente (CSAT)"
        description="Cuando se marca un negocio como ganado, SANDÍA envía al cliente una encuesta corta por WhatsApp (una plantilla con botones de calificación). La respuesta queda registrada por contacto y alimenta los KPIs, Google Sheets y los webhooks."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Star className="text-primary h-4 w-4" /> Encuesta post-venta
          </CardTitle>
          <CardDescription>
            Requiere una plantilla de WhatsApp aprobada con botones de respuesta
            rápida numerados (por ejemplo 1 a 5).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="border-border flex items-center justify-between gap-4 rounded-md border p-3">
            <div>
              <p className="text-foreground text-sm font-medium">Activar la encuesta</p>
              <p className="text-muted-foreground text-xs">
                Se envía una sola vez por negocio ganado.
              </p>
            </div>
            <Switch
              checked={state.enabled}
              onCheckedChange={(v) => patch({ enabled: v })}
              disabled={disabled}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="csat-template">Plantilla</Label>
            <select
              id="csat-template"
              value={state.template_name ?? ''}
              onChange={(e) => {
                const tpl = templates.find((x) => x.name === e.target.value);
                patch({
                  template_name: e.target.value || null,
                  template_language: tpl?.language ?? null,
                });
              }}
              disabled={rowDisabled || templates.length === 0}
              className={`${SELECT_CLASS} w-full`}
            >
              <option value="">Elige una plantilla…</option>
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.name}>
                  {tpl.name}
                  {tpl.language ? ` (${tpl.language})` : ''}
                </option>
              ))}
            </select>
            {templates.length === 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-500">
                No hay plantillas aprobadas todavía. Crea una en Configuración →
                Plantillas.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="csat-scale">Escala de calificación</Label>
            <select
              id="csat-scale"
              value={state.scale}
              onChange={(e) => patch({ scale: e.target.value === '3' ? 3 : 5 })}
              disabled={rowDisabled}
              className={SELECT_CLASS}
            >
              <option value={5}>1 a 5</option>
              <option value={3}>1 a 3</option>
            </select>
            <p className="text-muted-foreground text-xs">
              Debe coincidir con la cantidad de botones de tu plantilla.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Enviar después de</Label>
            <div className="flex items-center gap-2 text-sm">
              <Input
                type="number"
                min={0}
                value={delay.value}
                onChange={(e) =>
                  patch({
                    delay_minutes: toMinutes(Number(e.target.value), delay.unit),
                  })
                }
                disabled={rowDisabled}
                className="w-20"
              />
              <select
                value={delay.unit}
                onChange={(e) =>
                  patch({
                    delay_minutes: toMinutes(delay.value, e.target.value as Unit),
                  })
                }
                disabled={rowDisabled}
                className={SELECT_CLASS}
              >
                <option value="minutes">minutos</option>
                <option value="hours">horas</option>
                <option value="days">días</option>
              </select>
              <span className="text-muted-foreground">de marcar el negocio como ganado</span>
            </div>
            <p className="text-muted-foreground text-xs">
              0 = enviar de inmediato. Máximo 14 días.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="csat-cooldown">No volver a encuestar al mismo cliente en</Label>
            <div className="flex items-center gap-2 text-sm">
              <Input
                id="csat-cooldown"
                type="number"
                min={0}
                max={CSAT_COOLDOWN_MAX_DAYS}
                value={state.cooldown_days}
                onChange={(e) =>
                  patch({
                    cooldown_days: Math.min(
                      CSAT_COOLDOWN_MAX_DAYS,
                      Math.max(0, Math.floor(Number(e.target.value) || 0)),
                    ),
                  })
                }
                disabled={rowDisabled}
                className="w-20"
              />
              <span className="text-muted-foreground">días</span>
            </div>
          </div>

          {canEditSettings && (
            <Button onClick={handleSave} disabled={disabled}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              Guardar
            </Button>
          )}
          {!canEditSettings && (
            <p className="text-muted-foreground text-xs">
              Solo los administradores pueden cambiar esta configuración.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
