// ============================================================
// A DM do Instagram vira contato, conversa e mensagem — e NADA mais.
//
// É o irmão do `inbound-store.ts` da Evolution, com três diferenças que são
// decisões, não omissões:
//
// · A identidade do cliente é o IGSID (`contacts.instagram_id`), nunca o
//   telefone: `findExistingContact` casa pelos últimos 8 dígitos, e um IGSID
//   de 16 dígitos fundiria em silêncio com o celular de um cliente real
//   (a armadilha do JID de grupo, 906). A ficha nasce com `phone` NULO (989).
// · D1 do plano (docs/PLANO-instagram-direct.md): automação, fluxo e IA NÃO
//   respondem no Direct na v1. Este arquivo não importa os motores — é a
//   mesma garantia ESTRUTURAL de `cb-groups/persist.ts`, com teste lendo o
//   fonte. O roteamento para o funil (card no primeiro contato) e a
//   reabertura da conversa ENTRAM: são decisões de gente, não de robô.
// · O ECO (`is_echo`) é a mensagem que a PRÓPRIA conta mandou. Se o CRM a
//   enviou (Fase 4), a linha já existe com o mesmo `mid` e o UNIQUE
//   `(conversation_id, message_id)` descarta a cópia; se foi digitada no app
//   do Instagram, entra como `persistDeviceMessage` entra a do celular
//   pareado: `sender_type='agent'`, `from_device=true`, sem motor.
//
// TENANCY: toda leitura e escrita aqui passa pela CONTA da rota (`ctx`), e
// as mensagens são alcançadas pela CONVERSA do cliente — nunca por
// `message_id` solto. O `mid` da Meta só é único por conversa no nosso
// schema, e este módulo roda em service-role (Codex, PR #173).
//
// `user_id` das linhas novas é o DONO DA CONTA (`ownerUserId` resolvido de
// `accounts.owner_user_id` pela rota) — a regra do dono durável, cobrada por
// `dono-duravel.test.ts`.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { routeContactToPipeline } from '@/lib/cb-channels/pipeline-routing';
import { identidadeDoContato } from '@/lib/contacts/identidade';
import { followConversationChannel } from '@/lib/cb-channels/stamp';
import { registrarEntrega } from '@/lib/cb-channels/atraso-de-entrega';
import { isUniqueViolation } from '@/lib/contacts/dedupe';
import { reopenClosedConversation } from '@/lib/conversations/reopen';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import { findOrCreateConversation } from '@/lib/whatsapp/inbound-store';

import {
  clienteDe,
  midiaDoAnexo,
  type AnexoDoInstagram,
  type ClasseDeMidia,
  type EventoDoInstagram,
} from './webhook';

export interface ContextoDoCanal {
  accountId: string;
  /** `accounts.owner_user_id` — o dono DURÁVEL, nunca quem clicou. */
  ownerUserId: string;
  channelId: string;
}

/** O que `salvarMidia` devolve depois de baixar a URL assinada e subir. */
export interface MidiaSalva {
  url: string;
  mime: string;
  classe: ClasseDeMidia;
  filename: string | null;
}

/** Injetado pela rota (é I/O com Storage); `null` = não conseguiu. */
export type SalvarMidia = (
  anexo: AnexoDoInstagram,
  mid: string
) => Promise<MidiaSalva | null>;

export interface ContatoDoInstagram {
  id: string;
  name: string | null;
  instagram_username: string | null;
  avatar_url: string | null;
  avatar_checked_at: string | null;
  wasCreated: boolean;
}

/**
 * Injetado pela rota: lê o perfil (nome, @, foto) com o token do canal e
 * devolve o nome que ficou na ficha. Roda ANTES do roteamento para o funil,
 * para o card nascer com o nome da pessoa — `routeContactToPipeline` não
 * volta a mexer no card depois que ele existe (Codex, PR #173). `null` =
 * não leu; a mensagem já está gravada e nada aqui a segura.
 */
export type Enriquecer = (
  contato: ContatoDoInstagram,
  igsid: string
) => Promise<{ name: string | null } | null>;

type EventoMensagem = Extract<EventoDoInstagram, { tipo: 'mensagem' }>;
type EventoPostback = Extract<EventoDoInstagram, { tipo: 'postback' }>;
type EventoEdicao = Extract<EventoDoInstagram, { tipo: 'edicao' }>;

export type ResultadoDaPersistencia =
  | {
      resultado: 'gravada';
      contato: ContatoDoInstagram;
      conversationId: string;
      messageId: string;
    }
  | { resultado: 'duplicada' | 'ignorada' | 'falhou' };

const TAG = '[instagram/persistir]';
const COLUNAS_DO_CONTATO =
  'id, name, instagram_username, avatar_url, avatar_checked_at';

async function buscarContato(
  db: SupabaseClient,
  ctx: ContextoDoCanal,
  igsid: string
): Promise<Omit<ContatoDoInstagram, 'wasCreated'> | null> {
  const { data, error } = await db
    .from('contacts')
    .select(COLUNAS_DO_CONTATO)
    .eq('account_id', ctx.accountId)
    .eq('instagram_id', igsid)
    .maybeSingle();
  if (error) {
    console.error(`${TAG} buscar contato falhou:`, error.message);
    return null;
  }
  return data as Omit<ContatoDoInstagram, 'wasCreated'> | null;
}

/**
 * A ficha do cliente pelo IGSID. Nasce sem nome e sem `@` — o perfil chega
 * por `enriquecer` logo depois, e a falha lá não pode segurar a mensagem.
 */
export async function findOrCreateContatoDoInstagram(
  db: SupabaseClient,
  ctx: ContextoDoCanal,
  igsid: string
): Promise<ContatoDoInstagram | null> {
  const { accountId, ownerUserId } = ctx;
  const existente = await buscarContato(db, ctx, igsid);
  if (existente) return { ...existente, wasCreated: false };

  const { data: criado, error } = await db
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      phone: null,
      instagram_id: igsid,
    })
    .select(COLUNAS_DO_CONTATO)
    .single();

  if (error) {
    // Duas entregas da mesma pessoa em paralelo: o índice único parcial
    // `(account_id, instagram_id)` da 989 decide, e a perdedora relê.
    if (isUniqueViolation(error)) {
      const corrida = await buscarContato(db, ctx, igsid);
      if (corrida) return { ...corrida, wasCreated: false };
    }
    console.error(`${TAG} criar contato falhou:`, error.message);
    return null;
  }
  return {
    ...(criado as Omit<ContatoDoInstagram, 'wasCreated'>),
    wasCreated: true,
  };
}

/**
 * A conversa do cliente NESTA conta, sem criar nada — é por ela que edição
 * e exclusão alcançam a mensagem. `null` = a pessoa nunca escreveu para
 * esta conexão (edição de mensagem anterior à integração, ou de outro app).
 */
export async function conversaDoCliente(
  db: SupabaseClient,
  ctx: ContextoDoCanal,
  igsid: string
): Promise<string | null> {
  const contato = await buscarContato(db, ctx, igsid);
  if (!contato) return null;
  const { data, error } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', ctx.accountId)
    .eq('contact_id', contato.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error(`${TAG} buscar conversa falhou:`, error.message);
    return null;
  }
  return (data?.id as string | undefined) ?? null;
}

/**
 * O IGSID do cliente num evento SEM a marca de eco (edição): quando o
 * remetente é a própria conta, o cliente é o destinatário.
 */
export function igsidDoCliente(ev: {
  igUserId: string;
  remetente: string;
  destinatario: string;
}): string {
  return ev.remetente === ev.igUserId ? ev.destinatario : ev.remetente;
}

export interface ConteudoDaMensagem {
  content_type: 'text' | ClasseDeMidia;
  content_text: string | null;
  media_url: string | null;
  media_type: string | null;
  media_filename: string | null;
}

/**
 * O que vai para `messages` a partir do evento e da mídia (já salva).
 * Anexo que não é arquivo (compartilhamento, menção em story, reel) vira
 * texto com a URL — é o que sobra dele; a URL da Meta expira, mas o
 * histórico registra que houve.
 */
export function conteudoDaMensagem(
  ev: EventoMensagem,
  midia: MidiaSalva | null
): ConteudoDaMensagem {
  if (midia) {
    return {
      content_type: midia.classe,
      content_text: ev.texto,
      media_url: midia.url,
      media_type: midia.mime,
      media_filename: midia.filename,
    };
  }
  const partes: string[] = [];
  if (ev.respostaA && 'story' in ev.respostaA)
    partes.push('[Resposta a um story]');
  for (const a of ev.anexos) {
    if (midiaDoAnexo(a)) continue; // arquivo que não conseguiu ser salvo
    const rotulo =
      a.tipo === 'share'
        ? '[Publicação compartilhada]'
        : a.tipo === 'story_mention'
          ? '[Menção em story]'
          : a.tipo === 'reel' || a.tipo === 'ig_reel'
            ? '[Reel]'
            : `[Anexo: ${a.tipoCru || 'desconhecido'}]`;
    partes.push(a.url ? `${rotulo} ${a.url}` : rotulo);
  }
  if (ev.texto) partes.push(ev.texto);
  if (partes.length === 0) {
    if (ev.naoSuportada) partes.push('[Conteúdo não suportado pelo Instagram]');
    else if (ev.anexos.length > 0) partes.push('[Anexo indisponível]');
  }
  return {
    content_type: 'text',
    content_text: partes.length > 0 ? partes.join('\n') : null,
    media_url: null,
    media_type: null,
    media_filename: null,
  };
}

/** `messages.id` de uma mensagem desta conversa pelo `mid` da Meta. */
async function idDaMensagem(
  db: SupabaseClient,
  conversationId: string,
  mid: string
): Promise<string | null> {
  const { data } = await db
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('message_id', mid)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/** Texto da prévia na lista, no molde do `inbound-store`. */
function previa(c: ConteudoDaMensagem): string {
  return c.content_text || `[${c.content_type}]`;
}

async function gravarMensagem(
  db: SupabaseClient,
  ctx: ContextoDoCanal,
  ev: EventoMensagem,
  salvarMidia: SalvarMidia,
  enriquecer?: Enriquecer
): Promise<ResultadoDaPersistencia> {
  const igsid = clienteDe(ev);
  const contato = await findOrCreateContatoDoInstagram(db, ctx, igsid);
  if (!contato) return { resultado: 'falhou' };

  const conv = await findOrCreateConversation(
    db,
    ctx.accountId,
    ctx.ownerUserId,
    contato.id
  );
  if (!conv) return { resultado: 'falhou' };
  const conversation = conv.conversation;

  if (conv.created) {
    await dispatchWebhookEvent(db, ctx.accountId, 'conversation.created', {
      conversation_id: conversation.id,
      contact_id: contato.id,
      channel_id: ctx.channelId,
    });
  }

  // Apagada pelo cliente: só a marca de exibição (o texto fica — é a mesma
  // divergência deliberada do WhatsApp: o escritório precisa do registro).
  if (ev.apagada) {
    const { error } = await db
      .from('messages')
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: ev.ehEco ? 'agent' : 'customer',
      })
      .eq('conversation_id', conversation.id)
      .eq('message_id', ev.mid)
      .is('deleted_at', null);
    if (error) console.error(`${TAG} marcar apagada falhou:`, error.message);
    return { resultado: 'ignorada' };
  }

  // Um `mid` = uma linha. O Instagram aceita VÁRIOS arquivos numa DM; o
  // primeiro fica na mensagem e os demais viram linhas irmãs com o mid
  // sufixado — a exclusão pelo cliente alcança só a primeira (aceito: é
  // raro, e o alternativo era perder o segundo arquivo).
  const arquivos = ev.anexos.filter((a) => midiaDoAnexo(a) !== null);
  const midia =
    arquivos.length > 0 ? await salvarMidia(arquivos[0], ev.mid) : null;
  const conteudo = conteudoDaMensagem(ev, midia);
  const respostaA =
    ev.respostaA && 'mid' in ev.respostaA
      ? await idDaMensagem(db, conversation.id, ev.respostaA.mid)
      : null;
  const quando = new Date(ev.timestampMs ?? Date.now()).toISOString();

  const linha = (mid: string, c: ConteudoDaMensagem) => ({
    conversation_id: conversation.id,
    ...(ev.ehEco
      ? {
          sender_type: 'agent',
          from_me: true,
          from_device: true,
          status: 'sent',
        }
      : { sender_type: 'customer', from_me: false, status: 'delivered' }),
    content_type: c.content_type,
    content_text: c.content_text,
    media_url: c.media_url,
    media_type: c.media_type,
    media_filename: c.media_filename,
    message_id: mid,
    channel_id: ctx.channelId,
    reply_to_message_id: respostaA,
    created_at: quando,
  });

  const { data: inserida, error } = await db
    .from('messages')
    .insert(linha(ev.mid, conteudo))
    .select('id')
    .single();
  if (error || !inserida) {
    // O UNIQUE (conversation_id, message_id): reentrega da Meta, ou o eco
    // da mensagem que o PRÓPRIO CRM acabou de enviar (Fase 4). Nos dois
    // casos a linha certa já está lá.
    if (error && isUniqueViolation(error)) return { resultado: 'duplicada' };
    console.error(`${TAG} inserir mensagem falhou:`, error?.message);
    return { resultado: 'falhou' };
  }

  for (let i = 1; i < arquivos.length; i++) {
    const extra = await salvarMidia(arquivos[i], `${ev.mid}#${i + 1}`);
    if (!extra) continue;
    const { error: erroExtra } = await db
      .from('messages')
      .insert(
        linha(
          `${ev.mid}#${i + 1}`,
          conteudoDaMensagem({ ...ev, texto: null }, extra)
        )
      );
    if (erroExtra && !isUniqueViolation(erroExtra)) {
      console.error(`${TAG} inserir anexo extra falhou:`, erroExtra.message);
    }
  }

  if (ev.ehEco) {
    const agora = new Date().toISOString();
    await db
      .from('conversations')
      .update({
        last_message_text: previa(conteudo),
        last_message_at: agora,
        updated_at: agora,
      })
      .eq('id', conversation.id);
  } else {
    // ATÔMICO no banco (040): duas entregas ao mesmo tempo somariam a mesma
    // base e perderiam uma não-lida se fosse ler-somar-gravar (Codex, PR #173).
    const { error: erroBump } = await db.rpc('bump_conversation_on_inbound', {
      p_conversation_id: conversation.id,
      p_last_message_text: previa(conteudo),
    });
    if (erroBump)
      console.error(`${TAG} bump da conversa falhou:`, erroBump.message);
  }

  // Gente reabre — o cliente escrevendo, ou o escritório respondendo pelo
  // app do Instagram. Sem responsável: quem reabre por aqui não é membro.
  await reopenClosedConversation(
    db,
    conversation as { id: string; status?: string | null }
  );
  await followConversationChannel(db, conversation.id, ctx.channelId);

  // A fronteira de entrega da conexão (1002). Sem `timestampMs` não há o
  // que medir, e inventar `Date.now()` aqui diria "entrega instantânea" —
  // a afirmação exatamente oposta à que o alarme existe para fazer.
  if (ev.timestampMs) {
    await registrarEntrega(db, ctx.channelId, Math.round(ev.timestampMs / 1000));
  }

  // O perfil ANTES do funil: o card nasce com o nome da pessoa. E nunca
  // derruba o que vem depois — a mensagem já está gravada; roteamento e
  // webhook têm de sair mesmo que o perfil falhe (Codex, PR #178).
  let enriquecido: { name: string | null } | null = null;
  if (enriquecer) {
    try {
      enriquecido = await enriquecer(contato, igsid);
    } catch (err) {
      console.error(
        `${TAG} enriquecer lançou:`,
        err instanceof Error ? err.message : err
      );
    }
  }
  const nome = enriquecido?.name ?? contato.name;

  await routeContactToPipeline({
    db,
    accountId: ctx.accountId,
    channelId: ctx.channelId,
    contactId: contato.id,
    // ⚠️ Queda no `@usuario` (1007): o título do card é o nome e nada mais,
    // e a ficha do Instagram não tem telefone para servir de reserva — sem
    // isto, quem escreve antes de o perfil ser lido abriria um card chamado
    // "Novo contato". No WhatsApp esta queda não existe porque lá a ficha
    // nasce com `name || phone`.
    contactName: nome ?? identidadeDoContato(contato),
    conversationId: conversation.id,
  });

  if (!ev.ehEco) {
    await dispatchWebhookEvent(db, ctx.accountId, 'message.received', {
      conversation_id: conversation.id,
      contact_id: contato.id,
      instagram_message_id: ev.mid,
      content_type: conteudo.content_type,
      text: conteudo.content_text,
      channel_id: ctx.channelId,
    });
  }

  return {
    resultado: 'gravada',
    contato: { ...contato, name: nome },
    conversationId: conversation.id,
    messageId: inserida.id as string,
  };
}

/** Um clique em ice breaker/botão vira o que o cliente "disse". */
async function gravarPostback(
  db: SupabaseClient,
  ctx: ContextoDoCanal,
  ev: EventoPostback,
  salvarMidia: SalvarMidia,
  enriquecer?: Enriquecer
): Promise<ResultadoDaPersistencia> {
  const texto = ev.titulo ?? ev.payload;
  if (!texto) return { resultado: 'ignorada' };
  const comoMensagem: EventoMensagem = {
    tipo: 'mensagem',
    igUserId: ev.igUserId,
    remetente: ev.remetente,
    destinatario: ev.destinatario,
    timestampMs: ev.timestampMs,
    mid: ev.mid ?? `postback:${ev.remetente}:${ev.timestampMs ?? Date.now()}`,
    texto,
    anexos: [],
    ehEco: false,
    apagada: false,
    naoSuportada: false,
    respostaA: null,
    quickReply: ev.payload,
  };
  return gravarMensagem(db, ctx, comoMensagem, salvarMidia, enriquecer);
}

/**
 * Edição de verdade (num_edit ≥ 1 — o parser já descartou o 0). A mensagem
 * é alcançada pela CONVERSA do cliente nesta conta, nunca por `mid` solto.
 */
async function aplicarEdicao(
  db: SupabaseClient,
  ctx: ContextoDoCanal,
  ev: EventoEdicao
): Promise<ResultadoDaPersistencia> {
  const conversationId = await conversaDoCliente(db, ctx, igsidDoCliente(ev));
  if (!conversationId) return { resultado: 'ignorada' };

  const { data: atual } = await db
    .from('messages')
    .select('id, content_text')
    .eq('conversation_id', conversationId)
    .eq('message_id', ev.mid)
    .maybeSingle();
  if (!atual) return { resultado: 'ignorada' }; // anterior à integração
  if (ev.texto === null || atual.content_text === ev.texto)
    return { resultado: 'ignorada' };

  const { error } = await db
    .from('messages')
    .update({
      content_text: ev.texto,
      text_before_edit: atual.content_text,
      edited_at: new Date().toISOString(),
    })
    .eq('id', atual.id)
    .eq('conversation_id', conversationId);
  if (error) {
    console.error(`${TAG} aplicar edição falhou:`, error.message);
    return { resultado: 'falhou' };
  }
  return { resultado: 'ignorada' };
}

/**
 * Persiste UM evento já interpretado. Reação, lida e referral ficam de fora
 * na v1 (D5); `ignorado` já vem com o motivo do parser.
 */
export async function persistirEventoDoInstagram(
  db: SupabaseClient,
  ctx: ContextoDoCanal,
  ev: EventoDoInstagram,
  salvarMidia: SalvarMidia,
  enriquecer?: Enriquecer
): Promise<ResultadoDaPersistencia> {
  switch (ev.tipo) {
    case 'mensagem':
      return gravarMensagem(db, ctx, ev, salvarMidia, enriquecer);
    case 'postback':
      return gravarPostback(db, ctx, ev, salvarMidia, enriquecer);
    case 'edicao':
      return aplicarEdicao(db, ctx, ev);
    default:
      return { resultado: 'ignorada' };
  }
}
