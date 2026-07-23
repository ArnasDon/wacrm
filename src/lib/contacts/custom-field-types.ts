export const CUSTOM_FIELD_TYPES = [
  'text',
  'number',
  'date',
  'select',
  'checkbox',
  'url',
  'phone',
] as const;

export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export interface CustomFieldOptions {
  options?: string[];
}

export type ParsedCustomValue = string | number | boolean | null;

export interface CustomFieldValidationMessages {
  invalidNumber: string;
  invalidDate: string;
  selectOptionsRequired: string;
  selectInvalidOption: string;
  invalidHttpUrl: string;
  invalidUrl: string;
  invalidPhone: string;
}

export interface CustomFieldFormatOptions {
  checkboxLabels?: {
    checked: string;
    unchecked: string;
  };
}

const DEFAULT_VALIDATION_MESSAGES: CustomFieldValidationMessages = {
  invalidNumber: 'Enter a valid number.',
  invalidDate: 'Enter a valid date.',
  selectOptionsRequired: 'Add select options before saving a value.',
  selectInvalidOption: 'Choose one of the configured options.',
  invalidHttpUrl: 'Enter a valid HTTP or HTTPS URL.',
  invalidUrl: 'Enter a valid URL.',
  invalidPhone: 'Enter a valid phone number.',
};

export const CUSTOM_FIELD_EMPTY_SELECT_VALUE = '__custom_field_empty__';
const CUSTOM_FIELD_SELECT_VALUE_PREFIX = 'option:';

export const CUSTOM_FIELD_TYPE_DEFINITIONS: Array<{
  value: CustomFieldType;
  label: string;
  icon: string;
}> = [
  { value: 'text', label: 'Text', icon: 'Type' },
  { value: 'number', label: 'Number', icon: 'Hash' },
  { value: 'date', label: 'Date', icon: 'Calendar' },
  { value: 'select', label: 'Select', icon: 'List' },
  { value: 'checkbox', label: 'Checkbox', icon: 'CheckSquare' },
  { value: 'url', label: 'URL', icon: 'Link' },
  { value: 'phone', label: 'Phone', icon: 'Phone' },
];

export function isCustomFieldType(value: unknown): value is CustomFieldType {
  return (
    typeof value === 'string' &&
    CUSTOM_FIELD_TYPES.includes(value as CustomFieldType)
  );
}

export function coerceCustomFieldType(value: unknown): CustomFieldType {
  return isCustomFieldType(value) ? value : 'text';
}

export function parseSelectOptions(options?: unknown): string[] {
  if (
    !options ||
    typeof options !== 'object' ||
    !('options' in options) ||
    !Array.isArray((options as CustomFieldOptions).options)
  ) {
    return [];
  }

  const rawOptions = (options as CustomFieldOptions).options;
  if (!rawOptions) return [];

  const seen = new Set<string>();
  return rawOptions
    .filter((option): option is string => typeof option === 'string')
    .map((option) => option.trim())
    .filter((option) => {
      if (!option) return false;
      const key = option.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function encodeCustomFieldSelectValue(value: string): string {
  if (!value) return CUSTOM_FIELD_EMPTY_SELECT_VALUE;
  return `${CUSTOM_FIELD_SELECT_VALUE_PREFIX}${encodeURIComponent(value)}`;
}

export function decodeCustomFieldSelectValue(value?: string | null): string {
  if (!value || value === CUSTOM_FIELD_EMPTY_SELECT_VALUE) return '';
  if (!value.startsWith(CUSTOM_FIELD_SELECT_VALUE_PREFIX)) return value;

  try {
    return decodeURIComponent(
      value.slice(CUSTOM_FIELD_SELECT_VALUE_PREFIX.length)
    );
  } catch {
    return '';
  }
}

export function parseCustomValue(
  type: CustomFieldType,
  raw?: string | null
): ParsedCustomValue {
  const value = raw ?? '';
  const trimmed = value.trim();

  if (!trimmed) {
    return type === 'checkbox' ? false : null;
  }

  if (type === 'checkbox') {
    return ['1', 'true', 'yes', 'on'].includes(trimmed.toLowerCase());
  }

  if (type === 'number') {
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : trimmed;
  }

  return trimmed;
}

export function serializeCustomValue(
  type: CustomFieldType,
  value: ParsedCustomValue
): string {
  if (type === 'checkbox') {
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return parseCustomValue(type, String(value ?? '')) ? 'true' : 'false';
  }

  if (value == null) return '';

  if (type === 'number') {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? String(value) : '';
    }
    return String(value).trim();
  }

  return String(value).trim();
}

export function validateCustomValue(
  type: CustomFieldType,
  raw?: string | null,
  options?: unknown,
  messages: CustomFieldValidationMessages = DEFAULT_VALIDATION_MESSAGES
): string | null {
  const value = (raw ?? '').trim();

  if (!value) return null;

  if (type === 'number') {
    return Number.isFinite(Number(value)) ? null : messages.invalidNumber;
  }

  if (type === 'date') {
    return isIsoDate(value) ? null : messages.invalidDate;
  }

  if (type === 'select') {
    const selectOptions = parseSelectOptions(options);
    if (selectOptions.length === 0) {
      return messages.selectOptionsRequired;
    }
    return selectOptions.includes(value) ? null : messages.selectInvalidOption;
  }

  if (type === 'url') {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:'
        ? null
        : messages.invalidHttpUrl;
    } catch {
      return messages.invalidUrl;
    }
  }

  if (type === 'phone') {
    return value.replace(/\D/g, '').length >= 3 ? null : messages.invalidPhone;
  }

  return null;
}

export function formatCustomValue(
  type: CustomFieldType,
  raw?: string | null,
  options?: CustomFieldFormatOptions
): string {
  const parsed = parseCustomValue(type, raw);

  if (parsed == null) return '';
  if (type === 'checkbox') {
    const labels = options?.checkboxLabels ?? {
      checked: 'Yes',
      unchecked: 'No',
    };
    return parsed ? labels.checked : labels.unchecked;
  }
  if (type === 'number' && typeof parsed === 'number') {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 20 }).format(
      parsed
    );
  }

  return String(parsed);
}

function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const [, rawYear, rawMonth, rawDay] = match;
  if (!rawYear || !rawMonth || !rawDay) return false;

  const year = Number(rawYear);
  const month = Number(rawMonth);
  const day = Number(rawDay);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
