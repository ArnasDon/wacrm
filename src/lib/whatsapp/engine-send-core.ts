// ============================================================
// Shared provider-credential resolution for the engine senders
// (automations/meta-send.ts, flows/meta-send.ts). Both load a raw
// `whatsapp_config` row and need to know which provider it's for and
// what to decrypt — this is that logic in one place instead of
// duplicated (and, previously, hardcoded to Meta-only) in each file.
// ============================================================

import { decrypt } from './encryption'

export interface EngineProviderCreds {
  isEvolution: boolean
  // Meta
  phoneNumberId: string
  accessToken: string
  // Evolution Go
  evolutionApiUrl: string
  evolutionInstanceToken: string
}

/**
 * Resolve which provider a whatsapp_config row sends through and
 * decrypt only the secret that provider actually uses — mirrors the
 * branch in send-message.ts's sendMessageToConversation. A 'meta' row
 * is guaranteed access_token IS NOT NULL, an 'evolution' row is
 * guaranteed evolution_instance_token IS NOT NULL (migration 040's
 * CHECK constraints), so this never decrypts a null.
 */
export function resolveEngineProviderCreds(config: {
  provider?: string | null
  phone_number_id?: string | null
  access_token?: string | null
  evolution_api_url?: string | null
  evolution_instance_token?: string | null
}): EngineProviderCreds {
  const isEvolution = config.provider === 'evolution'
  return {
    isEvolution,
    phoneNumberId: config.phone_number_id ?? '',
    accessToken: isEvolution ? '' : decrypt(config.access_token as string),
    evolutionApiUrl: config.evolution_api_url ?? '',
    evolutionInstanceToken: isEvolution
      ? decrypt(config.evolution_instance_token as string)
      : '',
  }
}
