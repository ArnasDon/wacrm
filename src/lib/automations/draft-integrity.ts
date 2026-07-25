import { createHash } from 'node:crypto';
import {
  generatedAutomationSchema,
  type GeneratedAutomation,
} from './dsl/schema';

/**
 * Hashes the schema-normalized automation using deterministic JSON key order.
 * Only the digest is persisted; user-authored automation content is not copied
 * into generation telemetry.
 */
export function hashAutomationDraft(draft: GeneratedAutomation): string {
  const normalized = generatedAutomationSchema.parse(draft);
  return createHash('sha256')
    .update(canonicalJson(normalized), 'utf8')
    .digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));

  return `{${entries
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(',')}}`;
}
