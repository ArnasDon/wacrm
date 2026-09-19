import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

const h = vi.hoisted(() => ({
  persistInboundMessage: vi.fn(),
  persistDeviceMessage: vi.fn(),
}));
vi.mock('@/lib/whatsapp/inbound-store', () => h);

import type { EvolutionUpsert } from '@/lib/whatsapp/transport/evolution-inbound';

import { criarBanco, type Banco, type Linha } from './banco.test-helper';
import { receberSemTelefone } from './receber';

const RETIDAS = 'cb_mensagens_sem_telefone';
const LID = '254833865040050@lid';
const TEL = '5583900001111@s.whatsapp.net';
const CARIMBO = 1789747434; // 2026-09-18T16:03:54Z
const ms = (seg: number) => (CARIMBO + seg) * 1000;
const iso = (seg: number) => new Date(ms(seg)).toISOString();
const ROTA = { accountId: 'conta-1', ownerUserId: 'dono-1', channelId: 'canal-1' };

/** A cópia que o celular pareado reenvia: chave só com o LID, sem pushName. */
const copiaDoCelular = (over: Partial<EvolutionUpsert> = {}): EvolutionUpsert => ({
  key: { remoteJid: LID, fromMe: false, id: 'ACA5A459' },
  message: { messageContextInfo: {}, conversation: 'Olá, gostaria de informações' },
  messageTimestamp: CARIMBO,
  ...over,
});

/** O par LID↔telefone já visto numa mensagem gravada. */
const parConhecido = (over: Linha = {}): Linha => ({
  id: 'eco-1',
  conversation_id: 'conv-1',
  sender_type: 'agent',
  from_device: true,
  deleted_at: null,
  message_id: '3EB028',
  remote_jid: TEL,
  remote_jid_lid: LID,
  created_at: iso(17),
  conversations: { account_id: 'conta-1', group_id: null },
  ...over,
});

function chamar(b: Banco, item: EvolutionUpsert, jaGravada = vi.fn().mockResolvedValue(false), seg = 69) {
  return receberSemTelefone({ db: b.db, item, rota: ROTA, jaGravada, agoraMs: ms(seg) });
}

describe('receberSemTelefone', () => {
  let aviso: MockInstance<(...args: unknown[]) => void>;
  beforeEach(() => {
    aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    h.persistInboundMessage
      .mockReset()
      .mockResolvedValue({ messageId: 'msg-normal', conversationId: 'conv-1', contato: null });
    h.persistDeviceMessage
      .mockReset()
      .mockResolvedValue({ messageId: 'msg-aparelho', conversationId: 'conv-1', contato: null });
  });
  afterEach(() => vi.restoreAllMocks());

  const avisos = () => aviso.mock.calls.map((c) => String(c[0]));

  describe('o que NÃO é assunto daqui sai calado, como sempre', () => {
    const casos: Array<[string, EvolutionUpsert]> = [
      ['mensagem com telefone', copiaDoCelular({ key: { remoteJid: LID, remoteJidAlt: TEL, id: 'X' } })],
      ['grupo', copiaDoCelular({ key: { remoteJid: '120363000000000000@g.us', id: 'X' } })],
      ['chave sem id', copiaDoCelular({ key: { remoteJid: LID } })],
      ['reação', copiaDoCelular({ message: { reactionMessage: { key: { id: 'A' }, text: '👍' } } })],
      ['edição cifrada', copiaDoCelular({ message: { secretEncryptedMessage: { secretEncType: 1 } } })],
    ];
    for (const [nome, item] of casos) {
      it(nome, async () => {
        const b = criarBanco({ messages: [parConhecido()] });
        const jaGravada = vi.fn();
        expect(await chamar(b, item, jaGravada)).toEqual([]);
        expect(jaGravada).not.toHaveBeenCalled();
        expect(b.escritas).toEqual([]);
        expect(avisos()).toEqual([]);
      });
    }
  });

  it('DUPLICATA (a cópia normal já entrou — 4 dos 5 casos medidos): sai calada, sem alarme falso', async () => {
    const b = criarBanco({ messages: [parConhecido()] });
    expect(await chamar(b, copiaDoCelular(), vi.fn().mockResolvedValue(true))).toEqual([]);
    expect(b.escritas).toEqual([]);
    expect(h.persistInboundMessage).not.toHaveBeenCalled();
    expect(avisos()).toEqual([]);
  });

  it('eco do escritório espera a corrida do envio do próprio CRM, como a rota faz', async () => {
    const b = criarBanco();
    const jaGravada = vi.fn().mockResolvedValue(true);
    await chamar(b, copiaDoCelular({ key: { remoteJid: LID, fromMe: true, id: '3EB047' } }), jaGravada);
    expect(jaGravada).toHaveBeenCalledWith('3EB047', true);
  });

  it('O CASO DE 18/09: o escritório já tinha respondido → a fala ENTRA como história, sem motor', async () => {
    const b = criarBanco({ messages: [parConhecido()] });
    expect(await chamar(b, copiaDoCelular())).toEqual([]);

    const fala = b.tabelas.messages.find((m) => m.message_id === 'ACA5A459')!;
    expect(fala).toMatchObject({
      conversation_id: 'conv-1',
      sender_type: 'customer',
      remote_jid: TEL,
      remote_jid_lid: LID,
      channel_id: 'canal-1',
      created_at: iso(0),
    });
    expect(h.persistInboundMessage).not.toHaveBeenCalled();
    // O registro durável conta a ocorrência — sem guardar o conteúdo.
    expect(b.tabelas[RETIDAS]).toHaveLength(1);
    expect(b.tabelas[RETIDAS][0]).toMatchObject({
      situacao: 'entregue',
      resolvida_por: 'acervo',
      message_id: fala.id,
      payload: null,
      tipo: 'text',
    });
    expect(avisos()).toEqual([]);
  });

  it('LID conhecido e ela é a ÚLTIMA e recente → caminho normal, UMA vez, já com o telefone', async () => {
    const b = criarBanco({ messages: [parConhecido({ created_at: iso(-3600) })] });
    await chamar(b, copiaDoCelular(), undefined, 8);
    expect(h.persistInboundMessage).toHaveBeenCalledTimes(1);
    expect(h.persistInboundMessage.mock.calls[0][1]).toMatchObject({
      phone: '5583900001111',
      remoteJid: TEL,
      remoteJidLid: LID,
      providerMessageId: 'ACA5A459',
      channelId: 'canal-1',
      timestamp: CARIMBO,
    });
    expect(b.tabelas[RETIDAS][0]).toMatchObject({ situacao: 'entregue', message_id: 'msg-normal' });
  });

  it('com MÍDIA devolve o anexo a buscar, pela conexão deste webhook', async () => {
    const b = criarBanco({ messages: [parConhecido()] });
    const item = copiaDoCelular({
      message: { documentMessage: { mimetype: 'application/pdf', fileLength: '43407' } },
    });
    const anexos = await chamar(b, item);
    expect(anexos).toHaveLength(1);
    expect(anexos[0]).toMatchObject({
      item,
      contentType: 'document',
      bytes: 43407,
      channelId: 'canal-1',
    });
    expect(anexos[0].messageId).toEqual(expect.any(String));
  });

  it('LID DESCONHECIDO (lead novo, ninguém respondeu ainda) → RETIDA, com o payload cru', async () => {
    const b = criarBanco({ messages: [] });
    const item = copiaDoCelular();
    expect(await chamar(b, item)).toEqual([]);
    expect(b.tabelas[RETIDAS]).toHaveLength(1);
    expect(b.tabelas[RETIDAS][0]).toMatchObject({
      situacao: 'retida',
      lid_jid: LID,
      provider_message_id: 'ACA5A459',
      channel_id: 'canal-1',
      from_me: false,
      tipo: 'text',
      carimbo: iso(0),
      payload: item,
    });
    expect(b.tabelas.messages).toEqual([]);
    expect(h.persistInboundMessage).not.toHaveBeenCalled();
    expect(avisos().some((a) => a.includes('RETIDA'))).toBe(true);
    expect(avisos().some((a) => a.includes('DESCARTADA'))).toBe(false);
  });

  it('a CORRIDA retenção × eco: o par gravado DURANTE a retenção é visto na segunda olhada', async () => {
    const b = criarBanco({ messages: [] });
    // O eco é gravado por outro pedido exatamente quando esta retida é escrita.
    const from = b.db.from.bind(b.db);
    (b.db as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      if (t === RETIDAS && !b.tabelas.messages.length) b.tabelas.messages.push(parConhecido());
      return from(t);
    };
    await chamar(b, copiaDoCelular());
    expect(b.tabelas.messages.some((m) => m.message_id === 'ACA5A459')).toBe(true);
    expect(b.tabelas[RETIDAS]).toHaveLength(1);
    expect(b.tabelas[RETIDAS][0]).toMatchObject({
      situacao: 'entregue',
      resolvida_por: 'religacao',
      payload: null,
    });
  });

  it('a retenção FALHOU (ex.: deploy antes da 1007) → o comportamento e o aviso de SEMPRE', async () => {
    const b = criarBanco({ messages: [] });
    b.falhas[RETIDAS] = { code: '42P01', message: 'relation does not exist' };
    expect(await chamar(b, copiaDoCelular())).toEqual([]);
    const descarte = aviso.mock.calls.find((c) => String(c[0]).includes('DESCARTADA'))!;
    expect(String(descarte[0])).toBe(
      '[evolution/webhook] mensagem DESCARTADA: endereçada por @lid sem telefone.'
    );
    // O tipo é o do CONTEÚDO — antes saía `messageContextInfo`, a 1ª chave do payload.
    expect(JSON.parse(String(descarte[1]))).toEqual({
      canal: 'canal-1',
      remoteJid: LID,
      messageId: 'ACA5A459',
      fromMe: false,
      tipo: 'text',
    });
    expect(b.tabelas.messages).toEqual([]);
  });

  it('`jaGravada` que LANÇA não perde a mensagem: ela vai para a retenção', async () => {
    const b = criarBanco({ messages: [] });
    const jaGravada = vi.fn().mockRejectedValue(new Error('rede fora'));
    await expect(chamar(b, copiaDoCelular(), jaGravada)).resolves.toEqual([]);
    expect(b.tabelas[RETIDAS][0]).toMatchObject({ situacao: 'retida' });
  });

  it('estouro DEPOIS do insert (um motor, no modo nova) não vira "DESCARTADA": retém, e a religação deduplica', async () => {
    const b = criarBanco({ messages: [parConhecido({ created_at: iso(-3600) })] });
    h.persistInboundMessage.mockRejectedValue(new Error('motor estourou'));
    await expect(chamar(b, copiaDoCelular(), undefined, 8)).resolves.toEqual([]);
    expect(b.tabelas[RETIDAS][0]).toMatchObject({ situacao: 'retida' });
    expect(avisos().some((a) => a.includes('DESCARTADA'))).toBe(false);
  });

  it('LID conhecido mas a entrega falhou → retém e NÃO tenta de novo na hora (daria na mesma)', async () => {
    const b = criarBanco({ messages: [parConhecido({ created_at: iso(-3600) })] });
    h.persistInboundMessage.mockResolvedValue(null);
    await chamar(b, copiaDoCelular(), undefined, 8);
    expect(h.persistInboundMessage).toHaveBeenCalledTimes(1);
    expect(b.tabelas[RETIDAS][0]).toMatchObject({ situacao: 'retida' });
  });
});
