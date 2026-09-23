// ============================================================
// Resolver um canal META (API oficial) para operações que NÃO passam por uma
// conversa: broadcast, sync/criação de modelos.
//
// Essas operações liam o espelho `whatsapp_config` e perguntavam
// "o canal PADRÃO é Meta?". Numa conta cujo padrão é Evolution — que é o caso
// em produção — a resposta era não, e o operador recebia
// "Broadcasts require an official Meta (Cloud API) number" logo depois de
// conectar o número oficial como canal adicional. Beco sem saída.
//
// A pergunta certa é "EXISTE um canal Meta utilizável?". Ordem:
//   1. o canal pedido explicitamente (validado contra a conta e o tipo);
//   2. o canal PADRÃO, se for Meta;
//   3. o primeiro canal Meta conectado;
//   4. o espelho `whatsapp_config`, para a conta que nunca criou cb_channels.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { ehEvolution, ehMeta } from './transporte';

export interface MetaChannelForSend {
  /** `cb_channels.id`, ou `null` quando veio do espelho legado. */
  channelId: string | null;
  phoneNumberId: string;
  /** AINDA CRIPTOGRAFADO — o chamador decripta. */
  accessToken: string;
  wabaId: string | null;
  label: string;
}

interface LinhaCanal {
  id: string;
  label: string;
  kind: string;
  is_default: boolean;
  status: string;
  phone_number_id: string | null;
  waba_id: string | null;
  access_token: string | null;
}

/** A linha serve para enviar por API oficial? */
function utilizavel(c: LinhaCanal): boolean {
  return ehMeta(c) && !!c.phone_number_id && !!c.access_token;
}

function mapear(c: LinhaCanal): MetaChannelForSend {
  return {
    channelId: c.id,
    phoneNumberId: c.phone_number_id as string,
    accessToken: c.access_token as string,
    wabaId: c.waba_id,
    label: c.label,
  };
}

/**
 * A leitura falhou — erro de BANCO, não "sem canal". Os 7 chamadores têm um
 * `catch` externo que transforma a exceção em 500; devolver `null` aqui
 * virava o 400 "conecte um número em Configurações", e quem integra pela API
 * não reenvia um 400.
 */
export class ErroAoLerCanalMeta extends Error {
  constructor(onde: string, mensagem: string) {
    super(`meta channel lookup failed (${onde}): ${mensagem}`);
    this.name = 'ErroAoLerCanalMeta';
  }
}

/** `invalid_text_representation` — o id pedido não é um UUID. */
const UUID_MALFORMADO = '22P02';

/**
 * Canal Meta por onde um broadcast / uma operação de modelo deve sair.
 * Devolve `null` quando a conta não tem NENHUM número oficial utilizável —
 * o chamador traduz isso no seu próprio erro. Erro de LEITURA lança
 * {@link ErroAoLerCanalMeta} (Fase 3e do plano do upstream): antes ele era
 * descartado nos três pontos, e um tempo esgotado do PostgREST virava "conecte
 * um número"; na lista, pior — a falha caía em silêncio no espelho legado.
 *
 * `requestedChannelId` inexistente, de outra conta, NÃO-Meta ou MALFORMADO
 * (22P02 — é entrada inválida, não banco fora) devolve `null` em vez de cair
 * no padrão: quem pediu um número específico prefere um erro a ver a campanha
 * sair pelo número errado.
 *
 * O `status` do canal pedido NÃO é conferido, de propósito: nada marca um
 * canal Meta como desconectado quando o token falha (ele nasce `connected` e
 * só a Evolution e o espelho gravam `disconnected`), então recusar por essa
 * coluna seria decidir com um dado que não diz a verdade. A falha real (token
 * inválido) aparece no envio. Sem canal pedido, a busca já PREFERE o conectado.
 */
export async function resolveMetaChannel(
  db: SupabaseClient,
  accountId: string,
  requestedChannelId?: string | null,
): Promise<MetaChannelForSend | null> {
  if (requestedChannelId) {
    const { data, error } = await db
      .from('cb_channels')
      .select('id, label, kind, is_default, status, phone_number_id, waba_id, access_token')
      .eq('id', requestedChannelId)
      .eq('account_id', accountId)
      .maybeSingle();
    if (error) {
      if (error.code === UUID_MALFORMADO) return null;
      throw new ErroAoLerCanalMeta('pedido', error.message);
    }
    const linha = data as LinhaCanal | null;
    return linha && utilizavel(linha) ? mapear(linha) : null;
  }

  const { data, error } = await db
    .from('cb_channels')
    .select('id, label, kind, is_default, status, phone_number_id, waba_id, access_token')
    .eq('account_id', accountId)
    .eq('kind', 'meta')
    // Padrão primeiro, depois conectados, depois o mais antigo — a ordem que
    // o operador espera se não escolheu nada.
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });

  // Lista que falhou NÃO cai no espelho: o espelho é para a conta que nunca
  // criou canais, e numa conta com dois números a campanha sairia pelo número
  // antigo sem ninguém ter escolhido.
  if (error) throw new ErroAoLerCanalMeta('lista', error.message);
  if (data) {
    const linhas = (data as LinhaCanal[]).filter(utilizavel);
    const conectado = linhas.find((c) => c.status === 'connected');
    const escolhido = conectado ?? linhas[0];
    if (escolhido) return mapear(escolhido);
  }

  // Espelho legado: conta que nunca passou pelo cadastro de canais.
  const { data: cfg, error: erroDoEspelho } = await db
    .from('whatsapp_config')
    .select('phone_number_id, waba_id, access_token, provider')
    .eq('account_id', accountId)
    .maybeSingle();
  if (erroDoEspelho) throw new ErroAoLerCanalMeta('espelho', erroDoEspelho.message);
  const c = cfg as {
    phone_number_id: string | null;
    waba_id: string | null;
    access_token: string | null;
    provider: string | null;
  } | null;
  if (c && !ehEvolution(c) && c.phone_number_id && c.access_token) {
    return {
      channelId: null,
      phoneNumberId: c.phone_number_id,
      accessToken: c.access_token,
      wabaId: c.waba_id,
      label: 'WhatsApp',
    };
  }
  return null;
}
