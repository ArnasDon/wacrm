import { NextResponse, after } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'crypto';

import {
  edicaoCifrada,
  extractText,
  isReaction,
  normalizeUpsert,
  parseDeleteEvent,
  unwrapMessage,
  type EvolutionUpsert,
} from '@/lib/whatsapp/transport/evolution-inbound';
import { receberSemTelefone } from '@/lib/whatsapp/sem-telefone/receber';
import { religarRetidas } from '@/lib/whatsapp/sem-telefone/religar';
import { aceitamAvancoPara } from '@/lib/whatsapp/transport/escada-de-status';
import {
  PAUSAS_DO_RECIBO_MS,
  aplicarReciboQuandoAMensagemExistir,
  type Tentativa,
} from '@/lib/whatsapp/transport/recibo-antes-da-mensagem';
import {
  isGroupJid,
  normalizeGroupUpsert,
} from '@/lib/whatsapp/transport/evolution-group-inbound';
import {
  persistDeviceMessage,
  persistInboundMessage,
  type PersistedInbound,
} from '@/lib/whatsapp/inbound-store';
import {
  aprenderNossoLid,
  persistGroupDeviceMessage,
  persistGroupMessage,
  LIMITE_DOWNLOAD_AUTOMATICO_BYTES,
} from '@/lib/cb-groups/persist';
import {
  descreverParticipantes,
  nomesConhecidos,
  parseGroupsUpsert,
  parseParticipantsUpdate,
  registrarAvisoDeSistema,
} from '@/lib/cb-groups/system-events';
import { atualizarPreviaDaConversa } from '@/lib/inbox/conversation-preview';
import { resolveInboundEvolutionChannel } from '@/lib/cb-channels/resolve-inbound';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import { EvolutionClient } from '@/lib/whatsapp/transport/evolution-client';
import { marcarAnexoGrandeDemais } from '@/lib/whatsapp/anexo-grande';
import {
  anexoGrandeDemais,
  mediaBytesOf,
  nomeDeArquivoDeclarado,
} from '@/lib/whatsapp/transport/anexo-declarado';
import {
  fetchAndStoreEvolutionMedia,
  type EvolutionMediaSalva,
} from '@/lib/whatsapp/transport/evolution-media';
import { resolveChannelForConversation } from '@/lib/cb-channels/resolve';
import { decrypt } from '@/lib/whatsapp/encryption';
import { precisaConferirFoto } from '@/lib/contacts/foto-de-perfil';
import { atualizarFotoDoContato } from '@/lib/whatsapp/foto-do-contato';
import { ehEvolution } from '@/lib/cb-channels/transporte';

// Inbound processing fans out to flows / automations / AI, so give the
// after() block headroom beyond the platform default.
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null;
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _adminClient;
}

/**
 * Evolution does NOT sign its webhooks, so authenticity rests on a shared
 * secret we set in the instance's webhook `headers` (Authorization:
 * Bearer <EVOLUTION_WEBHOOK_SECRET>). Constant-time compare; the echoed
 * `apikey`/`server_url` in the body are attacker-controllable and are NOT
 * trusted. Fail-closed when the secret isn't configured.
 */
function isAuthorized(request: Request): boolean {
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET;
  if (!secret) return false;
  const presented = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Baileys ACK ints/enums → our messages.status ladder (CHECK-constrained).
//
// ⚠️ `ERROR` (0) VIRA `failed`, e a ausência disso era um buraco caro: até
// aqui o mapeador devolvia `null` para o erro, então uma mensagem que NÃO
// chegou ao cliente ficava com ✓ para sempre. Como produção roda Evolution, na
// prática o CRM nunca soube dizer "esta não foi entregue".
//
// ⚠️ NÃO confundir `ERROR`(0) com `PENDING`(1). São ints vizinhos com sentidos
// opostos — 1 é "ainda em trânsito", e mapeá-lo para falha pintaria de vermelho
// toda mensagem no primeiro instante de vida.
function ackToStatus(
  status: unknown,
): 'sent' | 'delivered' | 'read' | 'failed' | null {
  const s = String(status).toUpperCase();
  if (s === 'ERROR' || s === '0') return 'failed';
  if (s === 'SERVER_ACK' || s === '2') return 'sent';
  if (s === 'DELIVERY_ACK' || s === '3') return 'delivered';
  if (s === 'READ' || s === 'PLAYED' || s === '4' || s === '5') return 'read';
  return null;
}

/**
 * Situações a partir das quais `failed` é crível.
 *
 * ⚠️ A escada de status é de mão única, e `failed` é um desvio terminal válido
 * só no começo dela. Um `ERROR` que chegue DEPOIS de a mensagem ter sido
 * entregue ou lida é ruído da Baileys — aplicá-lo pintaria de "não entregue"
 * uma mensagem que o cliente comprovadamente leu. O lado Meta já tem essa
 * guarda (`isValidStatusTransition`); aqui não tinha.
 */
const ACEITA_FALHA = ['sending', 'sent'] as const;

interface EvolutionWebhookBody {
  event?: string;
  instance?: string;
  data?: unknown;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: EvolutionWebhookBody;
  try {
    body = (await request.json()) as EvolutionWebhookBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Config event names are UPPERCASE_SNAKE_CASE but the emitted `event`
  // field is lowercase dot-notation — match case-insensitively.
  const event = (body.event ?? '').toLowerCase().replace(/_/g, '.');
  const instance = body.instance;
  if (!instance) return NextResponse.json({ ok: true });

  // Route to the owning account/channel by instance name (the inbound key).
  // cb_channels first (multi-canal); falls back to whatsapp_config (the
  // single-channel flow) with a warning. Deploy-safe: unknown table → fallback.
  const route = await resolveInboundEvolutionChannel(supabaseAdmin(), instance);

  if (!route) {
    // Unknown/foreign instance — ack so Evolution doesn't retry forever.
    return NextResponse.json({ ok: true });
  }

  if (event === 'messages.upsert') {
    const items: EvolutionUpsert[] = Array.isArray(body.data)
      ? (body.data as EvolutionUpsert[])
      : [body.data as EvolutionUpsert];
    after(async () => {
      // DUAS FASES, de propósito — a separação é a correção, não estilo.
      //
      // Antes a mídia era baixada ANTES de gravar, e o comentário jurava que
      // falhar só custaria o anexo. Não custava: o download não tinha timeout,
      // então um servidor mudo consumia os 60s de `maxDuration` e a plataforma
      // matava o `after()` — a mensagem do cliente nunca chegava a existir.
      //
      // Gravar antes conserta o caso de UM item. Mas o lote pode ter vários, e
      // intercalar (gravar 1 → baixar 1 → gravar 2) faz o download lento do
      // primeiro consumir o orçamento e os SEGUINTES nunca serem gravados —
      // some a mensagem de novo, agora nos itens de trás.
      //
      // Fase 1 grava tudo; fase 2 busca os anexos. Assim o pior caso do
      // estouro de orçamento é ficar sem anexo, com todas as mensagens no
      // lugar. Perder o anexo é ruim; perder a mensagem é inaceitável.
      const semAnexo: {
        item: EvolutionUpsert;
        contentType: string;
        messageId: string;
        /**
         * Bytes declarados no payload. Decide duas coisas: se o anexo cabe no
         * Storage (1:1 e grupo) e, em grupo, se baixa agora ou sob demanda.
         */
        bytes?: number | null;
        /**
         * Mensagem de grupo. Decide o adiamento do download e o `pending`/
         * `failed` do `media_state` — os dois estados que existem para o
         * botão "toque para baixar", que só grupo tem. (`too_large` é dos
         * dois: ver o portão por tamanho no laço abaixo.)
         */
        ehGrupo?: boolean;
        /**
         * A conexão de onde o anexo é baixado, quando NÃO é a deste webhook:
         * mensagem retida sem telefone pode ser religada por uma mensagem que
         * chegou por OUTRO número, e a mídia só existe na instância por onde
         * ela veio. Ausente = `route.channelId`, como sempre foi.
         */
        channelId?: string | null;
      }[] = [];
      const paraFoto: NonNullable<PersistedInbound['contato']>[] = [];

      for (const item of items) {
        try {
          // Reação não é mensagem: vira estado em `message_reactions`,
          // pendurado na bolha da mensagem reagida.
          if (isReaction(item.message)) {
            await registrarReacao(item);
            continue;
          }

          // Edição que chega CIFRADA (Baileys 7 / Evolution 2.4 — ver
          // `isSecretEncrypted`). O texto novo não é conhecido, então o
          // máximo de verdade é carimbar `edited_at` na mensagem editada,
          // MANTENDO o texto antigo: a bolha passa a mostrar "editada"
          // (sem o "era: …", porque `text_before_edit` fica nulo) e o
          // operador sabe que o cliente mudou algo. Inventar texto ou apagar
          // o original seriam as duas mentiras possíveis. Sem isto o item
          // caía em `normalizeUpsert` como texto vazio e virava bolha em branco.
          const edicao = edicaoCifrada(item.message);
          if (edicao) {
            // ⚠️ Escopo de CONTA (Codex, PR #175): `message_id` só é único por
            // CONVERSA (040) — o mesmo wamid pode existir em duas contas quando
            // as duas estão na mesma conversa (grupo com dois números nossos,
            // ou uma segunda instalação no mesmo chat). Primeiro as linhas
            // DESTA conta, depois o carimbo por `id`.
            const { data: alvos, error: erroBusca } = await supabaseAdmin()
              .from('messages')
              .select('id, conversations!inner(account_id)')
              .eq('message_id', edicao.targetId)
              .eq('conversations.account_id', route.accountId)
              .is('edited_at', null);
            if (erroBusca) {
              console.error('[evolution/webhook] achar alvo da edição cifrada falhou:', erroBusca.message);
              continue;
            }
            const ids = (alvos ?? []).map((a: { id: string }) => a.id);
            if (ids.length > 0) {
              const { error: erroEdicao } = await supabaseAdmin()
                .from('messages')
                .update({ edited_at: new Date().toISOString() })
                .in('id', ids);
              if (erroEdicao) {
                console.error('[evolution/webhook] carimbar edição cifrada falhou:', erroEdicao.message);
              }
            }
            continue;
          }

          // ---- GRUPO ----
          // A bifurcação vem ANTES do normalizeUpsert porque ele barra `@g.us`
          // de propósito: o que ele produz é conversa de CONTATO, e grupo não
          // é contato (ver 906_cb_grupos). Caminho próprio, sem fan-out.
          if (isGroupJid(item.key?.remoteJid)) {
            if (!route.groupsEnabled) continue; // interruptor por canal
            const g = normalizeGroupUpsert(
              item,
              route.accountId,
              route.ownerUserId,
              route.channelId,
            );
            if (!g) continue;
            if (await jaGravada(g.providerMessageId, g.fromMe)) continue;

            // A nossa própria mensagem no grupo é a fonte mais barata do
            // nosso LID — sem ele, menção a nós nunca acende (916). Vai o
            // `senderLid`, não o `senderJid`: este prefere o telefone, e com
            // a Baileys 7 seria telefone sempre (ver `lidDoRemetente`).
            if (g.fromMe && route.channelId) {
              await aprenderNossoLid(supabaseAdmin(), route.channelId, g.senderLid);
            }

            const gravadaGrupo = g.fromMe
              ? await persistGroupDeviceMessage({ db: supabaseAdmin(), m: g, mediaRef: item })
              : await persistGroupMessage({
                  db: supabaseAdmin(),
                  m: g,
                  ownLid: route.ownLid,
                  mediaRef: item,
                });

            if (gravadaGrupo && g.contentType !== 'text' && g.contentType !== 'location') {
              semAnexo.push({
                item,
                contentType: g.contentType,
                messageId: gravadaGrupo.messageId,
                bytes: g.mediaBytes,
                ehGrupo: true,
              });
            }
            continue;
          }

          const normalized = normalizeUpsert(
            item,
            route.accountId,
            route.ownerUserId,
            route.channelId,
          );
          if (!normalized) {
            // ---- `@lid` SEM TELEFONE ----
            // A cópia que o celular pareado reenvia quando a Evolution não
            // decifrou a mensagem de primeira. Até 19/09/2026 era jogada fora
            // aqui, com um `console.warn` como único rastro — e num caso
            // medido era a fala inicial de um lead novo. Agora o telefone é
            // procurado no acervo; sem ele, a mensagem fica RETIDA até o
            // número aparecer. Qualquer outro descarte segue calado, como
            // sempre. Nunca lança. Ver `sem-telefone/receber.ts`.
            semAnexo.push(
              ...(await receberSemTelefone({
                db: supabaseAdmin(),
                item,
                rota: route,
                jaGravada,
              })),
            );
            continue;
          }

          if (await jaGravada(normalized.providerMessageId, normalized.fromMe)) continue;

          // `fromMe` que sobreviveu ao teste acima não é eco nosso — foi
          // digitado no celular pareado, que divide a conta de WhatsApp
          // com o CRM. Caminho separado: sem fan-out e sem não-lido.
          const gravada = normalized.fromMe
            ? await persistDeviceMessage(supabaseAdmin(), normalized)
            : await persistInboundMessage(supabaseAdmin(), normalized);

          // Foto de perfil (973): só quem nunca foi conferido ou passou de
          // 30 dias — e depois de tudo gravado, fora do caminho da mensagem.
          if (
            gravada?.contato &&
            !normalized.remoteJid?.endsWith('@g.us') &&
            precisaConferirFoto(gravada.contato, Date.now()) &&
            !paraFoto.some((c) => c.id === gravada.contato!.id)
          ) {
            paraFoto.push(gravada.contato);
          }

          if (gravada && normalized.contentType !== 'text' && !normalized.mediaUrl) {
            semAnexo.push({
              item,
              contentType: normalized.contentType,
              messageId: gravada.messageId,
              // Tamanho declarado no 1:1 também (antes só grupo lia): é o que
              // evita baixar 46 MiB para descobrir que não cabe.
              bytes: mediaBytesOf(item),
            });
          }

          // ---- RELIGAR ----
          // Esta mensagem trouxe o PAR (telefone + LID). Se havia fala daquele
          // LID retida por falta de telefone, ela entra na conversa agora —
          // tipicamente o eco da resposta do escritório destravando a primeira
          // mensagem do lead. ⚠️ DEPOIS de tudo desta mensagem, de propósito:
          // os motores viram exatamente o que veriam sem a retida (é o que
          // mantém o gatilho "primeira mensagem" igual ao de hoje), e a retida
          // entra como história. Sai sem consultar nada quando a conversa não
          // é endereçada por LID; nunca lança. Ver `sem-telefone/religar.ts`.
          if (gravada) {
            semAnexo.push(
              ...(await religarRetidas({
                db: supabaseAdmin(),
                accountId: route.accountId,
                ownerUserId: route.ownerUserId,
                lidJid: normalized.remoteJidLid,
                telefoneJid: normalized.remoteJid,
                conversationId: gravada.conversationId,
                jaGravada,
              })),
            );
          }
        } catch (err) {
          console.error('[evolution/webhook] persist failed:', err);
        }
      }

      for (const pendente of semAnexo) {
        try {
          // ---- MAIOR QUE O BUCKET ----
          // ⚠️ Vem ANTES de tudo, inclusive do adiamento de grupo: baixar um
          // arquivo que o Storage vai recusar gasta banda e memória para
          // terminar em "Documento indisponível", que não explica nada. Com
          // `too_large` gravado, a bolha diz o NOME do arquivo e o motivo, e
          // `podeBaixarAnexo` esconde o botão que nunca funcionaria.
          //
          // Vale para 1:1 e para grupo. Até 2026-09-09 o `media_state` era só
          // de grupo — e `too_large` não tinha escritor nenhum, embora a rota
          // de download já o lesse.
          if (anexoGrandeDemais(pendente.bytes)) {
            // ⚠️ Os dois passos (marcar + apagar o ponteiro com as chaves de
            // decifragem) moram no helper de propósito — soltos aqui, eles já
            // divergiram da rota de download em um PR. Ver `anexo-grande.ts`.
            await marcarAnexoGrandeDemais({
              db: supabaseAdmin(),
              messageId: pendente.messageId,
              filename: nomeDeArquivoDeclarado(pendente.item),
              limparPonteiro: !!pendente.ehGrupo,
            });
            continue;
          }

          // Em GRUPO o anexo grande fica sob demanda ("toque para baixar"),
          // e só ele: no 1:1 o comportamento segue exatamente como era.
          // Tamanho desconhecido conta como pequeno de propósito — o WhatsApp
          // expira a mídia no servidor dele, então na dúvida é melhor gastar
          // banda agora do que descobrir semanas depois que o comprovante do
          // cliente não existe mais em lugar nenhum.
          if (
            pendente.ehGrupo &&
            pendente.bytes != null &&
            pendente.bytes > LIMITE_DOWNLOAD_AUTOMATICO_BYTES
          ) {
            continue; // fica com media_state='pending'
          }

          const midia = await resolveEvolutionMedia(
            route.accountId,
            // `in`, e não `??`: a retida cuja conexão foi APAGADA traz `null`
            // de propósito, e cair no canal deste webhook buscaria a mídia na
            // instância errada.
            'channelId' in pendente ? (pendente.channelId ?? null) : route.channelId,
            pendente.item,
            pendente.contentType,
          );

          if (!midia) {
            // `failed` continua SÓ em grupo: é o estado que acende o botão
            // de tentar de novo, e a rota de download sob demanda só existe
            // para grupo. Marcar 1:1 aqui prometeria um botão que não há.
            // (Diferente do `too_large` do portão acima, que não oferece
            // botão nenhum — só explica.)
            if (pendente.ehGrupo) {
              await supabaseAdmin()
                .from('messages')
                .update({ media_state: 'failed' })
                .eq('id', pendente.messageId);
            }
            continue;
          }

          const { error } = await supabaseAdmin()
            .from('messages')
            .update({
              media_url: midia.url,
              // O nome como o remetente enviou (969) e o mime que a Evolution
              // declarou. Os dois chegavam até aqui e eram descartados: o
              // documento aparecia como "Documento" na bolha e `media_type`
              // ficava NULL em 100% das linhas deste transporte.
              // ⚠️ Só escreve o nome quando ele existe — sobrescrever com NULL
              // apagaria o que outro caminho tivesse gravado antes.
              ...(midia.filename ? { media_filename: midia.filename } : {}),
              media_type: midia.mime,
              // Baixou: o anexo está no nosso Storage e o balão para de
              // oferecer o botão.
              ...(pendente.ehGrupo ? { media_state: null } : {}),
            })
            .eq('id', pendente.messageId);
          if (error) {
            console.error(
              '[evolution/webhook] anexo baixado mas não pôde ser ligado à mensagem:',
              error.message,
            );
            continue;
          }

          // Ponteiro cumpriu o papel: o arquivo está no nosso Storage e não
          // se busca de novo. Apagar não é faxina — o payload do Baileys
          // carrega as CHAVES DE DECIFRAGEM da mídia, e guardá-las depois de
          // não precisar mais é superfície de risco de graça. Sobram na
          // tabela só os anexos realmente pendentes ou falhos.
          if (pendente.ehGrupo) {
            await supabaseAdmin()
              .from('cb_message_media_ref')
              .delete()
              .eq('message_id', pendente.messageId);
          }
        } catch (err) {
          // A mensagem já está gravada — aqui só se perde o anexo.
          console.error('[evolution/webhook] anexo falhou:', err);
          if (pendente.ehGrupo) {
            // O `catch` de fora não protege o que roda DENTRO dele: sem este
            // try, uma falha aqui escaparia do laço e mataria os anexos dos
            // itens seguintes.
            try {
              await supabaseAdmin()
                .from('messages')
                .update({ media_state: 'failed' })
                .eq('id', pendente.messageId);
            } catch {
              // Nada a fazer: o anexo já estava perdido.
            }
          }
        }
      }

      // Fotos de perfil, por último: cada uma é uma chamada à Evolution mais
      // um download, e nada aqui pode segurar a mensagem (já gravada) nem o
      // anexo (já baixado). Falha vira log — a próxima mensagem tenta de novo.
      if (paraFoto.length > 0) {
        await conferirFotosDosContatos(route.accountId, route.channelId, paraFoto);
      }
    });
    return NextResponse.json({ ok: true });
  }

  if (event === 'messages.update') {
    const d = (body.data ?? {}) as { keyId?: string; status?: unknown; fromMe?: unknown };
    const status = ackToStatus(d.status);
    const keyId = d.keyId;
    if (keyId && status) {
      after(async () => {
        // Só toca nossas mensagens de saída (message_id === keyId). NÃO
        // escopamos por channel_id: o keyId da Baileys é único por mensagem,
        // então já mira exatamente a mensagem certa mesmo com vários canais —
        // e escopar por canal congelaria o ✓✓ das mensagens antigas
        // (channel_id NULL, anteriores à Fase 3).
        //
        // 'agent' é o envio manual do inbox; 'bot' é o que IA, flows e
        // automações gravam. Filtrar só por 'agent' deixava toda resposta
        // automática presa em "enviado", sem nunca virar entregue/lido.
        const tentar = async (): Promise<Tentativa> => {
          let q = supabaseAdmin()
            .from('messages')
            .update({ status })
            .eq('message_id', keyId)
            .in('sender_type', ['agent', 'bot']);
          // Ver `ACEITA_FALHA`: só marca falha o que ainda não passou de
          // "enviado". ⚠️ O resto da escada TAMBÉM tem guarda desde 09/09/2026:
          // a Evolution 2.4 (Baileys 7) emite SERVER_ACK DEPOIS do DELIVERY_ACK
          // da mesma mensagem (medido: 5 recibos em 9 s, o último rebaixando),
          // e sem a guarda a bolha voltava a um ✓ com a mensagem entregue. Uma
          // versão deste comentário dizia que a escada "já era monotônica na
          // prática" — era, na 6.7.19. Ver `escada-de-status.ts`.
          if (status === 'failed') q = q.in('status', ACEITA_FALHA);
          else q = q.in('status', aceitamAvancoPara(status));
          const { data: atualizadas, error } = await q.select('id');
          if (error) {
            console.error('[evolution/webhook] status update failed:', error);
            return 'erro';
          }
          return atualizadas && atualizadas.length > 0 ? 'avancou' : 'nada';
        };
        // ⚠️ O recibo costuma chegar ANTES da mensagem que ele confirma: a
        // Evolution despacha os dois no mesmo segundo, e a mensagem do celular
        // só é gravada depois dos 2 s de `jaGravada` (acima). Sem linha, espera
        // por ela; linha que existe e não avança é recibo atrasado ou repetido.
        // Ver `recibo-antes-da-mensagem.ts`.
        const avancou = await aplicarReciboQuandoAMensagemExistir({
          tentar,
          existe: async () => {
            const { data, error } = await supabaseAdmin()
              .from('messages')
              .select('id')
              .eq('message_id', keyId)
              .in('sender_type', ['agent', 'bot'])
              .limit(1);
            // Leitura que falhou vale "ainda não": a espera tem fim.
            return !error && (data?.length ?? 0) > 0;
          },
          esperar: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          // Recibo de mensagem RECEBIDA (`fromMe` false: o "lido" que a equipe
          // dá no celular) nunca acha linha de agent/bot — esperar por ela
          // seriam ~30 s de consultas a cada mensagem lida.
          pausas: d.fromMe === false ? [] : PAUSAS_DO_RECIBO_MS,
        });
        // Recibo atrasado ou repetido: nenhuma linha avançou, nada a anunciar
        // — sem isto o fan-out abaixo contaria ao integrador um "sent" sobre
        // mensagem já entregue.
        if (!avancou) return;

        // Fan-out do webhook público. O lado Meta já emite
        // message.status_updated; sem isto, quem integra recebe o ✓✓ dos
        // números oficiais e silêncio dos não-oficiais. Best-effort: uma
        // falha aqui não pode desfazer o UPDATE acima.
        const { data: msgRow } = await supabaseAdmin()
          .from('messages')
          .select('conversation_id, channel_id, conversations(account_id)')
          .eq('message_id', keyId)
          .in('sender_type', ['agent', 'bot'])
          .limit(1)
          .maybeSingle();

        const accountId = (
          msgRow?.conversations as { account_id: string } | null
        )?.account_id;
        if (msgRow && accountId) {
          await dispatchWebhookEvent(
            supabaseAdmin(),
            accountId,
            'message.status_updated',
            {
              whatsapp_message_id: keyId,
              conversation_id: msgRow.conversation_id,
              status,
              channel_id: msgRow.channel_id ?? null,
            },
          );
        }
      });
    }
    return NextResponse.json({ ok: true });
  }

  // A outra ponta apagou a mensagem ("apagar para todos").
  //
  // O conteúdo NÃO é removido do banco: fica marcado e a bolha o mostra
  // riscado. É divergência deliberada do WhatsApp — o escritório precisa do
  // registro do que foi dito, inclusive do que o cliente apagou depois.
  if (event === 'messages.delete') {
    // As duas formas de payload e o motivo da precedência estão em
    // `parseDeleteEvent` — ler só uma delas fazia o UPDATE acertar zero
    // linhas em silêncio.
    const exclusoes = parseDeleteEvent(body.data);
    if (exclusoes.length) {
      after(async () => {
        // ⚠️ SÓ CONFIRMA EXCLUSÃO QUE VEIO DE FORA.
        //
        // Havia aqui um segundo UPDATE que carimbava `deleted_at` nas
        // exclusões que o PRÓPRIO CRM tinha pedido, tratando este evento
        // como confirmação. Não é: quando o pedido parte da API da Evolution,
        // ela emite `messages.delete` como ECO do próprio pedido — antes e
        // independentemente de o WhatsApp ter revogado coisa alguma.
        //
        // Medido em produção em 28/07/2026: uma mensagem enviada pelo celular,
        // apagada pelo CRM, ficou com `deleted_at` preenchido e seguiu
        // intacta no aparelho. O eco confirmou uma revogação que não
        // aconteceu — exatamente a mentira que a separação
        // "solicitada × apagada" existe para impedir.
        //
        // Consequência aceita: exclusão pedida pelo CRM fica em "Exclusão
        // solicitada" e não vira "Apagada" sozinha. É a verdade — o WhatsApp
        // não emite confirmação de revogação para quem a pediu. Prometer
        // menos e cumprir vale mais que o contrário.
        const conversasAtingidas = new Set<string>();
        for (const { providerMessageId, fromMe } of exclusoes) {
          const { data: externas, error } = await supabaseAdmin()
            .from('messages')
            .update({
              deleted_at: new Date().toISOString(),
              // `fromMe` é a única fonte sobre a autoria aqui, e ausente
              // significa "o contato".
              deleted_by: fromMe ? 'agent' : 'customer',
            })
            .eq('message_id', providerMessageId)
            .is('deleted_at', null)
            // O filtro que faz o eco do nosso próprio pedido ser ignorado.
            .is('delete_requested_at', null)
            .select('conversation_id');

          if (error) {
            console.error('[evolution/webhook] marcar exclusão falhou:', error.message);
          }
          // O casamento é por `message_id` sem escopo de conta, então pode
          // atingir mais de uma linha — daí o Set em vez de uma variável.
          for (const linha of externas ?? []) {
            if (linha?.conversation_id) conversasAtingidas.add(linha.conversation_id);
          }
        }

        // A prévia é onde o operador decide qual conversa abrir. Sem isto a
        // bolha vira "Apagada" e a lista segue exibindo o texto retratado
        // como última mensagem — inclusive quando quem apagou foi o contato.
        for (const conversationId of conversasAtingidas) {
          await atualizarPreviaDaConversa(supabaseAdmin(), conversationId);
        }
      });
    }
    return NextResponse.json({ ok: true });
  }

  // A outra ponta editou a mensagem. Guardamos o texto anterior: o WhatsApp
  // não mantém histórico de edição, então este é o único registro de que a
  // mensagem dizia outra coisa.
  if (event === 'messages.edited') {
    const d = (body.data ?? {}) as {
      key?: { id?: string };
      message?: Record<string, unknown> | null;
      editedMessage?: Record<string, unknown> | null;
    };
    const providerId = d.key?.id;
    const novoTexto = extractText(d.editedMessage ?? d.message);
    if (providerId && novoTexto) {
      after(async () => {
        const { data: atual } = await supabaseAdmin()
          .from('messages')
          .select('id, content_text')
          .eq('message_id', providerId)
          .limit(1)
          .maybeSingle();
        if (!atual) return; // edição de mensagem anterior à integração

        // IDEMPOTÊNCIA. A Evolution reentrega o webhook quando não recebe
        // 200 a tempo. Na segunda passada `content_text` JÁ é o texto novo,
        // e gravá-lo em `text_before_edit` apagaria o original — que é o
        // único registro que existe, já que o WhatsApp não guarda histórico
        // de edição. Texto igual = nada mudou = reentrega.
        if (atual.content_text === novoTexto) return;

        const { error } = await supabaseAdmin()
          .from('messages')
          .update({
            content_text: novoTexto,
            text_before_edit: atual.content_text,
            edited_at: new Date().toISOString(),
          })
          .eq('id', atual.id);
        if (error) {
          console.error('[evolution/webhook] aplicar edição falhou:', error.message);
        }
      });
    }
    return NextResponse.json({ ok: true });
  }

  if (event === 'connection.update') {
    const d = (body.data ?? {}) as { state?: string };
    const raw = d.state;
    const state = raw === 'open' || raw === 'connecting' ? raw : 'close';
    after(async () => {
      // Espelho whatsapp_config (canal padrão / fluxo single-channel).
      await supabaseAdmin()
        .from('whatsapp_config')
        .update({
          instance_state: state,
          status: state === 'open' ? 'connected' : 'disconnected',
          ...(state === 'open' ? { last_connected_at: new Date().toISOString() } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('instance_name', instance);
      // cb_channels (multi-canal): mantém o status do canal fresco após
      // conexão/queda passiva — importante para o seletor da Fase 4. Best-
      // effort e deploy-safe (tabela ausente → erro ignorado). O CHECK de
      // cb_channels.status admite connected/connecting/disconnected (sem
      // 'close'), então 'close' → 'disconnected'.
      const { error: chErr } = await supabaseAdmin()
        .from('cb_channels')
        .update({
          status:
            state === 'open'
              ? 'connected'
              : state === 'connecting'
                ? 'connecting'
                : 'disconnected',
          ...(state === 'open' ? { connected_at: new Date().toISOString() } : {}),
        })
        .eq('instance_name', instance)
        .eq('kind', 'evolution');
      if (chErr) {
        console.warn(
          '[evolution/webhook] cb_channels status sync falhou (ignorado):',
          chErr.message,
        );
      }
    });
    return NextResponse.json({ ok: true });
  }

  // ---- GRUPOS ----
  // Os dois eventos abaixo só valem quando o canal tem grupos ligados. Sem o
  // interruptor a gente nem consulta o banco: um número com grupos desligados
  // não deve gastar trabalho com movimentação de grupo nenhuma.

  if (event === 'group.participants.update' && route.groupsEnabled) {
    const atualizacao = parseParticipantsUpdate(body.data);
    if (atualizacao) {
      after(async () => {
        try {
          const nomes = await nomesConhecidos(
            supabaseAdmin(),
            route.accountId,
            atualizacao.jids,
          );
          const texto = descreverParticipantes(atualizacao.acao, atualizacao.jids, nomes);
          if (!texto) return;
          await registrarAvisoDeSistema(supabaseAdmin(), {
            accountId: route.accountId,
            groupJid: atualizacao.groupJid,
            texto,
            channelId: route.channelId,
          });
        } catch (err) {
          // Aviso é acessório: perdê-lo não pode derrubar nada.
          console.error('[evolution/webhook] aviso de participantes falhou:', err);
        }
      });
    }
    return NextResponse.json({ ok: true });
  }

  if (event === 'groups.upsert' && route.groupsEnabled) {
    const grupos = parseGroupsUpsert(body.data);
    if (grupos.length) {
      after(async () => {
        for (const g of grupos) {
          if (!g.subject) continue;
          try {
            // Só ATUALIZA o nome de grupo que já conhecemos. Criar a linha
            // aqui poria no inbox um grupo em que ninguém nunca falou — e o
            // que povoa a lista é a sincronização, não este evento.
            const { error } = await supabaseAdmin()
              .from('cb_groups')
              .update({ subject: g.subject, synced_at: new Date().toISOString() })
              .eq('account_id', route.accountId)
              .eq('jid', g.jid);
            if (error) {
              console.warn('[evolution/webhook] atualizar nome do grupo falhou:', error.message);
            }
          } catch (err) {
            console.error('[evolution/webhook] groups.upsert falhou:', err);
          }
        }
      });
    }
    return NextResponse.json({ ok: true });
  }

  // Any other event (qrcode.updated, send.message echo, …) — just ack.
  return NextResponse.json({ ok: true });
}

/**
 * A mensagem já está no banco? Faz dois trabalhos com uma consulta:
 *
 *  1. **Idempotência.** A Evolution REENTREGA o webhook quando não recebe
 *     200 a tempo, com o mesmo `key.id` da Baileys. Sem isto a mesma
 *     mensagem entra duas vezes no histórico — já aconteceu em produção.
 *  2. **Distinguir o eco do aparelho.** Tudo que sai desta conta chega com
 *     `fromMe`. Se o id já existe, foi o CRM que enviou (gravamos no
 *     momento do envio). Se não existe, foi digitado no celular.
 *
 * `esperarCorrida` cobre o intervalo em que o CRM já mandou para a
 * Evolution mas ainda não gravou a linha: o envio grava DEPOIS de receber
 * o id de volta, então o eco pode chegar primeiro. Sem essa espera, o
 * próprio envio do operador viraria uma segunda bolha "pelo celular".
 */
async function jaGravada(providerMessageId: string, esperarCorrida = false): Promise<boolean> {
  const existe = async () => {
    const { data } = await supabaseAdmin()
      .from('messages')
      .select('id')
      .eq('message_id', providerMessageId)
      .limit(1)
      .maybeSingle();
    return !!data;
  };

  if (await existe()) return true;
  if (!esperarCorrida) return false;

  await new Promise((r) => setTimeout(r, 2_000));
  return existe();
}

/**
 * Reação recebida (`👍` numa mensagem). Não é mensagem: vira estado em
 * `message_reactions`, a mesma tabela que o lado Meta e o botão de reagir
 * do inbox já usam, então a bolha exibe sem nenhuma mudança de UI.
 *
 * Texto vazio significa REMOÇÃO da reação, igual à especificação da Meta.
 *
 * ⚠️ Reação feita no CELULAR pareado é ignorada de propósito. A chave é
 * `(message_id, actor_type, actor_id)` e não há como saber QUAL usuário do
 * CRM reagiu pelo aparelho compartilhado — atribuir a um chute poria o
 * nome de uma pessoa numa ação que não foi dela.
 */
async function registrarReacao(item: EvolutionUpsert): Promise<void> {
  if (item.key?.fromMe) return;

  const reacao = unwrapMessage(item.message)?.reactionMessage as
    | { key?: { id?: string }; text?: unknown }
    | undefined;
  const alvoProviderId = reacao?.key?.id;
  if (!alvoProviderId) return;

  const { data: alvo } = await supabaseAdmin()
    .from('messages')
    .select('id, conversation_id, conversations(contact_id)')
    .eq('message_id', alvoProviderId)
    .limit(1)
    .maybeSingle();

  // Reação a mensagem anterior à integração: não há bolha onde pendurar.
  if (!alvo) return;
  const contactId = (alvo.conversations as { contact_id: string } | null)?.contact_id;
  if (!contactId) return;

  const emoji = typeof reacao?.text === 'string' ? reacao.text : '';

  if (!emoji) {
    const { error } = await supabaseAdmin()
      .from('message_reactions')
      .delete()
      .eq('message_id', alvo.id)
      .eq('actor_type', 'customer')
      .eq('actor_id', contactId);
    if (error) console.error('[evolution/webhook] remover reação falhou:', error.message);
    return;
  }

  const { error } = await supabaseAdmin().from('message_reactions').upsert(
    {
      message_id: alvo.id,
      conversation_id: alvo.conversation_id,
      actor_type: 'customer',
      actor_id: contactId,
      emoji,
    },
    { onConflict: 'message_id,actor_type,actor_id' },
  );
  if (error) console.error('[evolution/webhook] gravar reação falhou:', error.message);
}

/**
 * Foto de perfil dos contatos que acabaram de falar (973): monta o client
 * UMA vez para o canal e confere um a um. Nunca lança.
 */
async function conferirFotosDosContatos(
  accountId: string,
  channelId: string | null,
  contatos: NonNullable<PersistedInbound['contato']>[],
): Promise<void> {
  try {
    const canal = await resolveChannelForConversation(supabaseAdmin(), accountId, {
      channel_id: channelId,
    });
    if (!canal || !ehEvolution(canal)) return;
    if (!canal.base_url || !canal.instance_name || !canal.api_key) return;
    const client = new EvolutionClient({
      baseUrl: canal.base_url,
      instance: canal.instance_name,
      apikey: decrypt(canal.api_key),
    });
    for (const c of contatos) {
      await atualizarFotoDoContato({
        db: supabaseAdmin(),
        client,
        accountId,
        contactId: c.id,
        phone: c.phone,
      });
    }
  } catch (err) {
    console.error('[evolution/webhook] foto de perfil:', err instanceof Error ? err.message : err);
  }
}

/**
 * Monta o client da Evolution a partir das credenciais do canal e baixa a
 * midia. Devolve `null` (e nunca lanca) quando o canal nao resolve ou o
 * download falha — o chamador persiste a mensagem sem anexo.
 */
async function resolveEvolutionMedia(
  accountId: string,
  channelId: string | null,
  rawItem: unknown,
  contentType: string,
): Promise<EvolutionMediaSalva | null> {
  try {
    const canal = await resolveChannelForConversation(supabaseAdmin(), accountId, {
      channel_id: channelId,
    });
    if (!canal || !ehEvolution(canal)) return null;
    if (!canal.base_url || !canal.instance_name || !canal.api_key) return null;

    const client = new EvolutionClient({
      baseUrl: canal.base_url,
      instance: canal.instance_name,
      apikey: decrypt(canal.api_key),
    });
    return await fetchAndStoreEvolutionMedia({
      db: supabaseAdmin(),
      client,
      accountId,
      // O item CRU do webhook (`{key, message, …}`), não o `.message` de
      // dentro dele. A Evolution faz `const msg = m?.message ? m :
      // getMessage(m.key)`: mandando só o conteúdo, `m.message` é undefined,
      // ela tenta o lookup por `m.key` — que não existe no que enviamos — e
      // devolve 400. Era por isso que NENHUM anexo recebido era baixado.
      rawMessage: rawItem,
      contentType,
    });
  } catch (err) {
    console.error(
      '[evolution/webhook] midia recebida nao pode ser salva:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
