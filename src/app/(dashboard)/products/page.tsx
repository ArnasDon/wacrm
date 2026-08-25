'use client';

import { readResponseJson } from '@/lib/http/response-json';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useCan } from '@/hooks/use-can';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrency } from '@/lib/currency';
import type { Product, Quote } from '@/types';
import { GatedButton } from '@/components/ui/gated-button';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Package,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  FileText,
  Send,
  ShoppingBag,
  Upload,
  Download,
  LayoutGrid,
} from 'lucide-react';
import { ProductForm } from '@/components/products/product-form';
import { QuoteBuilder } from '@/components/products/quote-builder';
import { ProductsImportDialog } from '@/components/products/products-import-dialog';
import { CatalogDeliverySettings } from '@/components/products/catalog-delivery-settings';
import {
  downloadProductsExcel,
  toProductExportRow,
} from '@/lib/products/export-excel';

const STATUS_VARIANT: Record<string, string> = {
  draft: 'border-border bg-muted text-muted-foreground',
  sent: 'border-primary/40 bg-primary/10 text-primary',
  accepted: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500',
  rejected: 'border-red-500/40 bg-red-500/10 text-red-500',
  expired: 'border-amber-500/40 bg-amber-500/10 text-amber-500',
};

type QuoteWithContact = Omit<Quote, 'contact'> & {
  contact?: {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
  } | null;
};

export default function ProductsPage() {
  const t = useTranslations('Products.page');
  const canManage = useCan('manage-products');
  const { defaultCurrency } = useAuth();

  const [tab, setTab] = useState<'products' | 'quotes' | 'catalog'>('products');

  // Products
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // Quotes
  const [quotes, setQuotes] = useState<QuoteWithContact[]>([]);
  const [loadingQuotes, setLoadingQuotes] = useState(true);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [sendingQuoteId, setSendingQuoteId] = useState<string | null>(null);

  const fetchProducts = useCallback(async () => {
    setLoadingProducts(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      toast.error(t('toastFailedLoadProducts'));
    } else {
      setProducts((data as Product[]) ?? []);
    }
    setLoadingProducts(false);
  }, [t]);

  const fetchQuotes = useCallback(async () => {
    setLoadingQuotes(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from('quotes')
      .select('*, contact:contacts(id, name, phone, email)')
      .order('created_at', { ascending: false });
    if (error) {
      toast.error(t('toastFailedLoadQuotes'));
    } else {
      setQuotes((data as QuoteWithContact[]) ?? []);
    }
    setLoadingQuotes(false);
  }, [t]);

  useEffect(() => {
    fetchProducts();
    fetchQuotes();
  }, [fetchProducts, fetchQuotes]);

  function openAddForm() {
    setEditProduct(null);
    setFormOpen(true);
  }

  function openEditForm(product: Product) {
    setEditProduct(product);
    setFormOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const res = await fetch(`/api/products/${deleteTarget.id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      toast.error(t('toastFailedDeleteProduct'));
    } else {
      toast.success(t('toastDeletedProduct'));
      fetchProducts();
    }
    setDeleting(false);
    setDeleteTarget(null);
  }

  async function handleViewPdf(quote: QuoteWithContact) {
    let url = quote.pdf_url;
    if (!url) {
      const res = await fetch(`/api/quotes/${quote.id}/pdf`, {
        method: 'POST',
      });
      const data = await readResponseJson(res).catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t('toastFailedPdf'));
        return;
      }
      url = data.pdf_url;
      fetchQuotes();
    }
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function handleResend(quote: QuoteWithContact) {
    setSendingQuoteId(quote.id);
    try {
      const res = await fetch(`/api/quotes/${quote.id}/send`, {
        method: 'POST',
      });
      const data = await readResponseJson(res).catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t('toastFailedSend'));
        return;
      }
      toast.success(t('toastSentSuccess'));
      fetchQuotes();
    } finally {
      setSendingQuoteId(null);
    }
  }

  async function handleExport() {
    await downloadProductsExcel(products.map(toProductExportRow));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-foreground text-2xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
        </div>
        {tab === 'products' && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={products.length === 0}
              className="border-border text-foreground hover:bg-muted"
            >
              <Download className="size-4" />
              {t('exportBtn')}
            </Button>
            <GatedButton
              canAct={canManage}
              gateReason="manage the product catalog"
              onClick={() => setImportOpen(true)}
              variant="outline"
              className="border-border text-foreground hover:bg-muted"
            >
              <Upload className="size-4" />
              {t('importBtn')}
            </GatedButton>
            <GatedButton
              canAct={canManage}
              gateReason="manage the product catalog"
              onClick={openAddForm}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              <Plus className="size-4" />
              {t('addProductBtn')}
            </GatedButton>
          </div>
        )}
        {tab === 'quotes' && (
          <GatedButton
            canAct={canManage}
            gateReason="build quotes"
            onClick={() => setBuilderOpen(true)}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Plus className="size-4" />
            {t('addQuoteBtn')}
          </GatedButton>
        )}
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) =>
          setTab((v as 'products' | 'quotes' | 'catalog') ?? 'products')
        }
      >
        <TabsList>
          <TabsTrigger value="products">{t('productsTab')}</TabsTrigger>
          <TabsTrigger value="quotes">{t('quotesTab')}</TabsTrigger>
          <TabsTrigger value="catalog">
            <LayoutGrid className="mr-1.5 size-4" />
            {t('catalogTab')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="mt-4">
          <div className="border-border overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="w-14" />
                  <TableHead className="text-muted-foreground">
                    {t('tableColumns.name')}
                  </TableHead>
                  <TableHead className="text-muted-foreground">
                    {t('tableColumns.price')}
                  </TableHead>
                  <TableHead className="text-muted-foreground">
                    {t('tableColumns.status')}
                  </TableHead>
                  <TableHead className="text-muted-foreground w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingProducts ? (
                  <TableRow className="border-border">
                    <TableCell colSpan={5} className="py-12 text-center">
                      <Loader2 className="text-primary mx-auto size-6 animate-spin" />
                    </TableCell>
                  </TableRow>
                ) : products.length === 0 ? (
                  <TableRow className="border-border">
                    <TableCell colSpan={5} className="py-12 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <Package className="text-muted-foreground size-8" />
                        <p className="text-muted-foreground text-sm">
                          {t('noProductsYet')}
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  products.map((product) => (
                    <TableRow key={product.id} className="border-border">
                      <TableCell>
                        {product.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={product.image_url}
                            alt={product.name}
                            className="size-10 rounded-md object-cover"
                          />
                        ) : (
                          <div className="bg-muted flex size-10 items-center justify-center rounded-md">
                            <Package className="text-muted-foreground size-4" />
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-foreground font-medium">
                        {product.name}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatCurrency(product.price, defaultCurrency)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            product.is_active
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
                              : 'border-border bg-muted text-muted-foreground'
                          }
                        >
                          {product.is_active
                            ? t('statusActive')
                            : t('statusInactive')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => openEditForm(product)}
                            disabled={!canManage}
                          >
                            <Pencil className="text-muted-foreground size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setDeleteTarget(product)}
                            disabled={!canManage}
                          >
                            <Trash2 className="text-muted-foreground size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="quotes" className="mt-4">
          <div className="border-border overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-muted-foreground">
                    {t('tableColumns.customer')}
                  </TableHead>
                  <TableHead className="text-muted-foreground">
                    {t('tableColumns.total')}
                  </TableHead>
                  <TableHead className="text-muted-foreground">
                    {t('tableColumns.status')}
                  </TableHead>
                  <TableHead className="text-muted-foreground">
                    {t('tableColumns.date')}
                  </TableHead>
                  <TableHead className="text-muted-foreground w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingQuotes ? (
                  <TableRow className="border-border">
                    <TableCell colSpan={5} className="py-12 text-center">
                      <Loader2 className="text-primary mx-auto size-6 animate-spin" />
                    </TableCell>
                  </TableRow>
                ) : quotes.length === 0 ? (
                  <TableRow className="border-border">
                    <TableCell colSpan={5} className="py-12 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <ShoppingBag className="text-muted-foreground size-8" />
                        <p className="text-muted-foreground text-sm">
                          {t('noQuotesYet')}
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  quotes.map((quote) => (
                    <TableRow key={quote.id} className="border-border">
                      <TableCell className="text-foreground">
                        {quote.contact?.name ||
                          quote.contact?.phone ||
                          quote.customer_email ||
                          quote.customer_phone}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatCurrency(quote.total, quote.currency)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            STATUS_VARIANT[quote.status] ?? STATUS_VARIANT.draft
                          }
                        >
                          {t(`quoteStatus.${quote.status}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {new Date(quote.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleViewPdf(quote)}
                            title={t('viewPdf')}
                          >
                            <FileText className="text-muted-foreground size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleResend(quote)}
                            disabled={!canManage || sendingQuoteId === quote.id}
                            title={t('resend')}
                          >
                            {sendingQuoteId === quote.id ? (
                              <Loader2 className="text-muted-foreground size-4 animate-spin" />
                            ) : (
                              <Send className="text-muted-foreground size-4" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="catalog" className="mt-4">
          <CatalogDeliverySettings />
        </TabsContent>
      </Tabs>

      <ProductForm
        open={formOpen}
        onOpenChange={setFormOpen}
        product={editProduct}
        onSaved={fetchProducts}
      />

      <QuoteBuilder
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        contact={null}
        onSaved={fetchQuotes}
      />

      <ProductsImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={fetchProducts}
      />

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {t('deleteProductTitle')}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('deleteProductDesc', { name: deleteTarget?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              {t('deleteBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
