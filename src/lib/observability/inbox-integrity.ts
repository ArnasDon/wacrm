// ============================================================
// Inbox integrity check — a periodic scan for the failure shapes that
// left an Instagram/Facebook conversation impossible (or awkward) for
// an agent to reply to, so the operator hears about a recurrence
// instead of a customer complaining.
//
// Run from `/api/system/heartbeat-check/cron`. Cross-account, so it
// uses the platform (service-role) client.
//
// Two symptoms, both from the Zernio `conversation.started` +
// `message.received` race (fixed in PR #28/#29, this is the guardrail):
//   1. an IG/FB conversation with real message traffic but NO
//      `zernio_conversation_id` — the reply send has no id to address;
//   2. more than one conversation row for the same (account, contact,
//      channel) — the duplicate-thread symptom, one of which is usually
//      the id-less orphan from (1).
// ============================================================

import { platformAdminClient } from '@/lib/platform/admin-client';

export interface InboxIntegrityReport {
  /** IG/FB conversations that have messages but no `zernio_conversation_id`. */
  unrepliableConversationIds: string[];
  /** Count of (account, contact, channel) groups on IG/FB with >1 conversation. */
  duplicateThreadGroups: number;
  /** True when the scan itself failed — treat as "unknown", not "healthy". */
  scanFailed: boolean;
}

const EMPTY: InboxIntegrityReport = {
  unrepliableConversationIds: [],
  duplicateThreadGroups: 0,
  scanFailed: true,
};

export async function checkInboxIntegrity(): Promise<InboxIntegrityReport> {
  let db: ReturnType<typeof platformAdminClient>;
  try {
    db = platformAdminClient();
  } catch (err) {
    console.error('[inbox-integrity] admin client unavailable:', err instanceof Error ? err.message : err);
    return EMPTY;
  }

  const { data: convs, error } = await db
    .from('conversations')
    .select('id, account_id, contact_id, channel, zernio_conversation_id')
    .in('channel', ['instagram', 'facebook']);

  if (error) {
    console.error('[inbox-integrity] conversation scan failed:', error.message);
    return EMPTY;
  }

  const rows = (convs ?? []) as {
    id: string;
    account_id: string;
    contact_id: string;
    channel: string;
    zernio_conversation_id: string | null;
  }[];

  // (1) duplicate threads for the same contact on the same channel.
  const groupCounts = new Map<string, number>();
  for (const c of rows) {
    const key = `${c.account_id}:${c.contact_id}:${c.channel}`;
    groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1);
  }
  const duplicateThreadGroups = [...groupCounts.values()].filter((n) => n > 1).length;

  // (2) id-less rows that actually carry traffic.
  const candidateIds = rows.filter((c) => !c.zernio_conversation_id).map((c) => c.id);
  let unrepliableConversationIds: string[] = [];
  if (candidateIds.length > 0) {
    const { data: msgs, error: msgErr } = await db
      .from('messages')
      .select('conversation_id')
      .in('conversation_id', candidateIds);
    if (msgErr) {
      console.error('[inbox-integrity] message scan failed:', msgErr.message);
      return EMPTY;
    }
    const withTraffic = new Set((msgs ?? []).map((m) => m.conversation_id as string));
    unrepliableConversationIds = candidateIds.filter((id) => withTraffic.has(id));
  }

  return { unrepliableConversationIds, duplicateThreadGroups, scanFailed: false };
}
