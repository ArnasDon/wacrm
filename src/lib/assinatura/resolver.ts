import type { SupabaseClient } from '@supabase/supabase-js';

import { nomeDePessoa, saneiaNome } from './assinatura';

// ============================================================
// Quem assina, resolvido contra o banco (migration 923).
//
// Separado das funções puras de `assinatura.ts` de propósito: aqui há I/O, e
// é este arquivo que decide a REGRA de quem pode assinar com o quê.
// ============================================================

/**
 * O nome que deve assinar uma mensagem, ou `null` para não assinar.
 *
 * ⚠️ A regra que importa, e o motivo de isto não ser uma linha no meio do
 * envio: **mensagem sem gente não leva nome de gente** (P1.5).
 *
 *  · `senderUserId` presente  → primeiro nome da pessoa que apertou enviar.
 *  · `senderUserId` ausente   → nome do escritório
 *    (`assinatura_nome_automatica`).
 *
 * O segundo caso não é exceção rara: cobre a API pública e o MCP, que
 * autenticam por CHAVE, e cobre automação, fluxo e IA. Assinar qualquer um
 * deles com o nome do dono da conta diria ao cliente que aquela pessoa leu o
 * caso e respondeu — o que num escritório de advocacia é uma afirmação séria,
 * e falsa.
 *
 * Devolve `null` (não assina) quando o interruptor está desligado, quando não
 * há nome utilizável, ou quando qualquer leitura falha. Falha fechada de
 * propósito: assinatura é acessória, e derrubar o envio de uma mensagem para
 * um cliente por causa dela seria trocar um enfeite por um atendimento.
 */
export async function nomeParaAssinar(
  db: SupabaseClient,
  accountId: string,
  senderUserId?: string | null,
): Promise<string | null> {
  try {
    const { data: conta } = await db
      .from('accounts')
      .select('assinatura_ativa, assinatura_nome_automatica')
      .eq('id', accountId)
      .maybeSingle();

    if (!conta?.assinatura_ativa) return null;

    if (!senderUserId) {
      return saneiaNome(conta.assinatura_nome_automatica as string | null);
    }

    const { data: perfil } = await db
      .from('profiles')
      .select('full_name, email')
      .eq('user_id', senderUserId)
      .maybeSingle();

    return nomeDePessoa(
      perfil?.full_name as string | null,
      perfil?.email as string | null,
    );
  } catch (erro) {
    console.warn('[assinatura] não foi possível resolver quem assina:', erro);
    return null;
  }
}

/**
 * A assinatura PERSONALIZADA de uma automação (998, D18): "Carol -
 * financeiro" no lugar do nome automático do escritório. Não é usuário —
 * "Carol" não precisa de login —, é texto livre saneado (`saneiaNome`, que
 * tira `*_~`), e continua sob o interruptor da conta: desligado, nada
 * assina. Falha fechada como as irmãs.
 */
export async function nomePersonalizadoParaAssinar(
  db: SupabaseClient,
  accountId: string,
  texto: string,
): Promise<string | null> {
  try {
    const { data: conta } = await db
      .from('accounts')
      .select('assinatura_ativa')
      .eq('id', accountId)
      .maybeSingle();
    if (!conta?.assinatura_ativa) return null;
    return saneiaNome(texto);
  } catch (erro) {
    console.warn('[assinatura] não foi possível resolver a assinatura personalizada:', erro);
    return null;
  }
}

/**
 * Atalho para os motores (automação, fluxo, IA), que nunca têm pessoa.
 *
 * Existe como função própria — e não como `nomeParaAssinar(db, conta, null)` —
 * para que o call site diga em voz alta que aquilo é robô. Quem for ler
 * `automations/meta-send.ts` daqui a um ano precisa ver a intenção sem
 * rastrear um argumento nulo.
 */
export async function nomeAutomaticoParaAssinar(
  db: SupabaseClient,
  accountId: string,
): Promise<string | null> {
  return nomeParaAssinar(db, accountId, null);
}
