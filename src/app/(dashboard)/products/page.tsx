"use client";
import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Product, ProductType, ProductStatus } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, MoreHorizontal, Package } from "lucide-react";
import { toast } from "sonner";
import { useCan } from "@/hooks/use-can";
import { useAuth } from "@/hooks/use-auth";
import { GatedButton } from "@/components/ui/gated-button";

const PRODUCT_TYPES: { value: ProductType; label: string }[] = [
  { value: "digital_file", label: "Digital File" },
  { value: "link", label: "Link" },
  { value: "service", label: "Service" },
];

export default function ProductsPage() {
  const supabase = createClient();
  const { accountId } = useAuth();
  const canManageProducts = useCan("send-messages");

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [productType, setProductType] = useState<ProductType>("digital_file");
  const [deliveryUrl, setDeliveryUrl] = useState("");
  const [triggerKeyword, setTriggerKeyword] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Failed to load products");
    } else {
      setProducts((data as Product[]) ?? []);
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  function resetForm() {
    setName("");
    setDescription("");
    setPrice("");
    setCurrency("INR");
    setProductType("digital_file");
    setDeliveryUrl("");
    setTriggerKeyword("");
  }

  async function handleCreate() {
    const trimmedName = name.trim();
    const trimmedKeyword = triggerKeyword.trim().toUpperCase();
    if (!trimmedName || !trimmedKeyword) {
      toast.error("Name and trigger keyword are required");
      return;
    }
    const priceValue = Number(price);
    if (Number.isNaN(priceValue) || priceValue < 0) {
      toast.error("Enter a valid price");
      return;
    }

    setCreating(true);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      toast.error("You must be signed in");
      setCreating(false);
      return;
    }
    if (!accountId) {
      toast.error("Not linked to an account");
      setCreating(false);
      return;
    }

    const { error } = await supabase.from("products").insert({
      account_id: accountId,
      user_id: user.id,
      name: trimmedName,
      description: description.trim() || null,
      price: priceValue,
      currency,
      product_type: productType,
      delivery_url: deliveryUrl.trim() || null,
      trigger_keyword: trimmedKeyword,
      status: "draft",
    });

    if (error) {
      if (error.code === "23505") {
        toast.error("That trigger keyword is already used by another product");
      } else {
        toast.error("Failed to create product");
      }
      setCreating(false);
      return;
    }

    toast.success("Product created");
    resetForm();
    setCreateOpen(false);
    setCreating(false);
    fetchProducts();
  }

  async function toggleStatus(product: Product) {
    const nextStatus: ProductStatus =
      product.status === "active" ? "draft" : "active";
    const { error } = await supabase
      .from("products")
      .update({ status: nextStatus })
      .eq("id", product.id);
    if (error) {
      toast.error("Failed to update status");
    } else {
      toast.success(
        nextStatus === "active" ? "Product activated" : "Product set to draft",
      );
      fetchProducts();
    }
  }

  function confirmDelete(product: Product) {
    setDeleteTarget(product);
    setDeleteConfirmOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase
      .from("products")
      .delete()
      .eq("id", deleteTarget.id);
    if (error) {
      toast.error("Failed to delete product");
    } else {
      toast.success("Product deleted");
      fetchProducts();
    }
    setDeleting(false);
    setDeleteConfirmOpen(false);
    setDeleteTarget(null);
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Package className="h-6 w-6" />
            Products
          </h1>
          <p className="text-sm text-muted-foreground">
            Sellable products customers can request via a WhatsApp keyword.
          </p>
        </div>
        <GatedButton
          canAct={canManageProducts}
          gateReason="add products"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="h-4 w-4 mr-1" />
          Add Product
        </GatedButton>
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Keyword</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : products.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  No products yet. Add your first one to start selling.
                </TableCell>
              </TableRow>
            ) : (
              products.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell>
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                      {p.trigger_keyword}
                    </code>
                  </TableCell>
                  <TableCell>
                    {p.currency} {p.price.toFixed(2)}
                  </TableCell>
                  <TableCell className="capitalize">
                    {p.product_type.replace("_", " ")}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        p.status === "active"
                          ? "bg-green-500/10 text-green-500"
                          : p.status === "archived"
                            ? "bg-muted text-muted-foreground"
                            : "bg-yellow-500/10 text-yellow-500"
                      }`}
                    >
                      {p.status}
                    </span>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger>
                        <Button variant="ghost" size="icon" disabled={!canManageProducts}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => toggleStatus(p)}>
                          {p.status === "active" ? "Set to draft" : "Activate"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => confirmDelete(p)}
                          className="text-destructive"
                        >
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Product</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="p-name">Name</Label>
              <Input
                id="p-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Notion Template Pack"
              />
            </div>
            <div>
              <Label htmlFor="p-desc">Description</Label>
              <Input
                id="p-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Short description"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="p-price">Price</Label>
                <Input
                  id="p-price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="499"
                />
              </div>
              <div>
                <Label htmlFor="p-currency">Currency</Label>
                <Input
                  id="p-currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  placeholder="INR"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="p-type">Type</Label>
              <select
                id="p-type"
                className="w-full border rounded-md h-9 px-3 bg-background text-sm"
                value={productType}
                onChange={(e) => setProductType(e.target.value as ProductType)}
              >
                {PRODUCT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="p-delivery">Delivery URL</Label>
              <Input
                id="p-delivery"
                value={deliveryUrl}
                onChange={(e) => setDeliveryUrl(e.target.value)}
                placeholder="https://... (sent to buyer after payment)"
              />
            </div>
            <div>
              <Label htmlFor="p-keyword">Trigger Keyword</Label>
              <Input
                id="p-keyword"
                value={triggerKeyword}
                onChange={(e) => setTriggerKeyword(e.target.value)}
                placeholder="e.g. GUIDE1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Customers type this word on WhatsApp to buy this product.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? "Creating..." : "Create Product"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Product</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete &quot;{deleteTarget?.name}&quot;? This
            cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
