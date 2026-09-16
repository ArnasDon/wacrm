// ============================================================
// Saúde das conexões — o que o indicador do cabeçalho mostra.
//
// A REGRA QUE ESTE MÓDULO CARREGA: `cb_channels.status` sozinho mente.
// Ele só muda quando o webhook `connection.update` chega ou quando alguém
// clica em parear/ressincronizar/reparear. Servidor Evolution morto, ou
// webhook desapontado, não produzem evento nenhum — e a linha segue dizendo
// `connected` indefinidamente. Por isso saúde tem DOIS eixos:
//
//     estado reportado          ×          frescor da informação
//
// e o "amarelo = travado" é exatamente `connected` + informação velha.
//
// ESCALA: um canal Evolution não custa uma requisição. `fetchInstances`
// devolve TODAS as instâncias de um servidor numa chamada só, então 2 ou 20
// canais no mesmo servidor custam o mesmo. A Meta não tem bulk por número:
// aí é uma chamada por canal, com cache mais longo.
//
// ⚠️ `fetchInstances` devolve as instâncias de TODAS as contas do servidor
// compartilhado. O cruzamento com os `instance_name` DESTA conta é barreira
// de tenancy, não otimização.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { EvolutionClient } from '@/lib/whatsapp/transport/evolution-client';
import { evolutionGlobalConfig } from '@/lib/whatsapp/transport/evolution-provision';
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';
import { ehUrlAlcancavel } from './webhook-url';
import type { CbChannelStatus, CbChannelKind } from './repo';
import { ehEvolution, ehInstagram, ehMeta } from './transporte';
import { atrasoDaFronteira, entregaAtrasada } from './atraso-de-entrega';
import { identidadeDoCanal } from './display';
import { InstagramApiError, criarClienteInstagram } from '@/lib/instagram/graph';

/** Cor do glifo. `unknown` = configuração incompleta, nem dá para sondar. */
export type HealthTone = 'ok' | 'warn' | 'down' | 'unknown';

export interface ChannelHealth {
  id: string;
  label: string;
  kind: CbChannelKind;
  phone: string | null;
  isDefault: boolean;
  tone: HealthTone;
  status: CbChannelStatus;
  connectedAt: string | null;
  /** Quando a sonda falou com o provedor pela última vez (ISO). */
  checkedAt: string | null;
  /** Motivo em uma linha, quando não está tudo bem. */
  detail: string | null;
  /**
   * Nível 2: o webhook da instância aponta para este CRM?
   * `null` = não checado nesta volta (canal Meta, ou cache ainda quente).
   */
  webhookOk: boolean | null;
  /**
   * Nível 3: quanto tempo a última mensagem levou do WhatsApp até aqui, em
   * segundos. `null` = nunca se mediu nesta conexão, que NÃO é zero — ver
   * `atraso-de-entrega.ts`.
   */
  atrasoSeg: number | null;
  /** Quando essa medição foi feita (ISO). Medição velha vale menos. */
  atrasoMedidoEm: string | null;
}

/** Acima disto, "conectado" deixa de ser confiável e vira amarelo. */
export const STALE_MS = 90_000;

/**
 * A sonda é de leitura e roda no caminho da tela: cortar cedo é melhor que
 * segurar o cabeçalho. Diferente do envio, onde o teto é generoso de
 * propósito porque abortar não cancela a entrega ao cliente.
 */
const PROBE_TIMEOUT_MS = 4_000;

const TTL_EVOLUTION_MS = 15_000;
const TTL_META_MS = 60_000;
/** Nível 2 é uma chamada POR instância — cadência bem mais lenta. */
const TTL_WEBHOOK_MS = 5 * 60_000;

// ------------------------------------------------------------
// Cache + single-flight
//
// `replicas: 1` no Swarm hoje, então este Map é singleton de verdade. Com N
// abas abertas pedindo a cada 30s, o servidor Evolution vê ~4 chamadas por
// minuto — independente de quantos canais existam. Se um dia escalar as
// réplicas, vira um cache por réplica: multiplica as sondas por N, não
// quebra nada.
// ------------------------------------------------------------
interface Entrada<T> {
  expiraEm: number;
  valor: T;
}
const cache = new Map<string, Entrada<unknown>>();
const emVoo = new Map<string, Promise<unknown>>();

export async function comCache<T>(
  chave: string,
  ttlMs: number,
  produzir: () => Promise<T>,
): Promise<T> {
  const agora = Date.now();
  const guardado = cache.get(chave) as Entrada<T> | undefined;
  if (guardado && guardado.expiraEm > agora) return guardado.valor;

  // Single-flight: dez abas atualizando juntas não viram dez chamadas.
  const jaPedido = emVoo.get(chave) as Promise<T> | undefined;
  if (jaPedido) return jaPedido;

  const promessa = produzir()
    .then((valor) => {
      cache.set(chave, { expiraEm: Date.now() + ttlMs, valor });
      return valor;
    })
    .finally(() => {
      emVoo.delete(chave);
    });

  emVoo.set(chave, promessa);
  return promessa;
}

/** Só para teste — o cache é de módulo e vaza entre casos. */
export function __limparCacheDeSaude() {
  cache.clear();
  emVoo.clear();
}

// ------------------------------------------------------------
// A regra de cor. Pura, e é o que os testes protegem.
// ------------------------------------------------------------
export interface EntradaDeCor {
  status: CbChannelStatus;
  /** Estado que o provedor acabou de reportar. `null` = não respondeu. */
  estadoVivo: 'open' | 'connecting' | 'close' | null;
  /** ISO da última vez que a sonda falou com o provedor. */
  checkedAt: string | null;
  lastError: string | null;
  /** Credenciais/roteamento faltando — não há o que sondar. */
  incompleto: boolean;
  /** Nível 2. `false` = o webhook não aponta para cá. */
  webhookOk: boolean | null;
  /** Nível 3. Atraso de entrega em segundos; `null` = nunca medido. */
  atrasoSeg: number | null;
  agoraMs: number;
}

/**
 * VERMELHO = não envia. AMARELO = degradado ou desconhecido. Verde só com
 * estado bom E informação fresca.
 *
 * O cinza é uma quarta caixa que o enunciado original não previa mas o banco
 * tem: canal cadastrado que nunca foi pareado não é "caiu", é "nunca ficou de
 * pé". Pintar de vermelho manda o operador procurar uma queda que não houve.
 */
export function toneFor(e: EntradaDeCor): { tone: HealthTone; detail: string | null } {
  if (e.incompleto) {
    return { tone: 'unknown', detail: 'incomplete' };
  }

  // O provedor respondeu agora: é a informação mais confiável que existe.
  if (e.estadoVivo === 'close') return { tone: 'down', detail: 'closed' };
  if (e.estadoVivo === 'connecting') return { tone: 'warn', detail: 'pairing' };

  if (e.estadoVivo === 'open') {
    // Conectado no provedor, mas o webhook não aponta para cá: o WhatsApp
    // está de pé e o CRM está surdo. É o caso mais traiçoeiro de todos, e o
    // único motivo do nível 2 existir.
    if (e.webhookOk === false) return { tone: 'warn', detail: 'webhook' };
    if (e.lastError) return { tone: 'warn', detail: 'lastError' };
    // Nível 3: de pé, ouvindo, sem erro — e entregando tarde. Era o único
    // buraco que sobrava, e foi por ele que passaram os 29 minutos de
    // 16/09/2026 sem o sistema dizer nada.
    if (entregaAtrasada(e.atrasoSeg)) return { tone: 'warn', detail: 'lagging' };
    return { tone: 'ok', detail: null };
  }

  // ---- O provedor NÃO respondeu. Sobra o que está gravado. ----
  if (e.status === 'disconnected') return { tone: 'down', detail: 'disconnected' };
  if (e.status === 'connecting') return { tone: 'warn', detail: 'pairing' };

  // `status === 'connected'` sem confirmação. Aqui mora a mentira que este
  // módulo existe para desarmar: só é verde enquanto a informação for nova.
  const idadeMs = e.checkedAt ? e.agoraMs - Date.parse(e.checkedAt) : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(idadeMs) || idadeMs > STALE_MS) {
    return { tone: 'warn', detail: 'stale' };
  }
  if (e.lastError) return { tone: 'warn', detail: 'lastError' };
  // O atraso é informação LOCAL — medida na nossa ingestão, não perguntada
  // ao provedor —, então vale igual aqui, onde o provedor não respondeu.
  if (entregaAtrasada(e.atrasoSeg)) return { tone: 'warn', detail: 'lagging' };
  return { tone: 'ok', detail: null };
}

/**
 * O que uma FALHA do `/me` do Instagram diz sobre o canal. Só a RESPOSTA da
 * Meta prova queda (token vencido/revogado, sem permissão). Tempo esgotado ou
 * rede fora é "não sei": fica `null`, e o tom vem do frescor do último
 * estado gravado — senão um blip de rede gravava `disconnected` com carimbo
 * novo, que é o verde mentiroso ao contrário (Codex, PR #167).
 */
export function estadoDaFalhaDoInstagram(err: unknown): 'close' | null {
  if (!(err instanceof InstagramApiError)) return 'close';
  // Rede fora, limite de chamadas (429) e 5xx da Meta são "não sei" — o
  // token pode estar perfeito. Só 4xx com resposta (190, permissão) é queda.
  if (err.codigo === 'rede' || err.codigo === 'limite') return null;
  if (err.status !== null && err.status >= 500) return null;
  return 'close';
}

/** O pior tom de um conjunto — é o que o glifo colapsado mostra. */
export function piorTom(tons: HealthTone[]): HealthTone {
  const ordem: HealthTone[] = ['down', 'warn', 'unknown', 'ok'];
  for (const t of ordem) if (tons.includes(t)) return t;
  return 'ok';
}

// ------------------------------------------------------------
// Sondas por provedor
// ------------------------------------------------------------
interface InstanciaBruta {
  name?: string;
  instanceName?: string;
  connectionStatus?: string;
  state?: string;
  instance?: { instanceName?: string; state?: string };
}

function normalizarEstado(bruto?: string): 'open' | 'connecting' | 'close' {
  return bruto === 'open' || bruto === 'connecting' ? bruto : 'close';
}

/** Mapa `instance_name` → estado, de um servidor Evolution inteiro. */
export async function estadosDoServidor(
  baseUrl: string,
  apikey: string,
): Promise<Map<string, 'open' | 'connecting' | 'close'>> {
  const client = new EvolutionClient({ baseUrl, apikey, instance: '_' });
  const lista = (await client.fetchInstances(PROBE_TIMEOUT_MS)) as InstanciaBruta[];
  const mapa = new Map<string, 'open' | 'connecting' | 'close'>();
  if (!Array.isArray(lista)) return mapa;
  for (const it of lista) {
    const nome = it?.name ?? it?.instanceName ?? it?.instance?.instanceName;
    if (!nome) continue;
    mapa.set(nome, normalizarEstado(it.connectionStatus ?? it.state ?? it.instance?.state));
  }
  return mapa;
}

/** Nível 2: o webhook desta instância aponta para um endereço público? */
async function webhookApontaParaCa(
  baseUrl: string,
  apikey: string,
  instanceName: string,
): Promise<boolean | null> {
  try {
    const client = new EvolutionClient({ baseUrl, apikey, instance: instanceName });
    const bruto = (await client.findWebhook()) as Record<string, unknown> | null;
    const w = ((bruto?.webhook as Record<string, unknown>) ?? bruto ?? {}) as {
      url?: string;
      enabled?: boolean;
    };
    if (w.enabled === false) return false;
    // Não comparamos com a URL deste processo de propósito: em dev a origem é
    // local e a produção é quem legitimamente recebe. A pergunta útil é "está
    // apontado para algum lugar que a Evolution alcança?".
    return ehUrlAlcancavel(w.url ?? null);
  } catch {
    // "Não consegui saber" ≠ "está errado". Amarelo por webhook é acusação
    // séria; só a fazemos com resposta na mão.
    return null;
  }
}

// ------------------------------------------------------------
// A sonda
// ------------------------------------------------------------
interface LinhaDeCanal {
  id: string;
  kind: CbChannelKind;
  label: string;
  display_phone: string | null;
  ig_username: string | null;
  is_default: boolean;
  status: CbChannelStatus;
  connected_at: string | null;
  last_error: string | null;
  last_checked_at: string | null;
  phone_number_id: string | null;
  server_url: string | null;
  instance_name: string | null;
  access_token: string | null;
  ig_user_id: string | null;
  entrega_carimbo_em: string | null;
  entrega_recebida_em: string | null;
}

export async function probeChannels(
  db: SupabaseClient,
  accountId: string,
): Promise<ChannelHealth[]> {
  const { data, error } = await db
    .from('cb_channels')
    .select(
      'id, kind, label, display_phone, is_default, status, connected_at, ' +
        'last_error, last_checked_at, phone_number_id, server_url, ' +
        'instance_name, access_token, ig_user_id, ig_username, ' +
        // ⚠️ Por NOME, então a janela pré-1002 devolve 42703 e a consulta
        // inteira falha — de propósito: a rota já traduz esse código em
        // `unavailable`, e o cabeçalho some em vez de afirmar saúde a
        // partir de colunas que o banco ainda não tem.
        'entrega_carimbo_em, entrega_recebida_em',
    )
    .eq('account_id', accountId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Falha ao listar canais: ${error.message}`);
  const canais = (data ?? []) as unknown as LinhaDeCanal[];
  if (canais.length === 0) return [];

  const agora = Date.now();
  const agoraIso = new Date(agora).toISOString();

  // ---- Evolution: um fetchInstances por SERVIDOR, não por canal ----
  const servidores = new Set(
    canais.filter((c) => ehEvolution(c) && c.server_url).map((c) => c.server_url!),
  );
  const estadosPorServidor = new Map<string, Map<string, 'open' | 'connecting' | 'close'>>();
  await Promise.all(
    [...servidores].map(async (url) => {
      try {
        const { apikey } = evolutionGlobalConfig();
        const mapa = await comCache(`evo:${url}`, TTL_EVOLUTION_MS, () =>
          estadosDoServidor(url, apikey),
        );
        estadosPorServidor.set(url, mapa);
      } catch (err) {
        console.warn(
          '[health] servidor Evolution não respondeu:',
          err instanceof Error ? err.message : err,
        );
      }
    }),
  );

  const saidas: ChannelHealth[] = [];
  const paraGravar: { id: string; status: CbChannelStatus }[] = [];

  for (const c of canais) {
    let estadoVivo: 'open' | 'connecting' | 'close' | null = null;
    let webhookOk: boolean | null = null;
    let incompleto = false;

    // Três transportes, três sondas: Evolution (instância + webhook), Meta
    // (verify do número) e Instagram (`/me` com o token).
    if (ehEvolution(c)) {
      if (!c.server_url || !c.instance_name) {
        incompleto = true;
      } else {
        const mapa = estadosPorServidor.get(c.server_url);
        // Instância que o servidor não lista foi apagada por fora: é queda,
        // não "não respondeu". Só vale quando o servidor respondeu.
        estadoVivo = mapa ? (mapa.get(c.instance_name) ?? 'close') : null;

        if (estadoVivo === 'open') {
          try {
            const { apikey } = evolutionGlobalConfig();
            webhookOk = await comCache(`wh:${c.instance_name}`, TTL_WEBHOOK_MS, () =>
              webhookApontaParaCa(c.server_url!, apikey, c.instance_name!),
            );
          } catch {
            webhookOk = null;
          }
        }
      }
    } else if (ehMeta(c)) {
      // Meta não "cai": falha por token revogado ou número restrito.
      if (!c.phone_number_id || !c.access_token) {
        incompleto = true;
      } else {
        try {
          await comCache(`meta:${c.phone_number_id}`, TTL_META_MS, async () => {
            await verifyPhoneNumber({
              phoneNumberId: c.phone_number_id!,
              accessToken: decrypt(c.access_token!),
            });
            return true;
          });
          estadoVivo = 'open';
        } catch (err) {
          // A Meta responde 401/190 com token revogado. Qualquer erro dela
          // significa que não dá para enviar por este número.
          console.warn(
            '[health] canal Meta não validou:',
            err instanceof Error ? err.message : err,
          );
          estadoVivo = 'close';
        }
      }
    } else if (ehInstagram(c)) {
      // O `/me` responde 200 enquanto o token vale e 190 quando venceu ou
      // foi revogado — é a mesma pergunta que a Meta responde com o verify.
      if (!c.ig_user_id || !c.access_token) {
        incompleto = true;
      } else {
        try {
          await comCache(`ig:${c.id}`, TTL_META_MS, async () => {
            await criarClienteInstagram(decrypt(c.access_token!)).me();
            return true;
          });
          estadoVivo = 'open';
        } catch (err) {
          console.warn(
            '[health] canal Instagram não validou:',
            err instanceof Error ? err.message : err,
          );
          estadoVivo = estadoDaFalhaDoInstagram(err);
        }
      }
    }

    const atrasoSeg = atrasoDaFronteira({
      carimboIso: c.entrega_carimbo_em,
      recebidaIso: c.entrega_recebida_em,
    });

    const { tone, detail } = toneFor({
      status: c.status,
      estadoVivo,
      checkedAt: c.last_checked_at,
      lastError: c.last_error,
      incompleto,
      webhookOk,
      atrasoSeg,
      agoraMs: agora,
    });

    // Só grava quando o provedor efetivamente respondeu. Sem resposta, o
    // frescor velho é a informação — inventar estado apagaria justamente o
    // sinal que faz o amarelo aparecer.
    const houveResposta = estadoVivo !== null;
    const novoStatus: CbChannelStatus =
      estadoVivo === 'open'
        ? 'connected'
        : estadoVivo === 'connecting'
          ? 'connecting'
          : 'disconnected';

    if (houveResposta) {
      const mudou = novoStatus !== c.status;
      const frescorVelho =
        !c.last_checked_at || agora - Date.parse(c.last_checked_at) > STALE_MS / 2;
      if (mudou || frescorVelho) paraGravar.push({ id: c.id, status: novoStatus });
    }

    saidas.push({
      id: c.id,
      label: c.label,
      kind: c.kind,
      // No Instagram é o `@` — `formatChannelPhone` devolve texto com
      // não-dígito como veio, então o popover mostra o @ sem saber que é.
      phone: identidadeDoCanal(c),
      isDefault: c.is_default,
      tone,
      status: houveResposta ? novoStatus : c.status,
      connectedAt: c.connected_at,
      checkedAt: houveResposta ? agoraIso : c.last_checked_at,
      detail,
      webhookOk,
      atrasoSeg,
      atrasoMedidoEm: c.entrega_recebida_em,
    });
  }

  // Escrita throttled (só mudança, ou frescor a meio caminho de vencer) para
  // não transformar o polling em um UPDATE por canal a cada 30s.
  if (paraGravar.length > 0) {
    await Promise.all(
      paraGravar.map(({ id, status }) =>
        db
          .from('cb_channels')
          .update({ status, last_checked_at: agoraIso })
          .eq('id', id)
          .eq('account_id', accountId)
          .then(({ error: err }) => {
            if (err) console.warn('[health] gravação de saúde falhou:', err.message);
          }),
      ),
    );
  }

  return saidas;
}
