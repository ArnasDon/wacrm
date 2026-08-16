'use client';

// ============================================================
// /catalog/[accountId] — public, dynamic product catalog.
//
// No auth, not in middleware.protectedPaths. A company shares this
// link on WhatsApp/Instagram/Facebook; visitors pick products +
// quantities, enter name/phone, and tap "Me lo llevo". The server
// creates an exact-selection quote (see
// src/app/api/public/catalog/[accountId]/quote-request/route.ts) and
// either delivers its PDF straight into an already-open WhatsApp
// conversation (`delivered: true` — nothing left to do here) or, if no
// conversation is currently inside Meta's messaging window, hands back
// a wa.me link so the VISITOR starts the chat themselves and the PDF
// follows automatically once they do.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Minus, Plus, PackageX, MessageCircle, ShoppingCart } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatCurrency } from '@/lib/currency';

interface CatalogProduct {
  id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
}

interface CatalogData {
  account_name: string;
  currency: string;
  whatsapp_number: string | null;
  products: CatalogProduct[];
}

export default function PublicCatalogPage() {
  const params = useParams<{ accountId: string }>();
  const accountId = params?.accountId;

  const [data, setData] = useState<CatalogData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [nit, setNit] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ delivered: boolean; whatsappUrl: string | null } | null>(
    null,
  );

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/public/catalog/${encodeURIComponent(accountId)}`, {
          cache: 'no-store',
        });
        if (!res.ok) {
          if (!cancelled) setLoadError(true);
          return;
        }
        const body = (await res.json()) as CatalogData;
        if (!cancelled) setData(body);
      } catch (err) {
        console.error('[catalog] load error:', err);
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const setQuantity = useCallback((productId: string, qty: number) => {
    setQuantities((prev) => {
      const next = { ...prev };
      if (qty <= 0) {
        delete next[productId];
      } else {
        next[productId] = qty;
      }
      return next;
    });
  }, []);

  const selectedItems = useMemo(
    () =>
      Object.entries(quantities)
        .filter(([, qty]) => qty > 0)
        .map(([productId, qty]) => {
          const product = data?.products.find((p) => p.id === productId);
          return product ? { product, quantity: qty } : null;
        })
        .filter((x): x is { product: CatalogProduct; quantity: number } => x !== null),
    [quantities, data],
  );

  const total = useMemo(
    () => selectedItems.reduce((sum, i) => sum + i.product.price * i.quantity, 0),
    [selectedItems],
  );
  const totalCount = selectedItems.reduce((sum, i) => sum + i.quantity, 0);

  async function handleSubmit() {
    if (!accountId) return;
    if (!name.trim() || !phone.trim()) {
      toast.error('Nombre y teléfono son requeridos');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/catalog/${encodeURIComponent(accountId)}/quote-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          nit: nit.trim() || undefined,
          email: email.trim() || undefined,
          address: address.trim() || undefined,
          items: selectedItems.map((i) => ({ product_id: i.product.id, quantity: i.quantity })),
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        delivered?: boolean;
        whatsapp_url?: string | null;
      };
      if (!res.ok) {
        toast.error(payload.error || 'No se pudo enviar la solicitud');
        setSubmitting(false);
        return;
      }
      setResult({ delivered: !!payload.delivered, whatsappUrl: payload.whatsapp_url ?? null });
    } catch (err) {
      console.error('[catalog] quote-request error:', err);
      toast.error('No se pudo conectar con el servidor');
    } finally {
      setSubmitting(false);
    }
  }

  function resetDialog() {
    setDialogOpen(false);
    const hadResult = result !== null;
    setResult(null);
    setName('');
    setPhone('');
    setNit('');
    setEmail('');
    setAddress('');
    if (hadResult) {
      setQuantities({});
    }
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
        <PackageX className="size-10 text-muted-foreground" />
        <p className="text-lg font-medium text-foreground">Catálogo no disponible</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Este enlace no es válido o la empresa aún no tiene un catálogo público.
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 pb-32 pt-8">
      <header className="mb-8 text-center">
        <h1 className="text-2xl font-semibold text-foreground">{data.account_name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Catálogo de productos</p>
      </header>

      {data.products.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <PackageX className="size-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Todavía no hay productos publicados.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.products.map((product) => {
            const qty = quantities[product.id] ?? 0;
            return (
              <Card key={product.id} className="overflow-hidden border-border bg-card">
                <div className="relative aspect-square w-full bg-muted">
                  {product.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- matches the app's existing product-image convention (product-form.tsx), which also skips next/image to avoid a remote-domain allowlist for Supabase Storage URLs.
                    <img
                      src={product.image_url}
                      alt={product.name}
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <ShoppingCart className="size-8 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <CardContent className="flex flex-col gap-2 p-4">
                  <h3 className="line-clamp-1 font-medium text-foreground">{product.name}</h3>
                  {product.description && (
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {product.description}
                    </p>
                  )}
                  <p className="text-sm font-semibold text-primary">
                    {formatCurrency(product.price, data.currency)}
                  </p>
                  <div className="mt-1 flex items-center justify-between">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-8"
                      onClick={() => setQuantity(product.id, Math.max(0, qty - 1))}
                      disabled={qty === 0}
                    >
                      <Minus className="size-3.5" />
                    </Button>
                    <span className="w-8 text-center text-sm font-medium text-foreground">
                      {qty}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-8"
                      onClick={() => setQuantity(product.id, qty + 1)}
                    >
                      <Plus className="size-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {totalCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-card/95 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
            <div>
              <p className="text-xs text-muted-foreground">
                {totalCount} {totalCount === 1 ? 'producto' : 'productos'}
              </p>
              <p className="text-base font-semibold text-foreground">
                {formatCurrency(total, data.currency)}
              </p>
            </div>
            <Button onClick={() => setDialogOpen(true)} className="bg-primary text-primary-foreground hover:bg-primary/90">
              Me lo llevo
            </Button>
          </div>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => (open ? setDialogOpen(true) : resetDialog())}>
        <DialogContent className="bg-popover border-border sm:max-w-md">
          {result === null ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-popover-foreground">Me lo llevo</DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  {totalCount} {totalCount === 1 ? 'producto seleccionado' : 'productos seleccionados'} —{' '}
                  {formatCurrency(total, data.currency)}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">Nombre *</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="bg-muted border-border text-foreground"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">Teléfono *</Label>
                  <Input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+502 5555 5555"
                    className="bg-muted border-border text-foreground"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-muted-foreground">NIT (opcional)</Label>
                    <Input
                      value={nit}
                      onChange={(e) => setNit(e.target.value)}
                      className="bg-muted border-border text-foreground"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-muted-foreground">Correo (opcional)</Label>
                    <Input
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="bg-muted border-border text-foreground"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">Dirección (opcional)</Label>
                  <Textarea
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    rows={2}
                    className="bg-muted border-border text-foreground"
                  />
                </div>
              </div>
              <DialogFooter className="bg-popover border-border">
                <Button
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                  className="border-border text-popover-foreground hover:bg-muted"
                >
                  Cancelar
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Enviando…
                    </>
                  ) : (
                    'Enviar solicitud'
                  )}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="text-popover-foreground">¡Listo!</DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  {result.delivered
                    ? 'Ya te enviamos el PDF de tu cotización por WhatsApp — revisa el chat.'
                    : result.whatsappUrl
                      ? 'Tu cotización fue creada. Continúa por WhatsApp para recibir el PDF.'
                      : 'Tu cotización fue creada. Pronto se pondrán en contacto contigo.'}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="bg-popover border-border">
                <Button
                  variant="outline"
                  onClick={resetDialog}
                  className="border-border text-popover-foreground hover:bg-muted"
                >
                  Cerrar
                </Button>
                {!result.delivered && result.whatsappUrl && (
                  <a href={result.whatsappUrl} target="_blank" rel="noopener noreferrer">
                    <Button className="gap-2 bg-[#25D366] text-white hover:bg-[#1ebe5a]">
                      <MessageCircle className="size-4" />
                      Continuar por WhatsApp
                    </Button>
                  </a>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
