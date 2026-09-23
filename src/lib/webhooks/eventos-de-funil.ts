// ============================================================
// Evento da fila do funil → aviso de webhook de saída. Puro, sem E/S.
//
// A fila `cb_automation_events` (0933/0934) já recebe TODO movimento de
// card, de todos os escritores, por gatilho de banco. O dreno
// (`drain-events.ts`) entrega cada linha ao motor de automações; este
// módulo decide o que a MESMA linha vira para quem assina os eventos
// `deal.*` (n8n, Make).
//
// A E/S — ler negócios, etapas e contatos em lote e mandar — mora em
// `entregar-eventos-de-funil.ts`. Aqui fica o que merece teste: qual evento
// a linha é, e a forma exata do `data`.
// ============================================================

import type { ApiDeal } from '@/lib/api/v1/deals';
import type {
  DealEventContact,
  DealEventPipeline,
  DealEventSource,
  DealEventStage,
  WebhookEventData,
} from '@/lib/webhooks/dados-dos-eventos';
import type { DealWebhookEvent } from '@/lib/webhooks/events';
import type { CbAutomationEvent } from '@/types';

export type LinhaDaFila = Pick<
  CbAutomationEvent,
  | 'id'
  | 'tipo'
  | 'deal_id'
  | 'contact_id'
  | 'channel_id'
  | 'from_pipeline_id'
  | 'to_pipeline_id'
  | 'from_stage_id'
  | 'to_stage_id'
  | 'from_status'
  | 'to_status'
  | 'origem'
  | 'criado_em'
>;

/**
 * Qual evento de webhook a linha é.
 *
 * ⚠️ O INSERT de um card também entra na fila como `deal_stage_changed`
 * (0934: "movido para OU criado nesta etapa", a regra do Kommo que as
 * automações usam) — só que com o "de onde" vazio. Para quem integra, card
 * novo e card movido são coisas diferentes, e é o "de onde" nulo que separa:
 * um UPDATE sempre tem funil e etapa de origem (as duas colunas são NOT
 * NULL em `deals`).
 */
export function eventoDaLinha(
  linha: Pick<LinhaDaFila, 'tipo' | 'from_pipeline_id' | 'from_stage_id'>
): DealWebhookEvent {
  if (linha.tipo === 'deal_status_changed') return 'deal.status_changed';
  if (linha.from_pipeline_id == null && linha.from_stage_id == null) return 'deal.created';
  return 'deal.stage_changed';
}

const ORIGEM: Record<LinhaDaFila['origem'], DealEventSource> = {
  usuario: 'user',
  conexao: 'channel',
  automacao: 'automation',
  sistema: 'system',
};

/** `origem` da fila → o vocabulário em inglês da API pública. */
export function origemDoAviso(origem: LinhaDaFila['origem']): DealEventSource {
  return ORIGEM[origem] ?? 'system';
}

/**
 * O que foi lido do banco para montar os avisos de um lote. Mapas por id;
 * ausência = a linha não existe mais (apagada entre o movimento e a entrega).
 */
export interface CatalogoDoAviso {
  negocios: Map<string, ApiDeal>;
  /** Por id de NEGÓCIO: `deals.assigned_to` aponta para `profiles.id`. */
  responsaveis: Map<string, { user_id: string; name: string | null }>;
  funis: Map<string, string>;
  etapas: Map<string, { name: string; position: number }>;
  contatos: Map<string, DealEventContact>;
}

function funil(id: string | null, cat: CatalogoDoAviso): DealEventPipeline | null {
  if (!id) return null;
  return { id, name: cat.funis.get(id) ?? null };
}

function etapa(id: string | null, cat: CatalogoDoAviso): DealEventStage | null {
  if (!id) return null;
  const e = cat.etapas.get(id);
  return { id, name: e?.name ?? null, position: e?.position ?? null };
}

export type AvisoDeFunil =
  | { evento: 'deal.created'; data: WebhookEventData['deal.created'] }
  | { evento: 'deal.stage_changed'; data: WebhookEventData['deal.stage_changed'] }
  | { evento: 'deal.status_changed'; data: WebhookEventData['deal.status_changed'] };

/**
 * Monta o aviso de uma linha da fila.
 *
 * `pipeline`/`stage` vêm do EVENTO (`to_*`), nunca do negócio: o negócio é
 * lido na hora da entrega e pode já ter andado de novo. Um arrasto duplo
 * gera dois avisos, e cada um tem de dizer a etapa DELE.
 */
export function montarAviso(linha: LinhaDaFila, cat: CatalogoDoAviso): AvisoDeFunil {
  const base = {
    event_id: linha.id,
    occurred_at: linha.criado_em,
    source: origemDoAviso(linha.origem),
    deal_id: linha.deal_id,
    deal: linha.deal_id ? (cat.negocios.get(linha.deal_id) ?? null) : null,
    assignee: linha.deal_id ? (cat.responsaveis.get(linha.deal_id) ?? null) : null,
    pipeline: funil(linha.to_pipeline_id, cat),
    stage: etapa(linha.to_stage_id, cat),
    contact: linha.contact_id ? (cat.contatos.get(linha.contact_id) ?? null) : null,
    channel_id: linha.channel_id,
  };

  const evento = eventoDaLinha(linha);
  if (evento === 'deal.status_changed') {
    return {
      evento,
      data: { ...base, from_status: linha.from_status, status: linha.to_status },
    };
  }
  if (evento === 'deal.stage_changed') {
    return {
      evento,
      data: {
        ...base,
        from_pipeline: funil(linha.from_pipeline_id, cat),
        from_stage: etapa(linha.from_stage_id, cat),
      },
    };
  }
  return { evento, data: base };
}
