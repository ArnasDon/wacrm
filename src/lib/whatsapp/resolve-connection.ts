// ============================================================
// Resolução de conexão de WhatsApp.
//
// O ÚNICO lugar do caminho de envio que lê a tabela de conexões e
// decripta a credencial. A resolução em três níveis (conversa →
// explícito → primária) entra na Onda 1b; a 1a só fez o rename da
// tabela. Nada acima deste arquivo conhece o nome da tabela ou o
// formato do ciphertext.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption';
import type { TransportConnection } from '@/lib/whatsapp/providers/types';
import { SendMessageError } from '@/lib/whatsapp/send-error';

export interface ResolveConnectionOptions {
  /**
   * Conexão explícita. Onda 0: aceito e ignorado — há no máximo uma
   * linha por account, então os três níveis da spec §4 (conversa →
   * explícito → primária) colapsam num só. A assinatura já existe para
   * que os call sites não precisem mudar de novo na Onda 1.
   */
  connectionId?: string;
  /** Conversa de origem. Mesma observação de `connectionId`. */
  conversationId?: string;
  /**
   * Reescreve um ciphertext CBC legado no formato GCM atual. Ligado só
   * pelo caminho da inbox / API pública, que é o único que fazia isso
   * antes deste refactor — os engines não escreviam na tabela de
   * configuração e continuam não escrevendo.
   */
  selfHeal?: boolean;
}

export async function resolveConnection(
  db: SupabaseClient,
  accountId: string,
  options: ResolveConnectionOptions = {}
): Promise<TransportConnection> {
  const { data: config, error } = await db
    .from('whatsapp_connections')
    .select('*')
    .eq('account_id', accountId)
    .eq('provider', 'meta')
    .single();

  if (error || !config) {
    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400,
      { reason: 'not_configured' }
    );
  }

  const credential = decrypt(config.credential);

  // Auto-cura de ciphertexts CBC legados. Fire-and-forget, idempotente.
  if (options.selfHeal && isLegacyFormat(config.credential)) {
    void db
      .from('whatsapp_connections')
      .update({ credential: encrypt(credential) })
      .eq('id', config.id)
      .then(
        ({ error: upgradeError }: { error: { message: string } | null }) => {
          if (upgradeError) {
            console.warn(
              '[resolve-connection] credential GCM upgrade failed:',
              upgradeError.message
            );
          }
        }
      );
  }

  return {
    id: config.id,
    accountId,
    // Backfill da 040: toda linha existente é 'meta'. A 1b acrescenta o
    // ramo 'uazapi' e a resolução em três níveis.
    provider: 'meta',
    phoneNumberId: config.phone_number_id ?? null,
    credential,
  };
}
