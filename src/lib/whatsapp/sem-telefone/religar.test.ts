import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  persistInboundMessage: vi.fn(),
  persistDeviceMessage: vi.fn(),
}));
vi.mock('@/lib/whatsapp/inbound-store', () => h);

import { criarBanco, type Banco, type Linha } from './banco.test-helper';
import { religarOResto, religarRetidas } from './religar';
import { MAXIMO_DE_PASSADAS_DO_RESTO, MAXIMO_DE_RETIDAS_POR_VEZ } from './retidas';

const RETIDAS = 'cb_mensagens_sem_telefone';
const LID = '100000000000101@lid';
const TEL = '5583900001111@s.whatsapp.net';
const CARIMBO = 1789747434; // 2026-09-18T16:03:54Z
const ms = (seg: number) => (CARIMBO + seg) * 1000;
const NADA = { anexos: [], haMais: false, resolvidas: 0 };
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
      expect(await chamar(b, { lidJid })).toEqual(NADA);
    }
    expect(from).not.toHaveBeenCalled();
  });

  it('o telefone de quem destrava tem de ser JID de telefone — LID nunca vira telefone', async () => {
    const b = criarBanco({ [RETIDAS]: [retida('A', 0)] });
    const from = vi.spyOn(b.db, 'from');
    for (const telefoneJid of [null, undefined, LID, '5583900001111', '120363000000000000@g.us']) {
      expect(await chamar(b, { telefoneJid })).toEqual(NADA);
    }
    expect(from).not.toHaveBeenCalled();
    expect(b.tabelas[RETIDAS][0].situacao).toBe('retida');
  });

  it('sem retida daquele LID: uma consulta, nenhuma escrita', async () => {
    const b = criarBanco({ [RETIDAS]: [retida('A', 0, { lid_jid: '999@lid' })] });
    expect(await chamar(b)).toEqual(NADA);
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
    // Só a B saiu de `retida`: é o que conta como progresso da passada.
    await expect(chamar(b, { jaGravada })).resolves.toEqual({ anexos: [], haMais: false, resolvidas: 1 });
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
    const { anexos } = await chamar(b);
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
    const {
      anexos: [anexo],
    } = await chamar(b);
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
    await expect(chamar(b)).resolves.toEqual(NADA);
    expect(b.tabelas.messages).toHaveLength(1);
  });
});

// ============================================================
// Mais retidas do que UMA página (Codex, PR #226, 3ª rodada). A página é o que
// limita o atraso do anexo de uma mensagem atual; o RESTO não pode esperar a
// próxima mensagem daquele LID — para quem não escreve de novo, isso é nunca, e
// a cauda são justamente as falas mais RECENTES dele.
// ============================================================
describe('mais retidas do que uma página', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    h.persistInboundMessage.mockReset().mockResolvedValue(null);
    h.persistDeviceMessage.mockReset().mockResolvedValue(null);
  });
  afterEach(() => vi.restoreAllMocks());

  /** `n` retidas, uma por segundo, com ids que ordenam como o carimbo. */
  const pilha = (n: number) =>
    Array.from({ length: n }, (_, i) => retida(`R${String(i + 1).padStart(3, '0')}`, i));
  const situacoes = (b: Banco) =>
    Object.fromEntries(b.tabelas[RETIDAS].map((l) => [l.provider_message_id, l.situacao]));
  const retidasAinda = (b: Banco) =>
    b.tabelas[RETIDAS].filter((l) => l.situacao === 'retida').map((l) => l.provider_message_id);

  function pedido(b: Banco, over: Partial<Parameters<typeof religarOResto>[0]> = {}) {
    return {
      db: b.db,
      accountId: 'conta-1',
      ownerUserId: 'dono-1',
      lidJid: LID,
      telefoneJid: TEL,
      conversationId: 'conv-1',
      jaGravada: vi.fn().mockResolvedValue(false),
      agoraMs: ms(601),
      ...over,
    };
  }

  it('a primeira passada religa UMA página — as mais antigas — e avisa que HÁ MAIS', async () => {
    const b = criarBanco({ messages: [gatilho()], [RETIDAS]: pilha(MAXIMO_DE_RETIDAS_POR_VEZ + 2) });
    const r = await religarRetidas(pedido(b));
    expect(r).toMatchObject({ haMais: true, resolvidas: MAXIMO_DE_RETIDAS_POR_VEZ });
    expect(retidasAinda(b)).toEqual(['R011', 'R012']);
  });

  it('página que NÃO vem cheia: não há mais — a rota nem chama a segunda etapa', async () => {
    const b = criarBanco({ messages: [gatilho()], [RETIDAS]: pilha(MAXIMO_DE_RETIDAS_POR_VEZ - 1) });
    expect(await religarRetidas(pedido(b))).toMatchObject({ haMais: false, resolvidas: 9 });
    expect(retidasAinda(b)).toEqual([]);
  });

  it('religarOResto drena TODAS as páginas seguintes, na ordem do carimbo — sem esperar outra mensagem', async () => {
    const b = criarBanco({ messages: [gatilho()], [RETIDAS]: pilha(25) });
    await religarRetidas(pedido(b)); // a página que roda antes dos anexos do lote
    expect(retidasAinda(b)).toHaveLength(15);

    await religarOResto(pedido(b));
    expect(retidasAinda(b)).toEqual([]);
    const falas = b.tabelas.messages.filter((m) => m.sender_type === 'customer');
    expect(falas.map((m) => m.message_id)).toEqual(pilha(25).map((l) => l.provider_message_id));
    // Todas como HISTÓRIA: há mensagem mais nova na conversa (a que trouxe o telefone).
    expect(h.persistInboundMessage).not.toHaveBeenCalled();
  });

  it('devolve os ANEXOS de todas as passadas, cada um com a conexão da SUA retida', async () => {
    const comDoc = (l: Linha, canal: string): Linha => ({
      ...l,
      channel_id: canal,
      payload: {
        ...(l.payload as Linha),
        message: { documentMessage: { mimetype: 'application/pdf', fileLength: '1000' } },
      },
    });
    const linhas = pilha(23);
    linhas[12] = comDoc(linhas[12], 'canal-A'); // cai na 1ª passada do resto
    linhas[21] = comDoc(linhas[21], 'canal-B'); // cai na 2ª
    const b = criarBanco({ messages: [gatilho()], [RETIDAS]: linhas });
    await religarRetidas(pedido(b));
    const anexos = await religarOResto(pedido(b));
    expect(anexos.map((a) => [a.contentType, a.channelId])).toEqual([
      ['document', 'canal-A'],
      ['document', 'canal-B'],
    ]);
  });

  it('é trabalho LIMITADO: para no teto de passadas, e o que sobra continua retido para a próxima mensagem', async () => {
    const total = MAXIMO_DE_RETIDAS_POR_VEZ * (MAXIMO_DE_PASSADAS_DO_RESTO + 1) + 7;
    const b = criarBanco({ messages: [gatilho()], [RETIDAS]: pilha(total) });
    await religarRetidas(pedido(b));
    const from = vi.spyOn(b.db, 'from');
    await religarOResto(pedido(b));
    const leituras = from.mock.calls.filter(([t]) => t === RETIDAS).length;
    // Uma leitura de página por passada + um `marcarEntregue` por retida.
    expect(leituras).toBe(MAXIMO_DE_PASSADAS_DO_RESTO * (1 + MAXIMO_DE_RETIDAS_POR_VEZ));
    expect(retidasAinda(b)).toHaveLength(7);
    // As que sobraram são as mais NOVAS — a ordem do fio foi respeitada até onde deu.
    expect(retidasAinda(b)[0]).toBe(`R${String(total - 6).padStart(3, '0')}`);
  });

  it('passada que não resolve NINGUÉM para o laço: a cabeça presa não vira leitura repetida', async () => {
    const b = criarBanco({ messages: [gatilho()], [RETIDAS]: pilha(30) });
    b.falhas.messages = { code: '57014', message: 'canceling statement due to statement timeout' };
    const from = vi.spyOn(b.db, 'from');
    await expect(religarOResto(pedido(b))).resolves.toEqual([]);
    expect(from.mock.calls.filter(([t]) => t === RETIDAS)).toHaveLength(1);
    expect(retidasAinda(b)).toHaveLength(30);
  });

  it('retida que FALHA na cabeça da fila não prende a CAUDA — e ela mesma segue retida, para a próxima mensagem', async () => {
    const b = criarBanco({ messages: [gatilho()], [RETIDAS]: pilha(14) });
    const jaGravada = vi.fn(async (id: string) => {
      if (id === 'R001') throw new Error('rede fora');
      return false;
    });
    expect(await religarRetidas(pedido(b, { jaGravada }))).toMatchObject({ haMais: true, resolvidas: 9 });
    await religarOResto(pedido(b, { jaGravada }));
    // A cauda (R011–R014) entrou, embora a R001 continue na frente dela na fila.
    // ⚠️ A R001 volta na página do resto (a leitura parte sempre da mais antiga)
    // e é tentada mais UMA vez — mas falhar não rende passada: com a página
    // incompleta o laço acaba, e ela fica com o destino de sempre (a próxima
    // mensagem do LID).
    expect(jaGravada.mock.calls.filter(([id]) => id === 'R001')).toHaveLength(2);
    expect(retidasAinda(b)).toEqual(['R001']);
    expect(Object.entries(situacoes(b)).filter(([, x]) => x === 'entregue')).toHaveLength(13);
  });

  it('leitura que falha no meio: devolve o que já tinha, sem lançar', async () => {
    const b = criarBanco({ messages: [gatilho()], [RETIDAS]: pilha(25) });
    await religarRetidas(pedido(b));
    b.falhas[RETIDAS] = { code: '57014', message: 'timeout' };
    await expect(religarOResto(pedido(b))).resolves.toEqual([]);
  });
});
