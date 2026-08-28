// ============================================================
// Resolução de conexão de WhatsApp.
//
// O ÚNICO lugar do caminho de envio que lê a tabela de configuração e
// decripta a credencial. Toda a Onda 1 (rename para
// `whatsapp_connections`, `access_token` → `credential`, resolução em
// três níveis) cabe dentro deste arquivo: nada acima dele conhece o nome
// da tabela ou o formato do ciphertext.
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
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .single();

  if (error || !config) {
    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400,
      { reason: 'not_configured' }
    );
  }

  const credential = decrypt(config.access_token);

  // Auto-cura de ciphertexts CBC legados. Fire-and-forget, idempotente.
  if (options.selfHeal && isLegacyFormat(config.access_token)) {
    void db
      .from('whatsapp_config')
      .update({ access_token: encrypt(credential) })
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
    // Onda 0: a tabela não tem coluna `provider` ainda. A migração 040
    // faz o backfill com este mesmo valor para toda linha existente.
    provider: 'meta',
    phoneNumberId: config.phone_number_id ?? null,
    credential,
  };
}
