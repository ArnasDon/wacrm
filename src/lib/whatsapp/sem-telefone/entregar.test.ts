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
  remoteJidLid: '100000000000101@lid',
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

  it('TARDIA — horas depois e AINDA a última: sem motor nenhum, mas a conversa ENCERRADA reabre, ganha a prévia e sobe na lista', async () => {
    const b = criarBanco({
      messages: [
        { id: 'velha', conversation_id: 'conv-1', sender_type: 'agent', sender_id: 'u1', deleted_at: null, content_text: 'até logo', content_type: 'text', created_at: iso(-86400) },
      ],
      conversations: [
        { id: 'conv-1', status: 'closed', assigned_agent_id: 'u1', aguardando_desde: null, last_message_text: 'até logo', last_message_at: iso(-86400) },
      ],
    });
    const r = await entregarRecuperada({
      db: b.db,
      m: recuperada({ text: 'Preciso falar com vocês' }),
      conversationId: 'conv-1',
      agoraMs: ms(3 * 3600),
    });
    expect(r).toMatchObject({ status: 'gravada', modo: 'tardia' });
    // Nenhum motor: o caminho normal não foi chamado.
    expect(h.persistInboundMessage).not.toHaveBeenCalled();
    expect(h.persistDeviceMessage).not.toHaveBeenCalled();

    const conversa = b.tabelas.conversations[0];
    expect(conversa.status).toBe('open');
    // Cliente reabre SEM responsável — o dono antigo não volta (regra da caixa em duas abas).
    expect(conversa.assigned_agent_id).toBeNull();
    expect(conversa.last_message_text).toBe('Preciso falar com vocês');
    expect(Date.parse(conversa.last_message_at as string)).toBeGreaterThan(ms(-86400));

    // A ordem é a regra: insert → reabrir → acertar a espera. A função do banco
    // trata encerrada como "ninguém espera"; rodando antes de reabrir, a fala
    // do cliente ficaria sem o "em atraso".
    const ordem = b.escritas.map((e) => `${e.op}:${e.tabela}`);
    const insert = ordem.indexOf('insert:messages');
    const reabrir = b.escritas.findIndex(
      (e) => e.tabela === 'conversations' && (e.payload as { status?: string }).status === 'open',
    );
    expect(insert).toBeGreaterThanOrEqual(0);
    expect(reabrir).toBeGreaterThan(insert);
    expect(b.rpcs).toHaveLength(1);
    expect(b.rpcs[0].nome).toBe('cb_assentar_mensagem_historica');
  });

  it('HISTÓRICA (já escreveram depois) NÃO mexe na conversa: encerrada continua encerrada, prévia e posição intactas', async () => {
    const b = criarBanco({
      messages: [
        { id: 'depois', conversation_id: 'conv-1', sender_type: 'agent', from_device: true, deleted_at: null, content_text: 'resolvido!', content_type: 'text', created_at: iso(60) },
      ],
      conversations: [
        { id: 'conv-1', status: 'closed', assigned_agent_id: null, aguardando_desde: null, last_message_text: 'resolvido!', last_message_at: iso(60) },
      ],
    });
    const r = await entregarRecuperada({
      db: b.db,
      m: recuperada(),
      conversationId: 'conv-1',
      agoraMs: ms(3 * 3600),
    });
    expect(r).toMatchObject({ status: 'gravada', modo: 'historica' });
    expect(b.tabelas.conversations[0]).toMatchObject({
      status: 'closed',
      last_message_text: 'resolvido!',
      last_message_at: iso(60),
    });
    expect(b.escritas.filter((e) => e.tabela === 'conversations')).toEqual([]);
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

  it('o caminho normal desistiu e a mensagem NÃO está no fio: falhou, sem segunda tentativa (quem chama retém)', async () => {
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

  it('o caminho normal desistiu porque a OUTRA cópia ganhou o UNIQUE: DUPLICADA — a mensagem está no fio, nada a reter', async () => {
    const b = criarBanco({ messages: [] });
    // A cópia normal entra ENTRE a decisão do modo e o insert desta.
    h.persistInboundMessage.mockImplementation(async () => {
      b.tabelas.messages.push({ id: 'normal', conversation_id: 'conv-1', message_id: 'ACA5A459', created_at: iso(0) });
      return null;
    });
    const r = await entregarRecuperada({
      db: b.db,
      m: recuperada(),
      conversationId: 'conv-1',
      agoraMs: ms(5),
    });
    expect(r).toEqual({ status: 'duplicada' });
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
