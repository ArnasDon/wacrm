'use client';

// ============================================================
// Settings → Facturación
//
// Shows Angel's bank details (platform_settings, readable by any
// authenticated user — migration 056) and this account's own next
// payment due date, with a "Reportar pago" button (admin/owner only)
// that emails pagosandia@gmail.com. Doesn't touch next_payment_due_at
// itself — Angel confirms and advances it from /admin.
// ============================================================

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Banknote, Loader2, Send } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface PlatformSettings {
  bank_name: string | null;
  account_number: string | null;
  account_type: string | null;
  account_holder: string | null;
}

export function BillingSettings() {
  const { accountId, canEditSettings } = useAuth();
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [nextDue, setNextDue] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reporting, setReporting] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      setLoading(true);
      const [settingsRes, accountRes] = await Promise.allSettled([
        supabase
          .from('platform_settings')
          .select('bank_name, account_number, account_type, account_holder')
          .eq('id', 1)
          .maybeSingle(),
        supabase.from('accounts').select('next_payment_due_at').eq('id', accountId).maybeSingle(),
      ]);
      if (cancelled) return;
      if (settingsRes.status === 'fulfilled') setSettings(settingsRes.value.data ?? null);
      if (accountRes.status === 'fulfilled') {
        setNextDue((accountRes.value.data?.next_payment_due_at as string | null) ?? null);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  async function handleReport() {
    setReporting(true);
    try {
      const res = await fetch('/api/billing/report-payment', { method: 'POST' });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(payload.error || 'No se pudo enviar el reporte');
        return;
      }
      toast.success('Pago reportado — te confirmaremos cuando quede registrado');
    } catch (err) {
      console.error('[billing] report-payment error:', err);
      toast.error('No se pudo conectar con el servidor');
    } finally {
      setReporting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Banknote className="size-4 text-primary" />
            Facturación
          </CardTitle>
          <CardDescription>
            {nextDue
              ? `Próximo pago: ${new Date(nextDue).toLocaleDateString('es-GT')}`
              : 'Todavía no tienes una fecha de pago asignada.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {settings ? (
            <div className="space-y-1 rounded-lg border border-border bg-muted/50 p-4 text-sm">
              <p className="text-foreground">
                <span className="text-muted-foreground">Banco: </span>
                {settings.bank_name || '—'}
              </p>
              <p className="text-foreground">
                <span className="text-muted-foreground">Número de cuenta: </span>
                {settings.account_number || '—'}
              </p>
              <p className="text-foreground">
                <span className="text-muted-foreground">Tipo de cuenta: </span>
                {settings.account_type || '—'}
              </p>
              <p className="text-foreground">
                <span className="text-muted-foreground">Titular: </span>
                {settings.account_holder || '—'}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Los datos bancarios todavía no están configurados.
            </p>
          )}

          {canEditSettings ? (
            <Button
              onClick={handleReport}
              disabled={reporting}
              className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {reporting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Reportar pago
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              Solo un administrador de la cuenta puede reportar un pago.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
