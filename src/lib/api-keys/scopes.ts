// ============================================================
// API key scopes — pure, unit-testable, no I/O.
//
// Authorization for the public API is *scopes-only*: a key's
// capabilities are defined entirely by the scopes granted to it at
// creation, independent of the role of the user who minted it. (We
// still gate *key creation* at admin+, so only trusted members can
// hand out capabilities — see the management routes.)
//
// A scope is `<resource>:<action>`. Endpoints declare the single
// scope they require; `requireApiKey(request, scope)` enforces it.
// Adding a capability = one entry here + the endpoint that checks
// it. No migration needed (the DB stores scopes as a free `text[]`).
// ============================================================

export const API_SCOPES = [
  'messages:send',
  'messages:read',
  'contacts:read',
  'contacts:write',
  'conversations:read',
  'channels:read',
  'broadcasts:send',
  'webhooks:manage',
  'tasks:read',
  'tasks:write',
  'scheduled:read',
  'scheduled:write',
  'deals:read',
  'deals:write',
  'meetings:read',
  'meetings:write',
  'notes:read',
  'notes:write',
  'custom_fields:read',
  'custom_fields:write',
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

/** Human-readable descriptions, surfaced in the key-creation UI. */
export const SCOPE_DESCRIPTIONS: Record<ApiScope, string> = {
  'messages:send': 'Send WhatsApp messages',
  'messages:read': 'Read messages and their delivery status',
  'contacts:read': 'List and read contacts',
  'contacts:write': 'Create and update contacts',
  'conversations:read': 'List and read conversations',
  'channels:read': 'List the account WhatsApp numbers (channels)',
  'broadcasts:send': 'Launch broadcast campaigns',
  // ⚠️ Diz O QUE SAI, não só o verbo. Esta chave cadastra um endereço
  // qualquer e passa a receber lá o texto das mensagens dos clientes e, nos
  // `deal.*`, o contato inteiro (telefone, e-mail, etiquetas, campos
  // personalizados) e o negócio — é o escopo que mais vaza dado da conta, e
  // "manage webhooks" soava administrativo e inofensivo na tela de criar
  // chave, que é onde o admin decide. Texto em inglês: é o que a tela mostra
  // cru, sem dicionário (o mesmo vale para as demais linhas).
  'webhooks:manage':
    'Register and manage outbound event webhooks — the subscribed events send message text and full contact and deal data (custom fields included) to the URLs registered with it',
  'tasks:read': 'List and read tasks',
  'tasks:write': 'Create tasks for team members',
  'scheduled:read': 'List scheduled messages',
  'scheduled:write': 'Schedule text messages',
  'deals:read': 'List pipelines, stages and deals',
  'deals:write': 'Create deals and move them between stages',
  'meetings:read': 'List calendar meetings',
  'meetings:write': 'Create calendar meetings',
  'notes:read': 'Read internal conversation notes',
  'notes:write': 'Create internal conversation notes',
  'custom_fields:read': 'Read contact custom field values (by field key)',
  'custom_fields:write': 'Write contact custom field values (by field key)',
};

/** Type-narrow an unknown value into a valid `ApiScope`. */
export function isApiScope(value: unknown): value is ApiScope {
  return (
    typeof value === 'string' &&
    (API_SCOPES as readonly string[]).includes(value)
  );
}

/**
 * Validate and de-duplicate a caller-supplied scope list. Returns
 * the cleaned list, or `null` if any entry is not a known scope
 * (callers turn that into a 400). An empty input is valid — it
 * yields a key that authenticates but can't do anything beyond the
 * scope-free endpoints (e.g. `GET /api/v1/me`).
 */
export function normalizeScopes(input: unknown): ApiScope[] | null {
  if (!Array.isArray(input)) return null;
  const out: ApiScope[] = [];
  for (const entry of input) {
    if (!isApiScope(entry)) return null;
    if (!out.includes(entry)) out.push(entry);
  }
  return out;
}

/**
 * True iff `granted` contains `required`. The single source of
 * truth for "is this key allowed to do X?" — both `requireApiKey`
 * and any future inline check should call this rather than poking
 * at the array directly.
 */
export function hasScope(
  granted: readonly string[],
  required: ApiScope
): boolean {
  return granted.includes(required);
}
