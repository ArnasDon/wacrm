/**
 * Shared status badge config for email campaigns + recipients.
 *
 * Mirrors `broadcast-status.ts` but for the email_campaigns statuses
 * (draft/scheduled/sending/sent/failed) and email_campaign_recipients
 * statuses (pending/sent/delivered/opened/clicked/bounced/failed).
 * One source of truth so /email (list) and /email/[id] (detail) don't
 * drift.
 */

import type { EmailCampaignStatus, EmailRecipientStatus } from "@/types";

export interface StatusDisplay {
  label: string;
  classes: string;
  /** Set true for statuses that should pulse to convey "live / in-flight". */
  pulse?: boolean;
}

export const emailCampaignStatusConfig: Record<EmailCampaignStatus, StatusDisplay> = {
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

export const emailRecipientStatusConfig: Record<EmailRecipientStatus, StatusDisplay> = {
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
  opened: {
    label: "opened",
    classes: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  },
  clicked: {
    label: "clicked",
    classes: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  },
  bounced: {
    label: "bounced",
    classes: "bg-red-500/10 text-red-400 border-red-500/20",
  },
  failed: {
    label: "failed",
    classes: "bg-red-500/10 text-red-400 border-red-500/20",
  },
};

/**
 * Tolerant lookup — callers often have a generic string status coming
 * from Supabase. Falls back to "draft" / "pending" so the UI never
 * crashes on an unknown value.
 */
export function getEmailCampaignStatus(status: string): StatusDisplay {
  return (
    emailCampaignStatusConfig[status as EmailCampaignStatus] ??
    emailCampaignStatusConfig.draft
  );
}

export function getEmailRecipientStatus(status: string): StatusDisplay {
  return (
    emailRecipientStatusConfig[status as EmailRecipientStatus] ??
    emailRecipientStatusConfig.pending
  );
}