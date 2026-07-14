/**
 * Generic Webhooks Utility Helpers
 */

export interface WebhookCondition {
  field: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'exists' | 'not_exists';
  value: string;
}

export interface WebhookMapping {
  type: 'payload' | 'static' | 'upload';
  value: string;
}

/**
 * Resolves a nested key in a JSON object using dot notation.
 * e.g., getNestedValue({ customer: { name: 'John' } }, 'customer.name') => 'John'
 */
export function getNestedValue(obj: unknown, path: string): unknown {
  if (!obj || !path) return undefined;
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Flattens a nested JSON object into a list of dotted paths.
 * e.g., { a: { b: 1 } } => ['a.b']
 */
export function extractJsonPaths(obj: unknown, prefix = ''): string[] {
  if (obj === null || obj === undefined) return [];
  if (typeof obj !== 'object') return [];
  
  const paths: string[] = [];
  
  const record = obj as Record<string, unknown>;
  for (const key in record) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    const value = record[key];
    
    // Check if the current value is a nested non-array object
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      paths.push(...extractJsonPaths(value, path));
    } else {
      paths.push(path);
    }
  }
  
  return paths;
}

/**
 * Evaluates whether an incoming payload matches the specified conditions.
 */
export function evaluateConditions(
  payload: unknown,
  conditions: WebhookCondition[],
  matchType: 'all' | 'any' = 'all'
): boolean {
  if (!conditions || conditions.length === 0) return true;
  
  const results = conditions.map((cond) => {
    const val = getNestedValue(payload, cond.field);
    const target = cond.value;
    
    switch (cond.operator) {
      case 'equals':
        return String(val) === String(target);
      case 'not_equals':
        return String(val) !== String(target);
      case 'contains':
        return val !== undefined && val !== null && String(val).toLowerCase().includes(String(target).toLowerCase());
      case 'not_contains':
        return val === undefined || val === null || !String(val).toLowerCase().includes(String(target).toLowerCase());
      case 'exists':
        return val !== undefined && val !== null;
      case 'not_exists':
        return val === undefined || val === null;
      default:
        return false;
    }
  });
  
  if (matchType === 'any') {
    return results.some((r) => r === true);
  }
  return results.every((r) => r === true);
}

/**
 * Resolves template parameter mappings against an incoming payload.
 */
export function resolveMapping(payload: unknown, mapping: WebhookMapping): string {
  if (!mapping) return '';
  if (mapping.type === 'upload') {
    return mapping.value;
  }
  if (mapping.type === 'static') {
    // Replace dynamic variables in static text like {{customer.name}} or {{lead.name}}
    return mapping.value.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
      const trimmedPath = path.trim();
      const val = getNestedValue(payload, trimmedPath);
      return val !== undefined && val !== null ? String(val) : '';
    });
  }
  const val = getNestedValue(payload, mapping.value);
  return val !== undefined && val !== null ? String(val) : '';
}
