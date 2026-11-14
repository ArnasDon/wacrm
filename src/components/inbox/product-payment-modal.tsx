'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import {
  CreditCard,
  ShoppingBag,
  DollarSign,
  Search,
  Check,
  Loader2,
  Tag,
} from 'lucide-react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Product } from '@/lib/commerce/types';
import type { Message } from '@/types';

interface ProductPaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  contactId?: string;
  onSuccess?: () => void;
  onNewMessage?: (msg: Message) => void;
}

export function ProductPaymentModal({
  open,
  onOpenChange,
  conversationId,
  contactId,
  onSuccess,
  onNewMessage,
}: ProductPaymentModalProps) {
  const [mode, setMode] = useState<'catalog' | 'custom'>('catalog');
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Custom Amount Form
  const [customTitle, setCustomTitle] = useState('');
  const [customAmount, setCustomAmount] = useState('');
  const [customCurrency, setCustomCurrency] = useState('INR');
  const [customDescription, setCustomDescription] = useState('');
  const [provider, setProvider] = useState<'razorpay' | 'stripe'>('razorpay');

  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (open) {
      setLoadingProducts(true);
      fetch('/api/products?active=true')
        .then((res) => res.json())
        .then((data) => {
          setProducts(data.products || []);
        })
        .catch(() => {
          toast.error('Could not load products');
        })
        .finally(() => {
          setLoadingProducts(false);
        });
    }
  }, [open]);

  const handleSendPayment = async (e: React.FormEvent) => {
    e.preventDefault();

    let title = '';
    let amount = 0;
    let currency = 'INR';
    let description = '';
    let productId: string | undefined = undefined;

    if (mode === 'catalog') {
      if (!selectedProduct) {
        toast.error('Please select a product from catalog');
        return;
      }
      title = selectedProduct.title;
      amount = selectedProduct.price;
      currency = selectedProduct.currency;
      description = selectedProduct.description || '';
      productId = selectedProduct.id;
    } else {
      if (!customTitle.trim()) {
        toast.error('Title is required');
        return;
      }
      const num = Number(customAmount);
      if (isNaN(num) || num <= 0) {
        toast.error('Enter a valid amount greater than 0');
        return;
      }
      title = customTitle.trim();
      amount = num;
      currency = customCurrency.trim().toUpperCase();
      description = customDescription.trim();
    }

    setGenerating(true);
    try {
      const res = await fetch('/api/payments/create-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          contactId,
          productId,
          title,
          amount,
          currency,
          description,
          provider,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create payment link');
      }

      if (data.message && onNewMessage) {
        onNewMessage(data.message as Message);
      }

      toast.success('Payment request sent to customer via WhatsApp');
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error creating payment link');
    } finally {
      setGenerating(false);
    }
  };

  const filteredProducts = products.filter((p) => {
    const q = search.toLowerCase();
    return (
      p.title.toLowerCase().includes(q) ||
      (p.sku && p.sku.toLowerCase().includes(q))
    );
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <CreditCard className="h-5 w-5" />
            </span>
            <div>
              <DialogTitle>Send Product & Payment Request</DialogTitle>
              <DialogDescription className="text-xs">
                Generate an instant checkout link and send it directly in this chat.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSendPayment} className="space-y-4 pt-1">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <Label className="text-xs font-semibold text-muted-foreground uppercase">
                Gateway:
              </Label>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant={provider === 'razorpay' ? 'default' : 'outline'}
                  onClick={() => setProvider('razorpay')}
                  className="h-7 text-xs px-2.5"
                >
                  Razorpay (UPI / INR)
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={provider === 'stripe' ? 'default' : 'outline'}
                  onClick={() => setProvider('stripe')}
                  className="h-7 text-xs px-2.5"
                >
                  Stripe (Cards / Global)
                </Button>
              </div>
            </div>
          </div>

          <Tabs value={mode} onValueChange={(v) => setMode(v as 'catalog' | 'custom')}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="catalog" className="flex items-center gap-1.5">
                <ShoppingBag className="h-4 w-4" /> From Catalog
              </TabsTrigger>
              <TabsTrigger value="custom" className="flex items-center gap-1.5">
                <DollarSign className="h-4 w-4" /> Custom Amount
              </TabsTrigger>
            </TabsList>

            {/* Catalog tab */}
            <TabsContent value="catalog" className="space-y-3 pt-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search products by title or SKU..."
                  className="h-8 pl-8 text-xs"
                />
              </div>

              <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                {loadingProducts ? (
                  <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading products...
                  </div>
                ) : filteredProducts.length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">
                    {search ? 'No matching products found.' : 'Catalog is empty. Switch to Custom Amount or add products in Products page.'}
                  </div>
                ) : (
                  filteredProducts.map((p) => {
                    const isSelected = selectedProduct?.id === p.id;
                    return (
                      <div
                        key={p.id}
                        onClick={() => setSelectedProduct(p)}
                        className={`cursor-pointer rounded-lg border p-3 transition-colors flex items-center justify-between ${
                          isSelected
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:bg-muted/50'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          {p.image_url ? (
                            <Image
                              src={p.image_url}
                              alt={p.title}
                              className="h-10 w-10 rounded object-cover border border-border"
                              width={40}
                              height={40}
                              sizes="40px"
                              unoptimized
                            />
                          ) : (
                            <div className="flex h-10 w-10 items-center justify-center rounded bg-muted text-muted-foreground">
                              <ShoppingBag className="h-5 w-5" />
                            </div>
                          )}
                          <div>
                            <div className="text-sm font-medium text-foreground">{p.title}</div>
                            {p.sku && (
                              <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                                <Tag className="h-3 w-3" /> {p.sku}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <span className="text-sm font-semibold text-foreground">
                            {p.currency} {Number(p.price).toLocaleString()}
                          </span>
                          <div
                            className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                              isSelected
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-muted-foreground/30'
                            }`}
                          >
                            {isSelected && <Check className="h-3 w-3" />}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </TabsContent>

            {/* Custom Amount Tab */}
            <TabsContent value="custom" className="space-y-3 pt-2">
              <div className="space-y-1.5">
                <Label htmlFor="custom-title" className="text-xs">
                  Item / Service Name *
                </Label>
                <Input
                  id="custom-title"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder="e.g. Consultation Retainer / Custom Order"
                  required={mode === 'custom'}
                  className="h-8 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="custom-amount" className="text-xs">
                    Amount *
                  </Label>
                  <Input
                    id="custom-amount"
                    type="number"
                    min="1"
                    step="0.01"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    placeholder="2500"
                    required={mode === 'custom'}
                    className="h-8 text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="custom-curr" className="text-xs">
                    Currency
                  </Label>
                  <Input
                    id="custom-curr"
                    value={customCurrency}
                    onChange={(e) => setCustomCurrency(e.target.value.toUpperCase())}
                    placeholder="INR"
                    maxLength={4}
                    required={mode === 'custom'}
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="custom-desc" className="text-xs">
                  Note / Description (Optional)
                </Label>
                <Textarea
                  id="custom-desc"
                  value={customDescription}
                  onChange={(e) => setCustomDescription(e.target.value)}
                  placeholder="Additional invoice notes for the customer..."
                  rows={2}
                  className="text-xs"
                />
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={generating}>
              {generating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Generate & Send Payment Request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
