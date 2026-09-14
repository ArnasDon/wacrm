// ============================================================
// Acesso à tabela `cb_channels` — os canais de WhatsApp da conta.
//
// Ver o cabeçalho de supabase/migrations/0901_cb_channels.sql para o
// porquê da tabela existir ao lado de `whatsapp_config`.
//
// REGRA DE OURO DESTE MÓDULO
// `access_token` e `api_key` NUNCA saem daqui para o browser. A policy de
// RLS libera a linha inteira para qualquer membro (o Postgres não filtra
// coluna), então a barreira é aqui: consultas destinadas ao client usam
// CB_CHANNEL_SAFE_COLUMNS; só o caminho server-side lê os segredos.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Transporte } from './transporte';

/** O transporte da conexão. Ver `transporte.ts` — o único lugar que compara
 *  com o literal; o resto do código usa os predicados de lá. */
export type CbChannelKind = Transporte;
export type CbChannelStatus = 'disconnected' | 'connecting' | 'connected';

/** O que o browser pode ver. Note a ausência dos segredos. */
// ⚠️ Coluna de configuração por canal que não entrar AQUI salva no banco e
// nunca reaparece na tela — o valor some no reload e o operador conclui que
// não salvou. Já aconteceu com `default_agent_id` (903).
//
// `own_lid` (916) fica de fora de propósito: não é configuração, é um
// identificador interno descoberto sozinho, e nenhuma tela precisa dele.
export const CB_CHANNEL_SAFE_COLUMNS =
  'id, account_id, kind, label, display_phone, is_default, status, ' +
  'connected_at, last_error, phone_number_id, waba_id, server_url, ' +
  'instance_name, default_pipeline_id, default_stage_id, groups_enabled, ' +
  'radar_enabled, ig_user_id, ig_username, ig_token_expires_at, ' +
  'ig_human_agent, created_at, updated_at';

/** Canal como o client o enxerga. */
export interface CbChannel {
  id: string;
  account_id: string;
  kind: CbChannelKind;
  label: string;
  display_phone: string | null;
  is_default: boolean;
  status: CbChannelStatus;
  connected_at: string | null;
  last_error: string | null;
  phone_number_id: string | null;
  waba_id: string | null;
  server_url: string | null;
  instance_name: string | null;
  /**
   * Funil em que cai quem escrever neste número, e a etapa de entrada
   * (migration 908). `null` = a conexão não roteia nada. A etapa é explícita
   * porque a de menor `position` costuma ser faixa de estacionamento
   * ("Contato Avulso"), não a entrada do processo.
   */
  default_pipeline_id: string | null;
  default_stage_id: string | null;
  /**
   * Este número recebe mensagem de grupo (migration 906). FALSE por padrão —
   * ligar é decisão explícita do operador, canal a canal, senão o primeiro
   * deploy despejaria todos os grupos ativos do número no inbox, inclusive os
   * pessoais de quem pareou o QR.
   *
   * ⚠️ Ligar aqui não basta: a instância já conectada só passa a receber os
   * eventos de grupo depois que o webhook é reaplicado ("Ressincronizar").
   */
  groups_enabled: boolean;
  /**
   * Radar de Atendimento analisa as conversas deste canal com IA (941).
   * Nasce DESLIGADO de propósito — sigilo advogado-cliente: ligar é
   * decisão explícita do operador, canal a canal (há canal de uso pessoal
   * conectado nesta conta). É a exceção deliberada à convenção
   * "escopo vazio = todos".
   */
  radar_enabled: boolean;
  /**
   * Instagram (989). `ig_user_id` é o IG user id da conta profissional — o
   * `entry.id` do webhook; `ig_username` é o @ que a tela mostra no lugar do
   * telefone. NULL em canal de WhatsApp.
   */
  ig_user_id: string | null;
  ig_username: string | null;
  /** Quando o token de 60 dias do Instagram vence (o cron renova antes). */
  ig_token_expires_at: string | null;
  /**
   * Instagram: manda a tag HUMAN_AGENT fora das 24h (janela de 7 dias).
   * Nasce desligado — exige a feature aprovada no painel da Meta (D2).
   */
  ig_human_agent: boolean;
  created_at: string;
  updated_at: string;
}

/** Canal como o servidor o enxerga — inclui os segredos criptografados.
 *  `verify_token` fica de fora de CB_CHANNEL_SAFE_COLUMNS de propósito: é
 *  segredo, e só a verificação do webhook Meta e a promoção a padrão o leem. */
export interface CbChannelWithSecrets extends CbChannel {
  access_token: string | null;
  api_key: string | null;
  verify_token: string | null;
  /** Instagram: o Instagram App Secret CIFRADO — é quem assina o webhook. */
  ig_app_secret: string | null;
}

/**
 * Lista os canais da conta, sem segredos. Padrão primeiro, depois por
 * data de criação — a ordem em que o operador espera vê-los.
 */
export async function listChannels(
  db: SupabaseClient,
  accountId: string,
): Promise<CbChannel[]> {
  const { data, error } = await db
    .from('cb_channels')
    .select(CB_CHANNEL_SAFE_COLUMNS)
    .eq('account_id', accountId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Falha ao listar canais: ${error.message}`);
  return (data ?? []) as unknown as CbChannel[];
}

/**
 * Um canal da conta, COM os segredos ainda criptografados. Só uso
 * server-side. O filtro por `account_id` é redundante com a RLS de
 * propósito: torna o "0 linhas → 404" preciso e protege caminhos que
 * usem o client de service-role (que ignora RLS).
 */
export async function getChannelWithSecrets(
  db: SupabaseClient,
  accountId: string,
  channelId: string,
): Promise<CbChannelWithSecrets | null> {
  const { data, error } = await db
    .from('cb_channels')
    .select('*')
    .eq('id', channelId)
    .eq('account_id', accountId)
    .maybeSingle();

  if (error) throw new Error(`Falha ao carregar canal: ${error.message}`);
  return (data as CbChannelWithSecrets) ?? null;
}

/**
 * Quantos canais de WHATSAPP a conta já tem — é o que decide se o novo é o
 * padrão. O Instagram fica fora da conta de propósito: o padrão é o número
 * por onde as conversas sem canal respondem e o que o espelho
 * `whatsapp_config` copia. Numa conta que conectou o Instagram primeiro, o
 * primeiro WhatsApp ainda precisa nascer padrão.
 */
export async function countChannels(
  db: SupabaseClient,
  accountId: string,
): Promise<number> {
  const { count, error } = await db
    .from('cb_channels')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .in('kind', ['meta', 'evolution']);

  if (error) throw new Error(`Falha ao contar canais: ${error.message}`);
  return count ?? 0;
}

/**
 * Canais da conta no formato mínimo que a validação de ativação precisa
 * (id + rótulo + tipo). Usa o client de service-role dos engines/rotas, e o
 * filtro por `account_id` é a barreira de tenancy.
 *
 * Devolve `[]` (e não lança) quando a tabela ainda não existe — assim um
 * deploy fora de ordem não impede salvar automação.
 */
export async function loadAccountChannelsForValidation(
  db: SupabaseClient,
  accountId: string,
): Promise<{ id: string; label: string; kind: CbChannelKind }[]> {
  const { data, error } = await db
    .from('cb_channels')
    .select('id, label, kind')
    .eq('account_id', accountId);
  if (error) {
    console.warn(
      '[cb-channels] listagem para validação falhou (ignorado):',
      error.message,
    );
    return [];
  }
  return (data ?? []) as { id: string; label: string; kind: CbChannelKind }[];
}
