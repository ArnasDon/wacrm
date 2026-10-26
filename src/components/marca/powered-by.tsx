"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/** Firma discreta de la plantilla. Siempre visible: no depende de la config. */
export function PoweredBy({ className }: { className?: string }) {
  const t = useTranslations("Brand");
  return (
    <p
      className={cn(
        "flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground",
        className,
      )}
    >
      {t("poweredBy")}
      {/* eslint-disable-next-line @next/next/no-img-element -- asset estático de la plantilla */}
      <img src="/stackless/mark.png" alt="" className="h-3.5 w-auto" />
      <span className="font-semibold text-foreground/80">Stackless</span>
    </p>
  );
}
