import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { criarBanco } from './banco.test-helper';
import {
  MAXIMO_DE_RETIDAS_POR_VEZ,
  marcarDuplicada,
  marcarEntregue,
  reter,
  retidasDoLid,
  semMidiaEmbutida,
  type Ocorrencia,
} from './retidas';

const TABELA = 'cb_mensagens_sem_telefone';
const LID = '100000000000101@lid';

const ocorrencia = (over: Partial<Ocorrencia> = {}): Ocorrencia => ({
  accountId: 'conta-1',
  channelId: 'canal-1',
  lidJid: LID,
  providerMessageId: 'ACA5A459',
  fromMe: false,
  tipo: 'text',
  carimboSeg: 1789747434,
  ...over,
});

describe('retidas', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('reter guarda o payload cru, com o carimbo do WhatsApp', async () => {
    const b = criarBanco();
    const payload = { key: { remoteJid: LID, id: 'ACA5A459' }, message: { conversation: 'oi' } };
    expect(await reter(b.db, ocorrencia(), payload)).toBe(true);
    expect(b.tabelas[TABELA]).toHaveLength(1);
    expect(b.tabelas[TABELA][0]).toMatchObject({
      account_id: 'conta-1',
      channel_id: 'canal-1',
      lid_jid: LID,
      provider_message_id: 'ACA5A459',
      from_me: false,
      tipo: 'text',
      carimbo: '2026-09-18T16:03:54.000Z',
      situacao: 'retida',
      payload,
    });
  });

  it('mídia EMBUTIDA em base64 não vai para o banco — o resto do payload fica intacto', async () => {
    const payload = {
      key: { remoteJid: LID, id: 'DOC' },
      message: { documentMessage: { mimetype: 'application/pdf' }, base64: 'A'.repeat(1000) },
      messageTimestamp: 1789747434,
    };
    expect(semMidiaEmbutida(payload)).toEqual({
      key: { remoteJid: LID, id: 'DOC' },
      message: { documentMessage: { mimetype: 'application/pdf' } },
      messageTimestamp: 1789747434,
    });
    // Não muta o item da rota (ela ainda vai buscar o anexo com ele).
    expect(payload.message.base64).toHaveLength(1000);
    // Sem base64, devolve o MESMO objeto.
    const limpo = { key: {}, message: { conversation: 'oi' } };
    expect(semMidiaEmbutida(limpo)).toBe(limpo);
    for (const torto of [null, undefined, 'x', { message: null }]) {
      expect(semMidiaEmbutida(torto)).toBe(torto);
    }

    const b = criarBanco();
    await reter(b.db, ocorrencia(), payload);
    expect(JSON.stringify(b.tabelas[TABELA][0].payload)).not.toContain('AAAA');
  });

  it('REENTREGA do webhook não vira segunda linha nem desfaz o desfecho', async () => {
    const b = criarBanco();
    await reter(b.db, ocorrencia(), { n: 1 });
    await marcarEntregue(b.db, ocorrencia(), 'religacao', 'msg-1');
    expect(await reter(b.db, ocorrencia(), { n: 2 })).toBe(true);
    expect(b.tabelas[TABELA]).toHaveLength(1);
    expect(b.tabelas[TABELA][0]).toMatchObject({ situacao: 'entregue', payload: null });
  });

  it('reter que FALHA devolve false (o chamador cai no descarte de sempre)', async () => {
    const b = criarBanco();
    b.falhas[TABELA] = { code: '42P01', message: 'relation does not exist' };
    expect(await reter(b.db, ocorrencia(), {})).toBe(false);
  });

  it('retidasDoLid: só as `retida` daquele LID e daquela conta, da mais antiga para a mais nova', async () => {
    const b = criarBanco();
    await reter(b.db, ocorrencia({ providerMessageId: 'B', carimboSeg: 200 }), { n: 'B' });
    await reter(b.db, ocorrencia({ providerMessageId: 'A', carimboSeg: 100 }), { n: 'A' });
    await reter(b.db, ocorrencia({ providerMessageId: 'C', lidJid: '999@lid' }), {});
    await reter(b.db, ocorrencia({ providerMessageId: 'D', accountId: 'outra' }), {});
    await reter(b.db, ocorrencia({ providerMessageId: 'E', carimboSeg: 50 }), {});
    await marcarEntregue(b.db, ocorrencia({ providerMessageId: 'E', carimboSeg: 50 }), 'religacao', 'm');

    const r = await retidasDoLid(b.db, 'conta-1', LID);
    expect(r.map((x) => x.providerMessageId)).toEqual(['A', 'B']);
    expect(r[0]).toMatchObject({ channelId: 'canal-1', payload: { n: 'A' } });
  });

  // Religar roda DENTRO do processamento de uma mensagem normal: um acúmulo
  // (a conexão que ficou semanas sem religar ninguém) não pode virar uma
  // rajada de centenas de inserts no caminho dela.
  it('retidasDoLid devolve UMA página — as mais antigas primeiro; o resto sai nas passadas seguintes (`religarOResto`)', async () => {
    const b = criarBanco();
    for (let i = 0; i < MAXIMO_DE_RETIDAS_POR_VEZ + 7; i++) {
      await reter(b.db, ocorrencia({ providerMessageId: `M${String(i).padStart(3, '0')}`, carimboSeg: 1000 + i }), {});
    }
    const r = await retidasDoLid(b.db, 'conta-1', LID);
    expect(r).toHaveLength(MAXIMO_DE_RETIDAS_POR_VEZ);
    expect(r[0].providerMessageId).toBe('M000');
  });

  it('retidasDoLid que FALHA devolve lista vazia — a mensagem normal não paga por isto', async () => {
    const b = criarBanco();
    b.falhas[TABELA] = { code: 'PGRST205', message: 'tabela ausente' };
    expect(await retidasDoLid(b.db, 'conta-1', LID)).toEqual([]);
  });

  it('tabela AUSENTE (deploy antes da 1010) avisa UMA vez por processo, não a cada mensagem', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const b = criarBanco();
    b.falhas[TABELA] = { code: '42P01', message: 'relation does not exist' };
    for (let i = 0; i < 5; i++) await retidasDoLid(b.db, 'conta-1', LID);
    // ≤ 1: outro teste deste arquivo pode já ter gasto o aviso do processo.
    expect(erro.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('marcarEntregue na CHEGADA cria a linha já entregue, sem payload (o registro conta todas)', async () => {
    const b = criarBanco();
    await marcarEntregue(b.db, ocorrencia(), 'acervo', 'msg-9');
    expect(b.tabelas[TABELA][0]).toMatchObject({
      situacao: 'entregue',
      resolvida_por: 'acervo',
      message_id: 'msg-9',
      payload: null,
    });
    expect(b.tabelas[TABELA][0].resolvida_em).toEqual(expect.any(String));
  });

  it('marcarEntregue sobre uma RETIDA apaga o payload (conteúdo de cliente só enquanto é preciso)', async () => {
    const b = criarBanco();
    await reter(b.db, ocorrencia(), { message: { conversation: 'segredo do cliente' } });
    await marcarEntregue(b.db, ocorrencia(), 'religacao', 'msg-1');
    expect(b.tabelas[TABELA]).toHaveLength(1);
    expect(b.tabelas[TABELA][0]).toMatchObject({ situacao: 'entregue', payload: null });
  });

  it('marcarDuplicada tem CERCA: não rebaixa o que outro religador já entregou', async () => {
    const b = criarBanco();
    await reter(b.db, ocorrencia(), { n: 1 });
    const id = b.tabelas[TABELA][0].id as string;
    await marcarEntregue(b.db, ocorrencia(), 'religacao', 'msg-1');
    await marcarDuplicada(b.db, id);
    expect(b.tabelas[TABELA][0].situacao).toBe('entregue');
  });

  it('marcarDuplicada sobre uma retida: vira duplicada e perde o payload', async () => {
    const b = criarBanco();
    await reter(b.db, ocorrencia(), { n: 1 });
    await marcarDuplicada(b.db, b.tabelas[TABELA][0].id as string);
    expect(b.tabelas[TABELA][0]).toMatchObject({ situacao: 'duplicada', payload: null });
  });

  it('nenhuma das quatro lança quando o cliente do banco lança', async () => {
    const quebrado = {
      from: () => {
        throw new Error('rede fora');
      },
    } as never;
    await expect(reter(quebrado, ocorrencia(), {})).resolves.toBe(false);
    await expect(retidasDoLid(quebrado, 'conta-1', LID)).resolves.toEqual([]);
    await expect(marcarEntregue(quebrado, ocorrencia(), 'acervo', 'm')).resolves.toBeUndefined();
    await expect(marcarDuplicada(quebrado, 'x')).resolves.toBeUndefined();
  });
});
