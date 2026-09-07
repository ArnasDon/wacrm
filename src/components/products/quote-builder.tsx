'use client';

import { readResponseJson } from '@/lib/http/response-json';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { formatCurrency } from '@/lib/currency';
import { useAuth } from '@/hooks/use-auth';
import { nightsBetween, quoteStay } from '@/lib/products/rates';
import type { Contact, Product } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Plus, Trash2, Search } from 'lucide-react';

interface LineItem {
  key: string;
  product_id: string | null;
  description: string;
  unit_price: number;
  quantity: number;
}

interface QuoteBuilderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selected contact (opened from the inbox contact sidebar). Null
   *  shows a contact search step first. */
  contact?: Contact | null;
  /** Current conversation, if opened from an active chat — lets "save
   *  and send" target it directly instead of resolving one server-side. */
  conversationId?: string | null;
  onSaved: () => void;
}

export function QuoteBuilder({
  open,
  onOpenChange,
  contact,
  conversationId,
  onSaved,
}: QuoteBuilderProps) {
  const t = useTranslations('Products.quoteBuilder');
  const { defaultCurrency, account } = useAuth();
  const isHotel = account?.industry_vertical === 'hotel';

  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [contactSearch, setContactSearch] = useState('');
  const [contactResults, setContactResults] = useState<Contact[]>([]);
  const [searchingContacts, setSearchingContacts] = useState(false);

  const [products, setProducts] = useState<Product[]>([]);
  const [items, setItems] = useState<LineItem[]>([]);
  const [pickProductId, setPickProductId] = useState('');
  const [pickQuantity, setPickQuantity] = useState('1');
  // Hotel vertical: a room line prices per night from product_rates.
  const [stayCheckIn, setStayCheckIn] = useState('');
  const [stayCheckOut, setStayCheckOut] = useState('');
  const [stayOccupancy, setStayOccupancy] = useState<'standard' | 'couple' | 'group'>(
    'standard',
  );
  const [freeDescription, setFreeDescription] = useState('');
  const [freePrice, setFreePrice] = useState('');
  const [freeQuantity, setFreeQuantity] = useState('1');

  const [customerNit, setCustomerNit] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [saving, setSaving] = useState<'draft' | 'send' | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedContact(contact ?? null);
    setContactSearch('');
    setContactResults([]);
    setItems([]);
    setPickProductId('');
    setPickQuantity('1');
    setFreeDescription('');
    setFreePrice('');
    setFreeQuantity('1');
    setCustomerNit('');
    setCustomerEmail(contact?.email ?? '');
    setCustomerPhone(contact?.phone ?? '');
    setCustomerAddress('');

    setStayCheckIn('');
    setStayCheckOut('');
    setStayOccupancy('standard');

    // Via the API so each product carries its `rates` (migration 106).
    fetch('/api/products', { cache: 'no-store' })
      .then((res) => (res.ok ? readResponseJson<{ products?: Product[] }>(res) : { products: [] }))
      .then((data) =>
        setProducts((data.products ?? []).filter((p) => p.is_active)),
      )
      .catch(() => setProducts([]));
  }, [open, contact]);

  const searchContacts = useCallback(async (term: string) => {
    if (!term.trim()) {
      setContactResults([]);
      return;
    }
    setSearchingContacts(true);
    const supabase = createClient();
    const like = `%${term.trim()}%`;
    const { data } = await supabase
      .from('contacts')
      .select('*')
      .or(`name.ilike.${like},phone.ilike.${like},email.ilike.${like}`)
      .limit(10);
    setContactResults((data as Contact[]) ?? []);
    setSearchingContacts(false);
  }, []);

  const pickedProduct = products.find((p) => p.id === pickProductId) ?? null;
  const pickedIsRoom = isHotel && (pickedProduct?.rates?.length ?? 0) > 0;

  function addCatalogItem() {
    const product = products.find((p) => p.id === pickProductId);
    if (!product) return;

    // Hotel room: price the stay night-by-night from product_rates and
    // add it as one line (the server prices free-form lines by the
    // unit_price we send; a product line would use products.price).
    if (isHotel && (product.rates?.length ?? 0) > 0) {
      if (!stayCheckIn || !stayCheckOut) {
        toast.error(t('toastStayDatesRequired'));
        return;
      }
      const nights = nightsBetween(stayCheckIn, stayCheckOut);
      if (nights.length === 0) {
        toast.error(t('toastStayDatesOrder'));
        return;
      }
      const stay = quoteStay(
        (product.rates ?? []).map((r) => ({
          day_of_week: r.day_of_week,
          occupancy: r.occupancy,
          price: r.price,
          date_from: r.date_from,
          date_to: r.date_to,
        })),
        stayCheckIn,
        stayCheckOut,
        stayOccupancy,
      );
      if (stay.missing.length > 0) {
        toast.error(t('toastStayMissingRate', { dates: stay.missing.join(', ') }));
        return;
      }
      const occLabel =
        stayOccupancy === 'couple'
          ? t('stayCouple')
          : stayOccupancy === 'group'
            ? t('stayGroup')
            : t('stayStandard');
      setItems((prev) => [
        ...prev,
        {
          key: crypto.randomUUID(),
          product_id: null,
          description: `${product.name} · ${nights.length} ${t('stayNights')} (${stayCheckIn} → ${stayCheckOut}) · ${occLabel}`,
          unit_price: stay.total,
          quantity: 1,
        },
      ]);
      setPickProductId('');
      setStayCheckIn('');
      setStayCheckOut('');
      setStayOccupancy('standard');
      return;
    }

    const quantity = Number(pickQuantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast.error(t('toastQuantityInvalid'));
      return;
    }
    setItems((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        product_id: product.id,
        description: product.name,
        unit_price: product.price,
        quantity,
      },
    ]);
    setPickProductId('');
    setPickQuantity('1');
  }

  function addFreeItem() {
    const description = freeDescription.trim();
    const price = Number(freePrice);
    const quantity = Number(freeQuantity);
    if (!description) {
      toast.error(t('toastDescriptionRequired'));
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      toast.error(t('toastPriceInvalid'));
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast.error(t('toastQuantityInvalid'));
      return;
    }
    setItems((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        product_id: null,
        description,
        unit_price: price,
        quantity,
      },
    ]);
    setFreeDescription('');
    setFreePrice('');
    setFreeQuantity('1');
  }

  function removeItem(key: string) {
    setItems((prev) => prev.filter((i) => i.key !== key));
  }

  const total = useMemo(
    () => items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0),
    [items]
  );

  async function handleSave(mode: 'draft' | 'send') {
    if (!selectedContact) {
      toast.error(t('toastContactRequired'));
      return;
    }
    if (items.length === 0) {
      toast.error(t('toastItemsRequired'));
      return;
    }
    // NIT/email are optional (migration 082) — each company decides for
    // itself whether it wants to collect them; only phone and address
    // are needed to actually deliver a quote.
    if (!customerPhone.trim() || !customerAddress.trim()) {
      toast.error(t('toastCustomerFieldsRequired'));
      return;
    }

    setSaving(mode);
    try {
      const res = await fetch('/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: selectedContact.id,
          customer_nit: customerNit.trim() || undefined,
          customer_email: customerEmail.trim() || undefined,
          customer_phone: customerPhone.trim(),
          customer_address: customerAddress.trim(),
          items: items.map((i) => ({
            product_id: i.product_id ?? undefined,
            quantity: i.quantity,
            description: i.product_id ? undefined : i.description,
            unit_price: i.product_id ? undefined : i.unit_price,
          })),
        }),
      });
      const data = await readResponseJson(res).catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t('toastSaveFailed'));
        return;
      }
      const quoteId = data.quote.id as string;

      if (mode === 'send') {
        const sendRes = await fetch(`/api/quotes/${quoteId}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            conversationId ? { conversation_id: conversationId } : {}
          ),
        });
        const sendData = await readResponseJson(sendRes).catch(() => ({}));
        if (!sendRes.ok) {
          toast.error(sendData.error ?? t('toastSendFailed'));
          onOpenChange(false);
          onSaved();
          return;
        }
        toast.success(t('toastSentSuccess'));
      } else {
        toast.success(t('toastSavedSuccess'));
      }
      onOpenChange(false);
      onSaved();
    } finally {
      setSaving(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border text-popover-foreground max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {t('title')}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t('description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Contact */}
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">{t('contactLabel')}</Label>
            {selectedContact ? (
              <div className="border-border bg-muted flex items-center justify-between rounded-md border px-3 py-2">
                <span className="text-foreground text-sm">
                  {selectedContact.name ||
                    selectedContact.phone ||
                    selectedContact.email}
                </span>
                {!contact && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedContact(null)}
                  >
                    {t('changeContact')}
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
                  <Input
                    value={contactSearch}
                    onChange={(e) => {
                      setContactSearch(e.target.value);
                      void searchContacts(e.target.value);
                    }}
                    placeholder={t('contactSearchPlaceholder')}
                    className="bg-muted border-border text-foreground pl-8"
                  />
                </div>
                {searchingContacts && (
                  <Loader2 className="text-muted-foreground size-4 animate-spin" />
                )}
                {contactResults.length > 0 && (
                  <div className="border-border max-h-40 overflow-y-auto rounded-md border">
                    {contactResults.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setSelectedContact(c);
                          setCustomerEmail(c.email ?? '');
                          setCustomerPhone(c.phone ?? '');
                        }}
                        className="text-foreground hover:bg-muted flex w-full items-center justify-between px-3 py-2 text-left text-sm"
                      >
                        <span>{c.name || c.phone || c.email}</span>
                        <span className="text-muted-foreground text-xs">
                          {c.phone}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Items */}
          <div className="space-y-2">
            <Label className="text-muted-foreground">{t('itemsLabel')}</Label>

            {items.length > 0 && (
              <div className="border-border space-y-1 rounded-md border p-2">
                {items.map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span className="text-foreground flex-1 truncate">
                      {item.description} × {item.quantity}
                    </span>
                    <span className="text-muted-foreground">
                      {formatCurrency(
                        item.unit_price * item.quantity,
                        defaultCurrency
                      )}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => removeItem(item.key)}
                    >
                      <Trash2 className="text-muted-foreground size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <Label className="text-muted-foreground text-xs">
                  {t('productLabel')}
                </Label>
                <Select
                  value={pickProductId}
                  onValueChange={(v) => setPickProductId(v ?? '')}
                  items={Object.fromEntries(
                    products.map((p) => [
                      p.id,
                      `${p.name} — ${formatCurrency(p.price, defaultCurrency)}`,
                    ])
                  )}
                >
                  <SelectTrigger className="bg-muted border-border">
                    <SelectValue placeholder={t('productPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {products.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} — {formatCurrency(p.price, defaultCurrency)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {!pickedIsRoom && (
                <div className="w-20 space-y-1">
                  <Label className="text-muted-foreground text-xs">
                    {t('quantityLabel')}
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    value={pickQuantity}
                    onChange={(e) => setPickQuantity(e.target.value)}
                    className="bg-muted border-border text-foreground"
                  />
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={addCatalogItem}
                disabled={!pickProductId}
                className="border-border"
              >
                <Plus className="size-4" />
              </Button>
            </div>

            {pickedIsRoom && (
              <div className="border-border grid grid-cols-3 gap-2 rounded-md border p-2">
                <div className="space-y-1">
                  <Label className="text-muted-foreground text-xs">
                    {t('stayCheckIn')}
                  </Label>
                  <Input
                    type="date"
                    value={stayCheckIn}
                    onChange={(e) => setStayCheckIn(e.target.value)}
                    className="bg-muted border-border text-foreground"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-muted-foreground text-xs">
                    {t('stayCheckOut')}
                  </Label>
                  <Input
                    type="date"
                    value={stayCheckOut}
                    onChange={(e) => setStayCheckOut(e.target.value)}
                    className="bg-muted border-border text-foreground"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-muted-foreground text-xs">
                    {t('stayOccupancy')}
                  </Label>
                  <select
                    value={stayOccupancy}
                    onChange={(e) => {
                      const v = e.target.value;
                      setStayOccupancy(
                        v === 'couple' || v === 'group' ? v : 'standard',
                      );
                    }}
                    className="border-border bg-muted text-foreground h-9 w-full rounded-md border px-2 text-sm"
                  >
                    <option value="standard">{t('stayStandard')}</option>
                    <option value="couple">{t('stayCouple')}</option>
                    <option value="group">{t('stayGroup')}</option>
                  </select>
                </div>
                {stayCheckIn && stayCheckOut && nightsBetween(stayCheckIn, stayCheckOut).length > 0 && (
                  <p className="text-muted-foreground col-span-3 text-xs">
                    {(() => {
                      const stay = quoteStay(
                        (pickedProduct?.rates ?? []).map((r) => ({
                          day_of_week: r.day_of_week,
                          occupancy: r.occupancy,
                          price: r.price,
                          date_from: r.date_from,
                          date_to: r.date_to,
                        })),
                        stayCheckIn,
                        stayCheckOut,
                        stayOccupancy,
                      );
                      return stay.missing.length > 0
                        ? t('toastStayMissingRate', { dates: stay.missing.join(', ') })
                        : `${nightsBetween(stayCheckIn, stayCheckOut).length} ${t('stayNights')} · ${formatCurrency(stay.total, defaultCurrency)}`;
                    })()}
                  </p>
                )}
              </div>
            )}

            {/* Free item — human only, never available to the AI's create_quote action */}
            <details className="border-border rounded-md border p-2">
              <summary className="text-muted-foreground cursor-pointer text-xs">
                {t('freeItemToggle')}
              </summary>
              <div className="mt-2 flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <Label className="text-muted-foreground text-xs">
                    {t('freeDescriptionLabel')}
                  </Label>
                  <Input
                    value={freeDescription}
                    onChange={(e) => setFreeDescription(e.target.value)}
                    className="bg-muted border-border text-foreground"
                  />
                </div>
                <div className="w-24 space-y-1">
                  <Label className="text-muted-foreground text-xs">
                    {t('freePriceLabel')}
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={freePrice}
                    onChange={(e) => setFreePrice(e.target.value)}
                    className="bg-muted border-border text-foreground"
                  />
                </div>
                <div className="w-16 space-y-1">
                  <Label className="text-muted-foreground text-xs">
                    {t('quantityLabel')}
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    value={freeQuantity}
                    onChange={(e) => setFreeQuantity(e.target.value)}
                    className="bg-muted border-border text-foreground"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={addFreeItem}
                  className="border-border"
                >
                  <Plus className="size-4" />
                </Button>
              </div>
            </details>

            <div className="text-foreground flex justify-end text-sm font-medium">
              {t('totalLabel')}: {formatCurrency(total, defaultCurrency)}
            </div>
          </div>

          {/* Customer info */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">{t('nitLabel')}</Label>
              <Input
                value={customerNit}
                onChange={(e) => setCustomerNit(e.target.value)}
                className="bg-muted border-border text-foreground"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">{t('emailLabel')}</Label>
              <Input
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                className="bg-muted border-border text-foreground"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">{t('phoneLabel')}</Label>
              <Input
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                className="bg-muted border-border text-foreground"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">
                {t('addressLabel')}
              </Label>
              <Input
                value={customerAddress}
                onChange={(e) => setCustomerAddress(e.target.value)}
                className="bg-muted border-border text-foreground"
              />
            </div>
          </div>
        </div>

        <DialogFooter className="bg-popover border-border">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {t('cancel')}
          </Button>
          <Button
            variant="outline"
            onClick={() => handleSave('draft')}
            disabled={saving !== null}
            className="border-border"
          >
            {saving === 'draft' && <Loader2 className="size-4 animate-spin" />}
            {t('saveDraft')}
          </Button>
          <Button
            onClick={() => handleSave('send')}
            disabled={saving !== null}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {saving === 'send' && <Loader2 className="size-4 animate-spin" />}
            {t('saveAndSend')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
