"use client";

import type { ReactNode } from "react";
import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";

interface DocumentPreviewCardProps {
  url: string;
  filename: string;
  isAgent: boolean;
  thumbnailUrl: string | null;
  fileSize: number | null;
  time: string;
  status: ReactNode;
  verLabel: string;
  baixarLabel: string;
  /** Already-formatted ("40 páginas") by the caller — next-intl's ICU
   *  interpolation must run at the `t()` call site, not here. Null when
   *  the page count isn't known yet. */
  pagesLabel: string | null;
}

function formatFileSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 0.1) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  const kb = bytes / 1024;
  return `${Math.max(1, Math.round(kb))} KB`;
}

/**
 * Forces a real download instead of just opening the PDF in a new tab.
 * A plain cross-origin `<a download>` is silently ignored by the
 * browser (the `download` attribute only takes effect same-origin) —
 * chat-media is a separate Supabase Storage host, so without this the
 * "Baixar" button would behave identically to "Ver". The bucket serves
 * public objects with a permissive CORS policy, so fetching as a blob
 * and downloading that (same-origin blob: URL) works reliably.
 */
async function downloadFile(url: string, filename: string) {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(blobUrl);
  } catch {
    // Fall back to just opening it — better than a dead click.
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/** WhatsApp-style document card: a full-width thumbnail of the PDF's
 *  first page, then a footer with the filename, page count + size, and
 *  Ver/Baixar actions — themed to match the bubble it's in (not a
 *  literal clone of WhatsApp's own green), per the chosen visual
 *  direction. Only rendered once `thumbnailUrl` has landed (see
 *  MessageBubble's document case); until then, and for any non-PDF
 *  document, the existing plain pill is what renders instead. */
export function DocumentPreviewCard({
  url,
  filename,
  isAgent,
  thumbnailUrl,
  fileSize,
  time,
  status,
  verLabel,
  baixarLabel,
  pagesLabel,
}: DocumentPreviewCardProps) {
  const metaParts = [pagesLabel, "PDF", fileSize ? formatFileSize(fileSize) : null].filter(
    Boolean,
  );

  return (
    <div
      className={cn(
        "max-w-72 overflow-hidden rounded-lg border",
        isAgent ? "border-primary-foreground/20" : "border-border",
      )}
    >
      {thumbnailUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumbnailUrl} alt="" className="w-full object-cover" />
      )}
      <div
        className={cn(
          "space-y-2 px-3 py-2.5",
          isAgent ? "bg-primary-foreground/10" : "bg-muted/60",
        )}
      >
        <div className="flex items-start gap-2">
          <FileText
            className={cn(
              "mt-0.5 h-4 w-4 shrink-0",
              isAgent ? "text-primary-foreground/70" : "text-muted-foreground",
            )}
          />
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "truncate text-sm font-medium",
                isAgent ? "text-primary-foreground" : "text-foreground",
              )}
            >
              {filename}
            </p>
            <p
              className={cn(
                "truncate text-xs",
                isAgent ? "text-primary-foreground/70" : "text-muted-foreground",
              )}
            >
              {metaParts.join(" • ")}
            </p>
          </div>
          <span
            className={cn(
              "mt-0.5 flex shrink-0 items-center gap-1 text-[10px]",
              isAgent ? "text-primary-foreground/70" : "text-muted-foreground",
            )}
          >
            {time}
            {status}
          </span>
        </div>
        <div
          className={cn(
            "flex items-center gap-2 border-t pt-2 text-xs font-medium",
            isAgent ? "border-primary-foreground/20" : "border-border/60",
          )}
        >
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "flex-1 rounded-md py-1 text-center",
              isAgent
                ? "text-primary-foreground hover:bg-primary-foreground/10"
                : "text-primary hover:bg-primary/10",
            )}
          >
            {verLabel}
          </a>
          <button
            type="button"
            onClick={() => downloadFile(url, filename)}
            className={cn(
              "flex-1 rounded-md py-1 text-center",
              isAgent
                ? "text-primary-foreground hover:bg-primary-foreground/10"
                : "text-primary hover:bg-primary/10",
            )}
          >
            {baixarLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
