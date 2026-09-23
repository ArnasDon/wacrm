// ============================================================
// Exemplo do `data` de cada evento de webhook de saída — puro.
//
// Dois leitores, e é por isso que é UM arquivo:
//   - a aba "Documentação" de Configurações mostra estes exemplos;
//   - o botão "Enviar teste" da aba Webhooks → Enviados manda estes
//     exemplos ao endereço cadastrado (com `test: true` no envelope).
//
// Cada exemplo é tipado por `WebhookEventData` (`dados-dos-eventos.ts`), o
// mesmo tipo que `dispatchWebhookEvent` exige nos pontos de disparo — o
// exemplo não compila se divergir do que chega de verdade.
//
// ⚠️ DADOS FICTÍCIOS (a regra do PR #253): nome, telefone, e-mail e ids não
// são de ninguém. Ids com cara de UUID, mas que nenhum banco gera.
// ============================================================

import type {
  DealCreatedData,
  WebhookEnvelope,
  WebhookEventData,
} from '@/lib/webhooks/dados-dos-eventos';
import { DEAL_WEBHOOK_EVENTS, type DealWebhookEvent, type WebhookEvent } from '@/lib/webhooks/events';

const ID = {
  conta: '00000000-0000-4000-8000-00000000c0a7',
  conversa: '00000000-0000-4000-8000-0000000c0e7a',
  contato: '00000000-0000-4000-8000-0000000c0e70',
  conexao: '00000000-0000-4000-8000-0000000c0e40',
  negocio: '00000000-0000-4000-8000-0000000de410',
  funil: '00000000-0000-4000-8000-0000000f0e11',
  etapaAnterior: '00000000-0000-4000-8000-0000000e7a01',
  etapa: '00000000-0000-4000-8000-0000000e7a02',
  etiqueta: '00000000-0000-4000-8000-0000000e71c0',
  usuario: '00000000-0000-4000-8000-0000000a5e40',
  evento: '00000000-0000-4000-8000-0000000e4e47',
} as const;

const QUANDO = '2026-09-23T14:05:00.000Z';

const CONTATO: WebhookEventData['deal.created']['contact'] = {
  id: ID.contato,
  phone: '5511900000000',
  name: 'Maria Exemplo',
  email: 'maria@exemplo.com.br',
  company: null,
  avatar_url: null,
  instagram_id: null,
  instagram_username: null,
  tags: [{ id: ID.etiqueta, name: 'Typebot', color: '#3b82f6' }],
  created_at: '2026-09-20T12:00:00.000Z',
  updated_at: QUANDO,
  custom_fields: { tamanho_da_divida: '150000', utm_source: 'instagram' },
};

const NEGOCIO: NonNullable<WebhookEventData['deal.created']['deal']> = {
  id: ID.negocio,
  pipeline_id: ID.funil,
  stage_id: ID.etapa,
  contact_id: ID.contato,
  conversation_id: ID.conversa,
  channel_id: ID.conexao,
  title: 'Maria Exemplo',
  value: 0,
  currency: 'BRL',
  status: 'open',
  source: 'channel',
  expected_close_date: null,
  created_at: '2026-09-20T12:00:00.000Z',
  updated_at: QUANDO,
};

const BASE_DO_NEGOCIO: WebhookEventData['deal.created'] = {
  event_id: ID.evento,
  occurred_at: QUANDO,
  source: 'user',
  deal_id: ID.negocio,
  deal: NEGOCIO,
  assignee: { user_id: ID.usuario, name: 'Ana Atendente' },
  pipeline: { id: ID.funil, name: 'Comercial' },
  stage: { id: ID.etapa, name: 'Reunião Agendada', position: 3 },
  contact: CONTATO,
  channel_id: ID.conexao,
};

const EXEMPLOS: { [E in WebhookEvent]: WebhookEventData[E] } = {
  'message.received': {
    conversation_id: ID.conversa,
    contact_id: ID.contato,
    whatsapp_message_id: 'wamid.EXEMPLO0000000000000000000000',
    content_type: 'text',
    text: 'Olá, quero saber mais sobre o meu caso.',
    channel_id: ID.conexao,
  },
  'message.status_updated': {
    whatsapp_message_id: 'wamid.EXEMPLO0000000000000000000000',
    conversation_id: ID.conversa,
    status: 'read',
    channel_id: ID.conexao,
  },
  'conversation.created': {
    conversation_id: ID.conversa,
    contact_id: ID.contato,
    channel_id: ID.conexao,
  },
  'deal.created': {
    ...BASE_DO_NEGOCIO,
    source: 'channel',
    stage: { id: ID.etapaAnterior, name: 'Lead', position: 2 },
    deal: { ...NEGOCIO, stage_id: ID.etapaAnterior },
  },
  'deal.stage_changed': {
    ...BASE_DO_NEGOCIO,
    from_pipeline: { id: ID.funil, name: 'Comercial' },
    from_stage: { id: ID.etapaAnterior, name: 'Lead', position: 2 },
  },
  'deal.status_changed': {
    ...BASE_DO_NEGOCIO,
    deal: { ...NEGOCIO, status: 'won' },
    from_status: 'open',
    status: 'won',
  },
};

/** O `data` de exemplo de um evento. */
export function exemploDoEvento<E extends WebhookEvent>(evento: E): WebhookEventData[E] {
  return EXEMPLOS[evento];
}

function ehEventoDeNegocio(evento: WebhookEvent): evento is DealWebhookEvent {
  return (DEAL_WEBHOOK_EVENTS as readonly string[]).includes(evento);
}

/** O `data` de um `deal.*` carimbado com o fato DESTE envelope. */
function dadoDoNegocio<D extends DealWebhookEvent>(
  evento: D,
  id: string,
  quando: string
): WebhookEventData[D] {
  // ⚠️ Anotado de propósito, fora do espalhamento: espalhado sobre um tipo
  // GENÉRICO, o TypeScript não confere nem a chave nem o tipo do que se
  // acrescenta (medido: `{ ...ex(k), chaveQueNaoExiste: id }` compila). O
  // `Pick` é o que faz um `event_id` renomeado no contrato quebrar aqui.
  const fato: Pick<DealCreatedData, 'event_id' | 'occurred_at'> = {
    event_id: id,
    occurred_at: quando,
  };
  return { ...exemploDoEvento(evento), ...fato };
}

/**
 * O corpo inteiro de exemplo. `teste` marca o envelope do botão "Enviar
 * teste" — é o que deixa quem recebe descartar o teste num filtro.
 *
 * ⚠️⚠️ Nos `deal.*`, `id`/`occurred_at` do envelope e `event_id`/
 * `occurred_at` do `data` são o MESMO valor — é contrato (ver
 * `DealEventBase.event_id`: "o mesmo `id` do envelope"), e a entrega real o
 * cumpre porque `entregar-eventos-de-funil.ts` passa o id e o `criado_em` da
 * linha da fila aos dois lados. O botão "Enviar teste" passa `id` NOVO a
 * cada clique e `quando` = agora; com o `data` fixo do exemplo, o envelope
 * dizia um id e o `data` outro. Um n8n que deduplica por `data.event_id`
 * (a doc pública diz que ele é o `id` do envelope, "safe to dedupe")
 * engolia do segundo teste em diante — o `event_id` do exemplo nunca
 * mudava —, e quem monta a lógica sobre o teste a montava sobre uma
 * invariante que o próprio teste desmentia. Por isso os dois lados saem de
 * `id`/`quando`, e os eventos de mensagem (que não têm `event_id` no
 * `data`) ficam com o exemplo como está.
 */
export function exemploDeEnvelope<E extends WebhookEvent>(
  evento: E,
  opcoes: { accountId?: string; id?: string; quando?: string; teste?: boolean } = {}
): WebhookEnvelope<E> {
  const id = opcoes.id ?? ID.evento;
  const quando = opcoes.quando ?? QUANDO;
  // O cast é só de genérico: `ehEventoDeNegocio` estreita `evento` para
  // `E & DealWebhookEvent`, e o TypeScript não reconhece
  // `WebhookEventData[E & DealWebhookEvent]` como `WebhookEventData[E]`. O
  // que o `data` carrega é conferido dentro de `dadoDoNegocio`.
  const data = ehEventoDeNegocio(evento)
    ? (dadoDoNegocio(evento, id, quando) as WebhookEventData[E])
    : exemploDoEvento(evento);
  return {
    id,
    event: evento,
    occurred_at: quando,
    account_id: opcoes.accountId ?? ID.conta,
    ...(opcoes.teste ? { test: true as const } : {}),
    data,
  };
}
