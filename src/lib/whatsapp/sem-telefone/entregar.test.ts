import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  persistInboundMessage: vi.fn(),
  persistDeviceMessage: vi.fn(),
}));
vi.mock('@/lib/whatsapp/inbound-store', () => h);

import type { NormalizedInbound } from '@/lib/whatsapp/inbound-store';

import { criarBanco } from './banco.test-helper';
import { entregarRecuperada } from './entregar';

const CARIMBO = 1789747434; // 2026-09-18T16:03:54Z
const ms = (seg: number) => (CARIMBO + seg) * 1000;
const iso = (seg: number) => new Date(ms(seg)).toISOString();

const recuperada = (over: Partial<NormalizedInbound> = {}): NormalizedInbound => ({
  accountId: 'conta-1',
  configOwnerUserId: 'dono-1',
  channelId: 'canal-1',
  fromMe: false,
  phone: '5583900001111',
  name: '5583900001111',
  providerMessageId: 'ACA5A459',
  remoteJid: '5583900001111@s.whatsapp.net',
  remoteJidLid: '254833865040050@lid',
  timestamp: CARIMBO,
  contentType: 'text',
  text: 'Olá',
  mediaUrl: null,
  ...over,
});

describe('entregarRecuperada', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    h.persistInboundMessage.mockReset().mockResolvedValue({
      messageId: 'msg-normal',
      conversationId: 'conv-1',
      contato: null,
    });
    h.persistDeviceMessage.mockReset().mockResolvedValue({
      messageId: 'msg-aparelho',
      conversationId: 'conv-1',
      contato: null,
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('a ÚLTIMA da conversa e recente → NOVA: o caminho normal, UMA vez, com o telefone', async () => {
    const b = criarBanco({
      messages: [{ id: 'antiga', conversation_id: 'conv-1', created_at: iso(-3600) }],
    });
    const m = recuperada();
    const r = await entregarRecuperada({ db: b.db, m, conversationId: 'conv-1', agoraMs: ms(8) });
    expect(r).toEqual({ status: 'gravada', modo: 'nova', messageId: 'msg-normal' });
    expect(h.persistInboundMessage).toHaveBeenCalledTimes(1);
    expect(h.persistInboundMessage).toHaveBeenCalledWith(b.db, m);
    expect(h.persistDeviceMessage).not.toHaveBeenCalled();
    // A histórica não rodou: nada foi inserido por fora do caminho normal.
    expect(b.escritas).toEqual([]);
    expect(b.rpcs).toEqual([]);
  });

  it('eco do escritório (fromMe) na NOVA vai pelo caminho do celular pareado', async () => {
    const b = criarBanco({ messages: [] });
    const r = await entregarRecuperada({
      db: b.db,
      m: recuperada({ fromMe: true }),
      conversationId: 'conv-1',
      agoraMs: ms(5),
    });
    expect(r).toMatchObject({ status: 'gravada', modo: 'nova', messageId: 'msg-aparelho' });
    expect(h.persistInboundMessage).not.toHaveBeenCalled();
  });

  it('o caso de 18/09: já escreveram depois → HISTÓRICA, e o caminho normal NÃO é chamado', async () => {
    const b = criarBanco({
      messages: [
        {
          id: 'eco',
          conversation_id: 'conv-1',
          sender_type: 'agent',
          from_device: true,
          deleted_at: null,
          created_at: iso(17),
        },
      ],
    });
    const r = await entregarRecuperada({
      db: b.db,
      m: recuperada(),
      conversationId: 'conv-1',
      agoraMs: ms(69),
    });
    expect(r).toMatchObject({ status: 'gravada', modo: 'historica' });
    expect(h.persistInboundMessage).not.toHaveBeenCalled();
    expect(h.persistDeviceMessage).not.toHaveBeenCalled();
    expect(b.tabelas.messages.some((x) => x.message_id === 'ACA5A459')).toBe(true);
  });

  it('retida religada HORAS depois nunca passa pelos motores, mesmo sendo a última', async () => {
    const b = criarBanco({ messages: [] });
    const r = await entregarRecuperada({
      db: b.db,
      m: recuperada(),
      conversationId: 'conv-1',
      agoraMs: ms(3 * 3600),
    });
    expect(r).toMatchObject({ modo: 'historica' });
    expect(h.persistInboundMessage).not.toHaveBeenCalled();
  });

  it('NÃO CONSEGUI LER a última da conversa → histórica (a dúvida não arrisca os motores)', async () => {
    const b = criarBanco({ messages: [] });
    // A leitura falha; o insert da histórica precisa passar — falha só no 1º uso.
    let leituras = 0;
    const from = b.db.from.bind(b.db);
    (b.db as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      if (t === 'messages' && leituras++ === 0) {
        const falha = { data: null, error: { message: 'timeout' } };
        const q: Record<string, unknown> = {};
        for (const k of ['select', 'eq', 'order', 'limit']) q[k] = () => q;
        q.maybeSingle = () => Promise.resolve(falha);
        return q;
      }
      return from(t);
    };
    const r = await entregarRecuperada({
      db: b.db,
      m: recuperada(),
      conversationId: 'conv-1',
      agoraMs: ms(5),
    });
    expect(r).toMatchObject({ status: 'gravada', modo: 'historica' });
    expect(h.persistInboundMessage).not.toHaveBeenCalled();
  });

  it('o caminho normal desistiu (a OUTRA cópia ganhou o UNIQUE): falhou, sem segunda tentativa', async () => {
    h.persistInboundMessage.mockResolvedValue(null);
    const b = criarBanco({ messages: [] });
    const r = await entregarRecuperada({
      db: b.db,
      m: recuperada(),
      conversationId: 'conv-1',
      agoraMs: ms(5),
    });
    expect(r).toEqual({ status: 'falhou' });
    expect(h.persistInboundMessage).toHaveBeenCalledTimes(1);
    expect(b.escritas).toEqual([]);
  });

  it('histórica que bate no UNIQUE devolve duplicada', async () => {
    const b = criarBanco({
      messages: [
        { id: 'normal', conversation_id: 'conv-1', message_id: 'ACA5A459', created_at: iso(2) },
      ],
    });
    const r = await entregarRecuperada({
      db: b.db,
      m: recuperada(),
      conversationId: 'conv-1',
      agoraMs: ms(10),
    });
    expect(r).toEqual({ status: 'duplicada' });
  });
});
