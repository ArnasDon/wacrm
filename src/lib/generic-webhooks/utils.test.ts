import { describe, expect, it } from 'vitest';
import {
  getNestedValue,
  extractJsonPaths,
  evaluateConditions,
  resolveMapping,
  type WebhookCondition,
  type WebhookMapping
} from './utils';

describe('Generic Webhooks Utilities', () => {
  describe('getNestedValue', () => {
    it('resolves simple keys', () => {
      const obj = { name: 'Alice' };
      expect(getNestedValue(obj, 'name')).toBe('Alice');
    });

    it('resolves nested keys', () => {
      const obj = { customer: { profile: { email: 'alice@example.com' } } };
      expect(getNestedValue(obj, 'customer.profile.email')).toBe('alice@example.com');
    });

    it('returns undefined for non-existent paths', () => {
      const obj = { customer: { name: 'Alice' } };
      expect(getNestedValue(obj, 'customer.age')).toBeUndefined();
      expect(getNestedValue(obj, 'order.id')).toBeUndefined();
    });

    it('handles null and undefined targets gracefully', () => {
      expect(getNestedValue(null, 'name')).toBeUndefined();
      expect(getNestedValue(undefined, 'name')).toBeUndefined();
    });
  });

  describe('extractJsonPaths', () => {
    it('flattens simple object keys', () => {
      const obj = { name: 'Alice', age: 30 };
      expect(extractJsonPaths(obj)).toEqual(['name', 'age']);
    });

    it('flattens nested object keys omitting arrays from recursion', () => {
      const obj = {
        id: 1,
        customer: {
          name: 'Alice',
          address: {
            city: 'New York'
          }
        },
        items: [{ id: 10 }]
      };
      expect(extractJsonPaths(obj)).toEqual([
        'id',
        'customer.name',
        'customer.address.city',
        'items'
      ]);
    });

    it('handles empty structures gracefully', () => {
      expect(extractJsonPaths({})).toEqual([]);
      expect(extractJsonPaths(null)).toEqual([]);
    });
  });

  describe('evaluateConditions', () => {
    const payload = {
      event: 'lead.created',
      lead: {
        status: 'VIP',
        score: 95
      }
    };

    it('returns true when no conditions exist', () => {
      expect(evaluateConditions(payload, [])).toBe(true);
    });

    it('evaluates equals and not_equals operators correctly', () => {
      const conds: WebhookCondition[] = [
        { field: 'event', operator: 'equals', value: 'lead.created' },
        { field: 'lead.status', operator: 'not_equals', value: 'Regular' }
      ];
      expect(evaluateConditions(payload, conds)).toBe(true);
    });

    it('evaluates contains and not_contains operators correctly', () => {
      const conds: WebhookCondition[] = [
        { field: 'lead.status', operator: 'contains', value: 'vi' }
      ];
      expect(evaluateConditions(payload, conds)).toBe(true);

      const failConds: WebhookCondition[] = [
        { field: 'lead.status', operator: 'not_contains', value: 'VIP' }
      ];
      expect(evaluateConditions(payload, failConds)).toBe(false);
    });

    it('evaluates exists and not_exists operators correctly', () => {
      const conds: WebhookCondition[] = [
        { field: 'lead.status', operator: 'exists', value: '' },
        { field: 'lead.address', operator: 'not_exists', value: '' }
      ];
      expect(evaluateConditions(payload, conds)).toBe(true);
    });

    it('supports matchType any', () => {
      const conds: WebhookCondition[] = [
        { field: 'event', operator: 'equals', value: 'lead.deleted' },
        { field: 'lead.status', operator: 'equals', value: 'VIP' }
      ];
      expect(evaluateConditions(payload, conds, 'any')).toBe(true);
      expect(evaluateConditions(payload, conds, 'all')).toBe(false);
    });
  });

  describe('resolveMapping', () => {
    const payload = { name: 'Alice', details: { code: 'VIP-99' } };

    it('resolves static values', () => {
      const mapping: WebhookMapping = { type: 'static', value: 'Hello World' };
      expect(resolveMapping(payload, mapping)).toBe('Hello World');
    });

    it('resolves payload paths', () => {
      const mapping: WebhookMapping = { type: 'payload', value: 'details.code' };
      expect(resolveMapping(payload, mapping)).toBe('VIP-99');
    });

    it('returns empty string for missing path values', () => {
      const mapping: WebhookMapping = { type: 'payload', value: 'details.missing' };
      expect(resolveMapping(payload, mapping)).toBe('');
    });
  });
});
