import type { Contact } from "@/types";

export const CONTACT_VARIABLE_FIELDS = ["name", "phone", "email", "company"] as const;

export type ContactVariableField = (typeof CONTACT_VARIABLE_FIELDS)[number];

export function isContactVariableField(value: string): value is ContactVariableField {
  return (CONTACT_VARIABLE_FIELDS as readonly string[]).includes(value);
}

export function contactVariableValue(
  contact: Pick<Contact, ContactVariableField>,
  field: string,
): string | undefined {
  if (!isContactVariableField(field)) return undefined;
  return contact[field] ?? undefined;
}
