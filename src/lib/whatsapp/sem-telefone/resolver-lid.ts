// ============================================================
// LID → telefone, pelo ACERVO do próprio CRM.
//
// Toda mensagem 1:1 que entra pela Evolution 2.4 grava os DOIS endereços da
// conversa: `remote_jid` (o telefone) e `remote_jid_lid` (o LID — migration
// 917). Esse par veio do próprio WhatsApp, nos atributos da stanza
// (`sender_pn` / `peer_recipient_pn`). Quando chega uma cópia SÓ com o LID
// (ver `ehLidSemTelefone`), o telefone dela é o de qualquer mensagem já
// gravada com aquele LID.
//
// Medido em 19/09/2026: 959 LIDs no acervo, ZERO com mais de um telefone. A
// mais recente vence — o LID é da conta do WhatsApp da pessoa, e quem troca
// de número leva o LID junto.
//
// ⚠️⚠️ O LID JAMAIS vira `contacts.phone`. `findExistingContact` casa pelos
// ÚLTIMOS 8 DÍGITOS: um LID ali pode FUNDIR com o celular de um cliente real
// (a lição do JID de grupo, 906, e o motivo do descarte original — 4 contatos
// fantasmas em 26/07). Daqui só sai telefone que veio de mensagem real.
//
// Sem índice em `messages.remote_jid_lid`, de propósito: esta consulta roda
// só no caso raro (~5 por mês), e não se mexe em índice da tabela mais quente
// do banco por isso.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

/** Quantas mensagens recentes daquele LID olhar — a primeira 1:1 serve. */
const LINHAS_A_OLHAR = 5;

export interface TelefoneDoLid {
  /** `…@s.whatsapp.net`, como está em `messages.remote_jid`. */
  telefoneJid: string;
  /** A conversa onde o par foi visto — há UMA por contato por conta (036). */
  conversationId: string;
}

/**
 * Devolve `null` quando o LID nunca foi visto OU quando a consulta falhou: nos
 * dois casos o chamador RETÉM a mensagem em vez de adivinhar. NUNCA lança.
 */
export async function resolverTelefoneDoLid(
  db: SupabaseClient,
  accountId: string,
  lidJid: string
): Promise<TelefoneDoLid | null> {
  try {
    const { data, error } = await db
      .from('messages')
      // `!inner`: o filtro no recurso embutido RECORTA as mensagens (com o
      // embed LEFT ele só anularia o embutido — a armadilha de `filtros.ts`).
      // É a mesma forma que a rota do webhook já usa em produção para achar o
      // alvo de uma edição cifrada.
      .select('remote_jid, conversation_id, conversations!inner(account_id, group_id)')
      .eq('remote_jid_lid', lidJid)
      // `messages` não tem `account_id`: a conta entra pela conversa. A
      // ingestão roda em service-role e ignora RLS.
      .eq('conversations.account_id', accountId)
      .like('remote_jid', '%@s.whatsapp.net')
      .order('created_at', { ascending: false })
      .limit(LINHAS_A_OLHAR);

    if (error) {
      console.error('[evolution/sem-telefone] resolver o LID falhou:', error.message);
      return null;
    }
    // Grupo fica de fora EM JS, e não por filtro no embutido: mensagem de
    // grupo nem grava `remote_jid_lid` (e o `remote_jid` dela é `@g.us`), então
    // isto é cinto de segurança — e não vale uma forma de consulta que nunca
    // foi medida neste banco.
    for (const linha of data ?? []) {
      const embutida = linha.conversations as
        | { account_id?: string | null; group_id?: string | null }
        | { account_id?: string | null; group_id?: string | null }[]
        | null;
      const conversa = Array.isArray(embutida) ? embutida[0] : embutida;
      // ⚠️ A conta conferida TAMBÉM aqui. O recorte de verdade é o `!inner`
      // acima — mas se alguém o tirar, o PostgREST passa a devolver mensagem
      // de OUTRA conta com o embutido nulo, e nenhum teste com banco falso
      // percebe (ele não lê o texto do `select`). Daqui sai a conversa onde
      // uma mensagem de cliente vai ser gravada: sem a conta provada, não sai.
      if (conversa?.account_id !== accountId) continue;
      if (conversa?.group_id) continue;
      const telefoneJid = linha.remote_jid as string | null;
      const conversationId = linha.conversation_id as string | null;
      if (telefoneJid && conversationId) return { telefoneJid, conversationId };
    }
    return null;
  } catch (err) {
    console.error(
      '[evolution/sem-telefone] resolver o LID falhou:',
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
