import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================
// Os envios do ROBÔ (fluxo, IA, e o `send_to_number` / a régua, que
// passam por `engineSendText`) gravam a mensagem e a prévia pelo id da
// conversa em service-role. Upstream #589 (GHSA-m4fx-g6pr-hrw8): a conversa
// tem de ser DESTA conta, conferida ANTES do provedor — depois de a
// mensagem sair não há o que desfazer. Um caso por envio: texto, mídia e
// interativa (botões e lista passam pelo mesmo `sendInteractiveViaMeta`).
// ============================================================

const h = vi.hoisted(() => ({
  donaDaConversa: 'acc-1',
  mensagens: [] as Record<string, unknown>[],
  previas: [] as [string, unknown][][],
}))

vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from(tabela: string) {
      const filtros: [string, unknown][] = []
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (k: string, v: unknown) => (filtros.push([k, v]), chain),
        maybeSingle: async () => {
          if (tabela === 'contacts') return { data: { id: 'contact-1', phone: '+5583988887777' }, error: null }
          if (tabela === 'conversations') {
            const conta = filtros.find(([k]) => k === 'account_id')
            const id = filtros.find(([k]) => k === 'id')?.[1]
            return { data: !conta || conta[1] === h.donaDaConversa ? { id } : null, error: null }
          }
          return { data: null, error: null }
        },
        insert: (row: Record<string, unknown>) => {
          h.mensagens.push(row)
          return { select: () => ({ single: async () => ({ data: { id: 'msg-1' }, error: null }) }) }
        },
        update: () => {
          h.previas.push(filtros)
          return chain
        },
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok),
      }
      return chain
    },
  }),
}))

vi.mock('@/lib/cb-channels/engine-send', () => ({
  resolveEngineChannelPreferring: vi.fn(async () => ({
    channelId: 'canal-1',
    kind: 'meta',
    provider: 'meta',
    phone_number_id: 'pn-1',
    access_token: 'enc',
  })),
  evolutionTransportFor: vi.fn(),
  evolutionRemoteJid: vi.fn(() => null),
}))
vi.mock('@/lib/cb-channels/stamp', () => ({ stampMessageChannel: vi.fn(async () => {}) }))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => v }))
vi.mock('@/lib/assinatura/resolver', () => ({ nomeAutomaticoParaAssinar: vi.fn(async () => null) }))

const meta = vi.hoisted(() => ({
  sendTextMessage: vi.fn(async () => ({ messageId: 'wamid.t' })),
  sendMediaMessage: vi.fn(async () => ({ messageId: 'wamid.m' })),
  sendInteractiveButtons: vi.fn(async () => ({ messageId: 'wamid.b' })),
  sendInteractiveList: vi.fn(async () => ({ messageId: 'wamid.l' })),
}))
vi.mock('@/lib/whatsapp/meta-api', () => meta)

import { engineSendInteractiveButtons, engineSendMedia, engineSendText } from './meta-send'

const BASE = { accountId: 'acc-1', userId: 'u-1', conversationId: 'conv-1', contactId: 'contact-1' }

const ENVIOS = [
  { nome: 'texto', enviar: () => engineSendText({ ...BASE, text: 'oi' }), provedor: meta.sendTextMessage },
  {
    nome: 'mídia',
    enviar: () => engineSendMedia({ ...BASE, kind: 'image', link: 'https://x.test/a.jpg' }),
    provedor: meta.sendMediaMessage,
  },
  {
    nome: 'interativa',
    enviar: () =>
      engineSendInteractiveButtons({ ...BASE, bodyText: 'Escolha', buttons: [{ id: 'a', title: 'A' }] }),
    provedor: meta.sendInteractiveButtons,
  },
]

beforeEach(() => {
  h.donaDaConversa = 'acc-1'
  h.mensagens = []
  h.previas = []
})

describe('envio do robô — a conversa tem de ser desta conta (upstream #589)', () => {
  for (const e of ENVIOS) {
    it(`${e.nome}: conversa de outra conta é recusada antes do provedor, sem gravar nada`, async () => {
      h.donaDaConversa = 'outra-conta'
      await expect(e.enviar()).rejects.toThrow(/conversation not found for this account/)
      expect(e.provedor).not.toHaveBeenCalled()
      expect(h.mensagens).toEqual([])
      expect(h.previas).toEqual([])
    })

    it(`${e.nome}: conversa desta conta sai, e a prévia leva o recorte de conta`, async () => {
      await e.enviar()
      expect(e.provedor).toHaveBeenCalledTimes(1)
      expect(h.mensagens).toHaveLength(1)
      expect(h.previas.at(-1)).toContainEqual(['account_id', 'acc-1'])
    })
  }
})
