# Plan: Inbox reply export (contacts who replied + tags + latest reply)

**Goal:** Let a user export the people in the Inbox who have replied — one row per contact — with their tags and their latest reply. Deliver as a downloadable CSV.

**Status:** Completed / Implemented

---

## 0. Important finding — replies are ALREADY stored (no storage work needed)

The original ask assumed *"whatever response we got from the customer is not storing in the DB."* **That is not the case.** The WhatsApp webhook already persists every inbound customer message:

- `src/app/api/whatsapp/webhook/route.ts` → `processMessage()` (~line 697) inserts each inbound message into the **`messages`** table with `sender_type = 'customer'`, `content_text`, `content_type`, `created_at`, etc.
- It also updates `conversations.last_message_text` / `last_message_at`.

So the **full reply history is already retained** in `messages`. This feature is therefore **export-only over existing data** — no new column, table, or webhook write.

> If in your live environment inbound text genuinely does not appear in `messages`, that is a **separate webhook bug** to investigate (check Meta webhook signature verification and the `after()` processing logs) — it is out of scope for this plan. The code path above does store it.

### Scope decisions (confirmed with the user)
- **Row granularity:** one row per inbox contact = **latest reply per contact**.
- **Storage:** **No denormalized column.** The export reads the latest `sender_type='customer'` message from `messages` directly.

---

## 1. Data model (all already present, RLS-scoped by account)

| Table | Columns used | Notes |
|-------|--------------|-------|
| `conversations` | `id`, `contact_id`, `status`, `last_message_at`, `account_id` | Status is `open` / `pending` / `closed`. |
| `contacts` | `name`, `phone`, `email`, `company` | Joined via `conversations.contact_id`. |
| `contact_tags` → `tags` | `tags.name` | Many-to-many; flatten to a joined string. |
| `messages` | `conversation_id`, `sender_type`, `content_text`, `content_type`, `created_at` | Filter `sender_type = 'customer'`; take the most recent per conversation. |

**Tenancy / RLS:** Every one of these tables has row-level security scoping rows to the caller's account (see `supabase/migrations/001_initial_schema.sql` and later `017_account_sharing.sql`). The export MUST run through a **session-scoped Supabase client** (the user's cookies), NOT the service-role admin client, so RLS automatically restricts the export to the caller's own inbox. Do **not** use `supabaseAdmin()` / service-role here.

The Inbox UI already reads this exact shape via `CONVERSATION_SELECT` in `src/lib/inbox/conversations.ts`:
```ts
"*, contact:contacts(*, contact_tags(tags(*)))"
```
Reuse it — `normalizeConversation()` flattens `contact_tags(tags(*))` into `contact.tags`.

---

## 2. Definition of "replied"
A contact is included if their conversation has **at least one `messages` row with `sender_type = 'customer'`**. (Conversations are created on the first inbound message, so in practice almost all qualify — but filter on the existence of a customer message so an agent-initiated thread with no reply is excluded.)

---

## 3. Exported columns (CSV)
One row per qualifying contact:

| Column header | Source |
|---------------|--------|
| `Name` | `contacts.name` |
| `Phone` | `contacts.phone` |
| `Email` | `contacts.email` (blank if null) |
| `Company` | `contacts.company` (blank if null) |
| `Tags` | `tags.name` joined with `; ` (semicolon-space) |
| `Conversation Status` | `conversations.status` |
| `Last Reply` | latest customer message `content_text`, or a media placeholder (see §6) |
| `Last Reply Type` | latest customer message `content_type` (`text`, `image`, ...) |
| `Last Reply At` | latest customer message `created_at` (ISO 8601) |

---

## 4. Implementation

### 4a. API route — `GET /api/inbox/export`
Create `src/app/api/inbox/export/route.ts`. Server route, session-scoped client, returns `text/csv`.

```ts
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  CONVERSATION_SELECT,
  normalizeConversations,
} from '@/lib/inbox/conversations';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createClient();

  // Auth — RLS needs the session; reject anonymous callers.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 1. Conversations + contact + tags. RLS scopes to the caller's account.
  const { data: convRows, error: convErr } = await supabase
    .from('conversations')
    .select(CONVERSATION_SELECT)
    .order('last_message_at', { ascending: false });

  if (convErr) {
    console.error('[inbox-export] conversations query failed:', convErr);
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }

  const conversations = normalizeConversations(convRows ?? []);
  const convIds = conversations.map((c) => c.id);
  if (convIds.length === 0) {
    return csvResponse(CSV_HEADER + '\n'); // headers only
  }

  // 2. Latest customer reply per conversation. Read the messages table
  //    directly (no denormalized column). Ascending order + a "last wins"
  //    reduce leaves the newest customer message per conversation in the map.
  const { data: msgRows, error: msgErr } = await supabase
    .from('messages')
    .select('conversation_id, content_text, content_type, created_at')
    .in('conversation_id', convIds)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: true });

  if (msgErr) {
    console.error('[inbox-export] messages query failed:', msgErr);
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }

  const latestByConv = new Map<
    string,
    { content_text: string | null; content_type: string; created_at: string }
  >();
  for (const m of msgRows ?? []) {
    latestByConv.set(m.conversation_id, m); // ascending → last write is newest
  }

  // 3. Build rows only for conversations that actually have a customer reply.
  const lines = [CSV_HEADER];
  for (const conv of conversations) {
    const reply = latestByConv.get(conv.id);
    if (!reply) continue; // no customer message → not "replied"

    const c = conv.contact;
    const tags = (c?.tags ?? []).map((t) => t.name).join('; ');
    lines.push(
      [
        c?.name ?? '',
        c?.phone ?? '',
        c?.email ?? '',
        c?.company ?? '',
        tags,
        conv.status ?? '',
        displayReply(reply.content_text, reply.content_type),
        reply.content_type,
        reply.created_at,
      ]
        .map(csvEscape)
        .join(','),
    );
  }

  return csvResponse(lines.join('\n') + '\n');
}
```

Helpers in the same file:

```ts
const CSV_HEADER =
  'Name,Phone,Email,Company,Tags,Conversation Status,Last Reply,Last Reply Type,Last Reply At';

// RFC-4180 escaping: wrap in quotes if the value has comma/quote/newline,
// and double any embedded quotes.
function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Media replies have null content_text — show a readable placeholder.
function displayReply(text: string | null, type: string): string {
  if (text && text.trim()) return text;
  return `[${type}]`;
}

function csvResponse(body: string): Response {
  // Prepend a UTF-8 BOM so Excel opens non-ASCII (names, emoji) correctly.
  const filename = `inbox-replies-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response('﻿' + body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
```

**Verify before coding:**
- Confirm `@/lib/supabase/server` exports an async `createClient()` that reads the request cookies (the Inbox connection check and other server routes use it). If the project's server client is named/shaped differently, match the existing convention.
- Confirm `Tag` has a `name` field and `Conversation.status` values are `open|pending|closed` (they are, per `types/index.ts` and migration 001).

### 4b. UI — Export button
Add an **Export** button to the Inbox. Best home: the `ConversationList` header (`src/components/inbox/conversation-list.tsx`), near the existing tag/company filter controls, so it sits with the other list-level actions. (Alternatively the Inbox page header in `src/app/(dashboard)/inbox/page.tsx`.)

Trigger a download via fetch → blob → anchor (keeps same-origin auth cookies, lets us name the file, and shows errors as a toast):

```tsx
const [exporting, setExporting] = useState(false);

async function handleExport() {
  setExporting(true);
  try {
    const res = await fetch('/api/inbox/export');
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inbox-replies-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    toast.error('Could not export inbox replies');
  } finally {
    setExporting(false);
  }
}
```
Button: a small outline/ghost button labelled **Export** (add a `Download` lucide icon for parity with the rest of the UI), disabled while `exporting`. Add the string to the `Inbox` i18n namespace used on this page (`useTranslations("Inbox.page")`) rather than hard-coding, to match the existing pattern.

---

## 5. Optional: honour the active inbox filters
Nice-to-have (not required). The Inbox already has tag/company filters (`matchesContactFilters` in `src/lib/inbox/conversations.ts`). If you want the export to match what the user currently sees, accept optional query params `?tagIds=a,b&company=Acme&status=open` on the route and apply the same filtering server-side before building rows. Default (no params) = export everyone who replied. Keep this as a follow-up unless the user asks.

---

## 6. Edge cases & details
- **Media replies** (`image`, `document`, `audio`, `video`, `location`, `interactive`): `content_text` may be null → `displayReply()` emits `[image]`, `[document]`, etc. (Interactive taps and locations already store readable text in `content_text`, so those come through as text.)
- **Contacts with multiple conversations:** the dedup migrations (036) collapse to one canonical conversation per contact, so one row per contact holds in practice. If duplicates exist, this produces one row per conversation — acceptable, and matches what the Inbox shows.
- **Tags:** joined with `; ` so the comma-delimited CSV isn't broken by multi-tag contacts; `csvEscape` also quotes any field containing a comma as a safety net.
- **Excel/Unicode:** UTF-8 BOM prepended so Arabic/emoji/accented names render correctly on open.
- **Scale:** the two-query + in-memory reduce is fine for typical inboxes. For very large accounts (tens of thousands of customer messages) the `messages` pull grows; if that becomes a problem, replace step 2 with a `security_invoker` Postgres view or RPC using `DISTINCT ON (conversation_id) ... ORDER BY conversation_id, created_at DESC`. Not needed for v1.

---

## 7. Security / tenancy checklist
- [x] Route uses the **session** Supabase client, not service-role → RLS enforces account isolation automatically.
- [x] Route returns 401 when there is no authenticated user.
- [x] No `account_id` is accepted from the client (never trust a caller-supplied account) — scoping comes from RLS on the session.

---

## 8. Files touched
- **New:** `src/app/api/inbox/export/route.ts` — the CSV export endpoint.
- **New:** `src/app/api/inbox/export/route.test.ts` — unit tests for the CSV export endpoint.
- **Edit:** `src/components/inbox/conversation-list.tsx` — added Export button + download handler.
- **Edit (i18n):** `messages/en.json`, `messages/ko.json` — added `export` translation string.

---

## 9. Verification
1. In an account with several replied conversations (mix of text + media, tagged + untagged), click **Export**.
2. A CSV downloads named `inbox-replies-YYYY-MM-DD.csv`.
3. Check: one row per contact who replied; tags joined with `; `; `Last Reply` shows the newest **customer** message (not an agent message); media replies show `[image]` etc.; timestamps present.
4. Log in as a user from a **different account** and confirm the export contains only that account's contacts (RLS isolation).
5. Empty inbox → CSV with header row only, no error.

---

## 10. Implementation Progress & Status

- [x] **API Route (`GET /api/inbox/export`)**: Implemented in [`src/app/api/inbox/export/route.ts`](file:///d:/workspace/nexara_products/wacrm/src/app/api/inbox/export/route.ts). Authenticated via session-scoped Supabase client, returns CSV format with UTF-8 BOM, RFC-4180 escaping, and media type placeholders.
- [x] **UI (`Export` Button)**: Added to conversation list header in [`src/components/inbox/conversation-list.tsx`](file:///d:/workspace/nexara_products/wacrm/src/components/inbox/conversation-list.tsx#L205-L226). Triggers blob download of `inbox-replies-YYYY-MM-DD.csv`.
- [x] **i18n Translations**: Updated `messages/en.json` and `messages/ko.json` with the `export` key under `Inbox.conversationList`.
- [x] **Automated Testing**: Created unit tests in [`src/app/api/inbox/export/route.test.ts`](file:///d:/workspace/nexara_products/wacrm/src/app/api/inbox/export/route.test.ts). All tests passed cleanly.

