// Template status changes (Meta paused / disabled / re-approved a
// template) → every campaign sender in every process, immediately.
//
// With Kafka the change goes out on the `template.status` topic and each
// process's consumer re-emits it locally; without Kafka it's emitted
// straight onto this process's bus. Senders subscribe with
// onTemplateStatus() and drop a paused template at once, instead of
// finding out from the next failed send or status poll.

import { EventEmitter } from 'node:events';

import {
  publishTemplateStatus,
  type TemplateStatusEvent,
} from '@/lib/kafka/producers';

const g = globalThis as unknown as { __wacrmTemplateBus?: EventEmitter };
const bus = (g.__wacrmTemplateBus ??= new EventEmitter().setMaxListeners(200));

export function onTemplateStatus(
  fn: (e: TemplateStatusEvent) => void
): () => void {
  bus.on('status', fn);
  return () => bus.off('status', fn);
}

export function emitTemplateStatusLocal(e: TemplateStatusEvent): void {
  bus.emit('status', e);
}

/** Build the event from Meta's `message_template_status_update` value. */
export function templateStatusEvent(
  wabaId: string | null,
  value: unknown
): TemplateStatusEvent | null {
  const v = (value ?? {}) as {
    event?: string;
    message_template_id?: string | number;
    message_template_name?: string;
    message_template_language?: string;
    reason?: string | null;
  };
  if (!v.event) return null;
  return {
    v: 1,
    wabaId,
    templateId:
      v.message_template_id != null ? String(v.message_template_id) : null,
    name: v.message_template_name ?? null,
    language: v.message_template_language ?? null,
    event: String(v.event).toUpperCase(),
    reason: v.reason ?? null,
    at: new Date().toISOString(),
  };
}

export async function announceTemplateStatus(
  wabaId: string | null,
  value: unknown
): Promise<void> {
  const event = templateStatusEvent(wabaId, value);
  if (!event) return;
  // Kafka delivers it back to this process too (its own consumer).
  if (!(await publishTemplateStatus(event))) emitTemplateStatusLocal(event);
}
