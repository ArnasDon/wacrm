import { randomUUID } from "node:crypto";

export interface AsyncEventTrace {
  event_id: string;
  route: string;
  account_id?: string;
  contact_id?: string;
  conversation_id?: string;
  message_id?: string;
}

interface TraceSeed {
  route: string;
  eventId?: string;
  accountId?: string | null;
  contactId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
}

type AsyncLogLevel = "info" | "warn" | "error";

function normalizeTrace(trace: AsyncEventTrace): AsyncEventTrace {
  const normalized: AsyncEventTrace = {
    event_id: trace.event_id,
    route: trace.route,
  };
  if (trace.account_id) normalized.account_id = trace.account_id;
  if (trace.contact_id) normalized.contact_id = trace.contact_id;
  if (trace.conversation_id) normalized.conversation_id = trace.conversation_id;
  if (trace.message_id) normalized.message_id = trace.message_id;
  return normalized;
}

function cleanFields(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
}

export function createAsyncEventTrace(seed: TraceSeed): AsyncEventTrace {
  return normalizeTrace({
    event_id: seed.eventId ?? randomUUID(),
    route: seed.route,
    account_id: seed.accountId ?? undefined,
    contact_id: seed.contactId ?? undefined,
    conversation_id: seed.conversationId ?? undefined,
    message_id: seed.messageId ?? undefined,
  });
}

export function extendAsyncEventTrace(
  trace: AsyncEventTrace,
  patch: Omit<TraceSeed, "route" | "eventId"> & { route?: string },
): AsyncEventTrace {
  return normalizeTrace({
    ...trace,
    route: patch.route ?? trace.route,
    account_id: patch.accountId ?? trace.account_id,
    contact_id: patch.contactId ?? trace.contact_id,
    conversation_id: patch.conversationId ?? trace.conversation_id,
    message_id: patch.messageId ?? trace.message_id,
  });
}

export function eventTracePayload(
  trace: AsyncEventTrace | undefined,
  payload: Record<string, unknown> = {},
): Record<string, unknown> {
  if (!trace) return payload;
  return { event_id: trace.event_id, ...payload };
}

export function durationMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

export function errorFields(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return cleanFields({
      error_name: error.name,
      error_message: error.message,
    });
  }
  return { error_message: String(error) };
}

export function logAsyncEvent(
  level: AsyncLogLevel,
  name: string,
  trace: AsyncEventTrace,
  fields: Record<string, unknown> = {},
): void {
  const entry = cleanFields({
    ts: new Date().toISOString(),
    scope: "async-processing",
    kind: "event",
    name,
    ...normalizeTrace(trace),
    ...fields,
  });
  console[level](`[async] ${JSON.stringify(entry)}`);
}

export function logAsyncMetric(
  name: string,
  trace: AsyncEventTrace,
  fields: Record<string, unknown> = {},
): void {
  const entry = cleanFields({
    ts: new Date().toISOString(),
    scope: "async-processing",
    kind: "metric",
    name,
    ...normalizeTrace(trace),
    ...fields,
  });
  console.info(`[async] ${JSON.stringify(entry)}`);
}
