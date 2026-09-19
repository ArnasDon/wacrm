"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Archive, Boxes, Minus, Pencil, Plus, Search } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { EmptyState, Field, Money, PageHeader, inputCls, textareaCls } from "@/components/sales/kit";
import { ProductPhotos, type ProductImage } from "@/components/sales/product-photos";
import { thumbUrl } from "@/lib/media/urls";

interface Product {
  _id: string;
  name: string;
  sku: string | null;
  description: string | null;
  category: string | null;
  unit: string;
  price: number;
  stock: number | null;
  lowStockThreshold: number;
  aliases: string[];
  isActive: boolean;
  images?: ProductImage[];
}

const emptyForm = {
  name: "",
  sku: "",
  category: "",
  description: "",
  unit: "pcs",
  price: "",
  trackStock: true,
  stock: "0",
  lowStockThreshold: "5",
  aliases: "",
};

function ProductDialog({
  open,
  onOpenChange,
  product,
  imageStorage,
  onSaved,
  onPhotosChanged,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  product: Product | null;
  imageStorage: boolean;
  /** `created` is set when a NEW product was saved (dialog stays open for photos). */
  onSaved: (created?: Product) => void;
  onPhotosChanged: (p: Product) => void;
}) {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(
      product
        ? {
            name: product.name,
            sku: product.sku ?? "",
            category: product.category ?? "",
            description: product.description ?? "",
            unit: product.unit,
            price: String(product.price / 100),
            trackStock: product.stock !== null,
            stock: String(product.stock ?? 0),
            lowStockThreshold: String(product.lowStockThreshold),
            aliases: product.aliases.join(", "),
          }
        : emptyForm,
    );
    // Reset only when a different product is opened — photo uploads
    // replace the `product` object and must not wipe unsaved edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product?._id]);

  const set = <K extends keyof typeof emptyForm>(k: K, v: (typeof emptyForm)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        name: form.name,
        sku: form.sku || null,
        category: form.category || null,
        description: form.description || null,
        unit: form.unit || "pcs",
        price: form.price,
        trackStock: form.trackStock,
        stock: form.trackStock ? form.stock : null,
        lowStockThreshold: form.lowStockThreshold,
        aliases: form.aliases.split(",").map((a) => a.trim()).filter(Boolean),
      };
      if (product) {
        await api(`/api/products/${product._id}`, { method: "PATCH", body });
        toast.success("Product updated");
        onOpenChange(false);
        onSaved();
      } else {
        const r = await api<{ product: Product }>("/api/products", { body });
        toast.success(imageStorage ? "Product added — now add some photos" : "Product added");
        // Keep the dialog open on the new product so photos can be added.
        if (imageStorage) onSaved(r.product);
        else {
          onOpenChange(false);
          onSaved();
        }
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border border-slate-800 bg-slate-900 text-slate-100 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">{product ? "Edit product" : "Add product"}</DialogTitle>
        </DialogHeader>
        <div className="grid max-h-[65vh] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <p className="mb-1.5 text-xs font-medium text-slate-300">Photos</p>
            {product ? (
              <ProductPhotos product={product} enabled={imageStorage} onChange={onPhotosChanged} />
            ) : (
              <p className="text-[11px] text-slate-500">Save the product first, then add photos.</p>
            )}
          </div>
          <Field label="Name" className="sm:col-span-2">
            <input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Ankara fabric (6 yards)" />
          </Field>
          <Field label="Price (₦)">
            <input className={inputCls} inputMode="decimal" value={form.price} onChange={(e) => set("price", e.target.value)} placeholder="12500" />
          </Field>
          <Field label="Unit" hint="pcs, yard, kg, pack…">
            <input className={inputCls} value={form.unit} onChange={(e) => set("unit", e.target.value)} />
          </Field>
          <Field label="SKU (optional)">
            <input className={inputCls} value={form.sku} onChange={(e) => set("sku", e.target.value)} placeholder="ANK-006" />
          </Field>
          <Field label="Category (optional)">
            <input className={inputCls} value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="Fabrics" />
          </Field>
          <Field
            label="Other names customers use"
            hint="Comma-separated. Helps the sales rep recognise orders like “2 ankara” or “wax print”."
            className="sm:col-span-2"
          >
            <input className={inputCls} value={form.aliases} onChange={(e) => set("aliases", e.target.value)} placeholder="ankara, wax print" />
          </Field>
          <Field label="Description (optional)" hint="The AI sales rep uses this to answer questions." className="sm:col-span-2">
            <textarea className={textareaCls} value={form.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
          <div className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2 sm:col-span-2">
            <div>
              <p className="text-sm text-slate-200">Track stock</p>
              <p className="text-[11px] text-slate-500">Off for services or made-to-order items.</p>
            </div>
            <Switch checked={form.trackStock} onCheckedChange={(v) => set("trackStock", v)} />
          </div>
          {form.trackStock && (
            <>
              <Field label={product && product.stock !== null ? "In stock (use Adjust stock to change)" : "Opening stock"}>
                <input
                  className={inputCls}
                  inputMode="numeric"
                  value={form.stock}
                  disabled={!!product && product.stock !== null}
                  onChange={(e) => set("stock", e.target.value)}
                />
              </Field>
              <Field label="Low-stock alert at">
                <input className={inputCls} inputMode="numeric" value={form.lowStockThreshold} onChange={(e) => set("lowStockThreshold", e.target.value)} />
              </Field>
            </>
          )}
        </div>
        <DialogFooter className="border-slate-800 bg-slate-900">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-slate-300">Cancel</Button>
          <Button onClick={save} disabled={saving || !form.name || !form.price}>{saving ? "Saving…" : "Save product"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StockDialog({ product, onClose, onSaved }: { product: Product | null; onClose: () => void; onSaved: () => void }) {
  const [delta, setDelta] = useState("");
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDelta("");
    setNote("");
    setMode("add");
  }, [product]);

  const save = async () => {
    if (!product) return;
    const n = Math.abs(Math.round(Number(delta)));
    if (!n) return toast.error("Enter a quantity");
    setSaving(true);
    try {
      await api(`/api/products/${product._id}/stock`, {
        body: { delta: mode === "add" ? n : -n, reason: mode === "add" ? "restock" : "adjustment", note: note || null },
      });
      toast.success("Stock updated");
      onClose();
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!product} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="border border-slate-800 bg-slate-900 text-slate-100">
        <DialogHeader>
          <DialogTitle className="text-white">Adjust stock — {product?.name}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-slate-400">Currently {product?.stock ?? 0} in stock. Paid orders reduce stock automatically.</p>
        <div className="grid grid-cols-2 gap-2">
          {(["add", "remove"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm ${mode === m ? "border-primary bg-primary/10 text-primary" : "border-slate-700 text-slate-300"}`}
            >
              {m === "add" ? <Plus className="size-4" /> : <Minus className="size-4" />}
              {m === "add" ? "Restock" : "Remove"}
            </button>
          ))}
        </div>
        <Field label="Quantity">
          <input className={inputCls} inputMode="numeric" value={delta} onChange={(e) => setDelta(e.target.value)} autoFocus />
        </Field>
        <Field label="Note (optional)">
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === "add" ? "Supplier delivery" : "Damaged"} />
        </Field>
        <DialogFooter className="border-slate-800 bg-slate-900">
          <Button variant="ghost" onClick={onClose} className="text-slate-300">Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Update stock"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function InventoryPage() {
  const { canEditSettings, canSendMessages } = useAuth();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [stockFor, setStockFor] = useState<Product | null>(null);
  const [imageStorage, setImageStorage] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<{ products: Product[]; imageStorage: boolean }>("/api/products");
      setProducts(data.products);
      setImageStorage(data.imageStorage);
    } catch (e) {
      toast.error((e as Error).message);
      setProducts([]);
    }
  }, []);
  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (products ?? []).filter(
      (p) =>
        (showArchived || p.isActive) &&
        (!needle || [p.name, p.sku, p.category, ...p.aliases].some((v) => v?.toLowerCase().includes(needle))),
    );
  }, [products, q, showArchived]);

  const archive = async (p: Product) => {
    if (!confirm(`Archive "${p.name}"? It stops appearing in price lists and new orders.`)) return;
    try {
      await api(`/api/products/${p._id}`, { method: "DELETE" });
      toast.success("Archived");
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const restore = async (p: Product) => {
    try {
      await api(`/api/products/${p._id}`, { method: "PATCH", body: { isActive: true } });
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const stockValue = (products ?? []).reduce((s, p) => s + (p.isActive && p.stock ? p.stock * p.price : 0), 0);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Inventory"
        description={
          products
            ? `${products.filter((p) => p.isActive).length} active products · stock value ${new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(stockValue / 100)}`
            : "Your catalogue — the sales rep quotes these prices"
        }
        actions={
          canEditSettings ? (
            <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
              <Plus className="size-4" /> Add product
            </Button>
          ) : null
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" />
          <input className={`${inputCls} pl-9`} placeholder="Search products" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <Switch checked={showArchived} onCheckedChange={setShowArchived} /> Show archived
        </label>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50">
        {products === null ? (
          <div className="h-48 animate-pulse" />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<Boxes className="size-6" />}
            title={products.length === 0 ? "No products yet" : "No matches"}
            body={products.length === 0 ? "Add what you sell. The sales rep only quotes products from this list." : undefined}
            action={
              products.length === 0 && canEditSettings ? (
                <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
                  <Plus className="size-4" /> Add your first product
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
                  <th className="px-4 py-2.5 font-medium">Product</th>
                  <th className="px-4 py-2.5 font-medium">Category</th>
                  <th className="px-4 py-2.5 text-right font-medium">Price</th>
                  <th className="px-4 py-2.5 text-right font-medium">Stock</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {visible.map((p) => {
                  const low = p.stock !== null && p.stock <= p.lowStockThreshold;
                  return (
                    <tr key={p._id} className={p.isActive ? "hover:bg-slate-800/30" : "opacity-50"}>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-3">
                          {p.images?.[0] ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={thumbUrl(p.images[0].url)} alt="" className="size-10 shrink-0 rounded-md border border-slate-700 object-cover" />
                          ) : (
                            <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-dashed border-slate-700 text-slate-600">
                              <Boxes className="size-4" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="font-medium text-white">{p.name}</div>
                            <div className="text-xs text-slate-500">
                              {[p.sku, p.aliases.length ? `aka ${p.aliases.join(", ")}` : null, p.images?.length ? `${p.images.length} photo${p.images.length === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ") || " "}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-400">{p.category ?? "—"}</td>
                      <td className="px-4 py-2.5 text-right text-white">
                        <Money minor={p.price} />
                        {p.unit !== "pcs" ? <span className="text-xs text-slate-500"> /{p.unit}</span> : null}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {p.stock === null ? (
                          <span className="text-xs text-slate-500">Not tracked</span>
                        ) : (
                          <span className={p.stock <= 0 ? "font-medium text-red-300" : low ? "font-medium text-amber-300" : "text-slate-200"}>
                            {p.stock <= 0 ? "Sold out" : p.stock}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-1">
                          {p.isActive && p.stock !== null && canSendMessages && (
                            <Button size="sm" variant="ghost" className="text-slate-300" onClick={() => setStockFor(p)}>
                              Adjust stock
                            </Button>
                          )}
                          {canEditSettings && p.isActive && (
                            <>
                              <Button size="icon-sm" variant="ghost" aria-label="Edit" className="text-slate-400" onClick={() => { setEditing(p); setDialogOpen(true); }}>
                                <Pencil />
                              </Button>
                              <Button size="icon-sm" variant="ghost" aria-label="Archive" className="text-slate-400" onClick={() => archive(p)}>
                                <Archive />
                              </Button>
                            </>
                          )}
                          {canEditSettings && !p.isActive && (
                            <Button size="sm" variant="ghost" className="text-slate-300" onClick={() => restore(p)}>Restore</Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ProductDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        product={editing}
        imageStorage={imageStorage}
        onSaved={(created) => {
          if (created) setEditing(created);
          void load();
        }}
        onPhotosChanged={(p) => {
          setEditing(p);
          setProducts((list) => list?.map((x) => (x._id === p._id ? p : x)) ?? list);
        }}
      />
      <StockDialog product={stockFor} onClose={() => setStockFor(null)} onSaved={load} />
    </div>
  );
}
