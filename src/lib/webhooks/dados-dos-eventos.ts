// ============================================================
// O formato do `data` de CADA evento de webhook de saída — puro, só tipos.
//
// ⚠️ É o CONTRATO com quem integra (n8n, Make). Três lugares dependem dele e
// por isso ele mora num arquivo só:
//   - `dispatchWebhookEvent` é tipado por este mapa: um ponto de disparo que
//     mandar outra forma não compila;
//   - `exemplos.ts` (a Documentação e o botão "Enviar teste") é tipado por
//     ele: o exemplo não pode mentir sobre o que chega de verdade;
//   - `docs/public-api.md` descreve este mesmo formato.
//
// Só `import type` aqui: o arquivo é lido pelo navegador (a aba de
// Documentação) e `contacts.ts` arrasta supabase/`node:crypto`.
// ============================================================

import type { ApiContact } from '@/lib/api/v1/contacts';
import type { ApiDeal } from '@/lib/api/v1/deals';
import type { WebhookEvent } from '@/lib/webhooks/events';

// ------------------------------------------------------------
// Mensagens e conversas (os três eventos do upstream)
// ------------------------------------------------------------

export interface MessageReceivedData {
  conversation_id: string;
  contact_id: string;
  /** Mensagem de WhatsApp (Meta ou Evolution). */
  whatsapp_message_id?: string;
  /** Mensagem do Instagram Direct — no lugar de `whatsapp_message_id`. */
  instagram_message_id?: string;
  content_type: string;
  text: string | null;
  /** Conexão (`cb_channels.id`) por onde a mensagem entrou. */
  channel_id: string | null;
}

export interface MessageStatusUpdatedData {
  whatsapp_message_id: string;
  conversation_id: string;
  status: string;
  channel_id: string | null;
}

export interface ConversationCreatedData {
  conversation_id: string;
  contact_id: string;
  channel_id: string | null;
}

// ------------------------------------------------------------
// Negócios (os três eventos da fila do funil)
// ------------------------------------------------------------

/**
 * Quem causou o movimento. Traduz `cb_automation_events.origem`, que o
 * gatilho da 0934 decide assim: há `auth.uid()` → `user`; senão, num INSERT
 * com `deals.source = 'channel'` → `channel`, com `'automation'` →
 * `automation`; todo o resto → `system`.
 *
 * - `user`: uma pessoa, nas telas do CRM (arrastar, formulário, lista,
 *   painel da conversa) — escrita sob RLS, com sessão;
 * - `channel`: o roteador da conexão (`routeContactToPipeline`) abriu o
 *   card. ⚠️ NÃO é "lead que chegou": ele roda nos DOIS sentidos — na
 *   primeira mensagem do cliente E no primeiro envio da equipe (a tela, o
 *   celular pareado, a agendada ou `POST /api/v1/messages`). Mesmo o envio
 *   feito por uma pessoa na tela sai `channel`, porque o roteador escreve em
 *   service role (sem `auth.uid()`);
 * - `automation`: o passo "Criar negócio" de uma automação;
 * - `system`: sem pessoa logada e fora dos dois casos acima — as escritas
 *   diretas em negócio pela API pública (`/api/v1/deals`, criar e mover) E
 *   os passos "Mover card de etapa"/"Marcar ganho ou perdido" das
 *   automações (`cb_atualizar_negocio`). O banco não separa os dois (os
 *   dois gravam em service role), e dizer mais seria inventar.
 */
export type DealEventSource = 'user' | 'channel' | 'automation' | 'system';

export interface DealEventPipeline {
  id: string;
  /** `null` quando o funil foi apagado antes da entrega. */
  name: string | null;
}

export interface DealEventStage {
  id: string;
  /** `null` quando a etapa foi apagada antes da entrega. */
  name: string | null;
  position: number | null;
}

/** O contato do card, no MESMO formato de `GET /api/v1/contacts/{id}`… */
export interface DealEventContact extends ApiContact {
  /** …mais os campos personalizados, chave → valor (vazio = `null`). */
  custom_fields: Record<string, string | null>;
}

interface DealEventBase {
  /**
   * Id do fato — o mesmo `id` do envelope. Estável: serve para descartar
   * repetição do lado de quem recebe.
   */
  event_id: string;
  /** Quando o card mudou (o relógio do banco), não quando o aviso saiu. */
  occurred_at: string;
  source: DealEventSource;
  deal_id: string | null;
  /**
   * O negócio como está NA HORA DO ENVIO, no formato de
   * `GET /api/v1/deals/{id}`. `null` se ele foi apagado antes.
   *
   * ⚠️ Pode estar à frente do evento: um card movido duas vezes em segundos
   * gera dois avisos, e os dois trazem o `deal` já na etapa final. A etapa
   * DESTE movimento é `stage`, não `deal.stage_id`.
   */
  deal: ApiDeal | null;
  /** Responsável pelo card. `user_id` é o id de usuário (tarefas/reuniões). */
  assignee: { user_id: string; name: string | null } | null;
  /** Funil e etapa em que o card ficou NESTE evento. */
  pipeline: DealEventPipeline | null;
  stage: DealEventStage | null;
  /** `null` em card sem contato (grupo, ou contato apagado). */
  contact: DealEventContact | null;
  /**
   * Conexão da CONVERSA do contato NO MOMENTO DO MOVIMENTO — o gatilho da
   * 0934 a resolve (a conversa com canal mais recente do contato) e grava na
   * linha da fila. Não é `deal.channel_id`, que é por onde ele CHEGOU.
   *
   * ⚠️ `null` não é só "evento de antes do multi-canal". Vem nulo sempre que,
   * no movimento, o contato não tinha conversa ligada a uma conexão: lead
   * criado por webhook de entrada (Typebot) ou pelo Calendly antes de
   * escrever (a conversa deles nasce com `channel_id` nulo), ficha criada
   * pela API (`POST /api/v1/contacts` não abre conversa), card sem contato
   * (grupo, contato apagado). Quem filtra por número no n8n precisa decidir
   * o que fazer com esses — descartar calado perde justamente o lead novo.
   */
  channel_id: string | null;
}

export type DealCreatedData = DealEventBase;

export interface DealStageChangedData extends DealEventBase {
  /** De onde o card saiu. Diferente de `pipeline` = trocou de funil. */
  from_pipeline: DealEventPipeline | null;
  from_stage: DealEventStage | null;
}

export interface DealStatusChangedData extends DealEventBase {
  from_status: string | null;
  status: string | null;
}

// ------------------------------------------------------------
// O mapa evento → data
// ------------------------------------------------------------

export interface WebhookEventData {
  'message.received': MessageReceivedData;
  'message.status_updated': MessageStatusUpdatedData;
  'conversation.created': ConversationCreatedData;
  'deal.created': DealCreatedData;
  'deal.stage_changed': DealStageChangedData;
  'deal.status_changed': DealStatusChangedData;
}

// O compilador cobra: evento novo em `WEBHOOK_EVENTS` sem entrada aqui não
// compila (e vice-versa) — `T extends never` só aceita o conjunto vazio.
type SoVazio<T extends never> = T;
export type CoberturaDosEventos = [
  SoVazio<Exclude<WebhookEvent, keyof WebhookEventData>>,
  SoVazio<Exclude<keyof WebhookEventData, WebhookEvent>>,
];

/** O corpo JSON inteiro que chega a quem recebe. */
export interface WebhookEnvelope<E extends WebhookEvent = WebhookEvent> {
  /** Id da entrega. Nos eventos de negócio é o `event_id` do fato. */
  id: string;
  event: E;
  occurred_at: string;
  account_id: string;
  /** Presente (e `true`) só no botão "Enviar teste" da tela. */
  test?: true;
  data: WebhookEventData[E];
}
