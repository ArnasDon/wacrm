// ============================================================
// Batched recipient-result writes for high-throughput campaigns.
//
// Senders record each outcome here; it's written in batches (every
// FLUSH_MS or BATCH rows) through apply_recipient_results (migration
// 052) — one statement per batch instead of one per message. When the
// function isn't there (migration not applied, or a test double), it
// falls back to per-row updates, so behaviour never depends on it.
//
// A failed flush keeps the rows and retries with backoff; the buffer is
// bounded, and `flush()` is awaited before anything that reads the
// results (finalising the campaign, committing Kafka offsets).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export interface RecipientResult {
  id: string;
  status: 'sent' | 'failed';
  sent_at?: string | null;
  whatsapp_message_id?: string | null;
  error_message?: string | null;
  whatsapp_config_id?: string | null;
  template_name?: string | null;
  template_language?: string | null;
  /** Meta's message_status on acceptance (migration 053). */
  meta_message_status?: string | null;
}

const BATCH = 500;
const FLUSH_MS = 150;
/** Past this, record() waits for a flush (back-pressure on senders). */
const MAX_BUFFER = 5_000;

export class RecipientResultWriter {
  private buffer: RecipientResult[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;
  private useRpc = true;
  /** Cleared if the meta_message_status column doesn't exist yet. */
  private withMetaStatus = true;
  private failures = 0;

  constructor(private readonly db: SupabaseClient) {}

  get size(): number {
    return this.buffer.length;
  }

  async record(result: RecipientResult): Promise<void> {
    this.buffer.push(result);
    if (this.buffer.length >= MAX_BUFFER) await this.flush();
    else if (this.buffer.length >= BATCH) void this.flush();
    else this.timer ??= setTimeout(() => void this.flush(), FLUSH_MS);
  }

  /** Write everything buffered so far (and anything added meanwhile). */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.flushing) await this.flushing;
    if (this.buffer.length === 0) return;
    this.flushing = this.drain().finally(() => {
      this.flushing = null;
    });
    await this.flushing;
  }

  private async drain(): Promise<void> {
    while (this.buffer.length) {
      const batch = this.buffer.splice(0, BATCH);
      try {
        await this.write(batch);
        this.failures = 0;
      } catch (err) {
        // Keep the rows and retry: the database may be briefly unreachable.
        this.buffer.unshift(...batch);
        this.failures++;
        console.error(
          `[result-writer] flush failed (${this.failures}), retrying:`,
          err instanceof Error ? err.message : err
        );
        await new Promise((r) =>
          setTimeout(r, Math.min(30_000, 500 * 2 ** this.failures))
        );
      }
    }
  }

  private async write(batch: RecipientResult[]): Promise<void> {
    if (
      this.useRpc &&
      typeof (this.db as { rpc?: unknown }).rpc === 'function'
    ) {
      const { error } = await this.db.rpc('apply_recipient_results', {
        p_rows: batch,
      });
      if (!error) return;
      // Function missing (migration 052 not applied) → per-row from now on.
      if (
        /apply_recipient_results|PGRST202|42883/.test(
          `${error.code} ${error.message}`
        )
      ) {
        this.useRpc = false;
      } else {
        throw new Error(error.message);
      }
    }
    for (const r of batch) {
      const { id, ...patch } = r;
      const clean = Object.fromEntries(
        Object.entries(patch).filter(
          ([k, v]) =>
            v !== undefined &&
            (this.withMetaStatus || k !== 'meta_message_status')
        )
      );
      const { error } = await this.db
        .from('broadcast_recipients')
        .update(clean)
        .eq('id', id)
        .eq('status', 'pending');
      if (
        error &&
        /meta_message_status/.test(error.message) &&
        this.withMetaStatus
      ) {
        // Column not there yet (migration 053) — write without it.
        this.withMetaStatus = false;
        throw new Error(error.message);
      }
      if (error) throw new Error(error.message);
    }
  }
}
