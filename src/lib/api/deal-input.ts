import { RequestError, requireUUID } from './local-route';
import type { DealInput } from '@/lib/db/deals';
export function dealInput(body: Record<string, unknown>): DealInput {
  const result: Record<string, unknown> = {};
  for (const key of ['pipeline_id', 'stage_id', 'contact_id', 'assigned_to']) {
    if (!Object.hasOwn(body, key)) continue;
    result[key] = (key === 'contact_id' || key === 'assigned_to') && body[key] === null ? null : requireUUID(body[key]);
  }
  for (const [key, max] of [['title', 500], ['notes', 20000]] as const) {
    if (!Object.hasOwn(body, key)) continue;
    const value = body[key];
    if (key === 'notes' && value === null) { result[key] = null; continue; }
    if (typeof value !== 'string' || value.length > max || (key === 'title' && !value.trim())) throw new RequestError('Invalid deal text.');
    result[key] = value.trim();
  }
  if (Object.hasOwn(body, 'value')) {
    if (typeof body.value !== 'number' || !Number.isFinite(body.value) || Math.abs(body.value) >= 10000000000) throw new RequestError('Invalid deal value.');
    result.value = body.value;
  }
  if (Object.hasOwn(body, 'currency')) {
    if (typeof body.currency !== 'string' || !/^[A-Z]{3}$/.test(body.currency)) throw new RequestError('Invalid currency.');
    result.currency = body.currency;
  }
  if (Object.hasOwn(body, 'status')) {
    if (!['open', 'won', 'lost'].includes(String(body.status))) throw new RequestError('Invalid deal status.');
    result.status = body.status;
  }
  if (Object.hasOwn(body, 'expected_close_date')) {
    if (body.expected_close_date !== null && (typeof body.expected_close_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.expected_close_date))) throw new RequestError('Invalid close date.');
    result.expected_close_date = body.expected_close_date;
  }
  return result as DealInput;
}
