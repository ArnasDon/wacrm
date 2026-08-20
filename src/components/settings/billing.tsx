'use client';

import { readResponseJson } from '@/lib/http/response-json';

// ============================================================
// Settings → Facturación
//
// Shows Angel's bank details (platform_settings, readable by any
// authenticated user — migration 056) and this account's own next
// payment due date, with a "Reportar pago" button (admin/owner only)
// that emails the payments inbox. Doesn't touch next_payment_due_at
// itself — Angel confirms and advances it from /admin.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Banknote, Loader2, Paperclip, Send, X } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface PlatformSettings {
  bank_name: string | null;
  account_number: string | null;
  account_type: string | null;
  account_holder: string | null;
}

const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const ALLOWED_RECEIPT_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export function BillingSettings() {
  const { accountId, canEditSettings } = useAuth();
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [nextDue, setNextDue] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reporting, setReporting] = useState(false);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        supabase
          .from('accounts')
          .select('next_payment_due_at')
          .eq('id', accountId)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      if (settingsRes.status === 'fulfilled')
        setSettings(settingsRes.value.data ?? null);
      if (accountRes.status === 'fulfilled') {
        setNextDue(
          (accountRes.value.data?.next_payment_due_at as string | null) ?? null
        );
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  function handleReceiptChange(file: File | null) {
    if (receiptPreview) URL.revokeObjectURL(receiptPreview);
    if (!file) {
      setReceipt(null);
      setReceiptPreview(null);
      return;
    }
    if (!ALLOWED_RECEIPT_TYPES.includes(file.type)) {
      toast.error('El comprobante debe ser una imagen (JPG, PNG o WEBP)');
      return;
    }
    if (file.size > MAX_RECEIPT_BYTES) {
      toast.error('La imagen del comprobante no puede superar 5 MB');
      return;
    }
    setReceipt(file);
    setReceiptPreview(URL.createObjectURL(file));
  }

  useEffect(() => {
    return () => {
      if (receiptPreview) URL.revokeObjectURL(receiptPreview);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleReport() {
    if (!receipt) {
      toast.error('Adjunta una foto del comprobante de depósito');
      return;
    }
    setReporting(true);
    try {
      const formData = new FormData();
      formData.append('receipt', receipt);
      const res = await fetch('/api/billing/report-payment', {
        method: 'POST',
        body: formData,
      });
      const payload = await readResponseJson<{ error?: string }>(res).catch(
        (): { error?: string } => ({})
      );
      if (!res.ok) {
        toast.error(payload.error || 'No se pudo enviar el reporte');
        return;
      }
      toast.success(
        'Pago reportado — te confirmaremos cuando quede registrado'
      );
      handleReceiptChange(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
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
        <Loader2 className="text-primary size-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Banknote className="text-primary size-4" />
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
            <div className="border-border bg-muted/50 space-y-1 rounded-lg border p-4 text-sm">
              <p className="text-foreground">
                <span className="text-muted-foreground">Banco: </span>
                {settings.bank_name || '—'}
              </p>
              <p className="text-foreground">
                <span className="text-muted-foreground">
                  Número de cuenta:{' '}
                </span>
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
            <p className="text-muted-foreground text-sm">
              Los datos bancarios todavía no están configurados.
            </p>
          )}

          {canEditSettings ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <p className="text-foreground text-sm font-medium">
                  Foto del comprobante de depósito
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) =>
                    handleReceiptChange(e.target.files?.[0] ?? null)
                  }
                />
                {receiptPreview ? (
                  <div className="border-border relative inline-flex overflow-hidden rounded-lg border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={receiptPreview}
                      alt="Comprobante de depósito"
                      className="max-h-40 w-auto object-contain"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        handleReceiptChange(null);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                      className="bg-background/80 text-foreground hover:bg-background absolute top-1 right-1 rounded-full p-1"
                      aria-label="Quitar comprobante"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip className="size-4" />
                    Adjuntar foto
                  </Button>
                )}
              </div>

              <Button
                onClick={handleReport}
                disabled={reporting || !receipt}
                className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
              >
                {reporting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                Reportar pago
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">
              Solo un administrador de la cuenta puede reportar un pago.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
