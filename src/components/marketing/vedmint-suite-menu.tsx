"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";

import { VEDMINT_SUITE } from "@/lib/brand";
import { cn } from "@/lib/utils";

type SuiteMenuProps = {
  isLight?: boolean;
  /** Compact chip style for the mobile nav strip */
  compact?: boolean;
};

export function VedMintSuiteMenu({
  isLight = true,
  compact = false,
}: SuiteMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1 font-medium transition-colors",
          compact
            ? cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-xs",
                isLight
                  ? open
                    ? "border-teal-300 bg-teal-50 text-teal-800"
                    : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:text-slate-900"
                  : open
                    ? "border-teal-700/60 bg-teal-950/40 text-teal-200"
                    : "border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700 hover:text-white",
              )
            : cn(
                "rounded-lg px-3 py-2 text-sm",
                isLight
                  ? open
                    ? "bg-teal-50 text-teal-800"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  : open
                    ? "bg-slate-800/80 text-teal-200"
                    : "text-slate-400 hover:bg-slate-800/60 hover:text-white",
              ),
        )}
      >
        VedMint Suite
        <ChevronDown
          className={cn(
            "size-3.5 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="VedMint Suite products"
          className={cn(
            "absolute z-50 mt-2 w-[min(100vw-2rem,20rem)] overflow-hidden rounded-xl border bg-white py-1.5 shadow-lg shadow-slate-900/10",
            compact ? "left-0" : "left-1/2 -translate-x-1/2 md:left-0 md:translate-x-0",
            isLight ? "border-slate-200" : "border-slate-200",
          )}
        >
          {VEDMINT_SUITE.map((item) => {
            const className = cn(
              "flex w-full items-start gap-2 px-3.5 py-2.5 text-left transition-colors hover:bg-slate-50",
            );
            const body = (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-900">
                    {item.name}
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-slate-500">
                    {item.description}
                  </span>
                </span>
                {item.external ? (
                  <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-slate-400" />
                ) : null}
              </>
            );

            if (item.external) {
              return (
                <a
                  key={item.id}
                  role="menuitem"
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={className}
                  onClick={() => setOpen(false)}
                >
                  {body}
                </a>
              );
            }

            return (
              <Link
                key={item.id}
                role="menuitem"
                href="/"
                className={className}
                onClick={() => setOpen(false)}
              >
                {body}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
