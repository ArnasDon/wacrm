import { describe, it, expect, vi, beforeEach } from 'vitest'

import { MEDIA_MAX_BYTES_ENTRADA } from '@/lib/storage/upload-media'

// Shared, hoisted state the module mocks close over. Reset per test.
const h = vi.hoisted(() => ({
  runAutomationsForTrigger: vi.fn(),
  dispatchInboundToFlows: vi.fn(),
  dispatchInboundToAiReply: vi.fn(),
  dispatchWebhookEvent: vi.fn(),
  state: {
    // Result the message upsert's .select() resolves to. A genuine insert
    // returns the row; a replayed delivery conflicts and returns [].
    messageUpsertResult: [{ id: 'msg-1' }] as { id: string }[],
    priorCustomerMsgCount: 0,
    /** Row `lookupInternalIdByMetaId` resolves for a `context.id`. */
    replyContextParent: null as { id: string } | null,
    conversation: { id: 'conv-1', unread_count: 0, account_id: 'acc-1' },
    upsertCalls: [] as { row: Record<string, unknown>; options: unknown }[],
    /** Erros que as próximas chamadas do upsert devolvem, em ordem (um por chamada). */
    messageUpsertErrors: [] as ({ code: string; message: string; details?: string } | null)[],
    rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
    afterCallbacks: [] as (() => Promise<void> | void)[],
    automationStarted: 0,
    automationCompleted: 0,
    /** whatsapp_config.mirror_inbound_media for the matched row (#466). */
    mirrorInboundMedia: true as boolean | undefined,
    /** Objects the inbound-media mirror pushed into chat-media. */
    storageUploads: [] as {
      bucket: string
      path: string
      options: { contentType?: string }
    }[],
    /** Error the next storage upload resolves with, if any. */
    storageUploadError: null as { message: string } | null,
  },
}))

vi.mock('next/server', () => ({
  after: (cb: () => Promise<void> | void) => {
    h.state.afterCallbacks.push(cb)
  },
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ body, init }),
  },
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      switch (table) {
        case 'whatsapp_config':
          return {
            select: () => ({
              eq: () =>
                Promise.resolve({
                  data: [
                    {
                      account_id: 'acc-1',
                      user_id: 'user-1',
                      access_token: 'enc',
                      mirror_inbound_media: h.state.mirrorInboundMedia,
                    },
                  ],
                  error: null,
                }),
            }),
          }
        case 'conversations':
          // findOrCreateConversation: select().eq().eq().order().limit()
          // reopenClosedConversation: update().eq('id').eq('status','closed'),
          // que roda a toda mensagem desde que o atalho sobre o status lido no
          // começo da requisição saiu (Codex, PR #232). 0 linhas = aberta.
          return {
            update: () => ({
              eq: () => ({
                eq: () => Promise.resolve({ error: null, count: 0 }),
              }),
            }),
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () =>
                      Promise.resolve({
                        data: [h.state.conversation],
                        error: null,
                      }),
                  }),
                }),
              }),
            }),
          }
        case 'broadcast_recipients':
          // flagBroadcastReplyIfAny: select().eq().eq().in().order().limit()
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  in: () => ({
                    order: () => ({
                      limit: () =>
                        Promise.resolve({ data: [], error: null }),
                    }),
                  }),
                }),
              }),
            }),
          }
        case 'messages':
          return {
            // Two different chains land here, told apart by the count
            // option: the prior-message count (head request) and the
            // reply-context parent lookup.
            select: (_columns: string, options?: { head?: boolean }) =>
              options?.head
                ? // priorCustomerMsgCount: select('id',{count,head}).eq().eq()
                  {
                    eq: () => ({
                      eq: () =>
                        Promise.resolve({
                          count: h.state.priorCustomerMsgCount,
                          error: null,
                        }),
                    }),
                  }
                : // lookupInternalIdByMetaId: select('id').eq().eq().maybeSingle()
                  {
                    eq: () => ({
                      eq: () => ({
                        maybeSingle: () =>
                          Promise.resolve({
                            data: h.state.replyContextParent,
                            error: null,
                          }),
                      }),
                    }),
                  },
            // Idempotent insert: upsert(...).select('id')
            upsert: (row: Record<string, unknown>, options: unknown) => {
              h.state.upsertCalls.push({ row, options })
              const erro = h.state.messageUpsertErrors.shift() ?? null
              return {
                select: () =>
                  Promise.resolve(
                    erro
                      ? { data: null, error: erro }
                      : { data: h.state.messageUpsertResult, error: null }
                  ),
              }
            },
          }
        // Multi-canal: além do `whatsapp_config` acima, a entrada consulta
        // `cb_channels` para descobrir por qual número a mensagem chegou e
        // carimbar `messages.channel_id`. Devolver vazio aqui é o cenário
        // "conta de um número só" — `channelId` fica null e o carimbo é
        // pulado, que é exatamente o comportamento anterior ao multi-canal
        // e o que estes testes do upstream assumem.
        case 'cb_channels': {
          const chain: Record<string, unknown> = {
            select: () => chain,
            eq: () => chain,
            order: () => chain,
            limit: () => chain,
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
            then: (resolve: (r: { data: unknown[]; error: null }) => unknown) =>
              resolve({ data: [], error: null }),
          }
          return chain
        }
        default:
          throw new Error(`unexpected table: ${table}`)
      }
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      h.state.rpcCalls.push({ name, args })
      return Promise.resolve({ data: null, error: null })
    },
    // Service-role Storage, used by the inbound-media mirror (#466).
    storage: {
      from(bucket: string) {
        return {
          upload: (
            path: string,
            _body: unknown,
            options: { contentType?: string },
          ) => {
            h.state.storageUploads.push({ bucket, path, options })
            return Promise.resolve({ error: h.state.storageUploadError })
          },
          getPublicUrl: (path: string) => ({
            data: { publicUrl: `https://cdn.test/${bucket}/${path}` },
          }),
        }
      },
    },
  }),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: () => 'plain-token',
  encrypt: (v: string) => v,
  isLegacyFormat: () => false,
}))
vi.mock('@/lib/whatsapp/meta-api', () => ({
  getMediaUrl: vi.fn(),
  downloadMedia: vi.fn(),
}))
vi.mock('@/lib/contacts/dedupe', () => ({
  findExistingContact: vi.fn(async () => ({
    contato: {
      id: 'contact-1',
      name: 'Ada',
      phone: '15551230000',
    },
    falhou: false,
  })),
  isUniqueViolation: () => false,
}))
vi.mock('@/lib/whatsapp/webhook-signature', () => ({
  verifyMetaWebhookSignature: () => true,
}))
vi.mock('@/lib/whatsapp/template-webhook', () => ({
  isTemplateWebhookField: () => false,
  handleTemplateWebhookChange: vi.fn(),
}))
vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: h.runAutomationsForTrigger,
}))
vi.mock('@/lib/flows/engine', () => ({
  dispatchInboundToFlows: h.dispatchInboundToFlows,
}))
vi.mock('@/lib/ai/auto-reply', () => ({
  dispatchInboundToAiReply: h.dispatchInboundToAiReply,
}))
// Multi-canal: o carimbo e a resolucao do canal de entrada sao NOSSOS. Sao
// substituidos aqui para que os casos de regressao no fim do arquivo possam
// observar se o webhook realmente os chama — e com quais argumentos.
vi.mock('@/lib/cb-channels/stamp', async () => {
  const real = await vi.importActual<typeof import('@/lib/cb-channels/stamp')>(
    '@/lib/cb-channels/stamp'
  )
  return {
    stampMessageChannel: vi.fn(async () => {}),
    followConversationChannel: vi.fn(async () => {}),
    pinConversationChannel: vi.fn(async () => {}),
    // A gravação com a rede da FK é a REAL: é ela que os casos de regressão
    // no fim do arquivo exercitam (canal no upsert; repetição sem canal).
    gravarComCanal: real.gravarComCanal,
    violouFkDoCanal: real.violouFkDoCanal,
  }
})
vi.mock('@/lib/cb-channels/resolve-inbound', () => ({
  resolveInboundMetaChannelId: vi.fn(async () => null),
  resolveInboundMetaChannel: vi.fn(async () => null),
}))
vi.mock('@/lib/cb-channels/pipeline-routing', () => ({
  routeContactToPipeline: vi.fn(async () => {}),
}))

vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: h.dispatchWebhookEvent,
}))

import { POST } from './route'
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api'

const mockGetMediaUrl = vi.mocked(getMediaUrl)
const mockDownloadMedia = vi.mocked(downloadMedia)

const TEXT_MESSAGE = {
  id: 'wamid.TEST1',
  from: '15551230000',
  timestamp: '1700000000',
  type: 'text',
  text: { body: 'hello' },
}

function inboundRequest(message: Record<string, unknown> = TEXT_MESSAGE) {
  const body = {
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: 'pn-1' },
              contacts: [{ wa_id: '15551230000', profile: { name: 'Ada' } }],
              messages: [message],
            },
          },
        ],
      },
    ],
  }
  return {
    text: async () => JSON.stringify(body),
    headers: { get: () => 'sha256=stub' },
  } as unknown as Request
}

async function runWebhook(message?: Record<string, unknown>) {
  const res = await POST(inboundRequest(message))
  // Drain the after() callback exactly as the runtime would.
  for (const cb of h.state.afterCallbacks) await cb()
  return res
}

beforeEach(() => {
  vi.clearAllMocks()
  h.state.messageUpsertResult = [{ id: 'msg-1' }]
  h.state.priorCustomerMsgCount = 0
  h.state.replyContextParent = null
  h.state.conversation = { id: 'conv-1', unread_count: 0, account_id: 'acc-1' }
  h.state.upsertCalls = []
  h.state.messageUpsertErrors = []
  h.state.rpcCalls = []
  h.state.afterCallbacks = []
  h.state.automationStarted = 0
  h.state.automationCompleted = 0
  h.state.mirrorInboundMedia = true
  h.state.storageUploads = []
  h.state.storageUploadError = null
  mockGetMediaUrl.mockResolvedValue({
    url: 'https://lookaside.fbsbx.com/whatsapp/abc',
    mimeType: 'image/jpeg',
    fileSize: 2048,
  })
  mockDownloadMedia.mockResolvedValue({
    buffer: Buffer.alloc(2048),
    contentType: 'image/jpeg',
  })
  h.dispatchInboundToFlows.mockResolvedValue({ consumed: false })
  h.dispatchInboundToAiReply.mockResolvedValue(undefined)
  h.dispatchWebhookEvent.mockResolvedValue(undefined)
  h.runAutomationsForTrigger.mockImplementation(() => {
    h.state.automationStarted++
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        h.state.automationCompleted++
        resolve()
      }, 0)
    })
  })
})

describe('inbound webhook: idempotent insert (#367)', () => {
  it('a genuine first delivery persists once and fans out downstream', async () => {
    await runWebhook()

    // Inserted via upsert with the (conversation_id, message_id) conflict
    // target — not a bare insert.
    expect(h.state.upsertCalls).toHaveLength(1)
    expect(h.state.upsertCalls[0].options).toMatchObject({
      onConflict: 'conversation_id,message_id',
      ignoreDuplicates: true,
    })
    // Downstream side effects ran exactly once.
    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.dispatchInboundToFlows).toHaveBeenCalledTimes(1)
    expect(h.dispatchWebhookEvent).toHaveBeenCalledTimes(1)
  })

  it('a replayed delivery is a no-op: no unread bump, no fan-out', async () => {
    // Upsert hits the unique index and returns no row.
    h.state.messageUpsertResult = []

    await runWebhook()

    expect(h.state.upsertCalls).toHaveLength(1)
    // None of the downstream side effects fire on a replay.
    expect(h.state.rpcCalls).toHaveLength(0)
    expect(h.dispatchInboundToFlows).not.toHaveBeenCalled()
    expect(h.runAutomationsForTrigger).not.toHaveBeenCalled()
    expect(h.dispatchInboundToAiReply).not.toHaveBeenCalled()
    expect(h.dispatchWebhookEvent).not.toHaveBeenCalled()
  })
})

describe('inbound webhook: atomic unread bump (#369)', () => {
  it('increments unread through the DB-side RPC, not a read-modify-write', async () => {
    await runWebhook()

    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.state.rpcCalls[0]).toMatchObject({
      name: 'bump_conversation_on_inbound',
      args: { p_conversation_id: 'conv-1' },
    })
  })
})

describe('inbound webhook: template quick-reply buttons (#478)', () => {
  // A customer tapping a QUICK_REPLY button on a broadcast template.
  // `context.id` points at the template message we sent — which the
  // broadcast path never wrote to `messages`, so the parent lookup
  // legitimately misses and the reply is stored unquoted.
  const templateButtonTap = {
    id: 'wamid.BTN1',
    from: '15551230000',
    timestamp: '1700000000',
    type: 'button',
    button: { text: 'Yes, interested', payload: 'YES_INTERESTED' },
    context: { id: 'wamid.BROADCAST1' },
  }

  it('stores the tap as an interactive reply, not an unsupported message', async () => {
    await runWebhook(templateButtonTap)

    expect(h.state.upsertCalls).toHaveLength(1)
    expect(h.state.upsertCalls[0].row).toMatchObject({
      content_type: 'interactive',
      content_text: 'Yes, interested',
      interactive_reply_id: 'YES_INTERESTED',
      reply_to_message_id: null,
    })
  })

  it('routes the tap to flows and fires the interactive_reply trigger', async () => {
    await runWebhook(templateButtonTap)

    expect(h.dispatchInboundToFlows).toHaveBeenCalledWith(
      expect.objectContaining({
        message: {
          kind: 'interactive_reply',
          reply_id: 'YES_INTERESTED',
          reply_title: 'Yes, interested',
          meta_message_id: 'wamid.BTN1',
        },
      }),
    )
    const triggers = h.runAutomationsForTrigger.mock.calls.map(
      (call) => (call[0] as { triggerType: string }).triggerType,
    )
    expect(triggers).toContain('interactive_reply')
    // The AI auto-reply must stay out of it — a button tap is not a
    // free-text question.
    expect(h.dispatchInboundToAiReply).not.toHaveBeenCalled()
  })

  it('falls back to the label when the template button carries no payload', async () => {
    await runWebhook({
      ...templateButtonTap,
      button: { text: 'Track my order' },
    })

    expect(h.state.upsertCalls[0].row).toMatchObject({
      content_type: 'interactive',
      content_text: 'Track my order',
      interactive_reply_id: 'Track my order',
    })
  })
})

describe('inbound webhook: inbound media is mirrored (#466)', () => {
  const IMAGE_MESSAGE = {
    id: 'wamid.IMG1',
    from: '15551230000',
    timestamp: '1700000000',
    type: 'image',
    image: { id: '1234567890123456', mime_type: 'image/jpeg', caption: 'hi' },
  }

  it('stores a durable bucket URL instead of the expiring proxy path', async () => {
    await runWebhook(IMAGE_MESSAGE)

    expect(h.state.storageUploads).toHaveLength(1)
    expect(h.state.storageUploads[0].bucket).toBe('chat-media')
    expect(h.state.storageUploads[0].path).toBe(
      'account-acc-1/inbound/1234567890123456-image-1700000000.jpg',
    )
    expect(h.state.upsertCalls[0].row).toMatchObject({
      media_url:
        'https://cdn.test/chat-media/account-acc-1/inbound/1234567890123456-image-1700000000.jpg',
      // Meta's MIME type used to be discarded outright (`void mediaType`).
      media_type: 'image/jpeg',
    })
  })

  it('falls back to the proxy URL when the upload is refused', async () => {
    h.state.storageUploadError = { message: 'mime type not supported' }

    await runWebhook(IMAGE_MESSAGE)

    // The message still lands, and it still lands with a usable URL —
    // the mirror failing must never cost us the message.
    expect(h.state.upsertCalls).toHaveLength(1)
    expect(h.state.upsertCalls[0].row).toMatchObject({
      media_url: '/api/whatsapp/media/1234567890123456',
      media_type: 'image/jpeg',
    })
  })

  it('falls back to the proxy URL when the download from Meta throws', async () => {
    mockDownloadMedia.mockRejectedValueOnce(new Error('Media download failed: 404'))

    await runWebhook(IMAGE_MESSAGE)

    expect(h.state.upsertCalls[0].row).toMatchObject({
      media_url: '/api/whatsapp/media/1234567890123456',
    })
  })

  it('skips media larger than the bucket accepts, without downloading it', async () => {
    mockGetMediaUrl.mockResolvedValue({
      url: 'https://lookaside.fbsbx.com/whatsapp/big',
      mimeType: 'application/pdf',
      // ⚠️ Derivado do teto, nunca um número solto: a 986 subiu o limite do
      // bucket para 50 MiB e um "40 MB" cravado passou a caber, então este
      // teste afirmava o contrário do que o código faz.
      fileSize: MEDIA_MAX_BYTES_ENTRADA + 1,
    })

    await runWebhook({
      id: 'wamid.DOC1',
      from: '15551230000',
      timestamp: '1700000000',
      type: 'document',
      document: {
        id: '999',
        mime_type: 'application/pdf',
        filename: 'huge.pdf',
      },
    })

    expect(mockDownloadMedia).not.toHaveBeenCalled()
    expect(h.state.storageUploads).toHaveLength(0)
    expect(h.state.upsertCalls[0].row).toMatchObject({
      media_url: '/api/whatsapp/media/999',
      media_type: 'application/pdf',
    })
  })

  it("names the object after a document's own filename", async () => {
    mockGetMediaUrl.mockResolvedValue({
      url: 'https://lookaside.fbsbx.com/whatsapp/doc',
      mimeType: 'application/pdf',
      fileSize: 4096,
    })
    mockDownloadMedia.mockResolvedValue({
      buffer: Buffer.alloc(4096),
      contentType: 'application/pdf',
    })

    await runWebhook({
      id: 'wamid.DOC2',
      from: '15551230000',
      timestamp: '1700000000',
      type: 'document',
      document: {
        id: '1234567890123456',
        mime_type: 'application/pdf',
        filename: 'invoice.pdf',
        caption: 'have a look',
      },
    })

    expect(h.state.storageUploads[0].path).toBe(
      'account-acc-1/inbound/1234567890123456-invoice.pdf',
    )
  })

  it('does not mirror when the account has opted out', async () => {
    h.state.mirrorInboundMedia = false

    await runWebhook(IMAGE_MESSAGE)

    expect(mockDownloadMedia).not.toHaveBeenCalled()
    expect(h.state.storageUploads).toHaveLength(0)
    expect(h.state.upsertCalls[0].row).toMatchObject({
      media_url: '/api/whatsapp/media/1234567890123456',
      // Still recorded — the MIME type costs nothing and makes the
      // download name right even for proxied media.
      media_type: 'image/jpeg',
    })
  })

  it('mirrors when the column is absent, e.g. a row read before migration 042', async () => {
    h.state.mirrorInboundMedia = undefined

    await runWebhook(IMAGE_MESSAGE)

    expect(h.state.storageUploads).toHaveLength(1)
  })

  it('leaves text messages alone', async () => {
    await runWebhook()

    expect(mockGetMediaUrl).not.toHaveBeenCalled()
    expect(h.state.storageUploads).toHaveLength(0)
    expect(h.state.upsertCalls[0].row).toMatchObject({ media_type: null })
  })
})

describe('inbound webhook: after() awaits automations (#368)', () => {
  it('every triggered automation settles before the after() callback resolves', async () => {
    await runWebhook()

    // first_inbound_message + new_message_received + keyword_match.
    expect(h.state.automationStarted).toBe(3)
    // If the dispatches were fire-and-forget, completed would still be 0
    // here — the callback would have resolved before the timers fired.
    expect(h.state.automationCompleted).toBe(3)
  })
})

// ============================================================
// REGRESSÃO DO MERGE (upstream 2026-08-26) — o NOSSO lado do webhook.
//
// Os 15 casos acima vieram do upstream e cobrem a metade DELES da
// composição: idempotência, bump atômico, toque em botão, espelho de mídia.
// Nenhum deles olharia para o carimbo de canal — e o carimbo é a peça que
// um "aceitar a versão deles" apagaria sem quebrar nada visível.
//
// Desde 10/09/2026 o carimbo vai NO PRÓPRIO upsert (`channel_id`). Antes era
// um UPDATE separado, depois do bump, que engolia a falha: a mensagem podia
// ficar sem carimbo, e a janela de 24h por número (janela-24h.ts) a leria como
// vinda de outro número. Um merge que devolva o upsert cru do upstream apaga o
// campo em silêncio — e toda mensagem recebida deixa de registrar por qual
// número entrou.
// ============================================================
describe('regressão de merge: carimbo de canal na entrada (multi-canal)', () => {
  it('carimba o canal NO PRÓPRIO upsert, e a conversa segue o cliente', async () => {
    const { stampMessageChannel, followConversationChannel } = await import(
      '@/lib/cb-channels/stamp'
    )
    const { resolveInboundMetaChannelId } = await import(
      '@/lib/cb-channels/resolve-inbound'
    )
    vi.mocked(resolveInboundMetaChannelId).mockResolvedValue('canal-1')
    h.state.messageUpsertResult = [{ id: 'msg-77' }]

    await runWebhook()

    // Na linha inserida, não num UPDATE depois — aquele era best-effort e
    // deixava a mensagem sem número quando falhava.
    expect(h.state.upsertCalls[0].row).toMatchObject({ channel_id: 'canal-1' })
    expect(stampMessageChannel).not.toHaveBeenCalled()
    // E a conversa segue o número por onde o cliente escreveu.
    expect(followConversationChannel).toHaveBeenCalledWith(
      expect.anything(),
      'conv-1',
      'canal-1'
    )
  })

  it('numa REENTREGA a conversa não segue de novo — o upsert já barrou antes', async () => {
    const { followConversationChannel } = await import('@/lib/cb-channels/stamp')
    const { resolveInboundMetaChannelId } = await import(
      '@/lib/cb-channels/resolve-inbound'
    )
    vi.mocked(resolveInboundMetaChannelId).mockResolvedValue('canal-1')
    // Upsert com conflito: a Meta reentregou a mesma mensagem.
    h.state.messageUpsertResult = []

    await runWebhook()

    expect(followConversationChannel).not.toHaveBeenCalled()
  })

  it('conta de um número só: sem canal resolvido, a linha nasce sem carimbo', async () => {
    // O comportamento anterior ao multi-canal, que precisa continuar
    // existindo — carimbar um canal inventado seria pior que não carimbar.
    const { followConversationChannel } = await import('@/lib/cb-channels/stamp')
    const { resolveInboundMetaChannelId } = await import(
      '@/lib/cb-channels/resolve-inbound'
    )
    vi.mocked(resolveInboundMetaChannelId).mockResolvedValue(null)

    await runWebhook()

    expect(h.state.upsertCalls[0].row).toMatchObject({ channel_id: null })
    expect(followConversationChannel).not.toHaveBeenCalled()
  })

  it('conexão apagada no meio: a FK recusa o canal e a mensagem é gravada SEM ele, sem se perder', async () => {
    const { followConversationChannel } = await import('@/lib/cb-channels/stamp')
    const { resolveInboundMetaChannelId } = await import(
      '@/lib/cb-channels/resolve-inbound'
    )
    vi.mocked(resolveInboundMetaChannelId).mockResolvedValue('canal-apagado')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.state.messageUpsertErrors = [
      {
        code: '23503',
        message:
          'insert or update on table "messages" violates foreign key constraint "messages_channel_id_fkey"',
        details: 'Key (channel_id)=(canal-apagado) is not present in table "cb_channels".',
      },
    ]

    await runWebhook()

    // Duas gravações: com o canal (recusada pela FK) e sem ele (a que vale).
    expect(h.state.upsertCalls.map((c) => c.row.channel_id)).toEqual([
      'canal-apagado',
      null,
    ])
    // A repetição mantém a idempotência: reentrega continua sendo reentrega.
    expect(h.state.upsertCalls[1].options).toMatchObject({
      onConflict: 'conversation_id,message_id',
      ignoreDuplicates: true,
    })
    // O canal sumiu: a conversa não segue um número que não existe mais…
    expect(followConversationChannel).not.toHaveBeenCalled()
    // …mas a mensagem entrou, e o resto da entrada rodou (o bump de não lidas).
    expect(h.state.rpcCalls.map((c) => c.name)).toContain(
      'bump_conversation_on_inbound'
    )
    warn.mockRestore()
  })
})
