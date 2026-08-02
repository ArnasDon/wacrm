/**
 * Shared status badge config for broadcasts + recipients.
 *
 * Previously `statusConfig` was defined inline in both
 * /broadcasts/page.tsx and /broadcasts/[id]/page.tsx with slight
 * drift risk. One source of truth now.
 *
 * Badge shape: bg-*-500/10 + text-*-400 + border-*-500/20. The
 * translucent fills sit fine on both light and dark surfaces; neutral
 * statuses use text-muted-foreground so the label stays legible in
 * light mode (a solid slate-400 would be too faint on white).
 */

import type { BroadcastStatus, RecipientStatus } from "@/types";

export interface StatusDisplay {
  label: string;
  classes: string;
  /**
   * Set true for statuses that should pulse in the UI to convey
   * "live / in-flight" — currently only `sending`.
   */
  pulse?: boolean;
}

export const broadcastStatusConfig: Record<BroadcastStatus, StatusDisplay> = {
  draft: {
    label: "draft",
    classes: "bg-slate-500/10 text-muted-foreground border-slate-500/20",
  },
  scheduled: {
    label: "scheduled",
    classes: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  },
  sending: {
    label: "sending",
    classes: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    pulse: true,
  },
  sent: {
    label: "sent",
    classes: "bg-primary/10 text-primary border-primary/20",
  },
  failed: {
    label: "failed",
    classes: "bg-red-500/10 text-red-400 border-red-500/20",
  },
};

export const recipientStatusConfig: Record<RecipientStatus, StatusDisplay> = {
  pending: {
    label: "pending",
    classes: "bg-slate-500/10 text-muted-foreground border-slate-500/20",
  },
  sent: {
    label: "sent",
    classes: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  },
  delivered: {
    label: "delivered",
    classes: "bg-primary/10 text-primary border-primary/20",
  },
  read: {
    label: "read",
    classes: "bg-primary/10 text-primary border-primary/20",
  },
  replied: {
    label: "replied",
    classes: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  },
  failed: {
    label: "failed",
    classes: "bg-red-500/10 text-red-400 border-red-500/20",
  },
};

/**
 * Tolerant lookup — callers often have a generic string status
 * coming from Supabase. Falls back to the "draft" / "pending"
 * entry so the UI never crashes on an unknown value.
 */
export function getBroadcastStatus(status: string): StatusDisplay {
  return (
    broadcastStatusConfig[status as BroadcastStatus] ??
    broadcastStatusConfig.draft
  );
}

export function getRecipientStatus(status: string): StatusDisplay {
  return (
    recipientStatusConfig[status as RecipientStatus] ??
    recipientStatusConfig.pending
  );
}
