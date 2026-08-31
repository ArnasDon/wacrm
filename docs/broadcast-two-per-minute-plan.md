# Plan: Send 2 broadcast messages per minute (one after another)

**Goal:** Change broadcast delivery pacing from **1 message/minute** to **2 messages/minute**, sent sequentially (one after the other, not simultaneously).

**Status:** Completed / Implemented

---

## 1. How pacing works today (context)

The delivery rate is controlled by a Cloudflare cron Worker that pings a Vercel endpoint once per minute; the endpoint sends exactly one message per call.

| Layer | File | Role |
|-------|------|------|
| Cloudflare Worker cron | `workers/broadcast-cron/src/index.ts` + `workers/broadcast-cron/wrangler.jsonc` | Cron `* * * * *` (every minute) → HTTP GET to `VERCEL_BROADCAST_CRON_URL` (`/api/broadcasts/cron`). |
| Vercel cron route | `src/app/api/broadcasts/cron/route.ts` | Auth-checks the request, then calls `processBroadcastQueue(admin)`. `maxDuration = 60`. |
| Queue processor | `src/lib/whatsapp/broadcast-queue-processor.ts` → `processBroadcastQueue()` | Selects the **oldest global pending** recipient, then `drainBroadcastQueue(db, broadcastId, 0, 1)` with `maxBatchSize = 1` → sends exactly **1** recipient. |

So: **1 cron tick = 1 send = 1 msg/min.**

### Why not "just run cron every 30 seconds"?
Cloudflare Cron Triggers have a **1-minute minimum granularity** — sub-minute schedules are not supported. Therefore 2/min must be achieved by sending **2 messages per invocation**, not by scheduling the cron more often. This also keeps the Cloudflare Worker and `wrangler.jsonc` **unchanged**.

---

## 2. The change (single file)

**File:** `src/lib/whatsapp/broadcast-queue-processor.ts`
**Function:** `processBroadcastQueue()` (currently around line 396)

Make it loop **twice** per invocation, re-selecting the oldest global pending recipient each iteration, with a short pause between the two sends so they go out sequentially.

### Replace the current implementation

Current:

```ts
export async function processBroadcastQueue(
  db: SupabaseClient,
): Promise<{ processed: number; completed: number }> {
  let processedCount = 0;
  let completedCount = 0;

  // Select the oldest queued recipient globally so simultaneous broadcasts do
  // not multiply the configured one-message-per-minute delivery rate.
  const { data: pendingRecipients } = await db
    .from('broadcast_recipients')
    .select('broadcast_id')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1);

  if (!pendingRecipients || pendingRecipients.length === 0) {
    return { processed: 0, completed: 0 };
  }

  const broadcastId = pendingRecipients[0].broadcast_id;
  await drainBroadcastQueue(db, broadcastId, 0, 1).catch((err) =>
    console.error(
      `[broadcast-cron] Error processing broadcast ${broadcastId}:`,
      err,
    ),
  );
  processedCount = 1;

  return { processed: processedCount, completed: completedCount };
}
```

New:

```ts
// Number of messages sent per cron invocation. Cloudflare cron fires once per
// minute, so this equals the messages-per-minute delivery rate.
const MESSAGES_PER_RUN = 2;

// Pause between the sequential sends within a single run, so the two messages
// go out one after another rather than back-to-back in the same instant.
const INTER_MESSAGE_DELAY_MS = 1000;

export async function processBroadcastQueue(
  db: SupabaseClient,
): Promise<{ processed: number; completed: number }> {
  let processedCount = 0;
  const completedCount = 0;

  for (let i = 0; i < MESSAGES_PER_RUN; i++) {
    // Re-select the oldest queued recipient globally each iteration so that
    // (a) simultaneous broadcasts do not multiply the configured rate, and
    // (b) the second send can come from a different broadcast if the first
    //     broadcast just ran out of pending recipients.
    const { data: pendingRecipients } = await db
      .from('broadcast_recipients')
      .select('broadcast_id')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1);

    if (!pendingRecipients || pendingRecipients.length === 0) {
      break; // Nothing left to send this run.
    }

    const broadcastId = pendingRecipients[0].broadcast_id;
    await drainBroadcastQueue(db, broadcastId, 0, 1).catch((err) =>
      console.error(
        `[broadcast-cron] Error processing broadcast ${broadcastId}:`,
        err,
      ),
    );
    processedCount++;

    // Pause before the next send (skip after the last one).
    if (i < MESSAGES_PER_RUN - 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, INTER_MESSAGE_DELAY_MS),
      );
    }
  }

  return { processed: processedCount, completed: completedCount };
}
```

### Notes for the implementer
- Keep `drainBroadcastQueue(db, broadcastId, 0, 1)` with `maxBatchSize = 1` **inside** the loop. Do **not** change it to `maxBatchSize = 2` — re-selecting the oldest global pending each iteration is what keeps ordering fair across concurrent broadcasts and correctly handles the second send belonging to a different broadcast.
- If only 1 recipient is pending, the loop `break`s after the first send — still correct (sends 1, not an error).
- Timing budget is safe: 2 sends + one 1s pause ≈ a few seconds, far under the route's `maxDuration = 60`.

---

## 3. Comment / doc updates (accuracy only, no behavior change)

1. **`src/lib/whatsapp/broadcast-queue-processor.ts`** — the docstring above `processBroadcastQueue` (around line 391) currently says *"Sends exactly one queued recipient. Vercel invokes this endpoint once per minute..."*. Update it to state that it sends `MESSAGES_PER_RUN` (2) recipients sequentially per minute.

2. **`workers/broadcast-cron/README.md`** — last line says *"The Vercel endpoint processes exactly one oldest pending broadcast recipient each time."* Change to *"...processes the two oldest pending broadcast recipients each time, one after another."*

3. If any UI copy or settings text states "1 message per minute", update to "2 messages per minute". (Search the repo for `per minute` / `per-minute` to confirm; update only user-facing strings if present.)

---

## 4. To go higher later (future reference)
The rate is now a single knob: `MESSAGES_PER_RUN` in `broadcast-queue-processor.ts`. E.g. set to `4` for 4 msg/min. Keep `INTER_MESSAGE_DELAY_MS × (MESSAGES_PER_RUN − 1)` comfortably under `maxDuration = 60s`. WhatsApp/Meta messaging throughput limits are far above these values, so they are not a constraint at this scale.

---

## 5. Files touched
- `src/lib/whatsapp/broadcast-queue-processor.ts` — **behavior change** (the loop) + docstring.
- `workers/broadcast-cron/README.md` — doc text only.
- `src/app/api/broadcasts/create/route.ts` — comment updated for accuracy.

**No changes** to the Cloudflare Worker code, `wrangler.jsonc`, the cron schedule, the cron route, or the database.

---

## 6. Verification
1. Deploy the Vercel app (Worker deploy not required — it is unchanged).
2. Queue a broadcast with ≥ 4 pending recipients.
3. Confirm from `broadcast_recipients` `sent_at` timestamps (or logs) that **2** rows move to `sent` per minute, with the two sends ~1s apart.
4. Confirm the broadcast finalizes correctly (`checkAndFinalizeIfDone`) once all recipients are processed.

---

## 7. Implementation Progress & Status

- [x] **`src/lib/whatsapp/broadcast-queue-processor.ts`**: Updated `processBroadcastQueue` with `MESSAGES_PER_RUN = 2` loop, `INTER_MESSAGE_DELAY_MS = 1000` inter-send pause, and updated docstrings.
- [x] **`workers/broadcast-cron/README.md`**: Updated documentation text describing Vercel endpoint batch processing (2 recipients per minute sequentially).
- [x] **`src/app/api/broadcasts/create/route.ts`**: Updated internal code comments referencing per-minute cron pacing to reflect 2/min.
- [x] **Test suite**: Verified all unit tests pass clean.

