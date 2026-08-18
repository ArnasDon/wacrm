"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Loader2, Upload, AlertTriangle } from "lucide-react";

import { formatCurrency } from "@/lib/currency";
import { useAuth } from "@/hooks/use-auth";
import { parseProductsWorkbook, type ParsedProductRow, type ProductRowError } from "@/lib/products/parse-products-excel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ProductsImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

export function ProductsImportDialog({ open, onOpenChange, onImported }: ProductsImportDialogProps) {
  const t = useTranslations("Products.import");
  const { defaultCurrency } = useAuth();

  const [rows, setRows] = useState<ParsedProductRow[]>([]);
  const [errors, setErrors] = useState<ProductRowError[]>([]);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);

  function reset() {
    setRows([]);
    setErrors([]);
  }

  async function handleFile(file: File) {
    setParsing(true);
    reset();
    try {
      const buffer = await file.arrayBuffer();
      const result = await parseProductsWorkbook(buffer);
      if (result.rows.length === 0 && result.errors.length === 0) {
        toast.error(t("noValidRows"));
        return;
      }
      setRows(result.rows);
      setErrors(result.errors);
    } catch {
      toast.error(t("parseFailed"));
    } finally {
      setParsing(false);
    }
  }

  async function handleConfirm() {
    if (rows.length === 0) return;
    setImporting(true);
    try {
      const res = await fetch("/api/products/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error ?? t("importFailed"));
        return;
      }
      toast.success(t("importSuccess", { count: data.created ?? rows.length }));
      reset();
      onOpenChange(false);
      onImported();
    } catch {
      toast.error(t("importFailed"));
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="border-border bg-popover sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t("title")}</DialogTitle>
          <DialogDescription className="text-muted-foreground">{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <label>
            <input
              type="file"
              accept=".xlsx"
              disabled={parsing || importing}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={parsing || importing}
              onClick={(e) => (e.currentTarget.previousElementSibling as HTMLInputElement)?.click()}
            >
              {parsing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              {t("chooseFile")}
            </Button>
          </label>

          {(rows.length > 0 || errors.length > 0) && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-popover-foreground">{t("previewTitle")}</p>
              <div className="flex flex-wrap gap-3 text-xs">
                <span className="text-emerald-500">{t("validRows", { count: rows.length })}</span>
                {errors.length > 0 && (
                  <span className="flex items-center gap-1 text-amber-500">
                    <AlertTriangle className="size-3.5" />
                    {t("errorRows", { count: errors.length })}
                  </span>
                )}
              </div>

              {rows.length > 0 && (
                <div className="max-h-52 overflow-y-auto rounded-md border border-border">
                  <table className="w-full text-xs">
                    <tbody>
                      {rows.map((row, i) => (
                        <tr key={i} className="border-b border-border last:border-0">
                          <td className="px-2 py-1.5 text-popover-foreground">{row.name}</td>
                          <td className="px-2 py-1.5 text-right text-muted-foreground">
                            {formatCurrency(row.price, defaultCurrency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {errors.length > 0 && (
                <ul className="max-h-24 overflow-y-auto rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-600 dark:text-amber-400">
                  {errors.map((err, i) => (
                    <li key={i}>
                      Row {err.row}: {err.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="bg-popover border-border">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {t("cancel")}
          </Button>
          <Button onClick={handleConfirm} disabled={rows.length === 0 || importing}>
            {importing ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t("importing")}
              </>
            ) : (
              t("confirmBtn", { count: rows.length })
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
