// ============================================================
// Resolução de conexão de WhatsApp.
//
// O ÚNICO lugar do caminho de envio que lê a tabela de conexões e
// decripta a credencial. A resolução acontece em três níveis: a
// conexão da conversa de origem → o `connectionId` explícito → a linha
// primária da conta. A variante devolvida (`meta` ou `uazapi`) é
// montada aqui a partir de `row.provider`. Nada acima deste arquivo
// conhece o nome da tabela ou o formato do ciphertext.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption';
import type { TransportConnection } from '@/lib/whatsapp/providers/types';
import { SendMessageError } from '@/lib/whatsapp/send-error';

export interface ResolveConnectionOptions {
  /**
   * Conexão explícita a usar (nível 2). Aplicada quando a conversa de
   * origem não fixa uma conexão; ainda cede para a primária se este id
   * não carregar (arquivado / inválido).
   */
  connectionId?: string;
  /**
   * Conversa de origem (nível 1). Seu `connection_id` é tentado
   * primeiro; se for NULL ou a linha não carregar, cai para o
   * `connectionId` explícito e depois para a primária.
   */
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
  // Nível 1: a conexão da conversa de origem, se houver e não for NULL.
  let targetId: string | undefined;
  if (options.conversationId) {
    const { data: conv } = await db
      .from('conversations')
      .select('connection_id')
      .eq('id', options.conversationId)
      .eq('account_id', accountId)
      .maybeSingle();
    if (conv?.connection_id) targetId = conv.connection_id as string;
  }
  // Nível 2: connectionId explícito.
  if (!targetId && options.connectionId) targetId = options.connectionId;

  // Carrega o alvo (nível 1/2) ou a primária (nível 3).
  const query = db
    .from('whatsapp_connections')
    .select('*')
    .eq('account_id', accountId)
    .is('archived_at', null);
  const { data: row } = targetId
    ? await query.eq('id', targetId).maybeSingle()
    : await query.eq('is_primary', true).maybeSingle();

  // Alvo que não carregou (arquivado / id inválido) → cai para a primária.
  const resolved =
    row ??
    (targetId
      ? (
          await db
            .from('whatsapp_connections')
            .select('*')
            .eq('account_id', accountId)
            .is('archived_at', null)
            .eq('is_primary', true)
            .maybeSingle()
        ).data
      : null);

  if (!resolved) {
    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400,
      { reason: 'not_configured' }
    );
  }

  const credential = decrypt(resolved.credential);

  // Auto-cura de ciphertexts CBC legados. Fire-and-forget, idempotente.
  if (options.selfHeal && isLegacyFormat(resolved.credential)) {
    void db
      .from('whatsapp_connections')
      .update({ credential: encrypt(credential) })
      .eq('id', resolved.id)
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

  if (resolved.provider === 'uazapi') {
    return {
      id: resolved.id,
      accountId,
      credential,
      provider: 'uazapi',
      instanceId: resolved.uazapi_instance_id,
      baseUrl: resolved.uazapi_base_url,
    };
  }
  return {
    id: resolved.id,
    accountId,
    credential,
    provider: 'meta',
    phoneNumberId: resolved.phone_number_id ?? '',
  };
}
