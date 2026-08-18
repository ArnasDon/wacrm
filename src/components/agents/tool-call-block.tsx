"use client";

import { useState } from "react";
import { ChevronDown, CheckCircle2, XCircle, Wrench, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

export interface ToolCallBlockData {
  toolName: string;
  status: "success" | "error" | "pending";
  request?: { method: string; url: string; headers: Record<string, string>; body: unknown };
  responseStatus?: number | null;
  responseBody?: string | null;
  errorMessage?: string | null;
  durationMs?: number | null;
}

/**
 * Compact, expandable "the agent called a tool" chip. Shared by the
 * inbox thread (`message-bubble.tsx`, `content_type === 'tool_call'`)
 * and the agent Playground, so a tool call looks identical whether an
 * agent sees it live in the inbox or an admin sees it while testing —
 * same component, same information.
 *
 * `onPrimary` matches the surrounding bubble fill (inbox bot bubbles
 * sit on `bg-primary`); the Playground passes it false to render on a
 * neutral surface instead.
 */
export function ToolCallBlock({
  data,
  onPrimary = false,
}: {
  data: ToolCallBlockData;
  onPrimary?: boolean;
}) {
  const t = useTranslations("Inbox.toolCall");
  const [open, setOpen] = useState(false);

  return (
    <div
      className={cn(
        "w-full max-w-full rounded-lg border text-xs",
        onPrimary
          ? "border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground"
          : "border-border bg-muted/50 text-foreground",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left"
      >
        {data.status === "pending" ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin opacity-70" />
        ) : (
          <Wrench className="h-3.5 w-3.5 shrink-0 opacity-70" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono font-medium">{data.toolName}</span>
        {data.status === "success" && (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
        )}
        {data.status === "error" && (
          <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
        )}
        <ChevronDown
          className={cn("h-3.5 w-3.5 shrink-0 opacity-60 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div
          className={cn(
            "space-y-1.5 border-t px-2.5 py-2 font-mono",
            onPrimary ? "border-primary-foreground/20" : "border-border",
          )}
        >
          {data.request && (
            <div className="break-all opacity-80">
              {data.request.method} {data.request.url}
            </div>
          )}
          {data.errorMessage ? (
            <div className="break-words text-red-400">{data.errorMessage}</div>
          ) : (
            <div className="break-words opacity-70">
              {typeof data.responseStatus === "number" && `${data.responseStatus} · `}
              {truncate(data.responseBody, 400) ?? t("noBody")}
            </div>
          )}
          {typeof data.durationMs === "number" && (
            <div className="opacity-50">{data.durationMs}ms</div>
          )}
        </div>
      )}
    </div>
  );
}

function truncate(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
