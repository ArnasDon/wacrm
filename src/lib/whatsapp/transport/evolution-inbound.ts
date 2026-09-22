// ============================================================
// Evolution `messages.upsert` → NormalizedInbound.
//
// Baileys delivers a flat `{ key, pushName, message, messageTimestamp }`
// shape (very different from Meta's entry[].changes[].value envelope).
// Text arrives as `message.conversation` or
// `message.extendedTextMessage.text`; media as a typed sub-object whose
// `caption` (when present) is the text. Group chats (`@g.us`) and our own
// echoes (`key.fromMe`) are dropped — a 1:1 CRM inbox doesn't want them.
// ============================================================

import type { NormalizedInbound } from '@/lib/whatsapp/inbound-store';

export interface EvolutionMessageKey {
  remoteJid?: string;
  fromMe?: boolean;
  id?: string;
  participant?: string;
  /**
   * Contrapartida em TELEFONE do `remoteJid` quando ele vem como `@lid`.
   * O WhatsApp está migrando o endereçamento para LID e a Baileys expõe o
   * número real num destes campos — os nomes variam entre versões, por isso
   * todos são aceitos.
   */
  remoteJidAlt?: string;
  senderPn?: string;
  participantPn?: string;
  participantAlt?: string;
  /**
   * O endereço que `remoteJid` tinha ANTES de a Evolution 2.3.2 reescrevê-lo
   * de `@lid` para telefone. Serve para AGIR sobre a mensagem (revogar,
   * editar): do lado do WhatsApp a conversa continua endereçada por LID, e a
   * revogação mandada para o telefone não acha nada. Ver migration 917 e
   * `lidJidFromKey` — o LID muda de campo entre versões da Evolution.
   */
  previousRemoteJid?: string;
  /**
   * Baileys 7 (Evolution 2.4): `'lid'` quando a conversa é endereçada por LID.
   * Informativo — a decisão do telefone/LID é de `phoneJidFromKey` e
   * `lidJidFromKey`, que olham os campos, não este rótulo.
   */
  addressingMode?: string;
}

export interface EvolutionUpsert {
  key?: EvolutionMessageKey;
  pushName?: string;
  message?: Record<string, unknown> | null;
  messageType?: string;
  messageTimestamp?: number | string;
  /**
   * Na 2.4, o `prepareMessage` da Evolution sobe o `contextInfo` da mensagem
   * para este nível — e, com o nosso patch (docker/evolution-cb), é aqui que
   * o `stanzaId` da citação chega. Ver `quotedProviderId`.
   */
  contextInfo?: Record<string, unknown> | null;
}

/**
 * Sufixos de JID que NÃO são conversa 1:1. Antes só `@g.us` era barrado, e
 * como `phoneFromJid` devolve os dígitos de qualquer JID, um canal do
 * WhatsApp (`@newsletter`) ou uma atualização de status (`@broadcast`)
 * entrava no inbox como se fosse um cliente novo, com telefone inventado.
 *
 * ⚠️ `@lid` NÃO está aqui de propósito. Desde a v2 o WhatsApp usa esse
 * formato no lugar do telefone em conversas legítimas — barrá-lo perderia
 * mensagem de cliente de verdade. O LID NUNCA vira `phone`: quem decide o
 * telefone é `phoneJidFromKey`, e o item que chega SÓ com o LID é resolvido
 * pelo acervo ou retido (`ehLidSemTelefone`, `sem-telefone/receber.ts`).
 * (Uma versão desta nota dizia que o contato nascia com o LID no campo
 * `phone` — era verdade até 27/07/2026, e foi o que criou os 4 contatos
 * fantasmas do commit 9606636.)
 */
const SUFIXOS_NAO_CONVERSA = ['@g.us', '@newsletter', '@broadcast'];

export function isNonChatJid(jid: string): boolean {
  return SUFIXOS_NAO_CONVERSA.some((sufixo) => jid.endsWith(sufixo));
}

/** Reduce a chat JID to digits-only phone (drops @suffix and device part). */
export function phoneFromJid(jid: string): string {
  return jid
    .replace(/@s\.whatsapp\.net$|@lid$|@g\.us$/, '')
    .replace(/:.*/, '')
    .replace(/\D/g, '');
}

export function isLidJid(jid: string): boolean {
  return jid.endsWith('@lid');
}

/**
 * JID de TELEFONE da conversa. Devolve `null` quando só existe o LID.
 *
 * ⚠️ Esta função existe por causa de um bug que chegou a produção: o
 * WhatsApp está migrando o endereçamento para LID (`10000000000107@lid`),
 * um identificador interno que NÃO é telefone. Em produção o eco das
 * mensagens que o operador mandava do celular chegava com LID enquanto as
 * mensagens recebidas do MESMO cliente chegavam com o telefone — e como o
 * contato é procurado por telefone, o LID virava um contato novo. Resultado:
 * a conversa se partia em duas, uma com o que o cliente escreveu e outra,
 * com nome de número sem sentido, com o que o advogado respondeu.
 *
 * A regra: sem telefone de verdade, NÃO se inventa contato. Descartar é
 * ruim (a mensagem do celular não aparece), mas partir a conversa de um
 * cliente ao meio e criar um contato falso na base é pior — e some no
 * meio dos contatos reais.
 */
export function phoneJidFromKey(key: EvolutionMessageKey | undefined): string | null {
  const principal = key?.remoteJid;
  if (principal && !isLidJid(principal)) return principal;

  // A Baileys mudou o nome deste campo entre versões; aceitar todos evita
  // que um upgrade do servidor Evolution volte a partir as conversas.
  for (const alt of [key?.remoteJidAlt, key?.senderPn, key?.participantPn, key?.participantAlt]) {
    if (alt && !isLidJid(alt) && /\d/.test(alt)) return alt;
  }
  return null;
}

/**
 * Endereço `@lid` da conversa, quando o WhatsApp a endereça assim. Devolve
 * `null` em conversa não migrada — o campo nem vem.
 *
 * Serve para AGIR sobre a mensagem (revogar, editar): do lado do WhatsApp a
 * conversa migrada continua endereçada por LID, e a revogação mandada para o
 * telefone não acha nada (migration 917). ⚠️ O LID muda de CAMPO conforme a
 * versão da Evolution, e ler só um deles é o que faria `remote_jid_lid`
 * nascer NULL depois de um upgrade — devolvendo o bug de 28/07/2026 (apagar
 * pelo CRM uma mensagem enviada do celular não fazia nada):
 *
 *   - 2.3.2 (+ patch `lidfix`): `remoteJid` reescrito para telefone e o LID
 *     guardado em `previousRemoteJid`;
 *   - `develop` (2.4.0): `remoteJid` e `remoteJidAlt` TROCADOS — telefone em
 *     `remoteJid`, LID em `remoteJidAlt`;
 *   - sem troca (o payload cru da Baileys 7): `remoteJid` É o LID e o
 *     telefone vem em `remoteJidAlt` — `phoneJidFromKey` já usou o
 *     alternativo, e o LID é o próprio `remoteJid`.
 *
 * A 2.3.7 põe telefone nos dois campos e PERDE o LID: nela isto devolve
 * `null`, limitação daquela versão, não deste código. Ver
 * docs/PLANO-baileys-7.md, seção 4.2.
 */
export function lidJidFromKey(key: EvolutionMessageKey | undefined): string | null {
  for (const candidato of [key?.previousRemoteJid, key?.remoteJidAlt, key?.remoteJid]) {
    if (candidato && isLidJid(candidato)) return candidato;
  }
  return null;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
}

/**
 * Invólucros que escondem a mensagem real uma camada mais fundo. Foto "ver
 * uma vez" chega como `viewOnceMessageV2.message.imageMessage`, e mensagem
 * de conversa com autodestruição, como `ephemeralMessage.message.…`. Sem
 * descer por eles, `detectContentType` via `text` e o anexo era ignorado —
 * o cliente mandava a foto do documento e no inbox não aparecia nada.
 */
const INVOLUCROS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
] as const;

/**
 * Desce pelos invólucros até a mensagem de verdade. O limite de profundidade
 * existe porque o payload vem de fora: sem ele, um `ephemeralMessage` que
 * aponte para si mesmo (acidente ou má-fé) prenderia o laço para sempre.
 */
export function unwrapMessage(
  message?: Record<string, unknown> | null
): Record<string, unknown> | null {
  let atual = message ?? null;
  for (let i = 0; i < 5 && atual; i++) {
    const involucro = INVOLUCROS.find((k) => asRecord(atual![k]));
    if (!involucro) return atual;
    const dentro = asRecord(asRecord(atual[involucro])!.message);
    if (!dentro) return atual;
    atual = dentro;
  }
  return atual;
}

/**
 * Legenda que não diz nada.
 *
 * ⚠️ MEDIDO em 2026-09-09 no payload real: documento mandado do iPhone chega
 * com `caption: "\uFFFC"` — o OBJECT REPLACEMENT CHARACTER, o marcador
 * invisível que o iOS usa no lugar do anexo. Ele não é legenda: gravado em
 * `content_text`, vira uma CAIXINHA sob o nome do arquivo na bolha, na prévia
 * da lista de conversas e no transcrito que o Radar manda para a IA.
 */
function legendaVazia(texto: string): boolean {
  return texto.replace(/[\uFFFC\s]/g, '') === '';
}

export function extractText(message?: Record<string, unknown> | null): string | null {
  const m0 = unwrapMessage(message);
  if (!m0) return null;
  if (typeof m0.conversation === 'string') return m0.conversation;
  const ext = asRecord(m0.extendedTextMessage);
  if (ext && typeof ext.text === 'string') return ext.text;
  for (const key of ['imageMessage', 'videoMessage', 'documentMessage']) {
    const m = asRecord(m0[key]);
    if (m && typeof m.caption === 'string' && m.caption && !legendaVazia(m.caption)) {
      return m.caption;
    }
  }
  return null;
}

export function detectContentType(
  message?: Record<string, unknown> | null
): NormalizedInbound['contentType'] {
  const m = unwrapMessage(message);
  if (!m) return 'text';
  if (m.imageMessage || m.stickerMessage) return 'image';
  if (m.videoMessage) return 'video';
  if (m.audioMessage) return 'audio';
  if (m.documentMessage) return 'document';
  if (m.locationMessage) return 'location';
  return 'text';
}

/**
 * Reação (`👍` numa mensagem) não é mensagem. Hoje ela cairia como texto de
 * conteúdo nulo: bolha vazia no histórico, e — pior — disparando automações,
 * flows e resposta de IA como se o cliente tivesse escrito algo.
 *
 * Descartar é o comportamento correto até a reação ser modelada de verdade
 * (guardada e exibida na bolha da mensagem reagida, como no WhatsApp).
 */
/** Mensagens que carregam `contextInfo` com a citação dentro do próprio corpo. */
const CAIXAS_COM_CONTEXTO = [
  'extendedTextMessage',
  'imageMessage',
  'videoMessage',
  'audioMessage',
  'documentMessage',
  'stickerMessage',
  // Localização também é resposta possível, e `detectContentType` a aceita —
  // sem ela aqui a mensagem entrava e a citação se perdia (Codex, PR #184).
  'locationMessage',
] as const;

/**
 * O wamid da mensagem CITADA, se esta for uma resposta.
 *
 * Duas moradas, porque a Evolution muda de versão: no nível de cima
 * (`item.contextInfo.stanzaId`) — é onde a 2.4 com o patch da citação o
 * entrega para texto — e dentro do corpo (`extendedTextMessage.contextInfo`
 * etc.), como a 2.3.2 entregava e como a 2.4 ainda entrega para mídia (só o
 * texto é achatado). ⚠️ Sem o patch, a 2.4 descarta o `contextInfo` do texto
 * e esta função devolve null — a resposta entra sem citação (issue upstream
 * #2713). Até 09/09/2026 o CRM nunca leu isto no transporte Evolution: só o
 * caminho da Meta resolvia citação.
 */
export function quotedProviderId(item: EvolutionUpsert): string | null {
  const topo = asRecord(item.contextInfo)?.stanzaId;
  if (typeof topo === 'string' && topo) return topo;
  const m = unwrapMessage(item.message);
  if (!m) return null;
  for (const caixa of CAIXAS_COM_CONTEXTO) {
    const id = asRecord(asRecord(m[caixa])?.contextInfo)?.stanzaId;
    if (typeof id === 'string' && id) return id;
  }
  return null;
}

export function isReaction(message?: Record<string, unknown> | null): boolean {
  return !!asRecord(unwrapMessage(message)?.reactionMessage);
}

/**
 * Mensagem cifrada com "message secret" (`secretEncryptedMessage`).
 *
 * ⚠️ MEDIDO em 09/09/2026, no primeiro teste de EDIÇÃO depois do upgrade da
 * Evolution para 2.4.0 / Baileys 7.0.0-rc13: quando o cliente (ou o celular
 * pareado) edita uma mensagem, o WhatsApp manda a edição assim —
 * `{ secretEncryptedMessage: { encIv, encPayload, secretEncType: 2,
 * targetMessageKey: { id } } }` — e a Baileys rc13 NÃO decifra (PRs abertos
 * no upstream: WhiskeySockets/Baileys #2690 e #2743). A Evolution entrega o
 * item como um `messages.upsert` comum, de `messageType`
 * 'secretEncryptedMessage' e sem texto nenhum: tratado como texto, virava
 * uma BOLHA VAZIA na conversa (foi assim que apareceu na tela, duas vezes,
 * às 19:44 e 19:45). Não tem conteúdo legível — descartar é a única verdade
 * possível aqui; quem sabe o alvo da edição é `edicaoCifrada`.
 */
export function isSecretEncrypted(message?: Record<string, unknown> | null): boolean {
  return !!asRecord(unwrapMessage(message)?.secretEncryptedMessage);
}

/**
 * A edição cifrada: qual mensagem foi editada. O texto NOVO não é conhecido
 * (vem em `encPayload`, cifrado); só o alvo é. `secretEncType` 2 é
 * MESSAGE_EDIT no proto do WhatsApp (1 é edição de evento, que não
 * modelamos). Quando a Evolution passar a decifrar, a edição vai chegar como
 * `messages.edited` COM texto e o caminho existente na rota cuida — este aqui
 * é o que dá para afirmar enquanto isso.
 */
export function edicaoCifrada(
  message?: Record<string, unknown> | null,
): { targetId: string } | null {
  const sec = asRecord(unwrapMessage(message)?.secretEncryptedMessage);
  if (!sec) return null;
  const tipo = sec.secretEncType;
  if (tipo !== 2 && tipo !== '2' && tipo !== 'MESSAGE_EDIT') return null;
  const alvo = asRecord(sec.targetMessageKey);
  const id = alvo?.id;
  return typeof id === 'string' && id ? { targetId: id } : null;
}

/**
 * O item é uma conversa 1:1 endereçada SÓ por `@lid` — a chave não traz o
 * telefone em campo nenhum. É a forma da cópia que a Baileys 7 emite quando o
 * celular pareado reenvia uma mensagem que ela não conseguiu decifrar
 * (`requestPlaceholderResend` sem o `msgData`: a chave vem crua do aparelho,
 * sem `remoteJidAlt`, sem `addressingMode` e sem `pushName`). Ver
 * docs/PLANO-lid-sem-telefone.md.
 */
export function ehLidSemTelefone(key: EvolutionMessageKey | undefined): boolean {
  const bruto = key?.remoteJid;
  return !!bruto && isLidJid(bruto) && phoneJidFromKey(key) === null;
}

/**
 * JID de telefone de verdade (`…@s.whatsapp.net`, com dígitos). É a régua do
 * telefone que vem de FORA da chave (`telefoneResolvido`): um LID, um grupo ou
 * um texto qualquer ali recriaria o contato falso que o descarte evita.
 */
function ehJidDeTelefone(jid: string): boolean {
  return jid.endsWith('@s.whatsapp.net') && /\d/.test(phoneFromJid(jid));
}

export interface OpcoesDoNormalize {
  /**
   * Telefone que o CHAMADOR resolveu para um item em `@lid` sem telefone — o
   * par LID→telefone já visto numa mensagem gravada (ver
   * `sem-telefone/resolver-lid.ts`). Só é usado quando a chave não traz
   * telefone nenhum; com telefone na chave, a chave manda.
   */
  telefoneResolvido?: string | null;
}

/**
 * Normalize one upsert item. Returns null for messages the inbox should
 * ignore (group chats, our own echoes, or missing key/id). `channelId` é o
 * `cb_channels.id` por onde a mensagem entrou (Fase 3), propagado para o
 * carimbo — NULL no fallback de transição.
 */
export function normalizeUpsert(
  item: EvolutionUpsert,
  accountId: string,
  configOwnerUserId: string,
  channelId: string | null = null,
  opcoes: OpcoesDoNormalize = {}
): NormalizedInbound | null {
  const bruto = item.key?.remoteJid;
  const id = item.key?.id;
  if (!bruto || !id) return null;
  if (isNonChatJid(bruto)) return null; // grupo, canal, status: não é 1:1
  if (isReaction(item.message)) return null; // reação não é mensagem (ver isReaction)
  if (isSecretEncrypted(item.message)) return null; // edição cifrada: sem texto (ver isSecretEncrypted)

  // Endereço de TELEFONE da conversa. Um `@lid` sem contrapartida devolve
  // null e a mensagem NÃO é gravada aqui — ver `phoneJidFromKey` para o
  // porquê: gravá-la criaria um contato falso e partiria a conversa do
  // cliente. Quem chama pode ter resolvido o telefone por fora
  // (`telefoneResolvido`); sem isso, a rota a RETÉM em vez de descartar.
  const resolvido = opcoes.telefoneResolvido;
  const jid =
    phoneJidFromKey(item.key) ??
    (resolvido && ehJidDeTelefone(resolvido) ? resolvido : null);
  if (!jid) return null;

  const phone = phoneFromJid(jid);
  if (!phone) return null;

  const ts =
    typeof item.messageTimestamp === 'number'
      ? item.messageTimestamp
      : typeof item.messageTimestamp === 'string'
        ? parseInt(item.messageTimestamp, 10) || Math.floor(Date.now() / 1000)
        : Math.floor(Date.now() / 1000);

  return {
    accountId,
    configOwnerUserId,
    channelId,
    // `fromMe` significa "saiu desta conta de WhatsApp" — o que engloba
    // DUAS origens que o chamador precisa separar: o eco do que o próprio
    // CRM enviou (já gravado, descartar) e o que o operador digitou no
    // celular pareado (tem de aparecer). Só o `message_id` distingue,
    // e isso exige ir ao banco — por isso a decisão não é tomada aqui.
    fromMe: item.key?.fromMe === true,
    phone,
    name: item.pushName || phone,
    providerMessageId: id,
    remoteJid: jid,
    // O endereço `@lid` da conversa, venha ele no campo que vier (a Evolution
    // muda o lugar entre versões — ver `lidJidFromKey`). Sem ele não dá para
    // revogar nem editar mensagem de conversa migrada: a revogação sairia
    // para a conversa "telefone" e a mensagem vive na "@lid". Só grava quando
    // é de fato um LID — em conversa não migrada o campo nem vem. Ver 917.
    remoteJidLid: lidJidFromKey(item.key),
    quotedProviderId: quotedProviderId(item),
    timestamp: ts,
    contentType: detectContentType(item.message),
    text: extractText(item.message),
    // Preenchido pelo webhook, que tem as credenciais para chamar
    // chat/getBase64FromMediaMessage — ver evolution-media.ts.
    mediaUrl: null,
  };
}

/** Uma exclusão anunciada pelo webhook `messages.delete`. */
export interface ExclusaoRecebida {
  /** Id da mensagem NO WHATSAPP — o que casa com `messages.message_id`. */
  providerMessageId: string;
  /** A mensagem apagada era nossa (`true`) ou do contato (`false`). */
  fromMe: boolean;
}

/**
 * Lê o `data` de um `messages.delete` da Evolution.
 *
 * ⚠️ A Evolution emite este evento em DUAS formas, e ler só uma delas é o
 * defeito que deixou a exclusão passar em branco:
 *
 *   1. Exclusão feita no CELULAR (ou em outro cliente do WhatsApp) — a chave
 *      vem achatada: `{ id, remoteJid, fromMe }`. Aqui `id` É o id do
 *      WhatsApp.
 *   2. Exclusão feita pela API DELA — isto é, pelo nosso botão de apagar — a
 *      chave vem aninhada em `key`, e o `id` de fora é o identificador
 *      INTERNO do banco da Evolution, que não casa com nada nosso. Usar o
 *      `id` de fora nessa forma faz o UPDATE acertar zero linhas em silêncio.
 *
 * Por isso `key.id` tem precedência sobre qualquer id de primeiro nível.
 *
 * Devolve lista porque o campo `data` também chega como array em lote; um
 * `data` que não contenha id nenhum vira lista vazia, nunca exceção.
 */
export function parseDeleteEvent(data: unknown): ExclusaoRecebida[] {
  const itens = Array.isArray(data) ? data : [data];
  const saida: ExclusaoRecebida[] = [];
  for (const bruto of itens) {
    if (!bruto || typeof bruto !== 'object') continue;
    const d = bruto as {
      id?: unknown;
      keyId?: unknown;
      fromMe?: unknown;
      key?: { id?: unknown; fromMe?: unknown } | null;
    };
    const candidato = d.key?.id ?? d.keyId ?? d.id;
    if (typeof candidato !== 'string' || !candidato) continue;
    const fromMe = d.key?.fromMe ?? d.fromMe;
    saida.push({ providerMessageId: candidato, fromMe: fromMe === true });
  }
  return saida;
}
