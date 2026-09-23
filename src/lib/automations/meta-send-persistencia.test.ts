import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================
// REGRESSÃO DO MERGE (upstream 2026-08-26) — o que a AUTOMAÇÃO grava.
//
// Duas correções se encontraram na mesma linha do `meta-send.ts`:
//
//   - Nossa (P1.5/923): automação nunca assina com nome de gente. O texto
//     que vai para `content_text` é o `textoFinal`, assinado pelo escritório
//     — não o `input.text` cru. Assinar com o autor da REGRA diria ao cliente
//     que aquela pessoa leu o caso e escreveu, quando uma regra disparou
//     sozinha, possivelmente meses depois.
//
//   - Deles (#483): envio de template gravava `content_text` NULL, e a bolha
//     nascia vazia no inbox.
//
// A versão do upstream é `input.kind === 'text' ? input.text : ...`, e a
// resolução do merge trocou `input.text` pelo nosso `textoFinal`. Um merge
// futuro que aceite a forma deles crua faz a automação gravar o texto SEM
// assinatura — o WhatsApp do cliente e o CRM passam a mostrar coisas
// diferentes para a mesma mensagem, e nada acusa.
//
// `meta-send.test.ts` (ao lado) cobre o repasse de canal em botão/lista e
// mocka o `supabaseAdmin` para explodir; por isso o caminho de persistência
// é exercitado aqui, num arquivo próprio.
// ============================================================

const h = vi.hoisted(() => ({
  mensagens: [] as Record<string, unknown>[],
  conversas: [] as Record<string, unknown>[],
  /** Filtros de cada UPDATE da prévia da conversa. */
  filtrosDaPrevia: [] as [string, unknown][][],
  /** De qual conta é a conversa do envio (upstream #589). */
  donaDaConversa: 'acc-1',
}))

vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from(tabela: string) {
      if (tabela === 'contacts') {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({
            data: { id: 'contact-1', phone: '+5511999998888' },
            error: null,
          }),
        }
        return chain
      }
      if (tabela === 'messages') {
        return {
          insert: (row: Record<string, unknown>) => {
            h.mensagens.push(row)
            return {
              select: () => ({
                single: async () => ({ data: { id: 'msg-1' }, error: null }),
              }),
            }
          },
        }
      }
      if (tabela === 'conversations') {
        return {
          // A conferência de posse (upstream #589): a linha só vem quando o
          // filtro de conta casa com a dona da conversa.
          select: () => {
            const filtros: [string, unknown][] = []
            const chain: Record<string, unknown> = {
              eq: (k: string, v: unknown) => (filtros.push([k, v]), chain),
              maybeSingle: async () => {
                const conta = filtros.find(([k]) => k === 'account_id')
                const id = filtros.find(([k]) => k === 'id')?.[1]
                return {
                  data: !conta || conta[1] === h.donaDaConversa ? { id } : null,
                  error: null,
                }
              },
            }
            return chain
          },
          update: (row: Record<string, unknown>) => {
            h.conversas.push(row)
            const filtros: [string, unknown][] = []
            h.filtrosDaPrevia.push(filtros)
            const chain: Record<string, unknown> = {
              eq: (k: string, v: unknown) => (filtros.push([k, v]), chain),
              then: (ok: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(ok),
            }
            return chain
          },
        }
      }
      throw new Error(`tabela inesperada: ${tabela}`)
    },
  }),
}))

vi.mock('@/lib/cb-channels/engine-send', () => ({
  resolveEngineChannelPreferring: vi.fn(async () => ({
    channelId: 'canal-1',
    provider: 'meta',
    phone_number_id: 'pn-1',
    access_token: 'enc',
  })),
  evolutionTransportFor: vi.fn(),
  evolutionRemoteJid: vi.fn(() => null),
}))

vi.mock('@/lib/cb-channels/stamp', () => ({
  stampMessageChannel: vi.fn(async () => {}),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => v,
}))

const sendTextMessage = vi.fn<(args: { text?: string }) => Promise<{ messageId: string }>>(
  async () => ({ messageId: 'wamid.texto' }),
)
vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage: (a: { text?: string }) => sendTextMessage(a),
  sendTemplateMessage: vi.fn(async () => ({ messageId: 'wamid.tpl' })),
}))

vi.mock('@/lib/assinatura/resolver', () => ({
  nomeAutomaticoParaAssinar: vi.fn(async () => 'CB Advogados'),
}))

vi.mock('@/lib/whatsapp/template-body', () => ({
  resolveTemplateRow: vi.fn(async () => ({
    row: null,
    malformed: false,
    language: 'pt_BR',
  })),
  templateContentText: vi.fn(() => 'Corpo do modelo substituído'),
}))

import { engineSendText } from './meta-send'

const ARGS = {
  accountId: 'acc-1',
  userId: 'user-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  text: 'Recebemos seu documento.',
}

beforeEach(() => {
  h.mensagens = []
  h.conversas = []
  h.filtrosDaPrevia = []
  h.donaDaConversa = 'acc-1'
  vi.clearAllMocks()
})

describe('conversa de OUTRA conta (upstream #589)', () => {
  it('recusa ANTES de chamar a Meta, e não grava mensagem nem prévia', async () => {
    h.donaDaConversa = 'outra-conta'
    await expect(engineSendText(ARGS)).rejects.toThrow(/conversation not found for this account/)
    expect(sendTextMessage).not.toHaveBeenCalled()
    expect(h.mensagens).toEqual([])
    expect(h.conversas).toEqual([])
  })

  it('a prévia da conversa é atualizada com o recorte de conta', async () => {
    await engineSendText(ARGS)
    expect(h.filtrosDaPrevia[0]).toContainEqual(['account_id', 'acc-1'])
  })
})

describe('regressão de merge: a automação grava o texto ASSINADO', () => {
  it('content_text carrega a assinatura do escritório, não o texto cru', async () => {
    await engineSendText(ARGS)

    const gravado = String(h.mensagens[0]?.content_text ?? '')
    expect(gravado).toContain('CB Advogados')
    expect(gravado).toContain('Recebemos seu documento.')
    // Se a linha tivesse ficado com `input.text` (a forma do upstream), isto
    // seria exatamente o texto cru.
    expect(gravado).not.toBe(ARGS.text)
  })

  it('o que o CRM grava é o MESMO que foi enviado ao cliente', async () => {
    // A propriedade que importa de verdade: a Meta e o banco recebem o mesmo
    // texto. Divergir aqui é o CRM mentir sobre o que o cliente leu.
    await engineSendText(ARGS)

    const enviado = sendTextMessage.mock.calls[0]?.[0]
    expect(h.mensagens[0]?.content_text).toBe(enviado?.text)
  })

  it('a prévia da conversa também usa o texto assinado', async () => {
    await engineSendText(ARGS)
    expect(String(h.conversas[0]?.last_message_text ?? '')).toContain(
      'CB Advogados'
    )
  })

  it('a mensagem sai carimbada como bot, não como agente', async () => {
    // Não é do merge, mas anda junto: se `sender_type` virar 'agent' numa
    // resolução futura, a bolha some da marcação de automação no inbox.
    await engineSendText(ARGS)
    expect(h.mensagens[0]?.sender_type).toBe('bot')
  })
})
