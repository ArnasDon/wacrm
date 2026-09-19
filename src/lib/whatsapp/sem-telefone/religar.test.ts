import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  persistInboundMessage: vi.fn(),
  persistDeviceMessage: vi.fn(),
}));
vi.mock('@/lib/whatsapp/inbound-store', () => h);

import { criarBanco, type Banco, type Linha } from './banco.test-helper';
import { religarRetidas } from './religar';

const RETIDAS = 'cb_mensagens_sem_telefone';
const LID = '254833865040050@lid';
const TEL = '5583900001111@s.whatsapp.net';
const CARIMBO = 1789747434; // 2026-09-18T16:03:54Z
const ms = (seg: number) => (CARIMBO + seg) * 1000;
const iso = (seg: number) => new Date(ms(seg)).toISOString();

/** Uma linha `retida`, como `reter` a grava. */
function retida(id: string, segundos: number, over: Linha = {}): Linha {
  return {
    id: `ret-${id}`,
    account_id: 'conta-1',
    channel_id: 'canal-1',
    lid_jid: LID,
    provider_message_id: id,
    from_me: false,
    situacao: 'retida',
    carimbo: iso(segundos),
    payload: {
      key: { remoteJid: LID, fromMe: false, id },
      message: { conversation: `fala ${id}` },
      messageTimestamp: CARIMBO + segundos,
    },
    ...over,
  };
}

/** A mensagem que TROUXE o telefone (o eco do escritório), já gravada. */
const gatilho = (): Linha => ({
  id: 'eco-1',
  conversation_id: 'conv-1',
  sender_type: 'agent',
  from_device: true,
  deleted_at: null,
  message_id: '3EB028',
  created_at: iso(600),
});

function chamar(b: Banco, over: Partial<Parameters<typeof religarRetidas>[0]> = {}) {
  return religarRetidas({
    db: b.db,
    accountId: 'conta-1',
    ownerUserId: 'dono-1',
    lidJid: LID,
    telefoneJid: TEL,
    conversationId: 'conv-1',
    jaGravada: vi.fn().mockResolvedValue(false),
    agoraMs: ms(601),
    ...over,
  });
}

describe('religarRetidas', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    h.persistInboundMessage.mockReset().mockResolvedValue(null);
    h.persistDeviceMessage.mockReset().mockResolvedValue(null);
  });
  afterEach(() => vi.restoreAllMocks());

  it('conversa que NÃO é endereçada por LID sai antes de qualquer consulta (o caminho quente)', async () => {
    const b = criarBanco({ [RETIDAS]: [retida('A', 0)] });
    const from = vi.spyOn(b.db, 'from');
    for (const lidJid of [null, undefined, '', TEL, '120363000000000000@g.us']) {
      expect(await chamar(b, { lidJid })).toEqual([]);
    }
    expect(from).not.toHaveBeenCalled();
  });

  it('o telefone de quem destrava tem de ser JID de telefone — LID nunca vira telefone', async () => {
    const b = criarBanco({ [RETIDAS]: [retida('A', 0)] });
    const from = vi.spyOn(b.db, 'from');
    for (const telefoneJid of [null, undefined, LID, '5583900001111', '120363000000000000@g.us']) {
      expect(await chamar(b, { telefoneJid })).toEqual([]);
    }
    expect(from).not.toHaveBeenCalled();
    expect(b.tabelas[RETIDAS][0].situacao).toBe('retida');
  });

  it('sem retida daquele LID: uma consulta, nenhuma escrita', async () => {
    const b = criarBanco({ [RETIDAS]: [retida('A', 0, { lid_jid: '999@lid' })] });
    expect(await chamar(b)).toEqual([]);
    expect(b.escritas).toEqual([]);
  });

  it('as retidas ENTRAM na conversa, na ordem do carimbo, como HISTÓRIA — e o payload é apagado', async () => {
    const b = criarBanco({
      messages: [gatilho()],
      [RETIDAS]: [retida('B', 30), retida('A', 0)],
    });
    await chamar(b);

    const falas = b.tabelas.messages.filter((m) => m.sender_type === 'customer');
    expect(falas.map((m) => [m.message_id, m.created_at])).toEqual([
      ['A', iso(0)],
      ['B', iso(30)],
    ]);
    expect(falas[0]).toMatchObject({
      conversation_id: 'conv-1',
      remote_jid: TEL,
      remote_jid_lid: LID,
      content_text: 'fala A',
    });
    // Há mensagem mais nova na conversa (a que trouxe o telefone): nunca é `nova`.
    expect(h.persistInboundMessage).not.toHaveBeenCalled();
    for (const linha of b.tabelas[RETIDAS]) {
      expect(linha).toMatchObject({ situacao: 'entregue', resolvida_por: 'religacao', payload: null });
      expect(linha.message_id).toEqual(expect.any(String));
    }
  });

  it('a cópia NORMAL da mesma mensagem já entrou → duplicada, sem segunda bolha', async () => {
    const b = criarBanco({ messages: [gatilho()], [RETIDAS]: [retida('A', 0)] });
    await chamar(b, { jaGravada: vi.fn().mockResolvedValue(true) });
    expect(b.tabelas.messages).toHaveLength(1);
    expect(b.tabelas[RETIDAS][0]).toMatchObject({ situacao: 'duplicada', payload: null });
  });

  it('o UNIQUE da conversa arbitra a corrida entre dois religadores', async () => {
    const b = criarBanco({
      messages: [gatilho(), { id: 'm', conversation_id: 'conv-1', message_id: 'A', created_at: iso(0) }],
      [RETIDAS]: [retida('A', 0)],
    });
    await chamar(b);
    expect(b.tabelas.messages.filter((m) => m.message_id === 'A')).toHaveLength(1);
    expect(b.tabelas[RETIDAS][0].situacao).toBe('duplicada');
  });

  it('uma retida que FALHA não segura as outras — e continua retida para a próxima tentativa', async () => {
    const b = criarBanco({
      messages: [gatilho()],
      [RETIDAS]: [retida('A', 0), retida('B', 30)],
    });
    const jaGravada = vi
      .fn()
      .mockRejectedValueOnce(new Error('rede fora'))
      .mockResolvedValue(false);
    await expect(chamar(b, { jaGravada })).resolves.toEqual([]);
    const porId = Object.fromEntries(b.tabelas[RETIDAS].map((l) => [l.provider_message_id, l.situacao]));
    expect(porId).toEqual({ A: 'retida', B: 'entregue' });
  });

  it('payload que não normaliza (nem com o telefone) segue retido — nunca vira bolha torta', async () => {
    const b = criarBanco({
      messages: [gatilho()],
      [RETIDAS]: [retida('A', 0, { payload: { key: { remoteJid: LID }, message: {} } })],
    });
    await chamar(b);
    expect(b.tabelas.messages).toHaveLength(1);
    expect(b.tabelas[RETIDAS][0].situacao).toBe('retida');
  });

  it('ANEXO: a conexão é a DA RETIDA — quem destravou pode ter chegado por outro número', async () => {
    const payload = {
      key: { remoteJid: LID, fromMe: false, id: 'DOC' },
      message: { documentMessage: { mimetype: 'application/pdf', fileLength: '43407' } },
      messageTimestamp: CARIMBO,
    };
    const b = criarBanco({
      messages: [gatilho()],
      [RETIDAS]: [retida('DOC', 0, { channel_id: 'canal-DA-RETIDA', payload })],
    });
    const anexos = await chamar(b);
    expect(anexos).toEqual([
      {
        item: payload,
        contentType: 'document',
        messageId: expect.any(String),
        bytes: 43407,
        channelId: 'canal-DA-RETIDA',
      },
    ]);
    // …e a própria mensagem é carimbada com a conexão por onde ELA chegou.
    expect(b.tabelas.messages.find((m) => m.message_id === 'DOC')!.channel_id).toBe('canal-DA-RETIDA');
  });

  it('conexão da retida APAGADA (null): a mensagem entra sem carimbo e o anexo leva null — nunca o canal do webhook', async () => {
    const payload = {
      key: { remoteJid: LID, fromMe: false, id: 'IMG' },
      message: { imageMessage: { mimetype: 'image/jpeg' } },
      messageTimestamp: CARIMBO,
    };
    const b = criarBanco({
      messages: [gatilho()],
      [RETIDAS]: [retida('IMG', 0, { channel_id: null, payload })],
    });
    const [anexo] = await chamar(b);
    expect(anexo.channelId).toBeNull();
    expect('channelId' in anexo).toBe(true);
  });

  it('eco do ESCRITÓRIO retido (o caso de 09/09) entra como equipe pelo celular', async () => {
    const payload = {
      key: { remoteJid: LID, fromMe: true, id: '3EB047' },
      pushName: 'Você',
      message: { conversation: 'Boa tarde!' },
      messageTimestamp: CARIMBO,
    };
    const b = criarBanco({
      messages: [gatilho()],
      [RETIDAS]: [retida('3EB047', 0, { from_me: true, payload })],
    });
    await chamar(b);
    expect(b.tabelas.messages.find((m) => m.message_id === '3EB047')).toMatchObject({
      sender_type: 'agent',
      from_me: true,
      from_device: true,
      status: 'sent',
    });
    expect(b.rpcs[0].args.p_conta_nao_lida).toBe(false);
  });

  it('leitura das retidas que FALHA: lista vazia, sem lançar — a mensagem normal não paga por isto', async () => {
    const b = criarBanco({ messages: [gatilho()] });
    b.falhas[RETIDAS] = { code: '42P01', message: 'relation does not exist' };
    await expect(chamar(b)).resolves.toEqual([]);
    expect(b.tabelas.messages).toHaveLength(1);
  });
});
