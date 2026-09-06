'use client';

import { readResponseJson } from '@/lib/http/response-json';

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
//
// Deliberately styled as a plain light storefront (hardcoded gray/white
// classes, not the dashboard's dark theme tokens) — this page is the
// company's public face, shown to customers who never see the admin
// UI, so it shouldn't inherit whatever dark/accent theme the account
// owner picked for their own dashboard. Single-brand catalog, so no
// search bar, filters, or category sidebar — every product shown here
// already belongs to this one company.
//
// Price options (migration 075): a product may carry up to 2 extra
// priced variants (e.g. a size/color that costs more), each optionally
// with its own installation cost and its own extra photos. A cart line
// is keyed by `${productId}::${optionId ?? ''}` (see `lineKey`) so the
// base price and each option are independent selections with their
// own quantity — picking "Talla XL" doesn't touch how many of the base
// product are already in the cart.
// ============================================================

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  Loader2,
  Minus,
  Plus,
  PackageX,
  MessageCircle,
  ShoppingCart,
  Search,
  ArrowRight,
  Leaf,
  Wrench,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatCurrency } from '@/lib/currency';
import { summarizeRates } from '@/lib/products/rates';

interface CatalogPriceOption {
  id: string;
  label: string;
  price: number;
  installation_cost: number | null;
  image_urls: string[];
}

interface CatalogRate {
  weekday_group: 'weekday' | 'weekend';
  occupancy: 'standard' | 'couple';
  price: number;
  date_from: string | null;
  date_to: string | null;
}

interface CatalogProduct {
  id: string;
  name: string;
  description: string | null;
  price: number;
  installation_cost: number | null;
  image_url: string | null;
  price_options: CatalogPriceOption[];
  /** Per-date room rates (hotel vertical). When present, the product is
   *  shown with a rate summary and is not add-to-cart — a stay needs
   *  dates + an availability check by a person. */
  rates: CatalogRate[];
  category: string | null;
}

interface CatalogData {
  account_name: string;
  currency: string;
  industry_vertical: string;
  whatsapp_number: string | null;
  categories: { id: string; name: string }[];
  products: CatalogProduct[];
}

/** A room (has per-date rates) is browse-only in the public catalog. */
function isRoom(p: CatalogProduct): boolean {
  return (p.rates?.length ?? 0) > 0;
}

/** Cart line identity: a product at its base price, or at one of its
 *  priced options — each tracked as an independent quantity. */
function lineKey(productId: string, optionId: string | null): string {
  return `${productId}::${optionId ?? ''}`;
}

function parseLineKey(key: string): {
  productId: string;
  optionId: string | null;
} {
  const [productId, optionId] = key.split('::');
  return { productId, optionId: optionId || null };
}

// `useSearchParams` (for the `?c=<conversationId>` param — see
// send-catalog.ts) opts this page out of static prerendering unless it
// sits under a Suspense boundary; without one the production build
// hits the "missing Suspense with CSR bailout" error. Mirrors the
// login/signup and settings-page split: a thin wrapper supplies the
// boundary, the inner component reads the query string.
export default function PublicCatalogPage() {
  return (
    <Suspense fallback={null}>
      <PublicCatalogPageInner />
    </Suspense>
  );
}

function PublicCatalogPageInner() {
  const params = useParams<{ accountId: string }>();
  const accountId = params?.accountId;
  const searchParams = useSearchParams();
  // The conversation this visitor's catalog link came from (see
  // sendCatalogToConversation) — handed straight back to quote-request
  // so it can deliver the quote onto the SAME channel/conversation the
  // customer is already chatting on, instead of guessing.
  const conversationId = searchParams.get('c');

  const [data, setData] = useState<CatalogData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [selectedProduct, setSelectedProduct] = useState<CatalogProduct | null>(
    null
  );
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [detailImageIndex, setDetailImageIndex] = useState(0);
  const [search, setSearch] = useState('');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [nit, setNit] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    delivered: boolean;
    whatsappUrl: string | null;
  } | null>(null);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/public/catalog/${encodeURIComponent(accountId)}`,
          {
            cache: 'no-store',
          }
        );
        if (!res.ok) {
          if (!cancelled) setLoadError(true);
          return;
        }
        const body = await readResponseJson<CatalogData>(res);
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

  const setQuantity = useCallback(
    (productId: string, optionId: string | null, qty: number) => {
      const key = lineKey(productId, optionId);
      setQuantities((prev) => {
        const next = { ...prev };
        if (qty <= 0) {
          delete next[key];
        } else {
          next[key] = qty;
        }
        return next;
      });
    },
    []
  );

  const selectedItems = useMemo(
    () =>
      Object.entries(quantities)
        .filter(([, qty]) => qty > 0)
        .map(([key, qty]) => {
          const { productId, optionId } = parseLineKey(key);
          const product = data?.products.find((p) => p.id === productId);
          if (!product) return null;
          const option = optionId
            ? (product.price_options.find((o) => o.id === optionId) ?? null)
            : null;
          return {
            product,
            option,
            quantity: qty,
            unitPrice: option ? option.price : product.price,
          };
        })
        .filter(
          (
            x
          ): x is {
            product: CatalogProduct;
            option: CatalogPriceOption | null;
            quantity: number;
            unitPrice: number;
          } => x !== null
        ),
    [quantities, data]
  );

  const total = useMemo(
    () =>
      selectedItems.reduce((sum, i) => {
        // Installation is a flat fee per selected line, not multiplied
        // by quantity — mirrors createQuote's server-side pricing. Comes
        // from the selected option when there is one, or the product's
        // own base installation_cost otherwise.
        const installation =
          (i.option
            ? i.option.installation_cost
            : i.product.installation_cost) ?? 0;
        return sum + i.unitPrice * i.quantity + installation;
      }, 0),
    [selectedItems]
  );
  const totalCount = selectedItems.reduce((sum, i) => sum + i.quantity, 0);
  const featuredProduct = data?.products.find((product) => product.image_url);
  const visibleProducts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('es');
    if (!query) return data?.products ?? [];
    return (data?.products ?? []).filter((product) =>
      `${product.name} ${product.description ?? ''}`
        .toLocaleLowerCase('es')
        .includes(query)
    );
  }, [data, search]);

  const selectedOption = selectedProduct
    ? (selectedProduct.price_options.find((o) => o.id === selectedOptionId) ??
      null)
    : null;
  const detailPrice = selectedOption
    ? selectedOption.price
    : selectedProduct?.price;
  const detailInstallationCost = selectedOption
    ? selectedOption.installation_cost
    : (selectedProduct?.installation_cost ?? null);
  const detailImages =
    selectedOption && selectedOption.image_urls.length > 0
      ? selectedOption.image_urls
      : selectedProduct?.image_url
        ? [selectedProduct.image_url]
        : [];
  const detailLineKey = selectedProduct
    ? lineKey(selectedProduct.id, selectedOptionId)
    : null;
  const detailQty = detailLineKey ? (quantities[detailLineKey] ?? 0) : 0;
  const selectedIsRoom = selectedProduct ? isRoom(selectedProduct) : false;

  async function handleSubmit() {
    if (!accountId) return;
    if (!name.trim() || !phone.trim()) {
      toast.error('Nombre y teléfono son requeridos');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/public/catalog/${encodeURIComponent(accountId)}/quote-request`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            phone: phone.trim(),
            nit: nit.trim() || undefined,
            email: email.trim() || undefined,
            address: address.trim() || undefined,
            items: selectedItems.map((i) => ({
              product_id: i.product.id,
              price_option_id: i.option?.id || undefined,
              quantity: i.quantity,
            })),
            conversation_id: conversationId || undefined,
          }),
        }
      );
      const payload = await readResponseJson<{
        error?: string;
        delivered?: boolean;
        whatsapp_url?: string | null;
      }>(res).catch(
        (): {
          error?: string;
          delivered?: boolean;
          whatsapp_url?: string | null;
        } => ({})
      );
      if (!res.ok) {
        toast.error(payload.error || 'No se pudo enviar la solicitud');
        setSubmitting(false);
        return;
      }
      setResult({
        delivered: !!payload.delivered,
        whatsappUrl: payload.whatsapp_url ?? null,
      });
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
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-gray-50 px-4 text-center">
        <PackageX className="size-10 text-gray-400" />
        <p className="text-lg font-medium text-gray-900">
          Catálogo no disponible
        </p>
        <p className="max-w-sm text-sm text-gray-500">
          Este enlace no es válido o la empresa aún no tiene un catálogo
          público.
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="size-6 animate-spin text-emerald-600" />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#f7f6f1] text-[#082f38]">
      <div className="bg-[#062f38] px-4 py-2 text-center text-[9px] font-semibold tracking-[0.14em] text-white uppercase sm:py-2.5 sm:text-xs sm:tracking-[0.2em]">
        Descubre nuestra selección · Solicita tu cotización en minutos
      </div>

      <header className="sticky top-0 z-20 border-b border-[#082f38]/10 bg-[#fffefa]/95 backdrop-blur-md">
        <div className="mx-auto grid max-w-7xl grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center gap-2 px-3 py-3 sm:grid-cols-[1fr_auto_1fr] sm:gap-3 sm:px-8 sm:py-4">
          <label className="relative hidden max-w-64 sm:block">
            <span className="sr-only">Buscar productos</span>
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[#082f38]/65" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar"
              className="h-10 w-full rounded-full bg-[#eef0ed] pr-4 pl-10 text-sm text-[#082f38] ring-[#1e7774] transition outline-none focus:ring-2"
            />
          </label>
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="col-start-2 min-w-0 text-center"
          >
            <span className="block truncate font-serif text-xl font-semibold tracking-tight sm:text-3xl">
              {data.account_name}
            </span>
            <span className="mt-0.5 block text-[9px] font-bold tracking-[0.28em] uppercase opacity-60">
              Catálogo
            </span>
          </button>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => totalCount > 0 && setDialogOpen(true)}
              className="relative flex size-10 items-center justify-center rounded-full transition hover:bg-[#eef0ed]"
              aria-label="Ver selección"
            >
              <ShoppingCart className="size-5" />
              {totalCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full bg-[#d48b55] text-[10px] font-bold text-white">
                  {totalCount}
                </span>
              )}
            </button>
          </div>
        </div>
        <nav className="app-scroll mx-auto flex max-w-7xl items-center justify-start gap-7 overflow-x-auto px-4 pb-3 text-[10px] font-bold tracking-[0.14em] whitespace-nowrap uppercase sm:justify-center sm:gap-8 sm:pb-4 sm:text-[11px] sm:tracking-[0.16em]">
          <a href="#productos" className="transition hover:text-[#1e7774]">
            Productos
          </a>
          <a href="#seleccion" className="transition hover:text-[#1e7774]">
            Tu selección
          </a>
          {data.whatsapp_number && (
            <a
              href={`https://wa.me/${data.whatsapp_number.replace(/\D/g, '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="transition hover:text-[#1e7774]"
            >
              Contacto
            </a>
          )}
        </nav>
        <div className="border-t border-[#082f38]/8 px-4 py-3 sm:hidden">
          <label className="relative mx-auto block max-w-lg">
            <span className="sr-only">Buscar productos</span>
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[#082f38]/65" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar productos"
              className="h-10 w-full rounded-full bg-[#eef0ed] pr-4 pl-10 text-sm ring-[#1e7774] outline-none focus:ring-2"
            />
          </label>
        </div>
      </header>

      {featuredProduct && (
        <section className="relative isolate min-h-[440px] overflow-hidden bg-[#d8ddd8] sm:min-h-[640px]">
          {/* eslint-disable-next-line @next/next/no-img-element -- product URLs come from account-configured Supabase storage. */}
          <img
            src={featuredProduct.image_url!}
            alt={featuredProduct.name}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-linear-to-r from-black/35 via-black/5 to-transparent" />
          <div className="relative mx-auto flex min-h-[440px] max-w-7xl items-end px-3 py-4 sm:min-h-[640px] sm:items-center sm:justify-end sm:px-8 sm:py-8">
            <div className="w-full max-w-lg rounded-2xl bg-[#fffefa]/95 p-5 shadow-2xl backdrop-blur-sm sm:rounded-none sm:p-12">
              <p className="mb-4 flex items-center gap-2 text-[11px] font-bold tracking-[0.2em] text-[#1e7774] uppercase">
                <Leaf className="size-4" /> Selección destacada
              </p>
              <h2 className="font-serif text-3xl leading-[0.98] font-medium tracking-tight text-[#062f38] sm:text-6xl">
                {featuredProduct.name}
              </h2>
              {featuredProduct.description && (
                <p className="mt-5 line-clamp-3 text-sm leading-6 text-[#284d53]/80 sm:text-base">
                  {featuredProduct.description}
                </p>
              )}
              <p className="mt-6 font-serif text-3xl text-[#062f38]">
                {formatCurrency(featuredProduct.price, data.currency)}
              </p>
              <button
                type="button"
                onClick={() => {
                  setSelectedOptionId(null);
                  setDetailImageIndex(0);
                  setSelectedProduct(featuredProduct);
                }}
                className="mt-5 inline-flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-[#062f38] px-6 text-xs font-bold tracking-[0.12em] text-white uppercase transition active:scale-[0.98] sm:mt-6 sm:w-auto sm:rounded-none sm:px-7 sm:hover:bg-[#1e7774]"
              >
                Ver producto <ArrowRight className="size-4" />
              </button>
            </div>
          </div>
        </section>
      )}

      <main
        id="productos"
        className="mx-auto max-w-7xl px-3 pt-10 pb-36 sm:px-8 sm:pt-20"
      >
        <div className="mb-10 text-center sm:mb-14">
          <p className="text-[11px] font-bold tracking-[0.22em] text-[#1e7774] uppercase">
            Nuestra colección
          </p>
          <h2 className="mt-3 font-serif text-4xl tracking-tight sm:text-5xl">
            Productos que te encantarán
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-[#284d53]/65">
            Elige tus favoritos, ajusta las cantidades y solicita una cotización
            personalizada.
          </p>
        </div>
        {data.products.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <PackageX className="size-10 text-gray-400" />
            <p className="text-sm text-gray-500">
              Todavía no hay productos publicados.
            </p>
          </div>
        ) : visibleProducts.length === 0 ? (
          <div className="py-16 text-center">
            <Search className="mx-auto size-8 text-[#082f38]/30" />
            <p className="mt-3 text-sm text-[#284d53]/65">
              No encontramos productos para “{search}”.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-x-3 gap-y-8 min-[390px]:grid-cols-2 sm:grid-cols-3 sm:gap-x-6 sm:gap-y-10 lg:grid-cols-4 lg:gap-x-8">
            {visibleProducts.map((product) => {
              const baseKey = lineKey(product.id, null);
              const qty = quantities[baseKey] ?? 0;
              return (
                <div key={product.id} className="group min-w-0">
                  {/* Opens the detail dialog — the quantity stepper below
                      is a sibling, not nested inside this button, so its
                      own clicks never bubble into "open detail". */}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedOptionId(null);
                      setDetailImageIndex(0);
                      setSelectedProduct(product);
                    }}
                    className="block w-full rounded-2xl text-left focus-visible:ring-2 focus-visible:ring-[#1e7774] focus-visible:outline-none sm:rounded-none"
                  >
                    <div className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl bg-[#e9ebe6] sm:rounded-none">
                      {product.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element -- matches the app's existing product-image convention (product-form.tsx), which also skips next/image to avoid a remote-domain allowlist for Supabase Storage URLs.
                        <img
                          src={product.image_url}
                          alt={product.name}
                          className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.025]"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center">
                          <ShoppingCart className="size-8 text-gray-300" />
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5 pt-4">
                      <h3 className="line-clamp-2 font-serif text-lg leading-tight text-[#062f38] sm:text-xl">
                        {product.name}
                      </h3>
                      {product.description && (
                        <p className="line-clamp-2 text-xs leading-5 text-[#284d53]/60 sm:text-sm">
                          {product.description}
                        </p>
                      )}
                      <p className="mt-1 text-sm font-semibold text-[#062f38] sm:text-base">
                        {isRoom(product)
                          ? summarizeRates(product.rates, (n) =>
                              formatCurrency(n, data.currency),
                            ) || formatCurrency(product.price, data.currency)
                          : product.price_options.length > 0
                            ? `Desde ${formatCurrency(Math.min(product.price, ...product.price_options.map((o) => o.price)), data.currency)}`
                            : formatCurrency(product.price, data.currency)}
                      </p>
                    </div>
                  </button>
                  <div className="pt-3">
                    {isRoom(product) ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedOptionId(null);
                          setDetailImageIndex(0);
                          setSelectedProduct(product);
                        }}
                        className="flex h-12 w-full items-center justify-center rounded-xl border border-[#082f38]/20 bg-[#fffefa] text-sm font-medium text-[#082f38] sm:h-10 sm:rounded-none"
                      >
                        Consultar disponibilidad
                      </button>
                    ) : (
                      <div className="flex h-12 items-center justify-between rounded-xl border border-[#082f38]/20 bg-[#fffefa] sm:h-10 sm:rounded-none">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="size-11 rounded-xl border-0 bg-transparent text-[#082f38] shadow-none active:bg-[#e7ebe5] sm:size-9 sm:rounded-none sm:hover:bg-[#e7ebe5]"
                          onClick={() =>
                            setQuantity(product.id, null, Math.max(0, qty - 1))
                          }
                          disabled={qty === 0}
                        >
                          <Minus className="size-3.5" />
                        </Button>
                        <span className="w-8 text-center text-sm font-semibold text-[#082f38]">
                          {qty}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="size-11 rounded-xl border-0 bg-transparent text-[#082f38] shadow-none active:bg-[#e7ebe5] sm:size-9 sm:rounded-none sm:hover:bg-[#e7ebe5]"
                          onClick={() => setQuantity(product.id, null, qty + 1)}
                        >
                          <Plus className="size-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <Dialog
        open={selectedProduct !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedProduct(null);
            setSelectedOptionId(null);
            setDetailImageIndex(0);
          }
        }}
      >
        <DialogContent className="inset-0 top-0 left-0 h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-none border-0 bg-[#fffefa] p-0 text-[#082f38] sm:top-1/2 sm:left-1/2 sm:h-auto sm:max-h-[94vh] sm:w-full sm:max-w-6xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl">
          {selectedProduct && (
            <div className="grid lg:min-h-[620px] lg:grid-cols-[1.08fr_0.92fr]">
              <div className="flex flex-col items-center justify-center gap-3 bg-[#e8e9e5] p-3 pt-12 sm:gap-4 sm:p-10 lg:min-h-[620px] lg:pt-10">
                <div className="relative aspect-[4/3] w-full max-w-xl overflow-hidden rounded-2xl bg-[#f1f1ee] sm:aspect-square sm:rounded-none">
                  {detailImages[detailImageIndex] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- see the catalog grid's own image above.
                    <img
                      src={detailImages[detailImageIndex]}
                      alt={selectedProduct.name}
                      className="h-full w-full object-contain transition duration-500 hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <ShoppingCart className="size-14 text-[#082f38]/20" />
                    </div>
                  )}
                  <span className="absolute top-4 left-4 bg-[#1e7774] px-4 py-2 text-[10px] font-bold tracking-[0.16em] text-white uppercase">
                    Catálogo
                  </span>
                </div>
                {detailImages.length > 1 && (
                  <div className="app-scroll flex w-full max-w-xl gap-2 overflow-x-auto pb-1">
                    {detailImages.map((url, i) => (
                      <button
                        key={url + i}
                        type="button"
                        onClick={() => setDetailImageIndex(i)}
                        className={`size-16 shrink-0 overflow-hidden rounded-xl border-2 ${detailImageIndex === i ? 'border-[#1e7774]' : 'border-transparent'}`}
                        aria-label={`Ver imagen ${i + 1}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-col p-5 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:p-10 lg:p-14">
                <p className="text-[10px] font-bold tracking-[0.2em] text-[#1e7774] uppercase">
                  {data.account_name} · Colección
                </p>
                <DialogHeader className="mt-4 text-left">
                  <DialogTitle className="font-serif text-3xl leading-none font-medium tracking-tight text-[#062f38] sm:text-5xl">
                    {selectedProduct.name}
                  </DialogTitle>
                  <DialogDescription className="sr-only">
                    Detalle de {selectedProduct.name}
                  </DialogDescription>
                </DialogHeader>

                {selectedIsRoom ? (
                  <div className="mt-6 space-y-1.5">
                    {selectedProduct.rates
                      .filter((r) => !r.date_from && !r.date_to)
                      .sort(
                        (a, b) =>
                          Number(a.occupancy === 'couple') - Number(b.occupancy === 'couple') ||
                          Number(a.weekday_group === 'weekend') -
                            Number(b.weekday_group === 'weekend'),
                      )
                      .map((r, i) => (
                        <div
                          key={i}
                          className="flex items-baseline justify-between gap-4 text-[#062f38]"
                        >
                          <span className="text-sm text-[#284d53]/75">
                            {(r.occupancy === 'couple' ? 'Pareja · ' : '') +
                              (r.weekday_group === 'weekend'
                                ? 'Vie–Dom'
                                : 'Lun–Jue')}
                          </span>
                          <span className="font-serif text-xl">
                            {formatCurrency(r.price, data.currency)}{' '}
                            <span className="text-xs text-[#284d53]/60">/ noche</span>
                          </span>
                        </div>
                      ))}
                    {selectedProduct.rates.some((r) => r.date_from && r.date_to) && (
                      <p className="pt-1 text-xs text-[#284d53]/60">
                        Aplican tarifas de temporada en ciertas fechas.
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    <p className="mt-6 font-serif text-3xl text-[#062f38]">
                      {formatCurrency(detailPrice ?? 0, data.currency)}
                    </p>
                    {detailInstallationCost ? (
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-[#284d53]/70">
                        <Wrench className="size-3.5" />+{' '}
                        {formatCurrency(detailInstallationCost, data.currency)} de
                        instalación
                      </p>
                    ) : null}
                  </>
                )}
                <div className="my-7 h-px bg-[#082f38]/12" />

                <p className="text-sm leading-7 whitespace-pre-wrap text-[#284d53]/75 sm:text-base">
                  {selectedProduct.description || 'Sin descripción disponible.'}
                </p>

                {selectedProduct.price_options.length > 0 && (
                  <div className="mt-8">
                    <p className="mb-3 text-[10px] font-bold tracking-[0.16em] uppercase">
                      Elige una opción
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedOptionId(null);
                          setDetailImageIndex(0);
                        }}
                        className={`min-h-11 rounded-xl border px-4 py-2 text-xs font-semibold transition sm:min-h-0 sm:rounded-none ${
                          selectedOptionId === null
                            ? 'border-[#062f38] bg-[#062f38] text-white'
                            : 'border-[#082f38]/25 text-[#082f38] hover:bg-[#e7ebe5]'
                        }`}
                      >
                        Precio base ·{' '}
                        {formatCurrency(selectedProduct.price, data.currency)}
                      </button>
                      {selectedProduct.price_options.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => {
                            setSelectedOptionId(option.id);
                            setDetailImageIndex(0);
                          }}
                          className={`min-h-11 rounded-xl border px-4 py-2 text-xs font-semibold transition sm:min-h-0 sm:rounded-none ${
                            selectedOptionId === option.id
                              ? 'border-[#062f38] bg-[#062f38] text-white'
                              : 'border-[#082f38]/25 text-[#082f38] hover:bg-[#e7ebe5]'
                          }`}
                        >
                          {option.label} ·{' '}
                          {formatCurrency(option.price, data.currency)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {selectedIsRoom ? (
                  <p className="mt-8 rounded-xl border border-[#082f38]/15 bg-[#f4f6f2] p-4 text-sm leading-6 text-[#284d53]/80 sm:rounded-none">
                    Para reservar, escríbenos con tus fechas de entrada y salida y
                    el número de personas — confirmamos disponibilidad y el precio
                    de tu estancia.
                  </p>
                ) : (
                  <>
                    <div className="mt-8">
                      <p className="mb-3 text-[10px] font-bold tracking-[0.16em] uppercase">
                        Cantidad
                      </p>
                      <div className="flex h-12 w-36 items-center justify-between border border-[#082f38]/25">
                        <button
                          type="button"
                          className="flex h-full w-12 items-center justify-center transition hover:bg-[#e7ebe5] disabled:opacity-30"
                          onClick={() =>
                            setQuantity(
                              selectedProduct.id,
                              selectedOptionId,
                              Math.max(0, detailQty - 1)
                            )
                          }
                          disabled={detailQty === 0}
                          aria-label="Reducir cantidad"
                        >
                          <Minus className="size-4" />
                        </button>
                        <span className="w-10 text-center text-sm font-semibold">
                          {detailQty}
                        </span>
                        <button
                          type="button"
                          className="flex h-full w-12 items-center justify-center transition hover:bg-[#e7ebe5]"
                          onClick={() =>
                            setQuantity(
                              selectedProduct.id,
                              selectedOptionId,
                              detailQty + 1
                            )
                          }
                          aria-label="Aumentar cantidad"
                        >
                          <Plus className="size-4" />
                        </button>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setQuantity(
                          selectedProduct.id,
                          selectedOptionId,
                          Math.max(1, detailQty + 1)
                        );
                        setSelectedProduct(null);
                        setSelectedOptionId(null);
                      }}
                      className="mt-8 flex h-14 w-full items-center justify-center gap-3 rounded-xl bg-[#062f38] px-6 text-xs font-bold tracking-[0.14em] text-white uppercase transition active:scale-[0.98] sm:rounded-none sm:hover:bg-[#1e7774]"
                    >
                      Agregar a mi selección <ShoppingCart className="size-4" />
                    </button>
                  </>
                )}

                <div className="mt-8 grid grid-cols-2 gap-3 border-t border-[#082f38]/12 pt-6 text-[10px] font-bold tracking-[0.12em] uppercase">
                  <span>✓ Cotización personalizada</span>
                  <span>✓ Atención por WhatsApp</span>
                </div>

                <div className="mt-auto pt-10">
                  <h3 className="border-b border-[#082f38]/15 pb-3 font-serif text-xl">
                    Descripción
                  </h3>
                  <p className="pt-4 text-sm leading-6 text-[#284d53]/70">
                    Consulta disponibilidad, acabados y opciones adicionales al
                    solicitar tu cotización.
                  </p>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {totalCount > 0 && (
        <div
          id="seleccion"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-[#082f38]/15 bg-[#fffefa]/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_30px_rgba(8,47,56,0.08)] backdrop-blur"
        >
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-8">
            <div>
              <p className="text-xs text-gray-500">
                {totalCount} {totalCount === 1 ? 'producto' : 'productos'}
              </p>
              <p className="text-base font-semibold text-gray-900">
                {formatCurrency(total, data.currency)}
              </p>
            </div>
            <Button
              onClick={() => setDialogOpen(true)}
              className="h-12 rounded-xl bg-[#062f38] px-6 text-xs font-bold tracking-[0.1em] text-white uppercase active:scale-[0.98] sm:h-11 sm:rounded-none sm:px-7 sm:hover:bg-[#1e7774]"
            >
              Me lo llevo
            </Button>
          </div>
        </div>
      )}

      {/* "Me lo llevo" data-capture dialog — restyled to the storefront's
          own palette/typography (was generic gray/white before), so the
          checkout step doesn't look like a different, unbranded app. */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => (open ? setDialogOpen(true) : resetDialog())}
      >
        <DialogContent className="inset-x-0 top-auto bottom-0 left-0 max-h-[92dvh] w-screen max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-t-3xl rounded-b-none border-0 bg-[#fffefa] p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-[#082f38] sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:p-4">
          {result === null ? (
            <>
              <DialogHeader>
                <DialogTitle className="font-serif text-2xl font-medium text-[#062f38]">
                  Me lo llevo
                </DialogTitle>
                <DialogDescription className="text-[#284d53]/70">
                  {totalCount}{' '}
                  {totalCount === 1
                    ? 'producto seleccionado'
                    : 'productos seleccionados'}{' '}
                  — {formatCurrency(total, data.currency)}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-bold tracking-[0.14em] text-[#082f38]/70 uppercase">
                    Nombre *
                  </Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                    className="rounded-none border-[#082f38]/25 bg-[#fffefa] text-[#082f38] focus-visible:ring-[#1e7774]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-bold tracking-[0.14em] text-[#082f38]/70 uppercase">
                    Teléfono *
                  </Label>
                  <Input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+502 5555 5555"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    className="rounded-none border-[#082f38]/25 bg-[#fffefa] text-[#082f38] focus-visible:ring-[#1e7774]"
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-bold tracking-[0.14em] text-[#082f38]/70 uppercase">
                      NIT (opcional)
                    </Label>
                    <Input
                      value={nit}
                      onChange={(e) => setNit(e.target.value)}
                      inputMode="numeric"
                      className="rounded-none border-[#082f38]/25 bg-[#fffefa] text-[#082f38] focus-visible:ring-[#1e7774]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-bold tracking-[0.14em] text-[#082f38]/70 uppercase">
                      Correo (opcional)
                    </Label>
                    <Input
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      className="rounded-none border-[#082f38]/25 bg-[#fffefa] text-[#082f38] focus-visible:ring-[#1e7774]"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-bold tracking-[0.14em] text-[#082f38]/70 uppercase">
                    Dirección (opcional)
                  </Label>
                  <Textarea
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    rows={2}
                    autoComplete="street-address"
                    className="rounded-none border-[#082f38]/25 bg-[#fffefa] text-[#082f38] focus-visible:ring-[#1e7774]"
                  />
                </div>
              </div>
              <DialogFooter className="bg-[#fffefa] *:min-h-11">
                <Button
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                  className="rounded-none border-[#082f38]/25 bg-transparent text-[#082f38] hover:bg-[#e7ebe5]"
                >
                  Cancelar
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="rounded-none bg-[#062f38] text-xs font-bold tracking-[0.1em] text-white uppercase hover:bg-[#1e7774]"
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
                <DialogTitle className="font-serif text-2xl font-medium text-[#062f38]">
                  ¡Listo!
                </DialogTitle>
                <DialogDescription className="text-[#284d53]/70">
                  {result.delivered
                    ? 'Ya te enviamos el PDF de tu cotización — revisa el chat donde nos escribiste.'
                    : result.whatsappUrl
                      ? 'Tu cotización fue creada. Continúa por WhatsApp para recibir el PDF.'
                      : 'Tu cotización fue creada. Pronto se pondrán en contacto contigo.'}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="bg-[#fffefa]">
                <Button
                  variant="outline"
                  onClick={resetDialog}
                  className="rounded-none border-[#082f38]/25 bg-transparent text-[#082f38] hover:bg-[#e7ebe5]"
                >
                  Cerrar
                </Button>
                {!result.delivered && result.whatsappUrl && (
                  <a
                    href={result.whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button className="gap-2 rounded-none bg-[#25D366] text-xs font-bold tracking-[0.1em] text-white uppercase hover:bg-[#1ebe5a]">
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
