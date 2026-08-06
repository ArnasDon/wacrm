// ============================================================
// Tipos compartidos de campañas (Broadcast WhatsApp + Email).
//
// Fuente única de verdad para config de audiencia y mapeo de
// variables. Antes vivían duplicados en use-broadcast-sending.ts,
// step2/step3/step4 — cada uno con su propia copia que podía
// desviarse. Centralizados aquí para reutilización atómica.
// ============================================================

export type CustomFieldOperator = 'is' | 'is_not' | 'contains';

export interface CustomFieldFilter {
  fieldId: string;
  operator: CustomFieldOperator;
  value: string;
}

export interface AudienceConfig {
  type: 'all' | 'tags' | 'custom_field' | 'csv';
  tagIds?: string[];
  customField?: CustomFieldFilter;
  csvContacts?: { phone: string; name?: string }[];
  /** Contacts carrying any of these tags are subtracted from the result. */
  excludeTagIds?: string[];
}

/**
 * Variable mapping — cada placeholder del template se resuelve al
 * enviar. `field` mapea a un campo built-in del contacto
 * (name/phone/email/company); `custom_field` a una fila de
 * contact_custom_values keyed por custom_fields.id.
 */
export type VariableMapping =
  | { type: 'static'; value: string }
  | { type: 'field'; value: string }
  | { type: 'custom_field'; value: string };
