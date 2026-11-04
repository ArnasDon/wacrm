export interface CustomValueRow {
  contact_id: string;
  custom_field_id: string;
  value: string;
}

export interface CustomValueWritePlan {
  upserts: CustomValueRow[];
  clearedFieldIds: string[];
}

export function planCustomValueWrites(
  contactId: string,
  values: Record<string, string>
): CustomValueWritePlan {
  const upserts: CustomValueRow[] = [];
  const clearedFieldIds: string[] = [];
  for (const [fieldId, raw] of Object.entries(values)) {
    const value = raw.trim();
    if (value) upserts.push({ contact_id: contactId, custom_field_id: fieldId, value });
    else clearedFieldIds.push(fieldId);
  }
  return { upserts, clearedFieldIds };
}
