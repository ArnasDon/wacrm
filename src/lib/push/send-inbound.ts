// ============================================================
// Inbound push fan-out — called by the WhatsApp webhook when a
// customer message lands.
//
// Recipient rule (per product spec):
//   - Conversation assigned to a user  → push only that user.
//   - Conversation unassigned          → push every owner/admin/agent
//                                         of the account (viewers are
//                                         read-only, so they're skipped).
// Everything is scoped by account_id, so one company never receives
// another company's notifications.
//
// Runs with the service-role client (RLS-bypassing) because the
// webhook has no Supabase session. Best-effort: never throws.
// ============================================================

import { supabaseAdmin } from "@/lib/automations/admin-client";
import {
  sendToSubscriptions,
  type StoredSubscription,
} from "@/lib/push/web-push";

/** Roles that actually handle conversations (get notified when unassigned). */
const NOTIFIABLE_ROLES = ["owner", "admin", "agent"] as const;

interface InboundPushInput {
  accountId: string;
  conversation: { id: string; assigned_agent_id?: string | null };
  contentText?: string | null;
  contactName: string;
  messageType: string;
}

export async function sendInboundPush({
  accountId,
  conversation,
  contentText,
  contactName,
  messageType,
}: InboundPushInput): Promise<void> {
  const admin = supabaseAdmin();

  // 1) Resolve the set of recipient user_ids.
  let recipientUserIds: string[];

  if (conversation.assigned_agent_id) {
    recipientUserIds = [conversation.assigned_agent_id];
  } else {
    const { data: members, error } = await admin
      .from("profiles")
      .select("user_id")
      .eq("account_id", accountId)
      .in("account_role", NOTIFIABLE_ROLES as unknown as string[]);

    if (error) {
      console.error("[push] failed to load account members:", error);
      return;
    }
    recipientUserIds = (members ?? []).map((m) => m.user_id as string);
  }

  if (recipientUserIds.length === 0) return;

  // 2) Fetch their active subscriptions (account-scoped for safety).
  const { data: subs, error: subErr } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh_key, auth_key")
    .eq("account_id", accountId)
    .eq("active", true)
    .in("user_id", recipientUserIds);

  if (subErr) {
    console.error("[push] failed to load subscriptions:", subErr);
    return;
  }
  if (!subs || subs.length === 0) return;

  // 3) Send. `tag` collapses repeated messages from the same
  //    conversation into one notification; `url` deep-links the inbox
  //    straight to the conversation (the inbox reads `?c=`).
  await sendToSubscriptions(subs as StoredSubscription[], {
    title: contactName,
    body: contentText?.trim() || `[${messageType}]`,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: conversation.id,
    url: `/inbox?c=${conversation.id}`,
    requireInteraction: false,
  });
}
