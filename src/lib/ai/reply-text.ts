// Pure helpers about the TEXT a model returns — no network, no db, so
// they can be unit-tested without the server-only modules.

/**
 * Is this stray output something we can send to a customer? Only if it
 * reads like a sentence a person would type — not a fragment of JSON,
 * and not the model thinking out loud about the schema.
 */
export function plainReplyFrom(raw: string): string | null {
  const text = raw.trim()
  if (text.length < 2 || text.length > 600) return null
  if (/[{}[\]]/.test(text)) return null
  if (/\b(json|schema|intent|product_id|customer_name|customer_email)\b/i.test(text)) return null
  // Reasoning leaks talk *about* the customer rather than to them.
  if (/^(we need to|we should|the user|the customer (wants|is asking|asked)|okay,|let'?s )/i.test(text)) return null
  return text
}
