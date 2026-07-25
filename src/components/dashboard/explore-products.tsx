"use client";

import {
  Building2,
  Compass,
  ExternalLink,
  Globe,
  type LucideIcon,
} from "lucide-react";

import { VEDMINT_ECOSYSTEM } from "@/lib/brand";

const PRODUCT_ICONS: Record<string, LucideIcon> = {
  main: Globe,
  discover: Compass,
  stay: Building2,
};

/**
 * Dashboard footer — 3 cards linking to other VedMint platform products.
 */
export function ExploreProducts() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">
          Explore our other products
        </h2>
        <p className="text-xs text-muted-foreground">
          WA CRM is part of the VedMint Suite — open another platform below.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {VEDMINT_ECOSYSTEM.map((product) => {
          const Icon = PRODUCT_ICONS[product.id] ?? Globe;
          return (
            <a
              key={product.id}
              href={product.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex flex-col rounded-2xl border border-border bg-card p-4 shadow-sm transition-colors hover:border-primary/40 hover:bg-muted/40"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground group-hover:text-primary">
                      {product.name}
                    </h3>
                    <ExternalLink className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {product.url.replace("https://", "")}
                  </p>
                </div>
              </div>
              <p className="mt-2 text-xs font-medium text-primary/90">
                {product.tagline}
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {product.description}
              </p>
            </a>
          );
        })}
      </div>
    </div>
  );
}
