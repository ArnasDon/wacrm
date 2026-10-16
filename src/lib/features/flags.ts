// ============================================================
// Per-account feature flags (accounts.feature_flags, migration 156).
//
// A flag lets a new or risky feature run on one account (the DEMO) and
// be verified with real traffic before every account gets it. The
// platform admin toggles flags per company in /admin. Keys not in this
// registry are ignored everywhere, so removing a flag here retires it.
// ============================================================

export const FEATURE_FLAGS = {
  ai_attention_hours_20_8: {
    label: 'Atenci\u00f3n autom\u00e1tica nocturna de 20:00 a 8:00',
    description: 'La IA responde solamente de 8:00 p. m. a 8:00 a. m. en la zona horaria de la empresa. Durante el d\u00eda atiende el personal.',
  },
  ai_attention_hours_8_20: {
    label: 'Atenci\u00f3n autom\u00e1tica de 8:00 a 20:00',
    description: 'Restringe respuestas, adjuntos y seguimientos autom\u00e1ticos a las 8:00-20:00 en la zona horaria de la empresa. El personal puede responder en cualquier horario.',
  },
  ai_voice_notes: {
    label: 'Notas de voz para la IA',
    description:
      'La IA transcribe las notas de voz entrantes (OpenAI) y responde a su contenido. Requiere una clave de OpenAI (proveedor o embeddings). Costo aprox. USD 0.003 por minuto.',
  },
} as const satisfies Record<string, { label: string; description: string }>;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

export const FEATURE_FLAG_KEYS = Object.keys(FEATURE_FLAGS) as FeatureFlag[];

function isFeatureFlag(key: unknown): key is FeatureFlag {
  return typeof key === 'string' && key in FEATURE_FLAGS;
}

/** Keep only known flags, deduplicated (DB rows may carry retired keys). */
export function normalizeFeatureFlags(raw: unknown): FeatureFlag[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(raw.filter(isFeatureFlag)));
}

export function hasFeature(flags: unknown, key: FeatureFlag): boolean {
  return normalizeFeatureFlags(flags).includes(key);
}
