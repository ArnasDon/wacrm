// ============================================================
// `cb_mensagens_sem_telefone` (1010): o registro DURÁVEL de cada mensagem que
// chegou em `@lid` sem telefone.
//
//   retida     o telefone ainda não é conhecido — o payload cru fica guardado;
//   entregue   virou linha em `messages` (pelo acervo, na chegada, ou por
//              religação) — o payload é APAGADO, o conteúdo já está lá;
//   duplicada  a mesma mensagem já tinha entrado pela via normal.
//
// Tabela FECHADA ao navegador: tudo aqui roda em service-role, na ingestão.
//
// ⚠️⚠️ NADA aqui pode custar a mensagem de ninguém. Toda função engole o
// erro (o supabase-js DEVOLVE `error`, não lança — e o `catch` cobre o que ele
// lança, rede) e responde o lado seguro: `reter` que falha vira o descarte de
// sempre; `retidasDoLid` que falha vira "nenhuma retida", e a mensagem normal
// segue a vida dela.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

const TABELA = 'cb_mensagens_sem_telefone';

/**
 * Quantas retidas de um LID UMA passada religa. A primeira passada roda ENTRE
 * gravar as mensagens atuais e buscar os anexos delas: cada retida são ~6 idas
 * ao banco, então o teto é o que limita o atraso do anexo de uma mensagem
 * ATUAL. (Um lead costuma ter 1 a 3 falas retidas antes de alguém responder.)
 *
 * ⚠️ O que passar dele NÃO espera outra mensagem daquele LID (Codex, PR #226,
 * 3ª rodada): a rota drena o resto DEPOIS da fase de anexos do lote, em
 * passadas deste mesmo tamanho (`religarOResto`, em `religar.ts`). Esperar a
 * mensagem seguinte deixava a cauda retida para sempre quando o cliente não
 * voltava a escrever — justamente as falas mais RECENTES dele.
 */
export const MAXIMO_DE_RETIDAS_POR_VEZ = 10;

/**
 * Quantas passadas A MAIS a rota faz por LID, depois da fase de anexos. Com a
 * primeira, são 60 retidas de um mesmo LID por lote — número que só uma
 * sessão de criptografia quebrada por horas produziria. Trabalho limitado de
 * propósito: além disso, o resto fica para a próxima mensagem daquele LID,
 * como qualquer retida que falha.
 */
export const MAXIMO_DE_PASSADAS_DO_RESTO = 5;

/** O que identifica a ocorrência — igual nos três desfechos. */
export interface Ocorrencia {
  accountId: string;
  /** A conexão por onde CHEGOU (é por ela que o anexo de uma retida é baixado). */
  channelId: string | null;
  lidJid: string;
  providerMessageId: string;
  fromMe: boolean;
  /** `text`, `image`, `audio`… — só para o aviso dizer o que é. */
  tipo: string;
  /** Segundos, como o WhatsApp manda. */
  carimboSeg: number;
}

export interface Retida {
  id: string;
  channelId: string | null;
  providerMessageId: string;
  /** O item cru do webhook, como chegou. */
  payload: unknown;
}

function base(o: Ocorrencia) {
  return {
    account_id: o.accountId,
    channel_id: o.channelId,
    lid_jid: o.lidJid,
    provider_message_id: o.providerMessageId,
    from_me: o.fromMe,
    tipo: o.tipo,
    carimbo: new Date(o.carimboSeg * 1000).toISOString(),
  };
}

/**
 * O payload SEM a mídia em base64. Hoje as instâncias não embutem a mídia no
 * webhook (o CRM a busca por `getBase64FromMediaMessage`), mas isso é um
 * interruptor da instância: ligado, cada retida com anexo levaria megabytes
 * para um jsonb. Não se perde nada — ao religar, a mídia é buscada na
 * Evolution pela chave da mensagem, como sempre.
 */
export function semMidiaEmbutida(payload: unknown): unknown {
  const item = payload as { message?: Record<string, unknown> | null } | null;
  if (!item || typeof item !== 'object' || !item.message || !('base64' in item.message)) {
    return payload;
  }
  const message = Object.fromEntries(
    Object.entries(item.message).filter(([chave]) => chave !== 'base64')
  );
  return { ...item, message };
}

/** Banco sem a 1010 (deploy antes da migration): avisa UMA vez por processo. */
let avisouTabelaAusente = false;
function registrarFalha(onde: string, error: { code?: string; message?: string }): void {
  const ausente = error.code === '42P01' || error.code === 'PGRST205';
  if (ausente) {
    if (avisouTabelaAusente) return;
    avisouTabelaAusente = true;
  }
  console.error(`[evolution/sem-telefone] ${onde} falhou:`, error.message ?? error.code);
}

/**
 * Guarda a mensagem até o telefone aparecer. `true` = está guardada (agora ou
 * de uma entrega anterior do mesmo webhook).
 *
 * ⚠️ `ignoreDuplicates`: a Evolution REENTREGA o webhook quando não recebe 200
 * a tempo, e a segunda cópia não pode virar segunda linha nem desfazer o
 * desfecho que a primeira já teve.
 */
export async function reter(
  db: SupabaseClient,
  o: Ocorrencia,
  payload: unknown
): Promise<boolean> {
  try {
    const { error } = await db
      .from(TABELA)
      .upsert(
        { ...base(o), situacao: 'retida', payload: semMidiaEmbutida(payload) },
        { onConflict: 'account_id,provider_message_id', ignoreDuplicates: true }
      );
    if (error) {
      registrarFalha('reter', error);
      return false;
    }
    return true;
  } catch (err) {
    registrarFalha('reter', { message: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/**
 * As retidas de um LID, da mais antiga para a mais nova — é a ordem em que
 * entram no fio —, até `MAXIMO_DE_RETIDAS_POR_VEZ`. Sempre a partir da MAIS
 * ANTIGA ainda retida: a que foi entregue sai do conjunto, então chamar de
 * novo devolve a página seguinte. Falha = lista vazia (nunca lança): quem
 * chama está no caminho de uma mensagem NORMAL, que não pode pagar por isto.
 */
export async function retidasDoLid(
  db: SupabaseClient,
  accountId: string,
  lidJid: string
): Promise<Retida[]> {
  try {
    const { data, error } = await db
      .from(TABELA)
      .select('id, channel_id, provider_message_id, payload')
      .eq('account_id', accountId)
      .eq('lid_jid', lidJid)
      .eq('situacao', 'retida')
      .order('carimbo', { ascending: true })
      // Uma PÁGINA: o que passar do teto é drenado pela rota nas passadas
      // seguintes (`religarOResto`), depois da fase de anexos do lote.
      .limit(MAXIMO_DE_RETIDAS_POR_VEZ);
    if (error) {
      registrarFalha('ler as retidas', error);
      return [];
    }
    return (data ?? []).map((l) => ({
      id: l.id as string,
      channelId: (l.channel_id as string | null) ?? null,
      providerMessageId: l.provider_message_id as string,
      payload: l.payload,
    }));
  } catch (err) {
    registrarFalha('ler as retidas', {
      message: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * A mensagem virou linha em `messages`. UPSERT, e não UPDATE: a resolvida NA
 * CHEGADA nunca teve linha aqui (nasce `entregue`), e a religada já tinha
 * (`retida` → `entregue`). ⚠️ O registro conta o que o CRM RECUPEROU ou
 * RETEVE — a cópia que chega quando a mensagem já está no fio (4 dos 5 casos
 * medidos) sai calada, sem linha: não houve o que recuperar.
 */
export async function marcarEntregue(
  db: SupabaseClient,
  o: Ocorrencia,
  resolvidaPor: 'acervo' | 'religacao',
  messageId: string
): Promise<void> {
  try {
    const { error } = await db.from(TABELA).upsert(
      {
        ...base(o),
        situacao: 'entregue',
        resolvida_por: resolvidaPor,
        message_id: messageId,
        // Conteúdo de cliente: existe só enquanto é necessário (CHECK da 1010).
        payload: null,
        resolvida_em: new Date().toISOString(),
      },
      { onConflict: 'account_id,provider_message_id' }
    );
    if (error) registrarFalha('marcar entregue', error);
  } catch (err) {
    registrarFalha('marcar entregue', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * A mesma mensagem já estava em `messages` (entrou pela via normal).
 *
 * ⚠️ Com a CERCA `situacao = 'retida'`: dois religadores podem correr juntos
 * (rajada de mensagens do mesmo cliente), e quem perdeu o insert chega aqui
 * DEPOIS de o outro já ter gravado `entregue` — sem a cerca, a linha
 * terminaria dizendo "duplicada" sobre mensagem que ELA entregou.
 */
export async function marcarDuplicada(db: SupabaseClient, id: string): Promise<void> {
  try {
    const { error } = await db
      .from(TABELA)
      .update({ situacao: 'duplicada', payload: null, resolvida_em: new Date().toISOString() })
      .eq('id', id)
      .eq('situacao', 'retida');
    if (error) registrarFalha('marcar duplicada', error);
  } catch (err) {
    registrarFalha('marcar duplicada', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
